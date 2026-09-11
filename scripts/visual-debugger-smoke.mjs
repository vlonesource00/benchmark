import assert from 'node:assert/strict';
import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField, CANDIDATE_IDS } from '../sandbox/bridges/index.js';

console.log('=== [SMOKE] 3D Visual AI Debugger Bridge & Data Contract Smoke Test ===');

const track = new Track('harbor-ring');
assert.ok(track, 'Track must be initialized');

const session = new Session(track, { classId: 'gt', mixed: false });
session.field = CANDIDATE_IDS.length;
session.autopilot = true;

const field = createField({
  session,
  hostTrack: track,
  order: CANDIDATE_IDS
});

assert.ok(field, 'Field must be created');
session.start({ freshTrack: true });
field.attach();
session.phase = 'racing';

const supremeBridge = field.byId('gemini-supreme');
assert.ok(supremeBridge, 'Gemini Supreme bridge must exist');
assert.equal(typeof supremeBridge.visualDebug, 'function', 'Gemini bridge must have visualDebug()');

// Step simulation for 60 ticks (0.5s) to let controllers engage and plan
for (let tick = 0; tick < 60; tick++) {
  session.step(1 / 120);
}

const visualData = supremeBridge.visualDebug();
assert.ok(visualData, 'visualDebug() must return an object');

// 1. Validate Selected Trajectory Ribbon
assert.ok(visualData.selectedTrajectory, 'selectedTrajectory must exist');
assert.ok(Array.isArray(visualData.selectedTrajectory.points), 'selectedTrajectory.points must be an array');
assert.ok(visualData.selectedTrajectory.points.length >= 10, 'selectedTrajectory.points must have at least 10 points');
assert.equal(visualData.selectedTrajectory.ribbonWidth, 0.65, 'ribbonWidth must be 0.65m');
assert.equal(visualData.selectedTrajectory.lift, 0.06, 'lift must be 0.06m');
assert.ok(typeof visualData.selectedTrajectory.color === 'string', 'selectedTrajectory must have a color');
console.log('  [PASS] Selected Trajectory Ribbon: points =', visualData.selectedTrajectory.points.length, ', mode =', visualData.selectedTrajectory.mode, ', color =', visualData.selectedTrajectory.color);

// 2. Validate Candidate Lattice
assert.ok(Array.isArray(visualData.candidates), 'candidates must be an array');
assert.ok(visualData.candidates.length >= 20 && visualData.candidates.length <= 36, `candidates count (${visualData.candidates.length}) must be bounded between 20 and 36`);
const reasons = new Set(visualData.candidates.map((c) => c.rejectionReason));
assert.ok(reasons.has('SELECTED'), 'Candidates must include SELECTED');
for (const cand of visualData.candidates) {
  assert.ok(cand.id, 'Candidate must have an id');
  assert.ok(Array.isArray(cand.points), 'Candidate must have points array');
  assert.ok(typeof cand.color === 'string', 'Candidate must have a color string');
  assert.ok(['SELECTED', 'VIABLE_ALTERNATIVE', 'COLLISION', 'ROAD_LIMIT', 'DYNAMIC_LIMIT', 'SWITCH_MARGIN', 'HIGHER_COST'].includes(cand.rejectionReason), `rejectionReason "${cand.rejectionReason}" must be valid`);
}
console.log('  [PASS] Candidate Lattice: count =', visualData.candidates.length, ', distinct reasons =', Array.from(reasons).join(', '));

// 3. Validate Tactical Corridor
assert.ok(visualData.tacticalCorridor, 'tacticalCorridor must exist');
assert.ok(Number.isFinite(visualData.tacticalCorridor.dMin), 'dMin must be finite');
assert.ok(Number.isFinite(visualData.tacticalCorridor.dMax), 'dMax must be finite');
assert.ok(visualData.tacticalCorridor.leftBoundary.length >= 10, 'leftBoundary must have points');
assert.ok(visualData.tacticalCorridor.rightBoundary.length >= 10, 'rightBoundary must have points');
console.log('  [PASS] Tactical Corridor: [', visualData.tacticalCorridor.dMin.toFixed(2), ',', visualData.tacticalCorridor.dMax.toFixed(2), '], points =', visualData.tacticalCorridor.leftBoundary.length);

// 4. Validate Opponent Predictions
assert.ok(Array.isArray(visualData.opponentPredictions), 'opponentPredictions must be an array');
for (const opp of visualData.opponentPredictions) {
  assert.ok(opp.id != null, 'Opponent must have an id');
  assert.ok(Array.isArray(opp.trail), 'Opponent must have a prediction trail');
  assert.equal(opp.boxes.length, 4, 'Opponent must have 4 prediction boxes (0.5s, 1.0s, 2.0s, 3.0s)');
  assert.deepEqual(opp.boxes.map((b) => b.time), [0.5, 1.0, 2.0, 3.0], 'Prediction box times must be [0.5, 1.0, 2.0, 3.0]');
}
console.log('  [PASS] Opponent Predictions: tracked opponents =', visualData.opponentPredictions.length);

// 5. Validate Aim Point & Markers
assert.ok(visualData.trackingPoint, 'trackingPoint must exist');
assert.ok(Number.isFinite(visualData.trackingPoint.x), 'trackingPoint.x must be finite');
assert.ok(visualData.frontAxle, 'frontAxle must exist');
assert.ok(visualData.markers, 'markers must exist');
console.log('  [PASS] Lookahead Tracking Point: (', visualData.trackingPoint.x.toFixed(1), ',', visualData.trackingPoint.z.toFixed(1), '), axle connector ready');

// 6. Validate Road Limits
assert.ok(visualData.roadLimits, 'roadLimits must exist');
assert.ok(visualData.roadLimits.asphaltLeft.length > 0, 'asphaltLeft must exist');
assert.ok(visualData.roadLimits.plannerLeft.length > 0, 'plannerLeft must exist');
console.log('  [PASS] Road and Planner Boundaries: verified');

console.log('>>> ALL 3D VISUAL DEBUGGER SMOKE CHECKS PASSED (Exit 0) <<<');
