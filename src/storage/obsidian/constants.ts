/**
 * Obsidian storage constants.
 * Paths and templates for tracking files.
 */

import type { TrackingType } from '../../types';

export const TRACKING_PATHS: Record<TrackingType, string> = {
  health: '70-79 Journals & Self-Tracking/78 Health Tracking',
  sleep: '70-79 Journals & Self-Tracking/77 Sleep Tracking',
  workout: '70-79 Journals & Self-Tracking/76 Workout Tracking',
};

export const TRACKING_BODY_TEMPLATES: Record<TrackingType, string> = {
  health: '# {{date}}\n\n## Health Metrics',
  sleep: '\n## Sleep Log',
  workout: '\n\n## Workout Log',
};
