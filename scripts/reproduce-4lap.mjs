import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField, TRIAD_CANDIDATES } from '../sandbox/bridges/index.js';

export async function runReproduction({
  grid = ['nova', 'gemini-supreme', 'astra'],
  laps = 4,
  skipCountdown = false,
  counterfactual = null
} = {}) {
  const track = new Track('harbor-ring');
  const session = new Session(track, { classId: 'gt', mixed: false });
  session.laps = laps;
  session.field = grid.length;
  session.cars = session.cars.slice(0, grid.length);
  session.drivers = session.drivers.slice(0, grid.length);
  session.autopilot = true;

  const field = createField({
    session,
    hostTrack: track,
    order: grid,
    candidatesList: TRIAD_CANDIDATES
  });

  session.start({ freshTrack: true });
  field.attach(true);

  if (skipCountdown) {
    session.phase = 'racing';
    session.countdown = 0;
  }

  const DT = 1 / 120;
  const maxSeconds = laps * 110 + 60;
  const maxSteps = Math.ceil(maxSeconds / DT);

  const novaBridge = field.bridges.find((b) => b.candidateId === 'nova');
  const novaCar = session.cars[novaBridge.carId];
  const novaDriver = novaBridge.driver;
  const cc = novaDriver.coupledController;
  const tp = novaDriver.topologyPlanner;

  // Track per-lap metrics
  const lapMetrics = [];
  function createLapRecord(lapIndex) {
    return {
      lapIndex,
      lapTime: 0,
      speedCapSeconds: 0,
      trafficBrakingSeconds: 0,
      actualOverspeedSeconds: 0,
      offlineLimiterSeconds: 0,
      minTyreScale: 1.0,
      attackSeconds: 0,
      followSeconds: 0,
      abortSeconds: 0,
      otherSeconds: 0,
      totalSeconds: 0,
      latErrorSqSum: 0,
      stepCount: 0,
      endOfLapTyres: null,
      topSpeedKmh: 0,
      peakLatG: 0,
    };
  }

  let currentLap = 1;
  let currentRecord = createLapRecord(1);
  let previousProgress = novaCar.race.progress;
  let previousLap = novaCar.race.lap;

  let steps = 0;
  const opponentLapTimes = {};
  grid.forEach((id) => { opponentLapTimes[id] = []; });

  while (steps < maxSteps) {
    if (session.phase === 'finished' && session.activeCars.every((c) => c.race.finishTime !== null)) {
      break;
    }

    // Step session
    session.step(DT, { throttle: 0, brake: 0, steer: 0 });
    steps++;

    // Track opponent lap completions
    session.activeCars.forEach((c, idx) => {
      const b = field.bridges[idx];
      const id = b.candidateId;
      if (c.race.lastLap !== null && c.race.lap > opponentLapTimes[id].length + 1) {
        opponentLapTimes[id].push(c.race.lastLap);
      }
    });

    // Check if NOVA completed a lap
    if (novaCar.race.lap > currentLap || novaCar.race.finishTime !== null) {
      currentRecord.lapTime = novaCar.race.lastLap ?? (session.time - currentRecord.totalSeconds);
      if (novaCar.wheels && novaCar.wheels.length >= 4) {
        const [fl, fr, rl, rr] = novaCar.wheels.map((w) => w.tyre);
        currentRecord.endOfLapTyres = {
          fl: { core: fl.core, surface: fl.surface, pressure: fl.pressure, wear: fl.wear },
          fr: { core: fr.core, surface: fr.surface, pressure: fr.pressure, wear: fr.wear },
          rl: { core: rl.core, surface: rl.surface, pressure: rl.pressure, wear: rl.wear },
          rr: { core: rr.core, surface: rr.surface, pressure: rr.pressure, wear: rr.wear }
        };
      }
      lapMetrics.push(currentRecord);

      if (novaCar.race.finishTime !== null || currentLap >= laps) {
        break;
      }

      currentLap = novaCar.race.lap;
      currentRecord = createLapRecord(currentLap);
    }

    if (session.phase === 'racing') {
      currentRecord.totalSeconds += DT;
      currentRecord.stepCount++;

      // NOVA stats inspection
      const speedKmh = novaCar.speed * 3.6;
      currentRecord.topSpeedKmh = Math.max(currentRecord.topSpeedKmh, speedKmh);

      // Lat G
      const yaw = novaCar.yaw ?? 0;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const ax = novaCar.ax ?? 0, az = novaCar.az ?? 0;
      const localLatG = Math.abs((ax * c - az * s) / 9.81);
      currentRecord.peakLatG = Math.max(currentRecord.peakLatG, localLatG);

      // Tyre scale
      const tScale = cc ? cc.computeTyreScale(novaCar) : 1.0;
      currentRecord.minTyreScale = Math.min(currentRecord.minTyreScale, tScale);

      // Planner state
      const phase = tp?.phase ?? 'FREE';
      const topo = novaDriver.topologyResult;
      const activeTopology = topo?.activeTopology ?? 'FREE_AIR';
      const targetSpeedCap = topo?.targetSpeedCap;

      if (phase.includes('ATTACK')) {
        currentRecord.attackSeconds += DT;
      } else if (phase.includes('FOLLOW') || activeTopology === 'H_FOLLOW') {
        currentRecord.followSeconds += DT;
      } else if (phase.includes('ABORT') || phase.includes('CONCEDE')) {
        currentRecord.abortSeconds += DT;
      } else {
        currentRecord.otherSeconds += DT;
      }

      // Speed cap seconds
      if (Number.isFinite(targetSpeedCap) && targetSpeedCap < 70.0) {
        currentRecord.speedCapSeconds += DT;
      }

      // Controller state inspection
      const ccState = cc?.state ?? {};
      if (ccState.brakeReason === 'TRAFFIC' || ccState.trafficBrakeActive) {
        currentRecord.trafficBrakingSeconds += DT;
      }
      if (ccState.brakeReason === 'ACTUAL_OVERSPEED') {
        currentRecord.actualOverspeedSeconds += DT;
      }
      if (ccState.targetLimitReason === 'GRIP_LIMIT' || (ccState.offlineTrim && ccState.offlineTrim < 0.99)) {
        currentRecord.offlineLimiterSeconds += DT;
      }

      // Lat error
      const here = cc ? cc.sample(novaCar.s) : { q: 0 };
      const qVal = Number.isFinite(novaCar.q) ? novaCar.q : (novaCar.lateral ?? 0);
      const latErr = qVal - here.q;
      currentRecord.latErrorSqSum += latErr * latErr;
    }
  }

  // Summary per lap
  console.log('\n================================================================================');
  console.log(`4-LAP REPRODUCTION REPORT: Grid = [${grid.join(', ')}]`);
  console.log('================================================================================');
  
  lapMetrics.forEach((m) => {
    const rmsLatErr = Math.sqrt(m.latErrorSqSum / Math.max(1, m.stepCount));
    const attackPct = ((m.attackSeconds / Math.max(0.01, m.totalSeconds)) * 100).toFixed(1);
    const followPct = ((m.followSeconds / Math.max(0.01, m.totalSeconds)) * 100).toFixed(1);
    const abortPct = ((m.abortSeconds / Math.max(0.01, m.totalSeconds)) * 100).toFixed(1);

    console.log(`\n--- LAP ${m.lapIndex} (Time: ${m.lapTime.toFixed(3)}s, TopSpeed: ${m.topSpeedKmh.toFixed(1)} km/h, PeakG: ${m.peakLatG.toFixed(2)}G) ---`);
    console.log(`  Min tyreScale:          ${m.minTyreScale.toFixed(4)}`);
    console.log(`  Speed-Cap time:         ${m.speedCapSeconds.toFixed(2)}s`);
    console.log(`  Traffic Braking time:   ${m.trafficBrakingSeconds.toFixed(2)}s`);
    console.log(`  ACTUAL_OVERSPEED time:  ${m.actualOverspeedSeconds.toFixed(2)}s`);
    console.log(`  Offline Limiter time:   ${m.offlineLimiterSeconds.toFixed(2)}s`);
    console.log(`  RMS Lateral Error:      ${rmsLatErr.toFixed(3)}m`);
    console.log(`  Tactic Distribution:    ATTACK ${attackPct}% | FOLLOW ${followPct}% | ABORT ${abortPct}%`);
    if (m.endOfLapTyres) {
      const { fl, fr, rl, rr } = m.endOfLapTyres;
      console.log(`  Tyre Temps (Core C):    FL: ${fl.core.toFixed(1)}° | FR: ${fr.core.toFixed(1)}° | RL: ${rl.core.toFixed(1)}° | RR: ${rr.core.toFixed(1)}°`);
      console.log(`  Tyre Temps (Surf C):    FL: ${fl.surface.toFixed(1)}° | FR: ${fr.surface.toFixed(1)}° | RL: ${rl.surface.toFixed(1)}° | RR: ${rr.surface.toFixed(1)}°`);
      console.log(`  Tyre Pressures (bar):   FL: ${fl.pressure.toFixed(2)} | FR: ${fr.pressure.toFixed(2)} | RL: ${rl.pressure.toFixed(2)} | RR: ${rr.pressure.toFixed(2)}`);
      console.log(`  Tyre Wear:              FL: ${(fl.wear * 100).toFixed(2)}% | FR: ${(fr.wear * 100).toFixed(2)}% | RL: ${(rl.wear * 100).toFixed(2)}% | RR: ${(rr.wear * 100).toFixed(2)}%`);
    }
  });

  console.log('\n--- OPPONENT LAP TIMES ---');
  grid.forEach((id) => {
    const carObj = session.cars[field.bridges.find(b => b.candidateId === id).carId];
    const totalTime = carObj.race.finishTime ?? session.time;
    console.log(`  ${id.padEnd(16)}: ${opponentLapTimes[id].map(t => t.toFixed(3) + 's').join(' | ')} (Total: ${totalTime.toFixed(3)}s)`);
  });

  return { lapMetrics, opponentLapTimes };
}

if (process.argv[1]?.endsWith('reproduce-4lap.mjs')) {
  runReproduction({
    grid: ['nova', 'gemini-supreme', 'astra'],
    laps: 4,
    skipCountdown: false
  }).catch(console.error);
}
