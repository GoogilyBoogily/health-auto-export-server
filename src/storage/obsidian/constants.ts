/**
 * Obsidian storage constants.
 * Path and template for daily tracking files.
 *
 * NOTE: These values are now configured in config.ts.
 * This file re-exports them for use in the storage layer.
 */

import { ObsidianConfig } from '../../config';

export const DAILY_TRACKING_PATH: string = ObsidianConfig.dailyPath;

export const DAILY_BODY_TEMPLATE: string = ObsidianConfig.bodyTemplate;
