import { performance } from 'node:perf_hooks';

import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField, VORTEX_QUAD_IDS, VORTEX_QUAD_CANDIDATES } from '../sandbox/bridges/index.js';

const DT = 1 / 120;
const lapsFlag = process.argv.find((arg) => arg.startsWith('--laps='));
const rotationsFlag = process.argv.find((arg) => arg.startsWith('--rotations='));
const laps = Number(lapsFlag?.slice(7) ?? 3);
const rotations = Number(rotationsFlag?.slice(12) ?? 1);
if (!Number.isInteger(laps) || laps < 1 || laps > 10) throw new Error('Use --laps=1..10');
if (!Number.isInteger(rotations) || rotations < 1 || rotations > 4) throw new Error('Use --rotations=1..4');

function meaningfulInteraction(car, cars, trackLength) {
  return cars.some((other) => {
    if (other === car) return false;
    let gap = other.race.progress - car.race.progress;
    if (Math.abs(gap) > trackLength / 2) gap -= Math.sign(gap) * trackLength;
    const width = car.spec.halfWidth + other.spec.halfWidth + 1.2;
    const lateral = Math.abs(car.lateral - other.lateral);
    if (Math.abs(gap) < car.spec.halfLength + other.spec.halfLength + 4 && lateral < width + 1.5) return true;
    const closing = Math.sign(gap) * (car.speed - other.speed);
    return Math.abs(gap) < 65 && closing > 1.5 && lateral < width + 2.5;
  });
}

export function runVortexHeat(grid, lapCount = laps) {
  const track = new Track('harbor-ring');
  const session = new Session(track, { classId: 'gt', mixed: false });
  session.laps = lapCount;
  session.field = grid.length;
  session.autopilot = true;
  const field = createField({ session, hostTrack: track, order: grid, candidatesList: VORTEX_QUAD_CANDIDATES });
  session.start({ freshTrack: true });
  field.attach(true);
  session.phase = 'racing';
  session.countdown = 0;

  const combatSeconds = Object.fromEntries(grid.map((id) => [id, 0]));
  const passes = Object.fromEntries(grid.map((id) => [id, 0]));
  const retainedPasses = Object.fromEntries(grid.map((id) => [id, 0]));
  const lastRank = new Map(session.standings().map((car, rank) => [car.id, rank]));
  const pending = [];
  const maxSteps = Math.ceil((lapCount * 105 + 60) / DT);
  const start = performance.now();
  let steps = 0;
  while (steps < maxSteps) {
    if (session.phase === 'finished' && !session.activeCars.every((car) => car.race.finishTime !== null)) session.phase = 'racing';
    session.step(DT, {});
    steps += 1;
    for (const car of session.activeCars) {
      const id = field.bridges[car.id].candidateId;
      if (meaningfulInteraction(car, session.activeCars, track.length)) combatSeconds[id] += DT;
    }
    const standings = session.standings();
    standings.forEach((car, rank) => {
      const previous = lastRank.get(car.id);
      if (previous > rank) {
        const id = field.bridges[car.id].candidateId;
        passes[id] += previous - rank;
        for (const rival of standings.slice(rank + 1, previous + 1)) {
          pending.push({ id, car, rival, progress: car.race.progress, resolved: false });
        }
      }
      lastRank.set(car.id, rank);
    });
    for (const pass of pending) {
      if (pass.resolved || pass.car.race.progress - pass.progress < 100) continue;
      pass.resolved = true;
      if (pass.car.race.progress > pass.rival.race.progress) retainedPasses[pass.id] += 1;
    }
    if (session.activeCars.every((car) => car.race.finishTime !== null)) break;
  }
  for (const pass of pending) {
    if (!pass.resolved && pass.car.race.progress > pass.rival.race.progress) retainedPasses[pass.id] += 1;
  }
  const results = session.standings().map((car, rank) => {
    const bridge = field.bridges[car.id];
    const id = bridge.candidateId;
    return {
      rank: rank + 1,
      id,
      finishTime: car.race.finishTime,
      bestLap: car.race.bestLap,
      lastLap: car.race.lastLap,
      valid: car.race.valid,
      offtrackSeconds: car.race.offtrack,
      combatSeconds: combatSeconds[id],
      combatRatio: session.time > 0 ? combatSeconds[id] / session.time : 0,
      passes: passes[id],
      retainedPasses: retainedPasses[id],
      bridgeErrors: bridge.errors,
      safetyInterventions: bridge.driver?.telemetry?.safetyInterventions ?? null
    };
  });
  return {
    grid,
    laps: lapCount,
    elapsedSimulationSeconds: session.time,
    elapsedWallSeconds: (performance.now() - start) / 1000,
    steps,
    completed: results.every((result) => result.finishTime !== null),
    contacts: session.contacts,
    severeContacts: session.collisionStats.severeContacts,
    results
  };
}

const heats = [];
for (let offset = 0; offset < rotations; offset += 1) {
  const grid = VORTEX_QUAD_IDS.map((_, index) => VORTEX_QUAD_IDS[(index + offset) % VORTEX_QUAD_IDS.length]);
  heats.push(runVortexHeat(grid));
}
console.log(JSON.stringify({ host: 'canonical Astra Harbor Ring', physicsHz: 120, heats }, null, 2));
if (heats.some((heat) => !heat.completed || heat.results.some((result) => result.bridgeErrors > 0))) process.exitCode = 1;
