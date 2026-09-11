import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField } from '../sandbox/bridges/index.js';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DT = 1 / 120;

function runSolo(subjectId, laps = 2, maxSeconds = 200) {
  const track = new Track('harbor-ring');
  const session = new Session(track, { classId: 'gt', mixed: false });
  session.laps = laps;
  session.field = 1;
  session.aggression = 0.72;
  session.autopilot = true;

  const field = createField({ session, hostTrack: track, order: [subjectId], onStatus: () => {} });
  session.start({ freshTrack: true });
  field.attach();

  const car = session.cars[0];
  const bridge = field.bridges[0];

  let elapsed = 0;
  let bodySlips = [];
  let yawRates = [];
  let lapTimes = [];
  let lastLap = 1;
  let lapStart = 0;
  let spins = 0;
  let wasSpinning = false;

  while (elapsed < maxSeconds && car.race.finishTime == null) {
    session.step(DT, { throttle: 0, brake: 0, steer: 0 });
    if (session.phase === 'finished') session.phase = 'racing';
    elapsed += DT;

    if (car.race.lap > lastLap) {
      lapTimes.push(elapsed - lapStart);
      lapStart = elapsed;
      lastLap = car.race.lap;
    }

    // Astra vehicle: u = longitudinal velocity, v = lateral velocity
    const u = car.u ?? 0;
    const v = car.v ?? 0;
    const beta = Math.atan2(v, Math.max(0.1, Math.abs(u)));
    const yawRate = car.yawRate ?? 0;

    const absBeta = Math.abs(beta);
    bodySlips.push(absBeta);
    yawRates.push(Math.abs(yawRate));

    // Spin detection: severe sideslip (> 0.35 rad ~ 20 deg) with elevated yaw
    const isSpinning = absBeta > 0.35 && Math.abs(yawRate) > 1.2;
    if (isSpinning && !wasSpinning) {
      spins++;
      wasSpinning = true;
    } else if (!isSpinning && absBeta < 0.15) {
      wasSpinning = false;
    }
  }

  bodySlips.sort((a, b) => a - b);
  const p95Index = Math.floor(bodySlips.length * 0.95);
  const p95Beta = bodySlips[p95Index] ?? 0;
  const maxBeta = bodySlips[bodySlips.length - 1] ?? 0;
  const maxYawRate = Math.max(...yawRates, 0);

  return {
    subjectId,
    bestLap: car.race.bestLap,
    lapTimes,
    finishTime: car.race.finishTime,
    offTrackSeconds: car.race.offtrack,
    damage: car.damage,
    spins,
    p95SideslipDeg: Number((p95Beta * 180 / Math.PI).toFixed(2)),
    maxSideslipDeg: Number((maxBeta * 180 / Math.PI).toFixed(2)),
    maxYawRateRadS: Number(maxYawRate.toFixed(2)),
    controllerErrors: bridge.errors
  };
}

console.log('=== Running Verified Solo Telemetry: Astra ===');
const astra = runSolo('astra');
console.log('Astra:', astra);

console.log('\n=== Running Verified Solo Telemetry: Gemini Supreme ===');
const supreme = runSolo('gemini-supreme');
console.log('Gemini Supreme:', supreme);

// Load baseline for before-and-after comparison
let baseline = null;
try {
  const raw = readFileSync('reports/verified/baseline-solo-telemetry.json', 'utf8');
  baseline = JSON.parse(raw);
} catch (e) {
  console.log('Could not load baseline:', e.message);
}

const verifiedData = {
  timestamp: new Date().toISOString(),
  baseline: baseline?.supremeBaseline ?? null,
  verified: supreme,
  referenceAstra: astra
};

mkdirSync('reports/verified', { recursive: true });
writeFileSync('reports/verified/solo-telemetry-verified.json', JSON.stringify(verifiedData, null, 2));
console.log('\nSaved verified telemetry to reports/verified/solo-telemetry-verified.json');
