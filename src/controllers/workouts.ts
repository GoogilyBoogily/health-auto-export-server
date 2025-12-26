import { IngestData } from '../models/IngestData';
import { IngestResponse } from '../models/IngestResponse';
import { storage } from '../storage';
import { Logger } from '../utils/logger';

export const saveWorkouts = async (
  ingestData: IngestData,
  log?: Logger,
): Promise<IngestResponse> => {
  const timer = log?.startTimer('saveWorkouts');

  try {
    const response: IngestResponse = {};
    const workouts = ingestData.data.workouts;

    if ((workouts?.length ?? 0) === 0) {
      log?.debug('No workout data provided');
      response.workouts = {
        message: 'No workout data provided',
        success: true,
      };
      timer?.end('info', 'No workouts to save');
      return response;
    }

    log?.debug('Processing workouts', { count: workouts.length });

    // Save workouts to file storage
    const result = await storage.saveWorkouts(workouts);

    response.workouts = {
      message: `${String(result.saved)} workouts saved, ${String(result.updated)} updated`,
      success: result.success,
    };

    timer?.end('info', 'Workouts saved', {
      saved: result.saved,
      updated: result.updated,
    });

    return response;
  } catch (error) {
    timer?.end('error', 'Failed to save workouts', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    const errorResponse: IngestResponse = {
      workouts: {
        error: error instanceof Error ? error.message : 'An error occurred',
        message: 'Workouts not saved',
        success: false,
      },
    };

    return errorResponse;
  }
};
