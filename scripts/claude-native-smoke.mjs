import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Circuit } from '../subjects/claude-racing/src/sim/Track.js';
import { Race } from '../subjects/claude-racing/src/sim/Race.js';
import { TrackGrid } from '../subjects/claude-racing/src/sim/TrackGrid.js';
import { cloneSpec } from '../subjects/claude-racing/src/sim/CarSpecs.js';
import { Pilot } from '../subjects/claude-racing/src/ai/Pilot.js';
import { PlanBudget } from '../subjects/claude-racing/src/ai/Scheduler.js';
import { HARBOR_RING } from '../subjects/claude-racing/src/scenarios/HarborRing.js';

const DT = 1 / 400;
const line = JSON.parse(await readFile(new URL('../subjects/claude-racing/public/lines/harbor-ring-gt.json', import.meta.url), 'utf8'));
const circuit = new Circuit({ scenario: HARBOR_RING });
const grid = new TrackGrid(circuit, cloneSpec('gt'), { solution: line, stationSpacing: 10.0 });
const race = new Race(circuit, {
  entries: [{ classId: 'gt', spec: cloneSpec('gt'), name: 'CLAUDE RACING', isPlayer: false, tint: '#ffb454' }],
  laps: 4,
  countdown: 0
});
const pilot = new Pilot(race.cars[0], grid, { field: race.cars, phase: 0, budget: new PlanBudget(1), name: 'CLAUDE RACING', skill: 0.96, aggression: 0.72 });
race.setDriver(0, pilot);

let steps = 0;
let maxOffTrack = 0;
let peakBrake = 0;
while (race.state !== 'finished' && steps < 240000) {
  race.step(DT);
  maxOffTrack = Math.max(maxOffTrack, race.cars[0].offTrack);
  peakBrake = Math.max(peakBrake, race.cars[0].controls.brake);
  steps += 1;
}

assert.equal(race.state, 'finished', 'Claude native solo did not finish four laps.');
assert.ok(peakBrake > 0.25, 'Claude native Driver never issued meaningful braking.');
assert.equal(race.entrants[0].lap, 4, 'Claude native solo lap count is wrong.');
console.log(JSON.stringify({ status: 'claude-native-400hz passed', steps, simulatedSeconds: Number(race.clock.toFixed(3)), laps: race.entrants[0].lap, peakBrake: Number(peakBrake.toFixed(3)), maxOffTrack: Number(maxOffTrack.toFixed(3)), bestLap: Number(race.entrants[0].bestLap.toFixed(3)) }, null, 2));
