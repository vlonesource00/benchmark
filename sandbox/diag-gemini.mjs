/**
 * Throwaway diagnostic for the Gemini bridges — off-track localisation.
 *   node sandbox/diag-gemini.mjs [subject] [seconds] [--every 0.25]
 */
import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField } from './bridges/index.js';

const DT = 1 / 120;
const subject = process.argv[2] ?? 'gemini-grand-prix';
const maxSeconds = Number(process.argv[3] ?? 200);
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : d;
};
const trace = process.argv.includes('--trace');
const every = arg('every', 0.5);

const track = new Track('harbor-ring');
const session = new Session(track, { classId: 'gt', mixed: false });
session.laps = 2;
session.field = 1;
session.aggression = 0.72;
session.autopilot = true;
const field = createField({ session, hostTrack: track, order: [subject], onStatus: () => {} });
session.start({ freshTrack: true });
field.attach();
const bridge = field.bridges[0];
const car = session.cars[0];
const shadowTrack = bridge.controller?.optimalEngine?.track ?? null;

if (process.argv.includes('--hostcurv') && shadowTrack) {
  for (const key of ['atDistance', 'surfaceAt', 'closest']) {
    const base = shadowTrack[key];
    shadowTrack[key] = (...a) => {
      const f = base(...a);
      f.curvature = Math.abs(f.curvature) * (f.turnSign < 0 ? 1 : -1);
      return f;
    };
  }
}

const f = (v, n = 2) => (Number.isFinite(v) ? v.toFixed(n).padStart(7) : '    n/a');

// ---- static track convention dump -------------------------------------------
if (process.argv.includes('--track')) {
  console.log('  s      x       z    head°   curvH   turnSh  cross    hw');
  for (let s = 0; s < track.length; s += 40) {
    const p = track.at(s);
    const prev = track.at(s - 5), next = track.at(s + 5);
    const cross = prev.tx * next.tz - prev.tz * next.tx;
    const sh = shadowTrack?.atDistance(s);
    console.log([
      f(s, 1), f(p.x, 1), f(p.z, 1), f(p.heading * 180 / Math.PI, 1),
      f(p.curvature, 5), f(sh?.turnSign, 0), f(cross, 5), f(track.halfWidth, 1)
    ].join(' '));
  }
}

// ---- run --------------------------------------------------------------------
const BUCKET = 20;
const buckets = new Map();
let elapsed = 0;
let sampleAt = 0;

if (trace) {
  console.log(['t', 'sHost', 'latH', 'spd', 'yawR', 'steer', 'thr', 'brk', 'latSh', 'zone', 'tOff', 'dSpd', 'hErr', 'latE', 'mode', 'rec', 'optLat', 'optV', 'curv', 'tSign'].map((h) => h.padStart(7)).join(' '));
}

while (elapsed < maxSeconds) {
  session.step(DT, { throttle: 0, brake: 0, steer: 0 });
  if (session.phase === 'finished') session.phase = 'racing';
  elapsed += DT;
  const proj = track.nearest(car.x, car.z);
  const b = Math.floor(proj.s / BUCKET);
  const e = buckets.get(b) ?? { off: 0, n: 0, sumAbs: 0, maxAbs: 0, sumLat: 0, spd: 0 };
  e.n += 1;
  e.sumAbs += Math.abs(proj.lateral);
  e.maxAbs = Math.max(e.maxAbs, Math.abs(proj.lateral));
  e.sumLat += proj.lateral;
  e.spd += car.speed;
  if (Math.abs(proj.lateral) > track.halfWidth) e.off += DT;
  buckets.set(b, e);

  const sFrom = arg('sfrom', -1), sTo = arg('sto', 1e9);
  if (trace && elapsed >= sampleAt && proj.s >= sFrom && proj.s <= sTo) {
    sampleAt = elapsed + every;
    const dbg = bridge.debug?.() ?? {};
    const tm = dbg.telemetry ?? {};
    const shadow = bridge.shadows[0];
    const opt = bridge.controller?.optimalEngine?.sampleAtDistance?.(shadow.distance, 'gt');
    const frame = shadowTrack?.atDistance(shadow.distance);
    const po = bridge.controller?.paceOptimizer;
    console.log([
      f(elapsed, 1), f(proj.s, 1), f(proj.lateral), f(car.speed), f(car.yawRate, 3),
      f(car.controls.steer, 3), f(car.controls.throttle, 2), f(car.controls.brake, 2),
      f(shadow.surface.lateral), String(shadow.surface.zone).padStart(7),
      f(dbg.desiredOffset), f(dbg.desiredSpeed), f(dbg.headingError, 3), f(dbg.lateralError),
      String(dbg.mode).padStart(7), String(dbg.recovering).padStart(7),
      f(opt?.lateral), f(opt?.targetSpeed), f(frame?.curvature, 5), f(frame?.turnSign, 0),
      '|aF', f(po?.alphaF, 3), 'aR', f(po?.alphaR, 3), 'satF', f(po?.satAvg, 2), 'yI', f(po?.yawInt, 3),
      'slip', f(Math.atan2(shadow.localVelocity.x, Math.max(3, Math.abs(shadow.localVelocity.z))), 3),
      'pace', f(po?.paceTrim, 3), 'drt', f(po?._derate({ vehicle: shadow, track: shadowTrack, targetOffset: dbg.desiredOffset }), 3)
    ].join(' '));
  }
}

if (process.argv.includes('--profile')) {
  console.log('\nper-40 m mean speed / mean |lateral| profile:');
  console.log(['s', 'spd', 'lat', 'maxAbs'].map((h) => h.padStart(8)).join(' '));
  const P = 40;
  const prof = new Map();
  for (const [b, e] of buckets) {
    const k = Math.floor((b * BUCKET) / P);
    const q = prof.get(k) ?? { n: 0, spd: 0, abs: 0, maxAbs: 0 };
    q.n += e.n; q.spd += e.spd; q.abs += e.sumAbs; q.maxAbs = Math.max(q.maxAbs, e.maxAbs);
    prof.set(k, q);
  }
  [...prof.entries()].sort((a, b) => a[0] - b[0]).forEach(([k, q]) => {
    console.log([f(k * P, 0), f(q.spd / q.n, 1), f(q.abs / q.n), f(q.maxAbs)].join(' '));
  });
}

console.log(`\n--- ${subject}: ${elapsed.toFixed(1)}s simulated ---`);
console.log(`offTrack=${car.race.offtrack.toFixed(2)}s damage=${car.damage.toFixed(3)} laps=${car.race.lap} best=${car.race.bestLap} errors=${bridge.errors}`);
if (bridge.lastError) console.log('lastError', bridge.lastError.stack?.split('\n').slice(0, 4).join('\n'));
console.log('\nworst 20 m buckets by off-track time:');
console.log(['s', 'off(s)', 'meanLat', 'maxAbs', 'meanSpd'].map((h) => h.padStart(8)).join(' '));
[...buckets.entries()]
  .filter(([, e]) => e.off > 0.05)
  .sort((a, b) => b[1].off - a[1].off)
  .slice(0, 22)
  .forEach(([b, e]) => {
    console.log([
      f(b * BUCKET, 1), f(e.off), f(e.sumLat / e.n), f(e.maxAbs), f(e.spd / e.n)
    ].join(' '));
  });
