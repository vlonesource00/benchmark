import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField, TRIAD_CANDIDATES } from '../sandbox/bridges/index.js';

export async function diagnoseHeat3() {
  const grid = ['gemini-supreme', 'nova', 'astra'];
  const track = new Track('harbor-ring');
  const session = new Session(track, { classId: 'gt' });
  session.laps = 5;
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

  let prevOfftrack = 0;
  const offtrackEpisodes = [];
  const buffer = [];
  let steps = 0;
  const maxSteps = Math.ceil(500 * 120);

  console.log('Simulating Grid 3 [gemini-supreme, nova, astra] for 5 laps...');

  while (steps < maxSteps) {
    if (session.phase === 'finished' && !session.activeCars.every((c) => c.race.finishTime !== null)) {
      session.phase = 'racing';
    }

    const dOff = novaCar.race.offtrack - prevOfftrack;
    const snapshot = {
      step: steps,
      time: session.time,
      s: novaCar.s,
      q: novaCar.lateral,
      speed: novaCar.speed,
      lap: novaCar.race.lap,
      offtrack: novaCar.race.offtrack,
      ax: novaCar.ax,
      ay: novaCar.ay,
      yaw: novaCar.yaw,
      yawRate: novaCar.yawRate,
      u: novaCar.u,
      v: novaCar.v,
      throttle: novaCar.controls.throttle,
      brake: novaCar.controls.brake,
      steer: novaCar.controls.steer,
      zone: novaCar.zone,
      flCore: novaCar.wheels[0].tyre.core,
      rrCore: novaCar.wheels[3].tyre.core,
      rrSurf: novaCar.wheels[3].tyre.surface,
      intent: novaDriver.topologyResult?.activeTopology ?? novaDriver.state?.intent,
      targetQ: novaDriver.coupledController?.state?.targetQ,
      vRef: novaDriver.coupledController?.state?.vRef,
      targetSpeed: novaDriver.coupledController?.state?.targetSpeed,
      brakeReason: novaDriver.coupledController?.state?.brakeReason,
      speedCap: novaDriver.topologyPlanner?.targetSpeedCap,
      speedCapReason: novaDriver.topologyPlanner?.lastSpeedCapReason,
      trackWidth: track.halfWidth,
    };
    buffer.push(snapshot);
    if (buffer.length > 720) buffer.shift(); // 6s at 120Hz

    if (dOff > 0.001) {
      if (offtrackEpisodes.length === 0 || session.time - offtrackEpisodes.at(-1).endTime > 1.0) {
        offtrackEpisodes.push({
          startTime: session.time,
          startStation: novaCar.s,
          startLap: novaCar.race.lap,
          preBuffer: [...buffer.slice(-600)], // 5s before
          endTime: session.time,
          totalOfftrack: dOff
        });
      } else {
        offtrackEpisodes.at(-1).endTime = session.time;
        offtrackEpisodes.at(-1).totalOfftrack += dOff;
      }
    }
    prevOfftrack = novaCar.race.offtrack;

    session.step(1 / 120, { throttle: 0, brake: 0, steer: 0 });
    steps++;

    if (session.activeCars.every(c => c.race.finishTime !== null)) break;
  }

  console.log(`Simulation finished in ${session.time.toFixed(2)}s. Total Nova Offtrack: ${novaCar.race.offtrack.toFixed(3)}s`);
  console.log(`Captured ${offtrackEpisodes.length} distinct offtrack episodes:`);
  offtrackEpisodes.forEach((ep, i) => {
    console.log(`\n=== EPISODE ${i + 1} ===`);
    console.log(`  Lap: ${ep.startLap} | Start Time: ${ep.startTime.toFixed(2)}s | End Time: ${ep.endTime.toFixed(2)}s | Duration: ${(ep.endTime - ep.startTime).toFixed(2)}s`);
    console.log(`  Station: ${ep.startStation.toFixed(1)}m | Accumulated Offtrack: ${ep.totalOfftrack.toFixed(3)}s`);
    console.log(`  --- 5 SECONDS BEFORE FIRST OFFTRACK (sampled every 0.5s) ---`);
    console.log(`  Time (s) | Station (m) | Lat q (m) | Spd (km/h) | Steer | Throt | Brake | Intent | vRef | RR Surf | Zone`);
    const pre = ep.preBuffer;
    for (let k = 0; k < pre.length; k += 60) {
      const snap = pre[k];
      console.log(
        `  ${snap.time.toFixed(2).padStart(8)} | ` +
        `${snap.s.toFixed(1).padStart(11)} | ` +
        `${snap.q.toFixed(2).padStart(9)} | ` +
        `${(snap.speed * 3.6).toFixed(1).padStart(10)} | ` +
        `${snap.steer.toFixed(3).padStart(5)} | ` +
        `${snap.throttle.toFixed(2).padStart(5)} | ` +
        `${snap.brake.toFixed(2).padStart(5)} | ` +
        `${(snap.intent ?? 'NONE').padEnd(10)} | ` +
        `${((snap.vRef ?? 0) * 3.6).toFixed(1).padStart(5)} | ` +
        `${snap.rrSurf.toFixed(1).padStart(7)}°C | ` +
        `${snap.zone}`
      );
    }
    // Also print immediate onset: 10 steps before and during onset
    console.log(`  --- ONSET VICINITY (-0.1s to +0.2s) ---`);
    const onsetStart = Math.max(0, pre.length - 24);
    for (let k = onsetStart; k < pre.length; k += 4) {
      const snap = pre[k];
      console.log(
        `  ${snap.time.toFixed(3)} | s=${snap.s.toFixed(1)} | q=${snap.q.toFixed(2)} | v=${(snap.speed * 3.6).toFixed(1)} | steer=${snap.steer.toFixed(3)} | throt=${snap.throttle.toFixed(2)} | brk=${snap.brake.toFixed(2)} | reason=${snap.brakeReason} | zone=${snap.zone}`
      );
    }
  });
}

diagnoseHeat3().catch(console.error);
