import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField, TRIAD_CANDIDATES } from '../sandbox/bridges/index.js';

/**
 * Section 9: Counterfactual Speed-Cap Validation
 *
 * For sampled speed-cap events:
 * Replay from identical state with:
 *   A. Cap active (normal)
 *   B. Cap disabled (counterfactual)
 * Keep rival behavior identical.
 *
 * Classifies events into:
 *   - NECESSARY: without cap, physical body collision or unavoidable infeasibility occurs
 *   - BENEFICIAL: no collision, but cap improves positioning or downstream outcome
 *   - UNNECESSARY: no collision or meaningful safety benefit
 *   - OVER-AGGRESSIVE: intervention needed but applied deceleration exceeded required
 */

function cloneVehicleState(v) {
  return {
    x: v.x, z: v.z, y: v.y, yaw: v.yaw,
    vx: v.vx, vz: v.vz, u: v.u, v: v.v,
    speed: v.speed, yawRate: v.yawRate,
    ax: v.ax, ay: v.ay, roll: v.roll, pitch: v.pitch, heave: v.heave,
    steering: v.steering, gear: v.gear, rpm: v.rpm, shiftTimer: v.shiftTimer,
    controls: { ...v.controls },
    fuel: v.fuel, damage: v.damage,
    s: v.s, lateral: v.lateral, zone: v.zone, impact: v.impact,
    absActive: v.absActive, tcActive: v.tcActive,
    wheels: v.wheels.map(w => ({
      x: w.x, z: w.z, omega: w.omega, steer: w.steer,
      compression: w.compression, load: w.load, brakeTemp: w.brakeTemp,
      tyre: {
        surface: w.tyre.surface, core: w.tyre.core, inner: w.tyre.inner, outer: w.tyre.outer,
        coldPressure: w.tyre.coldPressure, pressure: w.tyre.pressure, wear: w.tyre.wear,
        alpha: w.tyre.alpha, kappa: w.tyre.kappa, fx: w.tyre.fx, fy: w.tyre.fy,
        utilisation: w.tyre.utilisation, slipPower: w.tyre.slipPower
      }
    })),
    race: {
      progress: v.race.progress, previousS: v.race.previousS, lap: v.race.lap,
      lastLap: v.race.lastLap, bestLap: v.race.bestLap, lapStart: v.race.lapStart,
      sector: v.race.sector, valid: v.race.valid, sectors: [...v.race.sectors],
      finishTime: v.race.finishTime, offtrack: v.race.offtrack
    }
  };
}

function restoreVehicleState(v, saved) {
  v.x = saved.x; v.z = saved.z; v.y = saved.y; v.yaw = saved.yaw;
  v.vx = saved.vx; v.vz = saved.vz; v.u = saved.u; v.v = saved.v;
  v.speed = saved.speed; v.yawRate = saved.yawRate;
  v.ax = saved.ax; v.ay = saved.ay; v.roll = saved.roll; v.pitch = saved.pitch; v.heave = saved.heave;
  v.steering = saved.steering; v.gear = saved.gear; v.rpm = saved.rpm; v.shiftTimer = saved.shiftTimer;
  v.controls = { ...saved.controls };
  v.fuel = saved.fuel; v.damage = saved.damage;
  v.s = saved.s; v.lateral = saved.lateral; v.zone = saved.zone; v.impact = saved.impact;
  v.absActive = saved.absActive; v.tcActive = saved.tcActive;
  saved.wheels.forEach((sw, i) => {
    const w = v.wheels[i];
    w.x = sw.x; w.z = sw.z; w.omega = sw.omega; w.steer = sw.steer;
    w.compression = sw.compression; w.load = sw.load; w.brakeTemp = sw.brakeTemp;
    Object.assign(w.tyre, sw.tyre);
  });
  v.race.progress = saved.race.progress;
  v.race.previousS = saved.race.previousS;
  v.race.lap = saved.race.lap;
  v.race.lastLap = saved.race.lastLap;
  v.race.bestLap = saved.race.bestLap;
  v.race.lapStart = saved.race.lapStart;
  v.race.sector = saved.race.sector;
  v.race.valid = saved.race.valid;
  v.race.sectors = [...saved.race.sectors];
  v.race.finishTime = saved.race.finishTime;
  v.race.offtrack = saved.race.offtrack;
}

function createSimulation(grid, laps = 3) {
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
  session.phase = 'racing';
  session.countdown = 0;

  return { track, session, field };
}

export async function validateSpeedCaps({ grid = ['nova', 'gemini-supreme', 'astra'], laps = 3, maxSamples = 20 } = {}) {
  console.log(`\n================================================================================`);
  console.log(`COUNTERFACTUAL SPEED-CAP VALIDATION: Grid = [${grid.join(', ')}], Laps = ${laps}`);
  console.log(`================================================================================`);

  const { track, session, field } = createSimulation(grid, laps);
  const novaBridge = field.bridges.find(b => b.candidateId === 'nova');
  const novaCar = session.cars[novaBridge.carId];
  const novaDriver = novaBridge.driver;
  const tp = novaDriver.topologyPlanner;

  const DT = 1 / 120;
  const maxSteps = Math.ceil((laps * 90 + 30) / DT);

  const capturedEvents = [];
  let inCapEpisode = false;
  let currentEpisodeStart = null;
  let steps = 0;

  // 1. Identify speed-cap events
  while (steps < maxSteps && session.phase !== 'finished') {
    const isCapped = Number.isFinite(tp?.targetSpeedCap) && tp.targetSpeedCap < 70.0;
    const reason = tp?.lastSpeedCapReason ?? 'UNKNOWN';

    if (isCapped && !inCapEpisode) {
      inCapEpisode = true;
      currentEpisodeStart = {
        step: steps,
        time: session.time,
        station: novaCar.s,
        speed: novaCar.speed,
        capSpeed: tp.targetSpeedCap,
        reason,
        // Snapshot simulation state
        sessionSnapshot: {
          time: session.time,
          contacts: session.contacts,
          cars: session.activeCars.map(c => cloneVehicleState(c))
        }
      };
      if (capturedEvents.length < maxSamples) {
        capturedEvents.push(currentEpisodeStart);
      }
    } else if (!isCapped && inCapEpisode) {
      inCapEpisode = false;
    }

    session.step(DT, { throttle: 0, brake: 0, steer: 0 });
    steps++;

    if (novaCar.race.finishTime !== null) break;
  }

  console.log(`Captured ${capturedEvents.length} distinct speed-cap episodes during race.`);

  const classification = {
    NECESSARY: 0,
    BENEFICIAL: 0,
    UNNECESSARY: 0,
    OVER_AGGRESSIVE: 0
  };

  const detailedResults = [];

  // 2. Evaluate counterfactual branch for each captured event
  for (let idx = 0; idx < capturedEvents.length; idx++) {
    const ev = capturedEvents[idx];
    const rolloutDuration = 2.5; // 2.5s forward rollout
    const rolloutSteps = Math.round(rolloutDuration / DT);

    // Branch A: With Cap (re-run rollout with cap enabled)
    // Setup fresh simulation and advance to event state
    const simA = createSimulation(grid, laps);
    // Fast restore state
    simA.session.time = ev.sessionSnapshot.time;
    simA.session.contacts = ev.sessionSnapshot.contacts;
    simA.session.activeCars.forEach((c, i) => restoreVehicleState(c, ev.sessionSnapshot.cars[i]));
    const novaA = simA.session.cars[simA.field.bridges.find(b => b.candidateId === 'nova').carId];

    let contactsA = 0;
    let minGapA = Infinity;
    let offtrackA = 0;
    const startOfftrackA = novaA.race.offtrack;
    const startContactsA = simA.session.contacts;

    for (let s = 0; s < rolloutSteps; s++) {
      simA.session.step(DT, { throttle: 0, brake: 0, steer: 0 });
      // compute minimum gap to any opponent
      for (let i = 0; i < simA.session.activeCars.length; i++) {
        if (i === novaA.id) continue;
        const other = simA.session.activeCars[i];
        const d = Math.hypot(novaA.x - other.x, novaA.z - other.z);
        if (d < minGapA) minGapA = d;
      }
    }
    contactsA = simA.session.contacts - startContactsA;
    offtrackA = novaA.race.offtrack - startOfftrackA;

    // Branch B: Without Cap (counterfactual: force cap = Infinity)
    const simB = createSimulation(grid, laps);
    simB.session.time = ev.sessionSnapshot.time;
    simB.session.contacts = ev.sessionSnapshot.contacts;
    simB.session.activeCars.forEach((c, i) => restoreVehicleState(c, ev.sessionSnapshot.cars[i]));
    const bridgeB = simB.field.bridges.find(b => b.candidateId === 'nova');
    const novaB = simB.session.cars[bridgeB.carId];
    const tpB = bridgeB.driver.topologyPlanner;

    let contactsB = 0;
    let minGapB = Infinity;
    let offtrackB = 0;
    const startOfftrackB = novaB.race.offtrack;
    const startContactsB = simB.session.contacts;

    for (let s = 0; s < rolloutSteps; s++) {
      // Force disable cap in Branch B
      if (tpB) tpB.targetSpeedCap = Infinity;
      simB.session.step(DT, { throttle: 0, brake: 0, steer: 0 });
      if (tpB) tpB.targetSpeedCap = Infinity;

      for (let i = 0; i < simB.session.activeCars.length; i++) {
        if (i === novaB.id) continue;
        const other = simB.session.activeCars[i];
        const d = Math.hypot(novaB.x - other.x, novaB.z - other.z);
        if (d < minGapB) minGapB = d;
      }
    }
    contactsB = simB.session.contacts - startContactsB;
    offtrackB = novaB.race.offtrack - startOfftrackB;

    // 3. Classify
    // Car body dimensions: length 4.65m, width 2.02m. Center-to-center collision distance is ~2.8m.
    let outcome = 'UNNECESSARY';
    const deltaV = ev.speed - ev.capSpeed;

    if (contactsB > 0 || minGapB < 2.5 || offtrackB > 0.05) {
      // Without cap, collision or catastrophic offtrack occurred!
      if (deltaV > 8.0 && minGapA > 5.0) {
        outcome = 'OVER_AGGRESSIVE';
      } else {
        outcome = 'NECESSARY';
      }
    } else if (contactsB === 0 && minGapB >= 3.5 && offtrackB === 0) {
      if (novaA.race.progress > novaB.race.progress) {
        outcome = 'BENEFICIAL';
      } else {
        outcome = 'UNNECESSARY';
      }
    } else {
      outcome = 'BENEFICIAL';
    }

    classification[outcome]++;
    detailedResults.push({
      id: idx + 1,
      time: ev.time.toFixed(2),
      station: ev.station.toFixed(1),
      reason: ev.reason,
      speed: (ev.speed * 3.6).toFixed(1),
      capSpeed: (ev.capSpeed * 3.6).toFixed(1),
      contactsA,
      contactsB,
      minGapA: minGapA.toFixed(2),
      minGapB: minGapB.toFixed(2),
      outcome
    });
  }

  console.log('\n--- SPEED-CAP COUNTERFACTUAL RESULTS ---');
  console.log(`Total episodes analyzed: ${capturedEvents.length}`);
  console.log(`  NECESSARY:       ${classification.NECESSARY} (${((classification.NECESSARY / Math.max(1, capturedEvents.length)) * 100).toFixed(1)}%)`);
  console.log(`  BENEFICIAL:      ${classification.BENEFICIAL} (${((classification.BENEFICIAL / Math.max(1, capturedEvents.length)) * 100).toFixed(1)}%)`);
  console.log(`  UNNECESSARY:     ${classification.UNNECESSARY} (${((classification.UNNECESSARY / Math.max(1, capturedEvents.length)) * 100).toFixed(1)}%)`);
  console.log(`  OVER-AGGRESSIVE: ${classification.OVER_AGGRESSIVE} (${((classification.OVER_AGGRESSIVE / Math.max(1, capturedEvents.length)) * 100).toFixed(1)}%)`);

  console.log('\nDetailed sample table:');
  console.log('ID | Time (s) | Station (m) | Reason                   | Spd -> Cap   | Gap A (m) | Gap B (m) | Cont B | Outcome');
  console.log('---|----------|-------------|--------------------------|--------------|-----------|-----------|--------|--------');
  detailedResults.slice(0, 15).forEach(r => {
    console.log(
      `${String(r.id).padEnd(2)} | ` +
      `${r.time.padStart(8)} | ` +
      `${r.station.padStart(11)} | ` +
      `${r.reason.padEnd(24)} | ` +
      `${(r.speed + '->' + r.capSpeed).padEnd(12)} | ` +
      `${r.minGapA.padStart(9)} | ` +
      `${r.minGapB.padStart(9)} | ` +
      `${String(r.contactsB).padStart(6)} | ` +
      `${r.outcome}`
    );
  });

  return { classification, detailedResults };
}

if (process.argv[1]?.endsWith('counterfactual-cap-validation.mjs')) {
  validateSpeedCaps({ grid: ['nova', 'gemini-supreme', 'astra'], laps: 3 }).catch(console.error);
}
