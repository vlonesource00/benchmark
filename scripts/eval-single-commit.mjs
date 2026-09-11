import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField } from '../sandbox/bridges/index.js';

const DT = 1 / 120;
const LAPS = 2; // Lap 1 (outlap from grid) + Lap 2 (flying lap)
const MAX_TIME = 240; // max seconds

const track = new Track('harbor-ring');
const session = new Session(track, { classId: 'gt', mixed: false });
session.laps = LAPS;
session.field = 1;
session.aggression = 0.72;
session.autopilot = true;

const field = createField({ session, hostTrack: track, order: ['gemini-supreme'], onStatus: () => {} });
session.start({ freshTrack: true });
field.attach();
session.phase = 'racing';

const car = session.cars[0];
const bridge = field.bridges[0];
const controller = bridge.controller;

let elapsed = 0;
let bodySlips = [];
let yawRates = [];
let lapTimes = [];
let lapStartTimes = [];
let lastLap = 1;
let lapStart = 0;

let spins = 0;
let wasSpinning = false;
let spinEvents = [];

let offTrackEvents = 0;
let wasOffTrack = false;
let totalOffTrackTime = 0;

let steeringReversals = 0;
let lastSteerSign = 0;
let trajectorySwitches = 0;
let lastSelectedOffset = null;

let selectedRejectionClasses = {};
let dynamicLimitSelectedCount = 0;
let roadLimitSelectedCount = 0;

let maxPredictedLatAccels = [];
let actualLatAccels = [];
let candidateCounts = [];

let stabilityRisks = [];
let timeHighStabilityRisk = 0;

let rollingBuffer = []; // rolling history for spin traces (past 2s)

while (elapsed < MAX_TIME && car.race.finishTime == null) {
  session.step(DT, { throttle: 0, brake: 0, steer: 0 });
  if (session.phase === 'finished') session.phase = 'racing';
  elapsed += DT;

  // Track lap boundaries
  if (car.race.lap > lastLap) {
    const lapDuration = elapsed - lapStart;
    lapTimes.push({ lap: lastLap, time: lapDuration, valid: car.race.valid });
    lapStartTimes.push(lapStart);
    lapStart = elapsed;
    lastLap = car.race.lap;
  }

  const u = car.u ?? 0;
  const v = car.v ?? 0;
  const speed = car.speed ?? Math.hypot(u, v);
  const beta = Math.atan2(v, Math.max(0.1, Math.abs(u)));
  const absBeta = Math.abs(beta);
  const yawRate = car.yawRate ?? 0;
  const absYawRate = Math.abs(yawRate);

  bodySlips.push(absBeta);
  yawRates.push(absYawRate);

  // Actual lateral acceleration: a_lat = speed * yawRate
  const actualLatAccel = Math.abs(speed * yawRate);
  actualLatAccels.push(actualLatAccel);

  // Off-track tracking
  const isOffTrack = !car.race.valid || Math.abs(car.lateral ?? 0) > (track.roadHalfWidth + 0.85);
  if (isOffTrack) {
    totalOffTrackTime += DT;
    if (!wasOffTrack) {
      offTrackEvents++;
      wasOffTrack = true;
    }
  } else {
    wasOffTrack = false;
  }

  // Steering reversal tracking
  const steer = car.controls?.steer ?? 0;
  const steerSign = Math.sign(steer);
  if (Math.abs(steer) > 0.08 && steerSign !== 0 && steerSign !== lastSteerSign) {
    steeringReversals++;
    lastSteerSign = steerSign;
  }

  // Controller state extraction
  const debugState = controller?.getDebugState?.() ?? {};
  const currentPlan = controller?.trajectoryPlan;
  const stabRisk = debugState?.stabilityRisk ?? 0;
  stabilityRisks.push(stabRisk);
  if (stabRisk > 0.5) timeHighStabilityRisk += DT;

  if (currentPlan) {
    if (lastSelectedOffset !== null && Math.abs((currentPlan.selectedOffset ?? 0) - lastSelectedOffset) > 0.3) {
      trajectorySwitches++;
    }
    lastSelectedOffset = currentPlan.selectedOffset ?? 0;

    const candCount = currentPlan.candidateCount ?? currentPlan.candidates?.length ?? 0;
    if (candCount > 0) candidateCounts.push(candCount);

    const maxLatA = currentPlan.maxLateralAccelerationMps2 ?? 0;
    if (maxLatA > 0) maxPredictedLatAccels.push(maxLatA);

    const rej = currentPlan.rejectionReason ?? 'FEASIBLE';
    selectedRejectionClasses[rej] = (selectedRejectionClasses[rej] || 0) + 1;
    if (rej === 'DYNAMIC_LIMIT') dynamicLimitSelectedCount++;
    if (rej === 'ROAD_LIMIT') roadLimitSelectedCount++;
  }

  const frameSnapshot = {
    time: elapsed,
    s: car.s ?? 0,
    lateral: car.lateral ?? 0,
    speed,
    yaw: car.yaw ?? 0,
    yawRate,
    beta,
    steer,
    throttle: car.controls?.throttle ?? 0,
    brake: car.controls?.brake ?? 0,
    stabilityRisk: stabRisk,
    trajId: currentPlan?.id ?? 'none'
  };

  rollingBuffer.push(frameSnapshot);
  if (rollingBuffer.length > 240) rollingBuffer.shift(); // keep 2s history

  // Spin detection: severe body slip (> 0.35 rad ~ 20 deg) with elevated yaw rate (> 1.2 rad/s)
  const isSpinning = absBeta > 0.35 && absYawRate > 1.25 && speed > 5.0;
  if (isSpinning && !wasSpinning) {
    spins++;
    wasSpinning = true;
    spinEvents.push({
      onset: frameSnapshot,
      historyBefore: rollingBuffer.slice(-60)
    });
  } else if (!isSpinning && absBeta < 0.15) {
    wasSpinning = false;
  }
}

// Compute statistics
bodySlips.sort((a, b) => a - b);
const p95Beta = bodySlips[Math.floor(bodySlips.length * 0.95)] ?? 0;
const maxBeta = bodySlips[bodySlips.length - 1] ?? 0;

yawRates.sort((a, b) => a - b);
const p95YawRate = yawRates[Math.floor(yawRates.length * 0.95)] ?? 0;
const maxYawRate = yawRates[yawRates.length - 1] ?? 0;

const avgStabRisk = stabilityRisks.length > 0 ? (stabilityRisks.reduce((a, b) => a + b, 0) / stabilityRisks.length) : 0;
const avgCandCount = candidateCounts.length > 0 ? (candidateCounts.reduce((a, b) => a + b, 0) / candidateCounts.length) : 0;
const maxPredLatG = maxPredictedLatAccels.length > 0 ? Math.max(...maxPredictedLatAccels) : 0;
const peakActualLatG = actualLatAccels.length > 0 ? Math.max(...actualLatAccels) : 0;

const flyingLap = lapTimes.find((l) => l.lap === 2);
const cleanLaps = lapTimes.filter((l) => l.valid);

const result = {
  elapsedSeconds: elapsed,
  lapsCompleted: lapTimes.length,
  lapTimes,
  flyingLap: flyingLap?.time ?? null,
  flyingLapValid: flyingLap?.valid ?? false,
  bestCleanLap: cleanLaps.length > 0 ? Math.min(...cleanLaps.map((l) => l.time)) : null,
  offTrackSeconds: car.race.offtrack ?? totalOffTrackTime,
  offTrackEvents,
  spins,
  p95BodySlipDeg: (p95Beta * 180 / Math.PI),
  maxBodySlipDeg: (maxBeta * 180 / Math.PI),
  p95YawRateRadS: p95YawRate,
  maxYawRateRadS: maxYawRate,
  steerReversalsPerSec: steeringReversals / Math.max(1, elapsed),
  trajectorySwitchesPerSec: trajectorySwitches / Math.max(1, elapsed),
  avgCandidateCount: avgCandCount,
  dynamicLimitSelectedCount,
  roadLimitSelectedCount,
  selectedRejectionClasses,
  maxPredictedLatAccel: maxPredLatG,
  actualPeakLatAccel: peakActualLatG,
  avgStabilityRisk: avgStabRisk,
  timeHighStabilityRisk,
  spinDetails: spinEvents.map((s) => ({
    time: s.onset.time,
    s: s.onset.s,
    speed: s.onset.speed,
    betaDeg: (s.onset.beta * 180 / Math.PI),
    yawRate: s.onset.yawRate,
    steer: s.onset.steer,
    throttle: s.onset.throttle,
    brake: s.onset.brake,
    trajId: s.onset.trajId
  }))
};

console.log(JSON.stringify(result, null, 2));
