import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField, TRIAD_CANDIDATES } from '../sandbox/bridges/index.js';

export async function runTyreEnergyMap(laps = 3) {
  const track = new Track('harbor-ring');
  const session = new Session(track, { classId: 'gt', mixed: false });
  session.laps = laps;
  session.field = 1;
  session.cars = session.cars.slice(0, 1);
  session.drivers = session.drivers.slice(0, 1);
  session.autopilot = true;

  const field = createField({
    session,
    hostTrack: track,
    order: ['nova'],
    candidatesList: TRIAD_CANDIDATES
  });
  session.start({ freshTrack: true });
  field.attach(true);
  session.phase = 'racing';
  session.countdown = 0;

  const novaBridge = field.bridges.find(b => b.candidateId === 'nova');
  const car = session.cars[novaBridge.carId];

  const L = track.length;
  const numSectors = Math.ceil(L / 20); // 20-meter bins across track
  const binSize = L / numSectors;

  // Thermal energy bins per wheel: [FL, FR, RL, RR]
  // Index 3 is RR (Rear-Right), which is the most stressed tyre on anti-clockwise / heavy-traction tracks
  const sectorStats = Array.from({ length: numSectors }, (_, idx) => ({
    sector: idx,
    stationStart: idx * binSize,
    stationCenter: (idx + 0.5) * binSize,
    stationEnd: (idx + 1) * binSize,
    samples: 0,
    timeSpent: 0,
    // RR stats (wheel index 3)
    rrTractionEnergy: 0, // Joules from kappa > 0
    rrBrakingEnergy: 0,  // Joules from kappa < 0
    rrLateralEnergy: 0,  // Joules from alpha
    rrTotalSlipEnergy: 0,
    rrTempRiseSurf: 0,
    rrTempRiseCore: 0,
    rrMaxKappa: 0,
    rrMinKappa: 0,
    rrMaxAlpha: 0,
    rrAvgUtil: 0,
    rrPeakUtil: 0,
    speedAvg: 0,
    steerAvg: 0,
    throttleAvg: 0,
    brakeAvg: 0
  }));

  const DT = 1 / 120;
  const maxSteps = Math.ceil((laps * 90 + 30) / DT);
  let steps = 0;

  let prevLap = 1;
  let prevSurfRR = car.wheels[3].tyre.surface;
  let prevCoreRR = car.wheels[3].tyre.core;

  console.log(`Simulating NOVA for ${laps} laps to build high-resolution tyre energy map...`);

  const lapEnergy = [
    { lap: 1, traction: 0, braking: 0, lateral: 0, total: 0 },
    { lap: 2, traction: 0, braking: 0, lateral: 0, total: 0 },
    { lap: 3, traction: 0, braking: 0, lateral: 0, total: 0 },
    { lap: 4, traction: 0, braking: 0, lateral: 0, total: 0 },
    { lap: 5, traction: 0, braking: 0, lateral: 0, total: 0 }
  ];

  while (steps < maxSteps) {
    if (session.phase === 'finished' && !session.activeCars.every(c => c.race.finishTime !== null)) {
      session.phase = 'racing';
    }

    const wRR = car.wheels[3];
    const tRR = wRR.tyre;
    const surfBefore = tRR.surface;
    const coreBefore = tRR.core;

    session.step(DT, { throttle: 0, brake: 0, steer: 0 });
    steps++;

    const surfAfter = tRR.surface;
    const coreAfter = tRR.core;
    const dSurf = surfAfter - surfBefore;
    const dCore = coreAfter - coreBefore;

    const s = ((car.s % L) + L) % L;
    const binIdx = Math.min(numSectors - 1, Math.floor(s / binSize));
    const bin = sectorStats[binIdx];

    const omega = wRR.omega;
    const r = car.spec.radius;
    const vx = car.u;
    const slipVelX = omega * r - vx;
    const fx = tRR.fx ?? 0;
    const fy = tRR.fy ?? 0;
    const kappa = tRR.kappa ?? 0;
    const alpha = Math.abs(tRR.alpha ?? 0);
    const util = tRR.utilisation ?? 0;

    const slipPowX = Math.abs(fx * slipVelX);
    const slipPowY = tRR.slipPower - slipPowX;
    const energyX = slipPowX * DT;
    const energyY = Math.max(0, slipPowY) * DT;

    bin.samples++;
    bin.timeSpent += DT;
    if (kappa >= 0) {
      bin.rrTractionEnergy += energyX;
    } else {
      bin.rrBrakingEnergy += energyX;
    }
    bin.rrLateralEnergy += energyY;
    bin.rrTotalSlipEnergy += (tRR.slipPower * DT);

    const curLapIdx = Math.min(lapEnergy.length - 1, Math.max(0, car.race.lap - 1));
    if (kappa >= 0) lapEnergy[curLapIdx].traction += energyX;
    else lapEnergy[curLapIdx].braking += energyX;
    lapEnergy[curLapIdx].lateral += energyY;
    lapEnergy[curLapIdx].total += (tRR.slipPower * DT);

    bin.rrTempRiseSurf += dSurf;
    bin.rrTempRiseCore += dCore;
    bin.rrMaxKappa = Math.max(bin.rrMaxKappa, kappa);
    bin.rrMinKappa = Math.min(bin.rrMinKappa, kappa);
    bin.rrMaxAlpha = Math.max(bin.rrMaxAlpha, alpha);
    bin.rrAvgUtil += util;
    bin.rrPeakUtil = Math.max(bin.rrPeakUtil, util);

    bin.speedAvg += (car.speed * 3.6);
    bin.steerAvg += Math.abs(car.controls.steer);
    bin.throttleAvg += car.controls.throttle;
    bin.brakeAvg += car.controls.brake;

    if (car.race.lap > prevLap) {
      const prevIdx = prevLap - 1;
      const le = lapEnergy[prevIdx];
      console.log(`Lap ${prevLap} complete: Time=${car.race.lastLap?.toFixed(3)}s | RR Surf=${tRR.surface.toFixed(1)}°C, Core=${tRR.core.toFixed(1)}°C | Energy=${(le.total/1000).toFixed(1)}kJ (Tract: ${(le.traction/1000).toFixed(1)}kJ, Brake: ${(le.braking/1000).toFixed(1)}kJ, Lat: ${(le.lateral/1000).toFixed(1)}kJ)`);
      prevLap = car.race.lap;
    }

    if (session.activeCars.every(c => c.race.finishTime !== null)) break;
  }

  // Finalize averages
  for (const b of sectorStats) {
    if (b.samples > 0) {
      b.rrAvgUtil /= b.samples;
      b.speedAvg /= b.samples;
      b.steerAvg /= b.samples;
      b.throttleAvg /= b.samples;
      b.brakeAvg /= b.samples;
    }
  }

  // Totals across entire stint for RR:
  const totalTraction = sectorStats.reduce((sum, b) => sum + b.rrTractionEnergy, 0);
  const totalBraking = sectorStats.reduce((sum, b) => sum + b.rrBrakingEnergy, 0);
  const totalLateral = sectorStats.reduce((sum, b) => sum + b.rrLateralEnergy, 0);
  const totalEnergy = totalTraction + totalBraking + totalLateral;

  console.log(`\n================================================================================`);
  console.log(`RR TYRE ENERGY BREAKDOWN (STINT TOTAL: ${laps} LAPS)`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`  Total Slip Energy Dissipated: ${(totalEnergy / 1000).toFixed(1)} kJ (100.0%)`);
  console.log(`  - Exit Traction Wheelspin (kappa > 0): ${(totalTraction / 1000).toFixed(1)} kJ (${(totalTraction / totalEnergy * 100).toFixed(1)}%)`);
  console.log(`  - Braking Scrub (kappa < 0):          ${(totalBraking / 1000).toFixed(1)} kJ (${(totalBraking / totalEnergy * 100).toFixed(1)}%)`);
  console.log(`  - Lateral Cornering Scrub (alpha):     ${(totalLateral / 1000).toFixed(1)} kJ (${(totalLateral / totalEnergy * 100).toFixed(1)}%)`);
  console.log(`================================================================================\n`);

  // Rank Top 10 Energy Hotspots on Harbor Ring
  const sorted = [...sectorStats].sort((a, b) => b.rrTotalSlipEnergy - a.rrTotalSlipEnergy);
  console.log(`TOP 10 THERMAL ENERGY HOTSPOTS FOR RR TYRE (HARBOR RING):`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`| Rank | Station (m) | Total (kJ) | Tract (kJ) | Brake (kJ) | Lat (kJ) | Max Kappa | Min Kappa | Speed (km/h) | Controls (thr/brk) |`);
  console.log(`--------------------------------------------------------------------------------`);
  sorted.slice(0, 10).forEach((b, i) => {
    console.log(
      `| ${(i + 1).toString().padStart(4)} | ` +
      `${b.stationStart.toFixed(0).padStart(4)}-${b.stationEnd.toFixed(0).padEnd(4)}m | ` +
      `${(b.rrTotalSlipEnergy / 1000).toFixed(1).padStart(10)} | ` +
      `${(b.rrTractionEnergy / 1000).toFixed(1).padStart(10)} | ` +
      `${(b.rrBrakingEnergy / 1000).toFixed(1).padStart(10)} | ` +
      `${(b.rrLateralEnergy / 1000).toFixed(1).padStart(8)} | ` +
      `${b.rrMaxKappa.toFixed(3).padStart(9)} | ` +
      `${b.rrMinKappa.toFixed(3).padStart(9)} | ` +
      `${b.speedAvg.toFixed(1).padStart(12)} | ` +
      `thr=${b.throttleAvg.toFixed(2)} brk=${b.brakeAvg.toFixed(2)} |`
    );
  });
  console.log(`================================================================================\n`);

  return { sectorStats, totalTraction, totalBraking, totalLateral, totalEnergy };
}

runTyreEnergyMap(3).catch(console.error);
