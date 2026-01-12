import { Request, Response } from 'express';

import { debugLog, debugValidation, isDebugEnabled } from '../utils/debugLogger';
import { IngestDataSchema } from '../validation/schemas';
import { saveMetrics } from './metrics';
import { saveWorkouts } from './workouts';

import type { IngestData, IngestResponse } from '../types';

export const ingestData = async (req: Request, res: Response) => {
  const { log } = req;
  const timer = log.startTimer('ingestData');
  let response: IngestResponse = {};

  try {
    // Validate request body with Zod
    const parseResult = IngestDataSchema.safeParse(req.body);
    if (!parseResult.success) {
      log.warn('Invalid request body', { errors: parseResult.error.issues });
      debugValidation(log, false, req.body, parseResult.error.issues);
      res.status(400).json({
        details: parseResult.error.issues,
        error: 'Invalid request format',
      });
      return;
    }

    const data = parseResult.data as IngestData;

    // Debug: Log successful validation with data structure summary
    if (isDebugEnabled()) {
      debugValidation(log, true, {
        metricsCount: data.data.metrics?.length ?? 0,
        metricTypes: data.data.metrics?.map((m) => m.name) ?? [],
        workoutsCount: data.data.workouts?.length ?? 0,
        workoutTypes: data.data.workouts?.map((w) => w.name) ?? [],
      });
    }

    log.info('Processing ingestion request', {
      hasMetrics: (data.data.metrics?.length ?? 0) > 0,
      hasWorkouts: (data.data.workouts?.length ?? 0) > 0,
      metricsCount: data.data.metrics?.length ?? 0,
      workoutsCount: data.data.workouts?.length ?? 0,
    });

    // Use Promise.allSettled for fault tolerance - one failure doesn't stop the other
    const results = await Promise.allSettled([saveMetrics(data, log), saveWorkouts(data, log)]);

    const [metricsResult, workoutsResult] = results;
    if (metricsResult.status === 'fulfilled') {
      response = { ...response, ...metricsResult.value };
    } else {
      const reason = metricsResult.reason as Error | undefined;
      log.error('Metrics save failed', reason);
      response.metrics = {
        error: reason?.message ?? 'Unknown error',
        success: false,
      };
    }
    if (workoutsResult.status === 'fulfilled') {
      response = { ...response, ...workoutsResult.value };
    } else {
      const reason = workoutsResult.reason as Error | undefined;
      log.error('Workouts save failed', reason);
      response.workouts = {
        error: reason?.message ?? 'Unknown error',
        success: false,
      };
    }

    const responseValues = [response.metrics, response.workouts].filter(
      (r): r is NonNullable<typeof r> => r !== undefined,
    );
    const hasErrors = responseValues.some((r) => !r.success);
    const allFailed = responseValues.every((r) => !r.success);

    if (allFailed) {
      timer.end('error', 'Ingestion completely failed', { response });
      res.status(500).json(response);
      return;
    }

    timer.end(hasErrors ? 'warn' : 'info', 'Ingestion completed', {
      hasPartialErrors: hasErrors,
      metricsResult: response.metrics,
      workoutsResult: response.workouts,
    });

    // Debug: Log final processing results
    debugLog(log, 'TRANSFORM', 'Ingestion processing complete', {
      hasErrors,
      metricsResult: response.metrics,
      workoutsResult: response.workouts,
    });

    res.status(hasErrors ? 207 : 200).json(response);
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
