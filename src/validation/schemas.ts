import { z } from 'zod';

/**
 * One metric block. Applied per element so a single malformed block is skipped and counted
 * rather than rejecting an entire sync of 70 well-formed blocks.
 *
 * `data` elements stay `unknown` on purpose. Validating them here would make one bad datum
 * fail the whole array — a 300-datum block discarded and reported as a single skipped record.
 * The mapper checks each datum individually, where the counting is already per-datum.
 */
export const MetricDataSchema = z.object({
  data: z.array(z.unknown()),
  name: z.string(),
  units: z.string(),
});

// Simple measurement schema - just qty and units (no date/source)
const SimpleMeasurementSchema = z.object({
  qty: z.number(),
  units: z.string(),
});

// Full measurement schema - includes date and source
const FullMeasurementSchema = z.object({
  date: z.union([z.string(), z.date()]),
  qty: z.number(),
  source: z.string(),
  units: z.string(),
});

// Flexible measurement schema - accepts either simple or full format
const MeasurementSchema = z.union([SimpleMeasurementSchema, FullMeasurementSchema]).optional();

// Heart rate summary schema - nested max/avg/min structure
const HeartRateSummarySchema = z
  .object({
    avg: SimpleMeasurementSchema.optional(),
    max: SimpleMeasurementSchema.optional(),
    min: SimpleMeasurementSchema.optional(),
  })
  .optional();

/**
 * One workout. Applied per element so a single malformed workout is skipped and counted
 * rather than rejecting the whole payload.
 *
 * Every field the app actually sends is declared here. Zod strips undeclared keys, so an
 * omission is silent data loss — `basalEnergy`, `elevationUp`, `speed`, `totalEnergy` and
 * `walkingAndRunningDistance` arrive on every workout and were previously being dropped at
 * this boundary. `route` is deliberately absent: nothing stores GPS points, so validating
 * ~1400 of them per workout bought nothing.
 */
export const WorkoutDataSchema = z.object({
  activeEnergy: z.array(z.record(z.string(), z.unknown())).optional(),
  activeEnergyBurned: MeasurementSchema,
  avgHeartRate: SimpleMeasurementSchema.optional(),
  basalEnergy: z.array(z.record(z.string(), z.unknown())).optional(),
  distance: MeasurementSchema,
  duration: z.number(),
  elevationUp: MeasurementSchema,
  end: z.union([z.string(), z.date()]),
  flightsClimbed: MeasurementSchema,
  heartRate: HeartRateSummarySchema,
  heartRateData: z.array(z.record(z.string(), z.unknown())).optional(),
  heartRateRecovery: z.array(z.record(z.string(), z.unknown())).optional(),
  humidity: MeasurementSchema,
  id: z.string(),
  intensity: MeasurementSchema,
  isIndoor: z.boolean().optional(),
  location: z.string().optional(),
  maxHeartRate: SimpleMeasurementSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  name: z.string(),
  speed: MeasurementSchema,
  start: z.union([z.string(), z.date()]),
  stepCadence: SimpleMeasurementSchema.optional(),
  stepCount: z.array(z.record(z.string(), z.unknown())).optional(),
  temperature: MeasurementSchema,
  totalEnergy: MeasurementSchema,
  walkingAndRunningDistance: z.array(z.record(z.string(), z.unknown())).optional(),
});

/**
 * Request envelope. Deliberately loose: only a genuinely unusable shape (no `data` object,
 * or `metrics`/`workouts` not arrays) rejects the request. Individual elements are validated
 * in the controllers so one bad datum cannot discard a sync carrying thousands of good ones.
 */
export const IngestDataSchema = z.object({
  data: z.object({
    metrics: z.array(z.unknown()).optional(),
    workouts: z.array(z.unknown()).optional(),
  }),
});
