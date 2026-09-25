import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField, TRIAD_CANDIDATES } from '../sandbox/bridges/index.js';

export async function diagnoseHeat4() {
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
  const geminiBridge = field.bridges.find(b => b.candidateId === 'gemini-supreme');
  const astraBridge = field.bridges.find(b => b.candidateId === 'astra');
  const novaCar = session.cars[novaBridge.carId];
  const geminiCar = session.cars[geminiBridge.carId];
  const astraCar = session.cars[astraBridge.carId];
  const novaDriver = novaBridge.driver;

  let prevOfftrack = 0;
  const offtrackEpisodes = [];
  const buffer = [];
  let steps = 0;
  const maxSteps = Math.ceil(340 * 120);

  console.log(`Simulating Grid [${grid.join(', ')}] for 3 laps...`);

  while (steps < maxSteps) {
    const novaAi = novaDriver; // novaBridge.driver is novaAi (NovaDriver)
    const dbg = novaAi?.coupledController?.state?.debugSteer || {};
    const topo = novaAi?.topologyResult;
    const isApproach = session.time >= 42.0 && session.time <= 46.5;
    if (isApproach && steps % 4 === 0) {
      const dbg = novaAi?.coupledController?.state?.debugSteer || {};
      const cc = novaAi?.coupledController;
      const n = novaCar;
      console.log(`t=${session.time.toFixed(2)} | s=${n.s.toFixed(1)} q=${n.lateral.toFixed(2)} tgtQ=${(topo?.targetQ??0).toFixed(2)} | str=${n.controls.steer.toFixed(2)} pp=${(dbg.pp??0).toFixed(2)} ff=${(dbg.ff??0).toFixed(2)} damp=${(dbg.damp??0).toFixed(2)} bnd=${(dbg.boundarySteerCorrection??0).toFixed(2)} satR=${(dbg.satR??0).toFixed(2)} beta=${(cc?.lastBeta??0).toFixed(3)} | v=${(n.speed*3.6).toFixed(1)} thr=${n.controls.throttle.toFixed(2)} brk=${n.controls.brake.toFixed(2)}`);
      if (session.time >= 25.0 && session.time <= 26.0) {
        for (const c of topo?.candidates ?? []) {
          console.log(`   cand: ${c.topology} cost=${c.cost.toFixed(2)} feas=${c.trajectory?.corridorFeasible} risk=${c.predicted?.physicalCollisionRisk ?? 0}`);
        }
      }
    }
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
      steer: novaCar.controls.steer,
      throttle: novaCar.controls.throttle,
      brake: novaCar.controls.brake,
      zone: novaCar.zone,
      intent: novaDriver.topologyResult?.activeTopology ?? novaDriver.state?.intent,
    };
    buffer.push(snapshot);
    if (buffer.length > 720) buffer.shift();

    if (dOff > 0.001) {
      if (offtrackEpisodes.length === 0 || session.time - offtrackEpisodes.at(-1).endTime > 1.0) {
        offtrackEpisodes.push({
          startTime: session.time,
          startStation: novaCar.s,
          startLap: novaCar.race.lap,
          preBuffer: [...buffer.slice(-60)],
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

  console.log(`Simulation finished in ${session.time.toFixed(2)}s. Total Nova Offtrack: ${novaCar.race.offtrack.toFixed(3)}s, Nova Finish: ${novaCar.race.finishTime?.toFixed(2) ?? 'DNF'}`);
  console.log(`Captured ${offtrackEpisodes.length} distinct offtrack episodes:`);
  offtrackEpisodes.forEach((ep, i) => {
    console.log(`\n=== EPISODE ${i + 1} ===`);
    console.log(`  Lap: ${ep.startLap} | Start Time: ${ep.startTime.toFixed(2)}s | End Time: ${ep.endTime.toFixed(2)}s | Duration: ${(ep.endTime - ep.startTime).toFixed(2)}s | Station: ${ep.startStation.toFixed(1)}m`);
    const pre = ep.preBuffer;
    for (let k = 0; k < pre.length; k += 12) {
      const snap = pre[k];
      console.log(`  ${snap.time.toFixed(2)}s | s=${snap.s.toFixed(1)} | q=${snap.q.toFixed(2)} | v=${(snap.speed*3.6).toFixed(1)} | steer=${snap.steer.toFixed(2)} | throt=${snap.throttle.toFixed(2)} | brk=${snap.brake.toFixed(2)} | zone=${snap.zone}`);
    }
  });
}

diagnoseHeat4().catch(console.error);
