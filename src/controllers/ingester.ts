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

interface PrepResults {
  response: IngestResponse;
  metricsPrep?: MetricsPrepResult;
  workoutsPrep?: WorkoutsPrepResult;
}

/**
 * Surface validation-skipped record count to the client so silent drops are visible.
 * Mutates response in place.
 */
function attachSkippedCount(response: IngestResponse, metricsPrep?: MetricsPrepResult): void {
  if (!metricsPrep || metricsPrep.skippedRecords <= 0) return;
  response.metrics ??= { success: true };
  response.metrics.skippedRecords = metricsPrep.skippedRecords;
}

/**
 * Determine HTTP status code from response.
 */
function getResponseStatus(response: IngestResponse): number {
  const values = [response.metrics, response.workouts].filter(
    (r): r is NonNullable<typeof r> => r !== undefined,
  );
  const allFailed = values.every((r) => !r.success);
  if (allFailed) return 500;
  const hasErrors = values.some((r) => !r.success);
  return hasErrors ? 207 : 200;
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

  const hasNewMetrics = metricsPrep !== undefined && metricsPrep.newCount > 0;
  const hasNewWorkouts = workoutsPrep !== undefined && workoutsPrep.newCount > 0;

  if (!hasNewMetrics && !hasNewWorkouts) {
    attachSkippedCount(response, metricsPrep);
    return { response, status: getResponseStatus(response) };
  }

  // PHASE 2: Write to Obsidian
  const emptyMetrics: MetricsPrepResult = { newCount: 0, newMetrics: {}, skippedRecords: 0 };
  const emptyWorkouts: WorkoutsPrepResult = { newCount: 0, newWorkouts: [] };
  await writeToObsidian(
    metricsPrep ?? emptyMetrics,
    workoutsPrep ?? emptyWorkouts,
    hasNewMetrics,
    hasNewWorkouts,
    response,
    log,
  );

  attachSkippedCount(response, metricsPrep);

  return { response, status: getResponseStatus(response) };
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

    log.debugValidationPassed({
      metricsCount: data.data.metrics?.length ?? 0,
      metricTypes: data.data.metrics?.map((m) => m.name) ?? [],
      workoutsCount: data.data.workouts?.length ?? 0,
      workoutTypes: data.data.workouts?.map((w) => w.name) ?? [],
    });

    log.info('Processing ingestion request', {
      hasMetrics: (data.data.metrics?.length ?? 0) > 0,
      hasWorkouts: (data.data.workouts?.length ?? 0) > 0,
      metricsCount: data.data.metrics?.length ?? 0,
      workoutsCount: data.data.workouts?.length ?? 0,
    });

    const { response, status } = await processIngestion(data, log);

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
