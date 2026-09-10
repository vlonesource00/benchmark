import { Circuit } from '../subjects/gpt-racing/src/simulation/Track.js';
import { Vehicle } from '../subjects/gpt-racing/src/simulation/Vehicle.js';
import { RaceState } from '../subjects/gpt-racing/src/simulation/Race.js';
import { HARBOR_RING } from '../subjects/gpt-racing/src/scenarios/HarborRing.js';
import { CANDIDATES } from '../sandbox/controller-bridges.js';
import { createNativeEngineBridges } from '../sandbox/native-engine-bridges.js';

const dt = 1 / 120;
const track = new Circuit(HARBOR_RING);
const vehicles = CANDIDATES.map((candidate) => new Vehicle({
  id: candidate.id, name: candidate.label, color: candidate.color, player: false, spec: 'gt'
}));
const race = new RaceState(track, vehicles, 4);
vehicles.forEach((vehicle, index) => {
  const slot = race.gridPosition(index);
  vehicle.resetTo(track, slot.distance, slot.lateral);
});
race.reset();
const bridges = await createNativeEngineBridges({ track, vehicles, race });
for (let step = 0; step < 8 / dt; step += 1) {
  race.step(dt);
  bridges.step(dt, race.phase, race.raceTime);
}
const report = bridges.entries.map((entry) => ({
  id: entry.id,
  nativeHz: entry.id === 'claude-racing' ? 400 : 120,
  steps: entry.steps,
  speedKmh: Number((entry.vehicle.speed * 3.6).toFixed(1)),
  routePoints: entry.debug().planPath?.length ?? entry.debug().path?.length ?? 0
}));
for (const row of report) {
  const expected = row.nativeHz * 8;
  if (row.steps !== expected) throw new Error(`${row.id}: ${row.steps} native steps, expected ${expected}`);
  if (row.speedKmh < 10) throw new Error(`${row.id}: display proxy did not receive native motion`);
}
if (report.find((row) => row.id === 'claude-racing')?.routePoints < 2) throw new Error('Claude native Driver.plan route was not exposed');
console.log(JSON.stringify({ status: 'native-bridge-passed', report }, null, 2));
