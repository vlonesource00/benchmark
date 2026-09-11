import assert from 'node:assert/strict';
import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField } from '../sandbox/bridges/index.js';

const DT = 1 / 120;
const LAPS = 2;
const MAX_TIME = 200;

function runSimulation(debuggerActive) {
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
  let lastLap = 1;
  let lapStart = 0;
  const lapTimes = [];

  const history = [];

  while (elapsed < MAX_TIME && car.race.finishTime == null) {
    session.step(DT, { throttle: 0, brake: 0, steer: 0 });
    if (session.phase === 'finished') session.phase = 'racing';
    elapsed += DT;

    if (car.race.lap > lastLap) {
      const lapDuration = elapsed - lapStart;
      lapTimes.push({ lap: lastLap, time: lapDuration, valid: car.race.valid });
      lapStart = elapsed;
      lastLap = car.race.lap;
    }

    let visualData = null;
    if (debuggerActive) {
      visualData = bridge.visualDebug?.() ?? null;
    }

    const currentPlan = controller.trajectoryPlan;
    const candidates = controller.lastCandidates || [];
    const controlCandidateIds = candidates
      .filter(c => !c.isDiagnostic)
      .map(c => c.id || Number(c.offset).toFixed(2));

    history.push({
      time: elapsed,
      x: car.x,
      z: car.z,
      speed: car.speed,
      yaw: car.yaw,
      yawRate: car.yawRate,
      steer: car.controls?.steer ?? 0,
      throttle: car.controls?.throttle ?? 0,
      brake: car.controls?.brake ?? 0,
      selectedId: currentPlan?.selectedCandidate?.id ?? currentPlan?.id ?? 'none',
      selectedOffset: currentPlan?.selectedOffset ?? 0,
      controlCandidateIds,
      visualCandidatesCount: visualData?.candidates?.length ?? 0
    });
  }

  return { lapTimes, history, finalElapsed: elapsed };
}

console.log('=== Running Observational Integrity Test (Debugger ON vs OFF) ===');

console.log('  -> Executing Run A: Visual Debugger OFF...');
const runOff = runSimulation(false);
console.log(`     Completed: ${runOff.history.length} ticks, flying lap: ${runOff.lapTimes[1]?.time?.toFixed(3)}s`);

console.log('  -> Executing Run B: Visual Debugger ON (calling visualDebug() every 120Hz tick)...');
const runOn = runSimulation(true);
console.log(`     Completed: ${runOn.history.length} ticks, flying lap: ${runOn.lapTimes[1]?.time?.toFixed(3)}s`);

console.log('  -> Comparing Bit-for-Bit Determinism & Observational Invariance...');

assert.equal(runOff.history.length, runOn.history.length, 'Simulation length must match exactly');
assert.equal(runOff.lapTimes.length, runOn.lapTimes.length, 'Lap count must match');

let maxPosDiff = 0;
let maxSteerDiff = 0;
let maxThrottleDiff = 0;
let maxBrakeDiff = 0;
let candidateIdMismatches = 0;
let selectedIdMismatches = 0;

for (let i = 0; i < runOff.history.length; i++) {
  const a = runOff.history[i];
  const b = runOn.history[i];

  const posDiff = Math.hypot(a.x - b.x, a.z - b.z);
  maxPosDiff = Math.max(maxPosDiff, posDiff);

  const steerDiff = Math.abs(a.steer - b.steer);
  maxSteerDiff = Math.max(maxSteerDiff, steerDiff);

  const throttleDiff = Math.abs(a.throttle - b.throttle);
  maxThrottleDiff = Math.max(maxThrottleDiff, throttleDiff);

  const brakeDiff = Math.abs(a.brake - b.brake);
  maxBrakeDiff = Math.max(maxBrakeDiff, brakeDiff);

  if (a.selectedId !== b.selectedId || Math.abs(a.selectedOffset - b.selectedOffset) > 1e-9) {
    selectedIdMismatches++;
  }

  if (a.controlCandidateIds.length !== b.controlCandidateIds.length) {
    candidateIdMismatches++;
  } else {
    for (let j = 0; j < a.controlCandidateIds.length; j++) {
      if (a.controlCandidateIds[j] !== b.controlCandidateIds[j]) {
        candidateIdMismatches++;
        break;
      }
    }
  }
}

const lap1Diff = Math.abs(runOff.lapTimes[0].time - runOn.lapTimes[0].time);
const lap2Diff = Math.abs(runOff.lapTimes[1].time - runOn.lapTimes[1].time);

console.log(`     Max Position Divergence:      ${maxPosDiff.toExponential(3)} m`);
console.log(`     Max Steer Command Divergence: ${maxSteerDiff.toExponential(3)}`);
console.log(`     Max Throttle Divergence:      ${maxThrottleDiff.toExponential(3)}`);
console.log(`     Max Brake Divergence:         ${maxBrakeDiff.toExponential(3)}`);
console.log(`     Control Candidate Mismatches: ${candidateIdMismatches}`);
console.log(`     Selected Plan Mismatches:     ${selectedIdMismatches}`);
console.log(`     Lap 1 Time Delta:             ${lap1Diff.toFixed(6)} s`);
console.log(`     Lap 2 Flying Time Delta:      ${lap2Diff.toFixed(6)} s`);

assert.equal(candidateIdMismatches, 0, 'Control candidate IDs must be 100% identical');
assert.equal(selectedIdMismatches, 0, 'Selected trajectory plans must be 100% identical');
assert.ok(maxPosDiff < 1e-12, 'Position must match to double precision floating-point epsilon');
assert.ok(maxSteerDiff < 1e-12, 'Steering must match to double precision floating-point epsilon');
assert.ok(maxThrottleDiff < 1e-12, 'Throttle must match to double precision floating-point epsilon');
assert.ok(maxBrakeDiff < 1e-12, 'Brake must match to double precision floating-point epsilon');
assert.equal(lap1Diff, 0, 'Lap 1 time must match exactly');
assert.equal(lap2Diff, 0, 'Lap 2 time must match exactly');

console.log('\n>>> SUCCESS: OBSERVATIONAL INTEGRITY PROVEN (100% BIT-FOR-BIT INVARIANCE) (Exit 0) <<<');
