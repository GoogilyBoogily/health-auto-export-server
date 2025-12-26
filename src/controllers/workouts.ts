import { IngestData } from '../models/IngestData';
import { IngestResponse } from '../models/IngestResponse';
import { WorkoutData } from '../models/Workout';
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

    if (!workouts || !workouts.length) {
      log?.debug('No workout data provided');
      response.workouts = {
        success: true,
        message: 'No workout data provided',
      };
      timer?.end('info', 'No workouts to save');
      return response;
    }

    log?.debug('Processing workouts', { count: workouts.length });

    // Save workouts to file storage
    const result = await storage.saveWorkouts(workouts as WorkoutData[]);

    response.workouts = {
      success: result.success,
      message: `${result.saved} workouts saved, ${result.updated} updated`,
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

    const errorResponse: IngestResponse = {};
    errorResponse.workouts = {
      success: false,
      message: 'Workouts not saved',
      error: error instanceof Error ? error.message : 'An error occurred',
    };

    return errorResponse;
  }
};
