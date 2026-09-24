import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField, TRIAD_CANDIDATES } from '../sandbox/bridges/index.js';

export async function diagnoseHeat6Offtrack() {
  const grid = ['astra', 'gemini-supreme', 'nova'];
  const track = new Track('harbor-ring');
  const session = new Session(track, { classId: 'gt' });
  session.laps = 3;
  session.field = 3;
  session.cars = session.cars.slice(0, 3);
  session.drivers = session.drivers.slice(0, 3);
  session.autopilot = true;

  const field = createField({ session, hostTrack: track, order: grid, candidatesList: TRIAD_CANDIDATES });
  session.start({ freshTrack: true });
  field.attach(true);
  session.phase = 'racing';
  session.countdown = 0;

  const novaBridge = field.bridges.find(b => b.candidateId === 'nova');
  const novaCar = session.cars[novaBridge.carId];
  const novaDriver = novaBridge.driver;
  const astraCar = session.cars[0];
  const geminiCar = session.cars[1];

  let prevOfftrack = 0;
  const offtrackSamples = [];
  let steps = 0;
  const maxSteps = Math.ceil(300 * 120);

  console.log('Simulating Grid 6 for offtrack diagnosis...');

  while (steps < maxSteps) {
    if (session.phase === 'finished' && !session.activeCars.every((c) => c.race.finishTime !== null)) {
      session.phase = 'racing';
    }

    if (session.time >= 216.20 && session.time <= 216.30 && steps % 6 === 0) {
      const ctrl = novaDriver.coupledController;
      console.log(`\n=== HORIZON SNAPSHOT at t=${session.time.toFixed(3)} s=${novaCar.s.toFixed(1)} v=${(novaCar.speed*3.6).toFixed(1)} km/h ===`);
      console.log(`isBraking=${ctrl.isBraking} brkSt=${ctrl.brakingStation?.toFixed(0)} brkTar=${(ctrl.brakingTargetSpeed*3.6)?.toFixed(1)}`);
      for (let k = 0; k <= ctrl.HORIZON_STEPS; k += 4) {
        console.log(`  k=${k} s=${ctrl.sPred[k].toFixed(1)} vRef=${(ctrl.vRefH[k]*3.6).toFixed(1)} vAllow=${(ctrl.vAllow[k]*3.6).toFixed(1)} brkH=${ctrl.brkH[k]?.toFixed(1)}`);
      }
    }

    const dOff = novaCar.race.offtrack - prevOfftrack;
    if (dOff > 0.0001) {
      offtrackSamples.push({
        time: session.time,
        s: novaCar.s,
        q: novaCar.lateral,
        speed: novaCar.speed,
        vTarget: novaDriver.coupledController?.state?.targetSpeed,
        targetQ: novaDriver.coupledController?.state?.targetQ,
        steer: novaCar.controls.steer,
        throttle: novaCar.controls.throttle,
        brake: novaCar.controls.brake,
        activeTopology: novaDriver.topologyResult?.activeTopology,
        isOversteering: novaDriver.coupledController?.state?.isOversteering,
        dOff
      });
    }
    prevOfftrack = novaCar.race.offtrack;

    session.step(1 / 120, { throttle: 0, brake: 0, steer: 0 });
    steps++;

    if (session.activeCars.every(c => c.race.finishTime !== null)) break;
  }

  console.log(`Simulation complete. Total NOVA offtrack: ${novaCar.race.offtrack.toFixed(3)}s, samples: ${offtrackSamples.length}`);
  if (offtrackSamples.length > 0) {
    const first = offtrackSamples[0];
    const last = offtrackSamples[offtrackSamples.length - 1];
    console.log(`First offtrack at t=${first.time.toFixed(2)}s, s=${first.s.toFixed(1)}m, q=${first.q.toFixed(2)}m, speed=${(first.speed*3.6).toFixed(1)} km/h`);
    console.log(`Last offtrack at t=${last.time.toFixed(2)}s, s=${last.s.toFixed(1)}m, q=${last.q.toFixed(2)}m, speed=${(last.speed*3.6).toFixed(1)} km/h`);
    console.log('\nSamples:');
    for (let i = 0; i < offtrackSamples.length; i += Math.max(1, Math.floor(offtrackSamples.length / 10))) {
      const o = offtrackSamples[i];
      console.log(`  t=${o.time.toFixed(2)}s s=${o.s.toFixed(1)} q=${o.q.toFixed(2)} v=${(o.speed*3.6).toFixed(1)} targetQ=${o.targetQ?.toFixed(2)} vTarget=${(o.vTarget*3.6)?.toFixed(1)} steer=${o.steer.toFixed(2)} brk=${o.brake.toFixed(2)} isOS=${o.isOversteering} topo=${o.activeTopology}`);
    }
  }
}

diagnoseHeat6Offtrack().catch(console.error);
