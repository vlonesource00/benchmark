/**
 * Throwaway A/B harness for the Gemini bridges.
 *
 *   node sandbox/ab-gemini.mjs [--subject gemini-grand-prix] [--laps 2] [--seconds 240] [--opt name]
 *
 * Options are comma separated:
 *   spec            give the shadow vehicle the real host GT spec
 *   signedcurv      report signed curvature instead of Math.abs
 *   turnstrength    use Gemini's native turnStrength scale (curvature/0.09)
 *   curbside        populate curbSide like Gemini's own Track
 *   tight           planningLateralLimit = halfWidth - 1.02 - 0.16 - 0.9
 *   agg0.7 / agg0.5 lower controller aggression
 *   bank            report Gemini's authored bank profile
 */
import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createShadowTrack, createShadowVehicle, shadowRace } from './bridges/shadow.js';
import { CAR_CLASSES } from '../host/astra/src/sim/car-specs.js';
import { NextGenAIController as NmpccController } from '../subjects/gemini-nmpcc/src/ai/v2/NextGenAIController.js';
import { NextGenAIController as GrandPrixController } from '../subjects/gemini-grand-prix/src/ai/v2/NextGenAIController.js';

const DT = 1 / 120;
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const opts = new Set((arg('opt', '') || '').split(',').filter(Boolean));
const subject = arg('subject', 'gemini-grand-prix');
const laps = Number(arg('laps', 2));
const maxSeconds = Number(arg('seconds', 240));
const HOST = CAR_CLASSES.gt;

const runOne = (id) => {
  const track = new Track('harbor-ring');
  const session = new Session(track, { classId: 'gt', mixed: false });
  session.laps = laps;
  session.field = 1;
  session.aggression = 0.72;
  session.autopilot = true;
  session.start({ freshTrack: true });

  const car = session.cars[0];
  const shadowTrack = createShadowTrack(track, { id: 'harbor-ring' });

  if (opts.has('signedcurv') || opts.has('hostcurv') || opts.has('turnstrength') || opts.has('curbside') || opts.has('tight') || opts.has('bank')) {
    const base = shadowTrack.atDistance;
    shadowTrack.atDistance = (s) => {
      const f = base(s);
      if (opts.has('signedcurv')) f.curvature = Math.abs(f.curvature) * (f.turnSign < 0 ? -1 : 1);
      if (opts.has('hostcurv')) f.curvature = Math.abs(f.curvature) * (f.turnSign < 0 ? 1 : -1);
      if (opts.has('turnstrength')) f.turnStrength = Math.min(1, Math.abs(f.curvature) / 0.09);
      if (opts.has('curbside')) f.curbSide = Math.abs(f.curvature) > 0.009 ? f.turnSign : 0;
      if (opts.has('bank')) f.bank = Math.sin(s * 0.026 + 0.6) * 0.045 + f.turnSign * (opts.has('turnstrength') ? Math.min(1, Math.abs(f.curvature) / 0.09) : f.turnStrength) * 0.17;
      return f;
    };
    const baseSurface = shadowTrack.surfaceAt;
    shadowTrack.surfaceAt = (x, z) => {
      const f = baseSurface(x, z);
      if (opts.has('signedcurv')) f.curvature = Math.abs(f.curvature) * (f.turnSign < 0 ? -1 : 1);
      if (opts.has('hostcurv')) f.curvature = Math.abs(f.curvature) * (f.turnSign < 0 ? 1 : -1);
      if (opts.has('turnstrength')) f.turnStrength = Math.min(1, Math.abs(f.curvature) / 0.09);
      if (opts.has('curbside')) f.curbSide = Math.abs(f.curvature) > 0.009 ? f.turnSign : 0;
      return f;
    };
    if (opts.has('tight')) {
      const limit = shadowTrack.planningLateralLimit;
      shadowTrack.planningLateralLimit = (d, side, o = {}) => limit(d, side, { ...o, safetyM: 1.06 });
      shadowTrack.planningLateralLimitAtPoint = (p, side, o = {}) => shadowTrack.planningLateralLimit(0, side, o);
    }
  }

  const spec = opts.has('spec')
    ? {
        key: 'gt', classKey: 'gt', mass: HOST.mass, wheelBase: HOST.wheelbase, trackWidth: HOST.track,
        steering: { maxAngle: HOST.steeringLock },
        tire: { alphaPeak: 0.14, mu: 1.35, loadSensitivity: 0.16, idealTempC: 88 },
        collision: { overhangM: 0.56, bodyMarginM: 0.15 }
      }
    : null;

  // Mirrors createGeminiBridge: one shadow per session car, all synced each tick.
  const shadows = session.cars.map((c) => createShadowVehicle(c, track, c.id, { classKey: 'gt', spec, name: 'GEMINI' }));
  const shadow = shadows[0];
  if (opts.has('spec')) for (const s of shadows) { s.wheelBase = HOST.wheelbase; s.mass = HOST.mass; }
  if (opts.has('solo')) { shadows.length = 1; }

  const Controller = id === 'gemini-nmpcc' ? NmpccController : GrandPrixController;
  const aggression = opts.has('agg0.7') ? 0.7 : opts.has('agg0.5') ? 0.5 : 0.9;
  const controller = new Controller(0, { track: shadowTrack, aggression });
  controller.setDebugEnabled?.(true);

  // Install the controller as session driver 0 so Session.step() uses it.
  let errors = 0;
  session.drivers[0] = {
    update() {
      try {
        for (const s of shadows) s.sync();
        controller.update(shadow, shadows, shadowTrack, shadowRace, DT);
        shadow.applyToHost();
      } catch (e) {
        errors += 1;
        if (errors < 2) console.log('ERR', e.message);
        car.controls = { throttle: 0, brake: 0.6, steer: 0 };
      }
    }
  };

  let elapsed = 0;
  while (elapsed < maxSeconds && car.race.finishTime == null) {
    session.step(DT, { throttle: 0, brake: 0, steer: 0 });
    if (session.phase === 'finished') session.phase = 'racing';
    elapsed += DT;
  }
  return {
    subject: id,
    laps: Math.max(0, car.race.lap - 1),
    finished: car.race.finishTime != null,
    finishTime: car.race.finishTime,
    bestLap: car.race.bestLap,
    offTrack: car.race.offtrack,
    damage: car.damage,
    errors
  };
};

const ids = subject === 'both' ? ['gemini-grand-prix', 'gemini-nmpcc'] : [subject];
const rows = ids.map(runOne);
console.log(`opts: ${[...opts].join(',') || '(none)'}  laps=${laps} seconds=${maxSeconds}`);
console.table(rows);
