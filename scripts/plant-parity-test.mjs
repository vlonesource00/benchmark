import assert from 'node:assert';
import { CAR_CLASSES } from '../host/astra/src/sim/car-specs.js';
import { tyreGrip, createTyre } from '../host/astra/src/sim/tyre.js';
import { AnalyticalPerfModel } from '../subjects/gemini-supreme/src/ai/v2/GlobalTimeOptimalEngine.js';

console.log('=== PLANT PARITY ACCEPTANCE TEST ===');
console.log('Comparing Gemini Supreme AnalyticalPerfModel vs Host Astra GT Plant\n');

const astraGT = CAR_CLASSES.gt;
const speeds = [10, 20, 30, 40, 50, 60];

// Host Astra spec as provided to Gemini Bridge
const adaptedSpec = {
  mass: astraGT.mass,
  wheelbase: astraGT.wheelbase,
  track: astraGT.track,
  steeringLock: astraGT.steeringLock,
  cgHeight: astraGT.cg,
  weightFront: astraGT.frontWeight,
  wheelRadius: astraGT.radius,
  wheelInertia: astraGT.wheelInertia,
  yawInertia: astraGT.yawInertia,
  drive: astraGT.drive,
  maxTorque: astraGT.maxTorque,
  maxBrakeTorque: astraGT.brakeTorque,
  brakeBias: astraGT.brakeBias,
  finalDrive: astraGT.finalDrive,
  gears: astraGT.gears,
  tyreGrip: astraGT.tyreGrip,
  tireMu: 1.48 * astraGT.tyreGrip,
  loadSensitivity: 0.13,
  cl: astraGT.cl,
  cd: astraGT.cd,
  area: astraGT.area,
  frontAero: astraGT.frontAero
};

const supremeModel = new AnalyticalPerfModel(adaptedSpec, 'gt');

// Host calculations
function hostAero(v) {
  const q = 0.5 * 1.225 * v * v;
  const downforce = q * astraGT.area * astraGT.cl;
  const drag = q * astraGT.area * astraGT.cd;
  return { downforce, drag };
}

function hostMaxBrakeAccel(v) {
  const aero = hostAero(v);
  const fz = astraGT.mass * 9.81 + aero.downforce;
  const t = createTyre();
  t.core = 85; // optimal temp
  t.pressure = 2.15; // optimal pressure
  const mu = tyreGrip(t, fz / 4);
  const tireLimit = 0.96 * mu * fz;
  const brakeLimit = astraGT.brakeTorque / astraGT.radius;
  return (Math.min(tireLimit, brakeLimit) + aero.drag) / astraGT.mass;
}

function hostMaxLatAccel(v) {
  const aero = hostAero(v);
  const fz = astraGT.mass * 9.81 + aero.downforce;
  const t = createTyre();
  t.core = 85;
  t.pressure = 2.15;
  const mu = tyreGrip(t, fz / 4);
  return 0.90 * mu * fz / astraGT.mass;
}

function hostMaxDriveAccel(v) {
  const aero = hostAero(v);
  const fz = astraGT.mass * 9.81 + aero.downforce;
  const fzRear = fz * (1 - astraGT.frontWeight);
  const t = createTyre();
  t.core = 85;
  t.pressure = 2.15;
  const mu = tyreGrip(t, fzRear / 2) * 0.95;
  const tractionLimit = mu * fzRear;

  // Best gear engine thrust
  let bestThrust = 0;
  const wWheel = v / astraGT.radius;
  for (let g = 1; g < astraGT.gears.length; g++) {
    const ratio = astraGT.gears[g] * astraGT.finalDrive;
    const rpm = (wWheel * ratio * 60) / (2 * Math.PI);
    if (rpm > 8200) continue;
    const torqueCurve = Math.max(0.45, 1 - Math.pow((rpm - 5500) / 6700, 2));
    const thrust = (astraGT.maxTorque * torqueCurve * ratio * 0.91) / astraGT.radius;
    if (thrust > bestThrust) bestThrust = thrust;
  }
  const netForce = Math.min(bestThrust, tractionLimit) - aero.drag;
  return Math.max(0, netForce / astraGT.mass);
}

let allPassed = true;

console.log('1. Aero Downforce & Drag Parity (Target: <= 5.0% error across all speeds)');
for (const v of speeds) {
  const h = hostAero(v);
  const sDf = supremeModel.downforce(v);
  const sDrag = supremeModel.drag(v);
  const dfErr = Math.abs(sDf - h.downforce) / Math.max(1, h.downforce) * 100;
  const dragErr = Math.abs(sDrag - h.drag) / Math.max(1, h.drag) * 100;
  console.log(`  v=${v.toString().padStart(2)} m/s: downforce Host=${h.downforce.toFixed(1)}N Supreme=${sDf.toFixed(1)}N (err=${dfErr.toFixed(2)}%), drag Host=${h.drag.toFixed(1)}N Supreme=${sDrag.toFixed(1)}N (err=${dragErr.toFixed(2)}%)`);
  if (dfErr > 5.0 || dragErr > 5.0) allPassed = false;
}

console.log('\n2. Steady Lateral Envelope Parity (Target: <= 10.0% error across all speeds)');
for (const v of speeds) {
  const hLat = hostMaxLatAccel(v);
  const sLat = supremeModel.latAccel(v);
  const latErr = Math.abs(sLat - hLat) / hLat * 100;
  console.log(`  v=${v.toString().padStart(2)} m/s: latAccel Host=${hLat.toFixed(2)} m/s² Supreme=${sLat.toFixed(2)} m/s² (err=${latErr.toFixed(2)}%)`);
  if (latErr > 10.0) allPassed = false;
}

console.log('\n3. Braking Envelope Parity (Target: <= 10.0% error across all speeds)');
for (const v of speeds) {
  const hBrake = hostMaxBrakeAccel(v);
  const sBrake = supremeModel.brakeAccel(v);
  const brakeErr = Math.abs(sBrake - hBrake) / hBrake * 100;
  console.log(`  v=${v.toString().padStart(2)} m/s: brakeAccel Host=${hBrake.toFixed(2)} m/s² Supreme=${sBrake.toFixed(2)} m/s² (err=${brakeErr.toFixed(2)}%)`);
  if (brakeErr > 10.0) allPassed = false;
}

console.log('\n4. Longitudinal Drive Acceleration Envelope Parity (Target: <= 10.0% error across all speeds)');
for (const v of speeds) {
  const hDrive = hostMaxDriveAccel(v);
  const sDrive = supremeModel.driveAccel(v);
  const driveErr = Math.abs(sDrive - hDrive) / Math.max(0.1, hDrive) * 100;
  console.log(`  v=${v.toString().padStart(2)} m/s: driveAccel Host=${hDrive.toFixed(2)} m/s² Supreme=${sDrive.toFixed(2)} m/s² (err=${driveErr.toFixed(2)}%)`);
  if (driveErr > 10.0) allPassed = false;
}

if (!allPassed) {
  console.error('\nFAIL: One or more plant parity envelopes exceeded error thresholds!');
  process.exit(1);
} else {
  console.log('\nPASS: Supreme AnalyticalPerfModel achieved full plant parity with host Astra GT plant (Exit 0)');
}
