import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField, TRIAD_CANDIDATES } from '../sandbox/bridges/index.js';

export async function diagnoseHeat2() {
  const grid = ['nova', 'astra', 'gemini-supreme'];
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
  const astraCar = session.cars[1];
  const geminiCar = session.cars[2];

  let prevOfftrack = 0;
  const offtrackSamples = [];
  let steps = 0;
  const maxSteps = Math.ceil(120 * 120);

  console.log('Simulating Grid 2 for offtrack diagnosis...');

  while (steps < maxSteps) {
    if (session.phase === 'finished' && !session.activeCars.every((c) => c.race.finishTime !== null)) {
      session.phase = 'racing';
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
        phase: novaDriver.topologyResult?.phase,
        selectedSide: novaDriver.topologyPlanner?.selectedSide,
        targetSpeedCap: novaDriver.topologyResult?.targetSpeedCap,
        reason: novaDriver.topologyResult?.targetSpeedCapReason,
        astraS: astraCar.s,
        astraQ: astraCar.lateral,
        geminiS: geminiCar.s,
        geminiQ: geminiCar.lateral,
        dOff
      });
    }
    prevOfftrack = novaCar.race.offtrack;

    session.step(1 / 120, { throttle: 0, brake: 0, steer: 0 });
    steps++;

    if (session.time > 90.0) break;
  }

  console.log(`\nTotal Offtrack Samples: ${offtrackSamples.length}`);
  if (offtrackSamples.length > 0) {
    console.log(`First offtrack sample at t=${offtrackSamples[0].time.toFixed(3)}:`);
    console.log(JSON.stringify(offtrackSamples[0], null, 2));
    console.log(`Middle offtrack sample at t=${offtrackSamples[Math.floor(offtrackSamples.length / 2)].time.toFixed(3)}:`);
    console.log(JSON.stringify(offtrackSamples[Math.floor(offtrackSamples.length / 2)], null, 2));
    console.log(`Last offtrack sample at t=${offtrackSamples.at(-1).time.toFixed(3)}:`);
    console.log(JSON.stringify(offtrackSamples.at(-1), null, 2));
  }
}

diagnoseHeat2().catch(console.error);
