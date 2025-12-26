import { MetricName } from './MetricName';

export interface BaseMetric extends MetricCommon {
  qty: number;
  units: string;
}

export interface BloodPressureMetric extends MetricCommon {
  diastolic: number;
  systolic: number;
  units: string;
}

export interface HeartRateMetric extends MetricCommon {
  Avg: number;
  Max: number;
  Min: number;
  units: string;
}

/**
 * Common fields shared by all metric types.
 * Used for deduplication (date + source) and type-safe access.
 */
export interface MetricCommon {
  date: Date;
  metadata?: Record<string, string>;
  source?: string;
}

export interface MetricData {
  data: Metric[];
  name: MetricName | string;
  units: string;
}

export interface SleepMetric extends MetricCommon {
  awake: number;
  core: number;
  deep: number;
  inBed: number;
  inBedEnd: Date;
  inBedStart: Date;
  rem: number;
  sleepEnd: Date;
  sleepStart: Date;
  units: string;
  asleep?: number;
  totalSleep?: number;
}

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

export type Metric = BaseMetric | BloodPressureMetric | HeartRateMetric | SleepMetric;
