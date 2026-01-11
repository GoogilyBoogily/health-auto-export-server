/**
 * Metric data transformation utilities.
 * Transforms raw metric data from the API into typed metric objects.
 */

import { MetricName } from '../types';

import type {
  BaseMetric,
  BloodPressureMetric,
  HeartRateMetric,
  Metric,
  MetricData,
  SleepMetric,
} from '../types';

export const mapMetric = (
  metric: MetricData,
): (BloodPressureMetric | HeartRateMetric | Metric | SleepMetric)[] => {
  // Cast to MetricName for switch comparison - unknown strings handled by default case
  const metricName = metric.name as MetricName;
  switch (metricName) {
    case MetricName.BLOOD_PRESSURE: {
      const bpData = metric.data as BloodPressureMetric[];
      return bpData.map((measurement) => ({
        date: new Date(measurement.date),
        diastolic: measurement.diastolic,
        metadata: measurement.metadata,
        source: measurement.source,
        systolic: measurement.systolic,
        units: metric.units,
      }));
    }
    case MetricName.HEART_RATE: {
      const hrData = metric.data as HeartRateMetric[];
      return hrData.map((measurement) => ({
        Avg: measurement.Avg,
        date: new Date(measurement.date),
        Max: measurement.Max,
        metadata: measurement.metadata,
        Min: measurement.Min,
        source: measurement.source,
        units: metric.units,
      }));
    }
    case MetricName.SLEEP_ANALYSIS: {
      const sleepData = metric.data as SleepMetric[];
      return sleepData.map((measurement) => ({
        asleep: measurement.asleep,
        awake: measurement.awake,
        core: measurement.core,
        date: new Date(measurement.date),
        deep: measurement.deep,
        inBed: measurement.inBed,
        inBedEnd: new Date(measurement.inBedEnd),
        inBedStart: new Date(measurement.inBedStart),
        metadata: measurement.metadata,
        rem: measurement.rem,
        sleepEnd: new Date(measurement.sleepEnd),
        sleepStart: new Date(measurement.sleepStart),
        source: measurement.source,
        totalSleep: measurement.totalSleep,
        units: metric.units,
      }));
    }
    default: {
      const baseData = metric.data as BaseMetric[];
      return baseData.map((measurement) => ({
        date: new Date(measurement.date),
        metadata: measurement.metadata,
        qty: measurement.qty,
        source: measurement.source,
        units: metric.units,
      }));
    }
  }
};
