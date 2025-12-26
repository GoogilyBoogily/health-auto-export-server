import { z } from 'zod';

// Flexible metric data schema - accepts various metric formats
const MetricEntrySchema = z.record(z.string(), z.unknown());

const MetricDataSchema = z.object({
  name: z.string(),
  units: z.string(),
  data: z.array(MetricEntrySchema).optional(),
});

// Flexible measurement schema
const MeasurementSchema = z
  .object({
    qty: z.number(),
    units: z.string(),
    date: z.union([z.string(), z.date()]),
    source: z.string(),
  })
  .optional();

// Location schema for workout routes
const LocationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  course: z.number().optional(),
  courseAccuracy: z.number().optional(),
  speed: z.number().optional(),
  speedAccuracy: z.number().optional(),
  altitude: z.number().optional(),
  verticalAccuracy: z.number().optional(),
  horizontalAccuracy: z.number().optional(),
  timestamp: z.union([z.string(), z.date()]),
});

// Workout data schema
const WorkoutDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  start: z.union([z.string(), z.date()]),
  end: z.union([z.string(), z.date()]),
  duration: z.number(),
  distance: MeasurementSchema,
  activeEnergyBurned: MeasurementSchema,
  activeEnergy: z.record(z.string(), z.unknown()).optional(),
  heartRateData: z.array(z.record(z.string(), z.unknown())).optional(),
  heartRateRecovery: z.array(z.record(z.string(), z.unknown())).optional(),
  stepCount: z.array(z.record(z.string(), z.unknown())).optional(),
  temperature: MeasurementSchema,
  humidity: MeasurementSchema,
  intensity: MeasurementSchema,
  route: z.array(LocationSchema).optional(),
});

// Main ingest data schema
export const IngestDataSchema = z.object({
  data: z.object({
    metrics: z.array(MetricDataSchema).optional(),
    workouts: z.array(WorkoutDataSchema).optional(),
  }),
});

export type ValidatedIngestData = z.infer<typeof IngestDataSchema>;
