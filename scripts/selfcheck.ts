/**
 * Assertion-based self-check for the ingest behaviours that have no other guard.
 *
 * There is no test framework here on purpose. This covers the handful of paths where a
 * regression is silent — a failure reported as success, a datum dropped without a count, stored
 * sleep deleted — because those are exactly the ones that will not announce themselves.
 *
 * Writes only to a temp directory. Usage: bun run check
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ingestData } from '../src/controllers/ingester';
import { prepareMetrics } from '../src/controllers/metrics';
import { collapseReadings, createHealthFrontmatter } from '../src/storage/obsidian/formatters/health';
import { createSleepFrontmatter } from '../src/storage/obsidian/formatters/sleep';
import { createWorkoutFrontmatter } from '../src/storage/obsidian/formatters/workout';
import { initObsidianStorage } from '../src/storage';
import { resolveBody, serializeMarkdown } from '../src/storage/obsidian/utils/markdownUtilities';
import { Logger } from '../src/utils/logger';
import { withRetry } from '../src/utils/retry';

import type { SleepMetric } from '../src/types';

const scratch = mkdtempSync(path.join(tmpdir(), 'hae-selfcheck-'));
const log = new Logger('selfcheck');
const checks: string[] = [];

function pass(name: string): void {
  checks.push(name);
  console.log(`  ok  ${name}`);
}

/** Drive the real controller and return the status it chose. */
async function post(body: unknown): Promise<{ body: unknown; status: number }> {
  let status = 0;
  let payload: unknown;
  const res = {
    json(value: unknown) {
      payload = value;
      return res;
    },
    status(code: number) {
      status = code;
      return res;
    },
  };
  await ingestData({ body, log } as never, res as never);
  return { body: payload, status };
}

const datum = (hour: number, qty: number = 1) => ({
  date: `2026-08-11 ${String(hour).padStart(2, '0')}:00:00 -0500`,
  qty,
  source: 'selfcheck',
});

// --- A total storage failure must be a 5xx. A 2xx tells the exporter the sync landed. ---
{
  const notADirectory = path.join(scratch, 'blocked');
  writeFileSync(notADirectory, 'this is a file, so no vault can be created under it');
  initObsidianStorage(notADirectory);

  const { status } = await post({
    data: { metrics: [{ data: [datum(9)], name: 'step_count', units: 'count' }] },
  });
  assert.equal(status, 500, `metrics-only storage failure must be 500, got ${String(status)}`);
  pass('storage failure on a metrics-only request answers 500');
}

// --- Everything below writes to a real scratch vault. ---
initObsidianStorage(path.join(scratch, 'vault'));

{
  const { status } = await post({
    data: { metrics: [{ data: [datum(9), datum(10)], name: 'step_count', units: 'count' }] },
  });
  assert.equal(status, 200, 'a clean request is 200');
  pass('clean request answers 200');
}

// --- One unusable datum must not take its block with it. ---
{
  const good = Array.from({ length: 50 }, (_, index) => datum(index % 24));
  const result = prepareMetrics(
    { data: { metrics: [{ data: [...good, 42], name: 'step_count', units: 'count' }] } },
    log,
  );
  assert.equal(result?.newCount, 50, 'the 50 good datums survive a non-object sibling');
  assert.equal(result.skippedRecords, 1, 'exactly one datum is counted as skipped');
  pass('one malformed datum is skipped, its block survives');
}

// --- `date` decides the filename, so it is typed as strictly as the measurements. ---
for (const badDate of [true, 0, ['2026-08-11'], {}] as unknown[]) {
  const result = prepareMetrics(
    {
      data: {
        metrics: [{ data: [{ date: badDate, qty: 1 }], name: 'step_count', units: 'count' }],
      },
    },
    log,
  );
  assert.equal(result?.newCount, 0, `date ${JSON.stringify(badDate)} must not be accepted`);
  assert.equal(result.skippedRecords, 1, 'a rejected datum is counted');
}
pass('non-string dates are rejected and counted');

// --- A sleep segment with no duration used to reach the vault as `.nan`. ---
{
  const segment = (startDate: string, endDate: string, value: string, qty?: unknown) => ({
    endDate,
    qty,
    source: 'selfcheck',
    startDate,
    value,
  });
  const result = prepareMetrics(
    {
      data: {
        metrics: [
          {
            data: [
              segment('2026-08-10 23:00:00 -0500', '2026-08-11 00:00:00 -0500', 'Core', 1),
              segment('2026-08-11 00:00:00 -0500', '2026-08-11 01:00:00 -0500', 'Deep'),
            ],
            name: 'sleep_analysis',
            units: 'hr',
          },
        ],
      },
    },
    log,
  );
  assert.equal(result?.skippedRecords, 1, 'the duration-less segment is counted as skipped');

  const frontmatter = createSleepFrontmatter('2026-08-11', {
    sleepMetrics: result.newMetrics.sleep_analysis as SleepMetric[],
  });
  const yaml = serializeMarkdown(frontmatter, 'body\n');
  assert.ok(!yaml.includes('.nan'), 'no NaN reaches the vault');
  assert.equal((frontmatter.sleepSummary as { totalSleep: number }).totalSleep, 1);
  pass('a segment with no duration is skipped, not stored as .nan');
}

// --- Sleep stages merge by same-stage interval overlap, not by exact key. ---
{
  const stage = (startTime: string, endTime: string, stageName: string, duration: number) => ({
    duration,
    endTime,
    source: 'selfcheck',
    stage: stageName,
    startTime,
  });
  const stored = {
    date: '2026-08-12',
    sleepStages: [
      stage('2026-08-11T23:00:00-05:00', '2026-08-12T00:00:00-05:00', 'core', 1),
      stage('2026-08-12T02:00:00-05:00', '2026-08-12T02:45:00-05:00', 'awake', 0.75),
      stage('2026-08-12T03:00:00-05:00', '2026-08-12T04:00:00-05:00', 'rem', 1),
    ],
  };

  // Apple re-reports the same core stage with its boundaries shifted five minutes.
  const session = (startIso: string, endIso: string, stageName: string) => ({
    segments: [
      {
        duration: 1,
        endTime: new Date(endIso),
        rawEndTime: endIso,
        rawStartTime: startIso,
        source: 'selfcheck',
        stage: stageName,
        startTime: new Date(startIso),
      },
    ],
    sourceDate: '2026-08-12',
  });

  const merged = createSleepFrontmatter(
    '2026-08-12',
    {
      sleepMetrics: [
        session('2026-08-11T23:05:00-05:00', '2026-08-12T00:05:00-05:00', 'core'),
      ] as unknown as SleepMetric[],
    },
    stored as never,
  );

  const stages = merged.sleepStages as { stage: string }[];
  assert.equal(stages.length, 3, 'a boundary revision replaces its predecessor, it does not add');
  assert.ok(
    stages.some((entry) => entry.stage === 'awake'),
    'a stage the incoming payload never mentions is left alone',
  );

  const summary = merged.sleepSummary as { segmentCount: number; totalSleep: number };
  assert.equal(summary.segmentCount, stages.length, 'the summary counts the stages beside it');
  assert.ok(Number.isFinite(summary.totalSleep), 'and its totals are real numbers');
  pass('sleep stages merge by overlap, and the summary agrees with them');
}

// --- A throw on the last attempt must not be masked by an earlier soft failure. ---
{
  let attempts = 0;
  await assert.rejects(
    withRetry(
      async () => {
        attempts++;
        if (attempts === 1) return { saved: 5, success: false, updated: 2 };
        throw new Error('disk full');
      },
      { baseDelayMs: 1, maxRetries: 3, operationName: 'selfcheck', shouldRetry: (r) => !r.success },
    ),
    /disk full/,
    'the exception from the final attempt propagates',
  );
  pass('a thrown failure is not replaced by an earlier returned one');
}


// --- The dedup key: hourly buckets fold, event totals and discrete readings do not. ---
{
  const reading = (time: string, value: number, source = 'watch') => ({ source, time, value });
  const fm = (key: string, rows: unknown[]) => ({ date: '2026-08-11', [key]: rows });
  const datum = (time: string, qty: number, source = 'watch') => ({
    date: new Date(time),
    qty,
    rawDate: time,
    source,
    sourceDate: '2026-08-11',
    units: 'count',
  });
  const count = (out: Record<string, unknown>, key: string) => (out[key] as unknown[]).length;

  // Anchor drift: the same hour re-exported against a different minute is one reading.
  const anchors = createHealthFrontmatter(
    '2026-08-11',
    { step_count: [datum('2026-08-11 09:30:28 -0500', 900) as never] },
    fm('stepCount', [reading('2026-08-11T09:00:00-05:00', 500)]) as never,
  );
  assert.equal(count(anchors, 'stepCount'), 1, 'two anchors in one hour collapse to one reading');
  assert.equal((anchors.stepCount as { value: number }[])[0].value, 900, 'the larger value wins');

  // Stale-after-fresh: a partial bucket arriving late must not replace the complete one.
  const stale = createHealthFrontmatter(
    '2026-08-11',
    { step_count: [datum('2026-08-11 09:31:00 -0500', 3) as never] },
    fm('stepCount', [reading('2026-08-11T09:00:00-05:00', 2500)]) as never,
  );
  assert.equal((stale.stepCount as { value: number }[])[0].value, 2500, 'a stale partial loses');

  // Offset drift: one instant spelled under two offsets is one reading.
  const offsets = createHealthFrontmatter(
    '2026-08-11',
    { step_count: [datum('2026-08-11 09:00:00 -0500', 122) as never] },
    fm('stepCount', [reading('2026-08-11T07:00:00-07:00', 122)]) as never,
  );
  assert.equal(count(offsets, 'stepCount'), 1, 'the same instant under two offsets is one reading');

  // Device-set drift is RETAINED by decision — both rows survive, and the reporter reports it.
  const sources = createHealthFrontmatter(
    '2026-08-11',
    { step_count: [datum('2026-08-11 09:00:00 -0500', 500, 'watch|phone') as never] },
    fm('stepCount', [reading('2026-08-11T09:00:00-05:00', 500, 'watch')]) as never,
  );
  assert.equal(count(sources, 'stepCount'), 2, 'differing device sets stay distinct readings');

  // Event totals are per-entry: two meals in one hour are two readings.
  const meals = createHealthFrontmatter(
    '2026-08-11',
    { sodium: [datum('2026-08-11 09:02:24 -0500', 800) as never] },
    fm('sodium', [reading('2026-08-11T09:00:00-05:00', 985)]) as never,
  );
  assert.equal(count(meals, 'sodium'), 2, 'two entries in one hour are two events, not a duplicate');

  // Discrete metrics keep every spot reading in the hour.
  const spots = createHealthFrontmatter(
    '2026-08-11',
    { heart_rate: [datum('2026-08-11 09:40:00 -0500', 70) as never] },
    fm('heartRate', [
      reading('2026-08-11T09:00:00-05:00', 60),
      reading('2026-08-11T09:20:00-05:00', 65),
    ]) as never,
  );
  assert.equal(count(spots, 'heartRate'), 3, 'discrete readings in one hour all survive');

  pass('the dedup key folds hourly buckets and leaves events and spot readings alone');
}

// --- A heal cannot work by re-saving with no data: the re-key loop is per incoming metric. ---
{
  const stored = {
    date: '2026-08-11',
    stepCount: [
      { source: 'watch', time: '2026-08-11T09:00:00-05:00', value: 1 },
      { source: 'watch', time: '2026-08-11T09:30:28-05:00', value: 2 },
    ],
  };
  const out = createHealthFrontmatter('2026-08-11', {}, stored as never);
  assert.equal(out, stored, 'an empty payload returns the same object');
  assert.equal((out.stepCount as unknown[]).length, 2, 'and collapses nothing');
  pass('an empty payload is a no-op, so a heal must enumerate stored keys itself');
}

// --- An empty body is stored as '\n', which is truthy. Only `.trim()` sees it as empty. ---
{
  const now = new Date();
  const todayKey = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  assert.ok(resolveBody(todayKey, undefined).includes('## Habit Log'), 'a new file gets a body');

  // The bug: another app creates the note first, serializeMarkdown normalises '' to '\n', and
  // both `??` and `||` then preserve that forever. Swapping `.trim()` for `||` fails here.
  assert.ok(resolveBody(todayKey, '\n').includes('## Habit Log'), "a '\\n' body is re-templated");
  assert.ok(resolveBody(todayKey, '').includes('## Habit Log'), 'a zero-length body is re-templated');

  assert.equal(
    resolveBody(todayKey, '\n## Mood Log\n\n'),
    '\n## Mood Log\n\n',
    'a body another app wrote is preserved untouched',
  );

  // The backfill window: a full-history re-export must not retro-fill years of empty notes.
  assert.equal(resolveBody('2015-03-02', '\n'), '\n', 'an old empty body is left alone');
  assert.ok(
    resolveBody('2015-03-02', undefined).includes('## Habit Log'),
    'but an old brand-new file still gets a body, never an empty one',
  );

  pass('an empty body is re-templated inside the backfill window, never outside it');
}

// --- Workouts predating `appleWorkoutId` all keyed to `undefined` and deleted each other. ---
{
  const legacy = (hour: number, workoutType: string) => ({
    duration: 30,
    endTime: `2026-08-11T${String(hour).padStart(2, '0')}:30:00-05:00`,
    startTime: `2026-08-11T${String(hour).padStart(2, '0')}:00:00-05:00`,
    workoutId: workoutType.toLowerCase(),
    workoutType,
  });
  const stored = {
    date: '2026-08-11',
    workoutEntries: [legacy(6, 'Running'), legacy(12, 'Walking'), legacy(18, 'Yoga')],
  };

  // The trigger is a workout payload landing on that date, not any write: `saveDailyForDate`
  // guards the workout formatter behind `if (workoutData)`, so a metrics-only sync leaves them
  // alone. Measured, after an earlier claim here got it wrong. 349 vault files hold two or more.
  const merged = createWorkoutFrontmatter('2026-08-11', [], stored as never);
  const kept = merged.workoutEntries as { workoutType: string }[];
  assert.equal(kept.length, 3, 'three ID-less workouts on one date all survive a write');
  assert.deepEqual(
    kept.map((entry) => entry.workoutType),
    ['Running', 'Walking', 'Yoga'],
    'and they are the same three workouts, not one repeated',
  );
  pass('workouts with no appleWorkoutId are kept distinct by startTime');
}

// --- The collapse winner is the larger reading, never whichever happened to arrive last. ---
{
  const heartRate = (avg: number, max: number, min: number) => ({
    avg,
    max,
    min,
    source: 'watch',
    time: '2026-04-12T08:00:00-05:00',
    units: 'count/min',
  });
  const quiet = heartRate(91.998, 101, 84);
  const loud = heartRate(95.007, 108, 88);

  for (const order of [
    [quiet, loud],
    [loud, quiet],
  ]) {
    const [kept] = collapseReadings('heart_rate', order);
    assert.equal(kept.avg, 95.007, 'the larger heart rate wins whichever order it arrives in');
  }

  // Blood pressure reads its magnitude from `systolic`, so a shape-blind comparison scores both
  // sides as 0 and the last write silently wins — which erases the hypertensive reading.
  const bloodPressure = (systolic: number, diastolic: number) => ({
    diastolic,
    source: 'cuff',
    systolic,
    time: '2026-04-12T08:00:00-05:00',
    units: 'mmHg',
  });
  const normal = bloodPressure(118, 74);
  const high = bloodPressure(140, 90);

  for (const order of [
    [normal, high],
    [high, normal],
  ]) {
    const [kept] = collapseReadings('blood_pressure', order);
    assert.equal(kept.systolic, 140, 'a hypertensive reading is never erased by arrival order');
  }

  pass('the collapse winner is the larger reading, not the last one');
}

console.log(`\n${String(checks.length)} checks passed. Scratch: ${scratch}`);
