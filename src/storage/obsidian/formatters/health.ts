/**
 * Health metrics formatter.
 * Transforms raw metrics into Obsidian health tracking frontmatter.
 */

/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison -- Comparing string metricType to enum values */

import { MetricName } from '../../../types';
import { logger } from '../../../utils/logger';
import { getDateKey, getMonthKey, getWeekKey, parseDateKey, roundTo } from '../utils/dateUtilities';

import type { BaseMetric, HealthFrontmatter, HeartRateMetric, Metric } from '../../../types';

// Metrics that contribute to health tracking
const HEALTH_METRICS = new Set<string>([
  MetricName.ACTIVE_ENERGY,
  MetricName.BLOOD_OXYGEN_SATURATION,
  MetricName.HEART_RATE,
  MetricName.HEART_RATE_VARIABILITY,
  MetricName.RESPIRATORY_RATE,
  MetricName.RESTING_ENERGY,
  MetricName.RESTING_HEART_RATE,
  MetricName.STEP_COUNT,
  MetricName.VO2_MAX,
  MetricName.WALKING_HEART_RATE,
  MetricName.WALKING_HEART_RATE_AVERAGE,
  MetricName.WALKING_RUNNING_DISTANCE,
]);

type MetricsByType = Record<string, Metric[]>;

/**
 * Create health frontmatter from metrics for a specific date.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complex switch statement processing multiple metric types
export function createHealthFrontmatter(
  dateKey: string,
  metricsByType: MetricsByType,
  existing?: HealthFrontmatter,
): HealthFrontmatter {
  const date = parseDateKey(dateKey);
  const frontmatter: HealthFrontmatter = existing ?? {
    date: dateKey,
    monthKey: getMonthKey(date),
    type: 'health',
    weekKey: getWeekKey(date),
  };

  // Always update date keys in case they need recalculation
  frontmatter.date = dateKey;
  frontmatter.weekKey = getWeekKey(date);
  frontmatter.monthKey = getMonthKey(date);

  // Process each metric type
  for (const [metricType, metrics] of Object.entries(metricsByType)) {
    switch (metricType) {
      case MetricName.ACTIVE_ENERGY: {
        const energyMetrics = metrics as BaseMetric[];
        const newEnergy = roundTo(sum(energyMetrics.map((m) => m.qty)), 2);
        // Accumulate with existing value to aggregate across multiple requests
        frontmatter.activeEnergy = roundTo((existing?.activeEnergy ?? 0) + newEnergy, 2);
        break;
      }

      case MetricName.BLOOD_OXYGEN_SATURATION: {
        const spo2Metrics = metrics as BaseMetric[];
        const avgSpo2 = average(spo2Metrics.map((m) => m.qty));
        if (avgSpo2 !== undefined) {
          frontmatter.bloodOxygenSaturation = roundTo(avgSpo2, 2);
        }
        break;
      }

      case MetricName.HEART_RATE: {
        const hrMetrics = metrics as HeartRateMetric[];
        if (hrMetrics.length > 0) {
          frontmatter.heartRateMin = Math.round(Math.min(...hrMetrics.map((m) => m.Min)));
          frontmatter.heartRateMax = Math.round(Math.max(...hrMetrics.map((m) => m.Max)));
          frontmatter.heartRateAvg = Math.round(average(hrMetrics.map((m) => m.Avg)) ?? 0);
        }
        break;
      }

      case MetricName.HEART_RATE_VARIABILITY: {
        const hrvMetrics = metrics as BaseMetric[];
        const values = hrvMetrics.map((m) => m.qty);
        if (values.length > 0) {
          frontmatter.hrvAvg = roundTo(average(values) ?? 0, 2);
          frontmatter.hrvMin = Math.round(Math.min(...values));
          frontmatter.hrvMax = Math.round(Math.max(...values));
          frontmatter.hrvSamples = values.length;
        }
        break;
      }

      case MetricName.RESPIRATORY_RATE: {
        const rrMetrics = metrics as BaseMetric[];
        const avgRr = average(rrMetrics.map((m) => m.qty));
        if (avgRr !== undefined) {
          frontmatter.respiratoryRate = roundTo(avgRr, 2);
        }
        break;
      }

      case MetricName.RESTING_ENERGY: {
        const restingMetrics = metrics as BaseMetric[];
        const newEnergy = roundTo(sum(restingMetrics.map((m) => m.qty)), 2);
        // Accumulate with existing value to aggregate across multiple requests
        frontmatter.restingEnergy = roundTo((existing?.restingEnergy ?? 0) + newEnergy, 2);
        break;
      }

      case MetricName.RESTING_HEART_RATE: {
        const restingHr = metrics as BaseMetric[];
        // Use the most recent value
        const lastRestingHr = restingHr.at(-1);
        if (lastRestingHr?.qty) {
          frontmatter.restingHeartRate = Math.round(lastRestingHr.qty);
        }
        break;
      }

      case MetricName.STEP_COUNT: {
        const stepMetrics = metrics as BaseMetric[];
        const newSteps = Math.round(sum(stepMetrics.map((m) => m.qty)));
        // Accumulate with existing value to aggregate across multiple requests
        frontmatter.stepCount = (existing?.stepCount ?? 0) + newSteps;
        break;
      }

      case MetricName.VO2_MAX: {
        const vo2Metrics = metrics as BaseMetric[];
        // Use the most recent value
        const lastVo2 = vo2Metrics.at(-1);
        if (lastVo2?.qty) {
          frontmatter.vo2Max = roundTo(lastVo2.qty, 1);
        }
        break;
      }

      case MetricName.WALKING_HEART_RATE:
      case MetricName.WALKING_HEART_RATE_AVERAGE: {
        const walkingHr = metrics as BaseMetric[];
        // Use the most recent value
        const lastWalkingHr = walkingHr.at(-1);
        if (lastWalkingHr?.qty) {
          frontmatter.walkingHeartRate = Math.round(lastWalkingHr.qty);
        }
        break;
      }

      case MetricName.WALKING_RUNNING_DISTANCE: {
        const distanceMetrics = metrics as BaseMetric[];
        const newDistance = roundTo(sum(distanceMetrics.map((m) => m.qty)), 2);
        // Accumulate with existing value to aggregate across multiple requests
        frontmatter.walkingRunningDistance = roundTo(
          (existing?.walkingRunningDistance ?? 0) + newDistance,
          2,
        );
        break;
      }

      default: {
        // Log unhandled metric types that are in HEALTH_METRICS but not in switch
        if (HEALTH_METRICS.has(metricType)) {
          logger.warn('Unhandled health metric type in switch statement', { metricType });
        }
      }
    }
  }

  return frontmatter;
}

/**
 * Aggregate metrics by date for health tracking.
 * Groups metrics by date and returns a map of date -> metrics by type.
 */
export function groupHealthMetricsByDate(metricsByType: MetricsByType): Map<string, MetricsByType> {
  const byDate = new Map<string, MetricsByType>();

  for (const [metricType, metrics] of Object.entries(metricsByType)) {
    if (!isHealthMetric(metricType)) continue;

    for (const metric of metrics) {
      const dateKey = getDateKey((metric as BaseMetric).date);
      let dateMetrics = byDate.get(dateKey);
      if (!dateMetrics) {
        dateMetrics = {};
        byDate.set(dateKey, dateMetrics);
      }
      dateMetrics[metricType] ??= [];
      dateMetrics[metricType].push(metric);
    }
  }

  return byDate;
}

/**
 * Check if a metric type is relevant for health tracking.
 */
export function isHealthMetric(metricType: string): boolean {
  return HEALTH_METRICS.has(metricType);
}

/**
 * Merge new health data with existing frontmatter.
 * New values override existing ones.
 */
export function mergeHealthFrontmatter(
  existing: HealthFrontmatter,
  newData: Partial<HealthFrontmatter>,
): HealthFrontmatter {
  return {
    ...existing,
    ...newData,
    // Ensure type is always correct
    type: 'health',
  };
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return sum(values) / values.length;
}

// Helper functions
function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
