import { IngestData } from '../models/IngestData';
import { IngestResponse } from '../models/IngestResponse';
import { mapMetric, Metric } from '../models/Metric';
import { storage } from '../storage';
import { Logger } from '../utils/logger';

export const saveMetrics = async (
  ingestData: IngestData,
  log?: Logger,
): Promise<IngestResponse> => {
  const timer = log?.startTimer('saveMetrics');

  try {
    const response: IngestResponse = {};
    const metricsData = ingestData.data.metrics;

    if (!metricsData || metricsData.length === 0) {
      log?.debug('No metrics data provided');
      response.metrics = {
        message: 'No metrics data provided',
        success: true,
      };
      timer?.end('info', 'No metrics to save');
      return response;
    }

    log?.debug('Processing metrics', { rawMetricsCount: metricsData.length });

    // Group metrics by type and map the data
    const metricsByType: Record<string, Metric[]> = {};
    for (const metric of metricsData) {
      const mappedMetrics = mapMetric(metric);
      const key = metric.name;
      metricsByType[key] ??= [];
      metricsByType[key].push(...mappedMetrics);
    }

    // Save all metrics in a single batch operation to avoid race conditions
    const result = await storage.saveAllMetrics(metricsByType);

    const totalSaved = result.saved;
    const totalUpdated = result.updated;
    const metricTypesCount = Object.keys(metricsByType).length;

    response.metrics = {
      message: `${String(totalSaved)} metrics saved, ${String(totalUpdated)} updated across ${String(metricTypesCount)} metric types`,
      success: true,
    };

    timer?.end('info', 'Metrics saved', {
      metricTypes: Object.keys(metricsByType).length,
      saved: totalSaved,
      updated: totalUpdated,
    });

    return response;
  } catch (error) {
    timer?.end('error', 'Failed to save metrics', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    const errorResponse: IngestResponse = {
      metrics: {
        error: error instanceof Error ? error.message : 'Error saving metrics',
        success: false,
      },
    };

    return errorResponse;
  }
};
