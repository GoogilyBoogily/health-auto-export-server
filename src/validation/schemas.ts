import { z } from 'zod';

// Flexible metric data schema - accepts various metric formats
const MetricEntrySchema = z.record(z.string(), z.unknown());

const MetricDataSchema = z.object({
  data: z.array(MetricEntrySchema).optional(),
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

// Location schema for workout routes
const LocationSchema = z.object({
  altitude: z.number().optional(),
  course: z.number().optional(),
  courseAccuracy: z.number().optional(),
  horizontalAccuracy: z.number().optional(),
  latitude: z.number(),
  longitude: z.number(),
  speed: z.number().optional(),
  speedAccuracy: z.number().optional(),
  timestamp: z.union([z.string(), z.date()]),
  verticalAccuracy: z.number().optional(),
});

// Workout data schema
const WorkoutDataSchema = z.object({
  activeEnergy: z.array(z.record(z.string(), z.unknown())).optional(),
  activeEnergyBurned: MeasurementSchema,
  avgHeartRate: SimpleMeasurementSchema.optional(),
  distance: MeasurementSchema,
  duration: z.number(),
  end: z.union([z.string(), z.date()]),
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
  route: z.array(LocationSchema).optional(),
  start: z.union([z.string(), z.date()]),
  stepCadence: SimpleMeasurementSchema.optional(),
  stepCount: z.array(z.record(z.string(), z.unknown())).optional(),
  temperature: MeasurementSchema,
});

// Main ingest data schema
export const IngestDataSchema = z.object({
  data: z.object({
    metrics: z.array(MetricDataSchema).optional(),
    workouts: z.array(WorkoutDataSchema).optional(),
  }),
});

export type ValidatedIngestData = z.infer<typeof IngestDataSchema>;
