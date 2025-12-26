import { z } from 'zod';

// Flexible metric data schema - accepts various metric formats
const MetricEntrySchema = z.record(z.string(), z.unknown());

const MetricDataSchema = z.object({
  data: z.array(MetricEntrySchema).optional(),
  name: z.string(),
  units: z.string(),
});

// Flexible measurement schema
const MeasurementSchema = z
  .object({
    date: z.union([z.string(), z.date()]),
    qty: z.number(),
    source: z.string(),
    units: z.string(),
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
  activeEnergy: z.record(z.string(), z.unknown()).optional(),
  activeEnergyBurned: MeasurementSchema,
  distance: MeasurementSchema,
  duration: z.number(),
  end: z.union([z.string(), z.date()]),
  heartRateData: z.array(z.record(z.string(), z.unknown())).optional(),
  heartRateRecovery: z.array(z.record(z.string(), z.unknown())).optional(),
  humidity: MeasurementSchema,
  id: z.string(),
  intensity: MeasurementSchema,
  name: z.string(),
  route: z.array(LocationSchema).optional(),
  start: z.union([z.string(), z.date()]),
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
