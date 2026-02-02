/**
 * Obsidian storage constants.
 * Paths and templates for tracking files.
 *
 * NOTE: These values are now configured in config.ts.
 * This file re-exports them for backwards compatibility.
 */

import { ObsidianConfig } from '../../config';

import type { TrackingType } from '../../types';

export const TRACKING_PATHS: Record<TrackingType, string> = ObsidianConfig.trackingPaths;

export const TRACKING_BODY_TEMPLATES: Record<TrackingType, string> = ObsidianConfig.bodyTemplates;
