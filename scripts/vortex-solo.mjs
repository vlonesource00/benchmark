import { performance } from 'node:perf_hooks';

import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createAstraBridge } from '../sandbox/bridges/astra-bridge.js';
import { createVortexBridge } from '../sandbox/bridges/vortex-bridge.js';

const subject = process.argv.find((arg) => arg.startsWith('--subject='))?.slice(10) ?? 'vortex';
const requestedLaps = Number(process.argv.find((arg) => arg.startsWith('--laps='))?.slice(7) ?? 3);
if (!['vortex', 'astra'].includes(subject)) throw new Error('Use --subject=vortex|astra');
if (!Number.isInteger(requestedLaps) || requestedLaps < 1 || requestedLaps > 10) throw new Error('Use --laps=1..10');

const track = new Track('harbor-ring');
const session = new Session(track, { classId: 'gt', mixed: false });
session.mode = 'practice';
session.field = 1;
session.autopilot = true;
session.start({ freshTrack: true });
const bridge = subject === 'vortex'
  ? createVortexBridge({ line: session.lineFor(session.player), index: 0 })
  : createAstraBridge({ line: session.lineFor(session.player), index: 0 });
session.drivers[0] = bridge;
session.phase = 'racing';
session.countdown = 0;

const laps = [];
let previousLap = session.player.race.lap;
let previousOfftrack = 0;
let previousContacts = 0;
const start = performance.now();
const maxSteps = Math.ceil((requestedLaps * 110 + 60) * 120);
for (let step = 0; step < maxSteps && laps.length < requestedLaps; step += 1) {
  session.step(1 / 120, {});
  const car = session.player;
  if (!Number.isFinite(car.x) || !Number.isFinite(car.z) || !Number.isFinite(car.speed)) throw new Error('Non-finite vehicle state');
  if (car.race.lap > previousLap) {
    const offtrack = car.race.offtrack - previousOfftrack;
    const contacts = session.contacts - previousContacts;
    laps.push({
      lap: previousLap,
      seconds: car.race.lastLap,
      offtrackSeconds: offtrack,
      contacts,
      clean: offtrack === 0 && contacts === 0 && car.damage === 0
    });
    previousLap = car.race.lap;
    previousOfftrack = car.race.offtrack;
    previousContacts = session.contacts;
  }
}

const cleanTimes = laps.filter((lap) => lap.clean).map((lap) => lap.seconds).sort((a, b) => a - b);
const median = cleanTimes.length ? cleanTimes[Math.floor(cleanTimes.length / 2)] : null;
const result = {
  subject,
  host: 'canonical Astra Harbor Ring',
  physicsHz: 120,
  requestedLaps,
  laps,
  bestCleanLap: cleanTimes[0] ?? null,
  medianCleanLap: median,
  offtrackSeconds: session.player.race.offtrack,
  contacts: session.contacts,
  bridgeErrors: bridge.errors,
  safetyInterventions: bridge.driver?.telemetry?.safetyInterventions ?? null,
  wallSeconds: (performance.now() - start) / 1000
};
console.log(JSON.stringify(result, null, 2));
if (laps.length !== requestedLaps || bridge.errors > 0) process.exitCode = 1;
