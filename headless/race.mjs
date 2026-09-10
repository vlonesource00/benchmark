/**
 * Headless shared-world race.
 *
 * Every architecture drives the identical Astra GT car on the identical Harbor
 * Ring, on the identical 120 Hz tick, from a grid that is rotated between races
 * so no architecture is advantaged by a starting slot. This is the fair
 * comparison the architecture-native suites could never provide.
 *
 *   node headless/race.mjs [--laps 4] [--seconds 420] [--rotations] [--json out.json]
 */
import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { pathToFileURL } from 'node:url';
import { createField, CANDIDATE_IDS, rotations } from '../sandbox/bridges/index.js';

const DT = 1 / 120;

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const parsePositive = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Runs one race. `order` lists architecture ids in grid-slot order.
 * Returns per-architecture metrics plus the field-level safety counters.
 */
export function runRace({ order = CANDIDATE_IDS, laps = 4, maxSeconds = 420, label = 'race' } = {}) {
  const track = new Track('harbor-ring');
  const session = new Session(track, { classId: 'gt', mixed: false });
  session.laps = laps;
  session.field = order.length;
  session.aggression = 0.72;
  session.autopilot = true;

  const field = createField({ session, hostTrack: track, order, onStatus: () => {} });
  // `Session.start()` rebuilds the native driver array, so the bridges must be
  // installed after the grid is laid out, not before.
  session.start({ freshTrack: true });
  field.attach();

  // Astra's session ends when its designated player car finishes. For a fair
  // field race every car must run to its own chequered flag.
  const allFinished = () => session.activeCars.every((car) => car.race.finishTime != null);

  let elapsed = 0;
  let passCounts = new Map(CANDIDATE_IDS.map((id) => [id, { made: 0, suffered: 0 }]));
  let previousOrder = null;
  let sampleAt = 0;
  let steps = 0;

  let lastProgressLog = 0;
  while (elapsed < maxSeconds && !allFinished()) {
    session.step(DT, { throttle: 0, brake: 0, steer: 0 });
    if (session.phase === 'finished') session.phase = 'racing';
    elapsed += DT;
    steps += 1;

    if (elapsed - lastProgressLog >= 15.0) {
      lastProgressLog = elapsed;
      const finishedCount = session.activeCars.filter((c) => c.race.finishTime != null).length;
      console.log(`  [${label}] t=${elapsed.toFixed(1)}s | finished=${finishedCount}/${session.activeCars.length} | contacts=${session.contacts}`);
    }

    if (elapsed >= sampleAt) {
      sampleAt = elapsed + 0.25;
      const standings = session.standings().map((car) => car.id);
      if (previousOrder) {
        for (let a = 0; a < standings.length; a += 1) {
          for (let b = a + 1; b < standings.length; b += 1) {
            const leaderId = standings[a];
            const trailerId = standings[b];
            const beforeLeader = previousOrder.indexOf(leaderId);
            const beforeTrailer = previousOrder.indexOf(trailerId);
            // Only count a crossing, not noise within a sample.
            if (beforeLeader > beforeTrailer) {
              const leader = field.byCarId(leaderId);
              const trailer = field.byCarId(trailerId);
              if (leader && trailer) {
                passCounts.get(leader.candidateId).made += 1;
                passCounts.get(trailer.candidateId).suffered += 1;
              }
            }
          }
        }
      }
      previousOrder = standings;
    }
  }

  const standings = session.standings();
  const results = standings.map((car, position) => {
    const bridge = field.byCarId(car.id);
    const counts = passCounts.get(bridge.candidateId) ?? { made: 0, suffered: 0 };
    const lapTimes = car.race.sectors ?? [];
    return {
      candidateId: bridge.candidateId,
      label: bridge.label,
      gridSlot: bridge.gridSlot,
      finishPosition: position + 1,
      positionsGained: bridge.gridSlot - position,
      lapsCompleted: Math.max(0, car.race.lap - 1),
      finished: car.race.finishTime != null,
      finishTime: car.race.finishTime,
      bestLap: car.race.bestLap,
      progress: car.race.progress,
      offTrackSeconds: car.race.offtrack,
      damage: car.damage,
      passesMade: counts.made,
      passesSuffered: counts.suffered,
      controllerErrors: bridge.errors,
      lastError: bridge.lastError ? String(bridge.lastError.message ?? bridge.lastError) : null,
      lapCount: lapTimes.length
    };
  });

  return {
    label,
    order,
    laps,
    simulatedSeconds: elapsed,
    steps,
    trackLength: track.length,
    contacts: session.collisionStats,
    results
  };
}

/** Rotates the grid so each architecture starts in every slot exactly once. */
export function runMatrix({ laps = 4, maxSeconds = 420, ids = CANDIDATE_IDS } = {}) {
  const runs = [];
  const matrix = rotations(ids);
  for (let i = 0; i < matrix.length; i += 1) {
    const order = matrix[i];
    console.log(`\n=== Rotation ${i + 1}/${matrix.length}: ${order.join(' > ')} ===`);
    const run = runRace({ order, laps, maxSeconds, label: `Rot-${i + 1}` });
    runs.push(run);
    console.log(`=== Rotation ${i + 1} complete in ${run.simulatedSeconds.toFixed(1)}s simulated ===`);
  }
  return runs;
}

/** Fair aggregate: mean over rotations, so grid bias cancels out. */
export function aggregate(runs) {
  const byCandidate = new Map();
  for (const run of runs) {
    for (const result of run.results) {
      const entry = byCandidate.get(result.candidateId) ?? {
        candidateId: result.candidateId,
        label: result.label,
        runs: 0,
        finishes: 0,
        positionsGained: [],
        bestLap: [],
        offTrackSeconds: [],
        damage: [],
        passesMade: [],
        passesSuffered: [],
        finishPositions: [],
        controllerErrors: 0
      };
      entry.runs += 1;
      entry.finishes += result.finished ? 1 : 0;
      entry.positionsGained.push(result.positionsGained);
      entry.finishPositions.push(result.finishPosition);
      if (Number.isFinite(result.bestLap)) entry.bestLap.push(result.bestLap);
      entry.offTrackSeconds.push(result.offTrackSeconds);
      entry.damage.push(result.damage);
      entry.passesMade.push(result.passesMade);
      entry.passesSuffered.push(result.passesSuffered);
      entry.controllerErrors += result.controllerErrors ?? 0;
      byCandidate.set(result.candidateId, entry);
    }
  }
  const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  return [...byCandidate.values()].map((entry) => ({
    candidateId: entry.candidateId,
    label: entry.label,
    runs: entry.runs,
    finishRate: entry.finishes / entry.runs,
    meanFinishPosition: mean(entry.finishPositions),
    meanPositionsGained: mean(entry.positionsGained),
    bestLap: entry.bestLap.length ? Math.min(...entry.bestLap) : null,
    meanBestLapAcrossRotations: mean(entry.bestLap),
    meanOffTrackSeconds: mean(entry.offTrackSeconds),
    meanDamage: mean(entry.damage),
    meanPassesMade: mean(entry.passesMade),
    meanPassesSuffered: mean(entry.passesSuffered),
    controllerErrors: entry.controllerErrors
  }));
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const laps = parsePositive(arg('laps'), 4);
  const maxSeconds = parsePositive(arg('seconds'), 420);
  const subject = arg('subject', null);
  const ids = subject ? [subject] : CANDIDATE_IDS;
  const started = Date.now();

  if (flag('rotations')) {
    const runs = runMatrix({ laps, maxSeconds, ids: CANDIDATE_IDS });
    const table = aggregate(runs);
    console.table(table);
    console.log(`\n${runs.length} rotations × ${laps} laps in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (flag('json')) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(arg('json'), `${JSON.stringify({ runs, aggregate: table }, null, 2)}\n`);
      console.log(`Wrote ${arg('json')}`);
    }
  } else {
    const run = runRace({ order: ids, laps, maxSeconds });
    console.table(run.results);
    console.log(`\ntrack ${run.trackLength.toFixed(1)} m · ${run.simulatedSeconds.toFixed(1)}s simulated · contacts`, run.contacts);
  }
}
