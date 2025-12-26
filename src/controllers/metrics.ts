import { IngestData } from '../models/IngestData';
import { IngestResponse } from '../models/IngestResponse';
import { Metric, mapMetric } from '../models/Metric';
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
        success: true,
        message: 'No metrics data provided',
      };
      timer?.end('info', 'No metrics to save');
      return response;
    }

    log?.debug('Processing metrics', { rawMetricsCount: metricsData.length });

    // Group metrics by type and map the data
    const metricsByType = metricsData.reduce(
      (acc, metric) => {
        const mappedMetrics = mapMetric(metric);
        const key = metric.name;
        acc[key] = acc[key] || [];
        acc[key].push(...mappedMetrics);
        return acc;
      },
      {} as {
        [key: string]: Metric[];
      },
    );

    // Save all metrics in a single batch operation to avoid race conditions
    const result = await storage.saveAllMetrics(metricsByType);

    const totalSaved = result.saved;
    const totalUpdated = result.updated;

    response.metrics = {
      success: true,
      message: `${totalSaved} metrics saved, ${totalUpdated} updated across ${Object.keys(metricsByType).length} metric types`,
    };

    timer?.end('info', 'Metrics saved', {
      saved: totalSaved,
      updated: totalUpdated,
      metricTypes: Object.keys(metricsByType).length,
    });

    return response;
  } catch (error) {
    timer?.end('error', 'Failed to save metrics', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    const errorResponse: IngestResponse = {};
    errorResponse.metrics = {
      success: false,
      error: error instanceof Error ? error.message : 'Error saving metrics',
    };

    return errorResponse;
  }
};
