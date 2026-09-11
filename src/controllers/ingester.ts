import { Request, Response } from 'express';

import { RetryConfig } from '../config';
import { getObsidianStorage } from '../storage';
import { withRetry } from '../utils/retry';
import { IngestDataSchema } from '../validation/schemas';
import { prepareMetrics } from './metrics';
import { prepareWorkoutsData } from './workouts';

import type { IngestData, IngestResponse } from '../types';
import type { Logger } from '../utils/logger';
import type { MetricsPrepResult } from './metrics';
import type { WorkoutsPrepResult } from './workouts';

/** The data kinds a request can carry. */
type DataKind = 'metrics' | 'workouts';

interface PrepResults {
  response: IngestResponse;
  metricsPrep?: MetricsPrepResult;
  workoutsPrep?: WorkoutsPrepResult;
}

/**
 * Surface validation-skipped record counts to the client so silent drops are visible.
 * Mutates response in place.
 */
function attachSkippedCounts(
  response: IngestResponse,
  metricsPrep?: MetricsPrepResult,
  workoutsPrep?: WorkoutsPrepResult,
): void {
  if (metricsPrep && metricsPrep.skippedRecords > 0) {
    response.metrics ??= { success: true };
    response.metrics.skippedRecords = metricsPrep.skippedRecords;
  }
  if (workoutsPrep && workoutsPrep.skippedRecords > 0) {
    response.workouts ??= { success: true };
    response.workouts.skippedRecords = workoutsPrep.skippedRecords;
  }
}

/**
 * Which kinds this request actually sent. Read from the raw envelope rather than from the prep
 * results, so a preparation step that threw still counts as attempted.
 */
function attemptedKinds(data: IngestData): DataKind[] {
  const kinds: DataKind[] = [];
  if ((data.data.metrics?.length ?? 0) > 0) kinds.push('metrics');
  if ((data.data.workouts?.length ?? 0) > 0) kinds.push('workouts');
  return kinds;
}

/**
 * A stable fingerprint of a payload, for spotting the same sync arriving twice.
 *
 * Counts rather than contents: two deliveries of one export agree on every count, and a genuinely
 * new sync almost never does.
 */
function describePayload(data: IngestData): string {
  const metricBlocks = data.data.metrics?.length ?? 0;
  const workouts = data.data.workouts?.length ?? 0;
  const datums = (data.data.metrics ?? []).reduce<number>(
    (total, block) => total + ((block as null | { data?: unknown[] })?.data?.length ?? 0),
    0,
  );
  return `blocks=${String(metricBlocks)} datums=${String(datums)} workouts=${String(workouts)}`;
}

/**
 * Determine HTTP status code from response.
 *
 * Anything dropped during validation yields 207, not 200: the request partially succeeded and
 * saying so is the whole point of counting the drops. A 200 with a `skippedRecords` field
 * buried in the body is exactly the silent partial success this is meant to surface.
 *
 * Only the data kinds the request actually carried count towards the verdict. The placeholder
 * this controller writes for an absent kind ("No workout data provided") reports success, and
 * every real request carries metrics or workouts but never both — so counting placeholders made
 * "everything failed" unreachable and answered a total storage failure with 207. A 2xx tells the
 * exporter the sync landed, and it never sends it again.
 */
function getResponseStatus(response: IngestResponse, attempted: DataKind[]): number {
  const values = attempted
    .map((kind) => response[kind])
    .filter((r): r is NonNullable<typeof r> => r !== undefined);
  if (values.length === 0) return 200;

  if (values.every((r) => !r.success)) return 500;

  const hasErrors = values.some((r) => !r.success);
  const hasSkips = values.some((r) => (r.skippedRecords ?? 0) > 0);
  return hasErrors || hasSkips ? 207 : 200;
}

/**
 * Core ingestion logic — prepare data, write to Obsidian, and return response.
 */
async function processIngestion(
  data: IngestData,
  log: Logger,
): Promise<{ response: IngestResponse; status: number }> {
  // PHASE 1: Data preparation (mapping + validation)
  const { metricsPrep, response, workoutsPrep } = runDataPreparation(data, log);
  const attempted = attemptedKinds(data);

  const hasNewMetrics = metricsPrep !== undefined && metricsPrep.newCount > 0;
  const hasNewWorkouts = workoutsPrep !== undefined && workoutsPrep.newCount > 0;

  if (!hasNewMetrics && !hasNewWorkouts) {
    attachSkippedCounts(response, metricsPrep, workoutsPrep);
    return { response, status: getResponseStatus(response, attempted) };
  }

  // PHASE 2: Write to Obsidian
  const emptyMetrics: MetricsPrepResult = { newCount: 0, newMetrics: {}, skippedRecords: 0 };
  const emptyWorkouts: WorkoutsPrepResult = { newCount: 0, newWorkouts: [], skippedRecords: 0 };
  await writeToObsidian(
    metricsPrep ?? emptyMetrics,
    workoutsPrep ?? emptyWorkouts,
    hasNewMetrics,
    hasNewWorkouts,
    response,
    log,
  );

  attachSkippedCounts(response, metricsPrep, workoutsPrep);

  return { response, status: getResponseStatus(response, attempted) };
}

/**
 * Run data preparation (mapping + validation) and populate response for failures/empty cases.
 */
function runDataPreparation(data: IngestData, log: Logger): PrepResults {
  const response: IngestResponse = {};

  let metricsPrep: MetricsPrepResult | undefined;
  let workoutsPrep: WorkoutsPrepResult | undefined;

  try {
    metricsPrep = prepareMetrics(data, log);
  } catch (error) {
    log.error('Metrics preparation failed', error);
    response.metrics = {
      error: error instanceof Error ? error.message : 'Unknown error',
      success: false,
    };
  }

  try {
    workoutsPrep = prepareWorkoutsData(data, log);
  } catch (error) {
    log.error('Workouts preparation failed', error);
    response.workouts = {
      error: error instanceof Error ? error.message : 'Unknown error',
      success: false,
    };
  }

  // Fill in status for empty cases
  if (metricsPrep?.newCount === 0) {
    response.metrics = { message: 'No new metrics to save', success: true };
  }
  if (workoutsPrep?.newCount === 0) {
    response.workouts = { message: 'No new workouts to save', success: true };
  }
  if (metricsPrep === undefined && !response.metrics) {
    response.metrics = { message: 'No metrics data provided', success: true };
  }
  if (workoutsPrep === undefined && !response.workouts) {
    response.workouts = { message: 'No workout data provided', success: true };
  }

  return { metricsPrep, response, workoutsPrep };
}

/**
 * Write prepared data to Obsidian and populate response messages.
 */
async function writeToObsidian(
  metricsPrep: MetricsPrepResult,
  workoutsPrep: WorkoutsPrepResult,
  hasNewMetrics: boolean,
  hasNewWorkouts: boolean,
  response: IngestResponse,
  log: Logger,
): Promise<void> {
  const obsidianStorage = getObsidianStorage();

  log.debugStorage('Preparing Obsidian write', {
    data: {
      healthMetricTypes: hasNewMetrics ? Object.keys(metricsPrep.newMetrics).length : 0,
      newWorkoutCount: hasNewWorkouts ? workoutsPrep.newCount : 0,
    },
    fileType: 'daily',
  });

  const obsidianResult = await withRetry(
    () =>
      obsidianStorage.saveDailyData({
        metrics: hasNewMetrics ? metricsPrep.newMetrics : undefined,
        workouts: hasNewWorkouts ? workoutsPrep.newWorkouts : undefined,
      }),
    {
      baseDelayMs: RetryConfig.baseDelayMs,
      log,
      maxRetries: RetryConfig.maxRetries,
      operationName: 'Obsidian write',
      // saveDailyData reports per-date write failures by returning, not throwing, so the
      // retry has to be told what failure looks like or it would never fire.
      shouldRetry: (result) => !result.success,
    },
  );

  log.debugStorage('Obsidian write completed', {
    metadata: { saved: obsidianResult.saved, updated: obsidianResult.updated },
  });

  if (!obsidianResult.success) {
    const errorDetail = obsidianResult.errors?.join('; ') ?? 'Unknown storage error';
    if (hasNewMetrics) {
      response.metrics = { error: `Storage error: ${errorDetail}`, success: false };
    }
    if (hasNewWorkouts) {
      response.workouts = { error: `Storage error: ${errorDetail}`, success: false };
    }
    return;
  }

  if (hasNewMetrics) {
    const metricTypesCount = Object.keys(metricsPrep.newMetrics).length;
    response.metrics = {
      message: `${String(metricsPrep.newCount)} metrics saved across ${String(metricTypesCount)} metric types`,
      success: true,
    };
  }

  if (hasNewWorkouts) {
    response.workouts = {
      message: `${String(workoutsPrep.newCount)} workouts saved`,
      success: true,
    };
  }
}

export const ingestData = async (req: Request, res: Response) => {
  const { log } = req;
  const timer = log.startTimer('ingestData');

  try {
    // Validate request body with Zod
    const parseResult = IngestDataSchema.safeParse(req.body);
    if (!parseResult.success) {
      log.warn('Invalid request body', { errors: parseResult.error.issues });
      log.debugValidationFailed(req.body, parseResult.error.issues);
      res.status(400).json({
        details: parseResult.error.issues,
        error: 'Invalid request format',
      });
      return;
    }

    const data = parseResult.data as IngestData;

    // Envelope validation only — element shapes are still unvalidated here, so read names
    // defensively rather than assuming them.
    const readName = (entry: unknown): unknown => (entry as null | { name?: unknown })?.name;

    log.debugValidationPassed({
      metricsCount: data.data.metrics?.length ?? 0,
      metricTypes: data.data.metrics?.map((m) => readName(m)) ?? [],
      workoutsCount: data.data.workouts?.length ?? 0,
      workoutTypes: data.data.workouts?.map((w) => readName(w)) ?? [],
    });

    log.info('Processing ingestion request', {
      hasMetrics: (data.data.metrics?.length ?? 0) > 0,
      hasWorkouts: (data.data.workouts?.length ?? 0) > 0,
      metricsCount: data.data.metrics?.length ?? 0,
      workoutsCount: data.data.workouts?.length ?? 0,
    });

    const { response, status } = await processIngestion(data, log);

    // The exporter has never received a 207 from us — every status in ~20,000 logged client
    // events is 200 or 401 — so nobody knows whether it treats one as delivered or retries.
    // A retry would silently re-send the same payload and compound duplication. Log a stable
    // signature of what we answered 207 to; an identical signature appearing twice in the log
    // is the exporter retrying, and that is the whole answer.
    if (status === 207) {
      log.warn('Answered 207 — watch for this signature repeating, which means a client retry', {
        payloadSignature: describePayload(data),
        skipped: {
          metrics: response.metrics?.skippedRecords ?? 0,
          workouts: response.workouts?.skippedRecords ?? 0,
        },
      });
    }

    timer.end(status === 200 ? 'info' : 'warn', 'Ingestion completed', {
      hasPartialErrors: status === 207,
      metricsResult: response.metrics,
      workoutsResult: response.workouts,
    });

    log.debugLog('TRANSFORM', 'Ingestion processing complete', {
      hasErrors: status !== 200,
      metricsResult: response.metrics,
      workoutsResult: response.workouts,
    });

    res.status(status).json(response);
  } catch (error) {
    timer.end('error', 'Failed to process ingestion request', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'Failed to process request',
      message: error instanceof Error ? error.message : 'An error occurred',
    });
  }
};
