import { MetricName } from './MetricName';

export interface MetricData {
  name: string;
  units: string;
  data: Metric[];
}

/**
 * Common fields shared by all metric types.
 * Used for deduplication (date + source) and type-safe access.
 */
export interface MetricCommon {
  date: Date;
  source?: string;
  metadata?: Record<string, string>;
}

export interface BaseMetric extends MetricCommon {
  qty: number;
  units: string;
}

export interface BloodPressureMetric extends MetricCommon {
  systolic: number;
  diastolic: number;
  units: string;
}

export interface HeartRateMetric extends MetricCommon {
  Min: number;
  Avg: number;
  Max: number;
  units: string;
}

export interface SleepMetric extends MetricCommon {
  inBedStart: Date;
  inBedEnd: Date;
  sleepStart: Date;
  sleepEnd: Date;
  core: number;
  rem: number;
  deep: number;
  awake: number;
  inBed: number;
  asleep?: number;
  totalSleep?: number;
  units: string;
}

export const mapMetric = (
  metric: MetricData,
): (Metric | BloodPressureMetric | SleepMetric | HeartRateMetric)[] => {
  switch (metric.name) {
    case MetricName.BLOOD_PRESSURE: {
      const bpData = metric.data as BloodPressureMetric[];
      return bpData.map((measurement) => ({
        systolic: measurement.systolic,
        diastolic: measurement.diastolic,
        units: metric.units,
        date: new Date(measurement.date),
        source: measurement.source,
        metadata: measurement.metadata,
      }));
    }
    case MetricName.HEART_RATE: {
      const hrData = metric.data as HeartRateMetric[];
      return hrData.map((measurement) => ({
        Min: measurement.Min,
        Avg: measurement.Avg,
        Max: measurement.Max,
        units: metric.units,
        date: new Date(measurement.date),
        source: measurement.source,
        metadata: measurement.metadata,
      }));
    }
    case MetricName.SLEEP_ANALYSIS: {
      const sleepData = metric.data as SleepMetric[];
      return sleepData.map((measurement) => ({
        date: new Date(measurement.date),
        inBedStart: new Date(measurement.inBedStart),
        inBedEnd: new Date(measurement.inBedEnd),
        sleepStart: new Date(measurement.sleepStart),
        sleepEnd: new Date(measurement.sleepEnd),
        core: measurement.core,
        rem: measurement.rem,
        deep: measurement.deep,
        awake: measurement.awake,
        inBed: measurement.inBed,
        asleep: measurement.asleep,
        totalSleep: measurement.totalSleep,
        units: metric.units,
        source: measurement.source,
        metadata: measurement.metadata,
      }));
    }
    default: {
      const baseData = metric.data as BaseMetric[];
      return baseData.map((measurement) => ({
        qty: measurement.qty,
        units: metric.units,
        date: new Date(measurement.date),
        source: measurement.source,
        metadata: measurement.metadata,
      }));
    }
  }
};

export type Metric = BaseMetric | BloodPressureMetric | SleepMetric | HeartRateMetric;
