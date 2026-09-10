import { Circuit as GPTCircuit } from '../subjects/gpt-racing/src/simulation/Track.js';
import { Vehicle as GPTVehicle } from '../subjects/gpt-racing/src/simulation/Vehicle.js';
import { RaceState } from '../subjects/gpt-racing/src/simulation/Race.js';
import { HARBOR_RING } from '../subjects/gpt-racing/src/scenarios/HarborRing.js';
import { lateralCapacity } from '../subjects/gpt-racing/src/ai/AIConfig.js';
import { CANDIDATES } from '../sandbox/controller-bridges.js';
import { createNativeEngineBridges } from '../sandbox/native-engine-bridges.js';

const DT = 1 / 120;
const SECONDS = 20;
const EXPECTED_HZ = new Map([
  ['gpt-racing', 120],
  ['claude-racing', 400],
  ['gemini-nmpcc', 120],
  ['gemini-grand-prix', 120]
]);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function makeHosts() {
  return CANDIDATES.map((candidate) => new GPTVehicle({
    id: candidate.id,
    name: candidate.label,
    color: candidate.color,
    player: false,
    spec: 'gt'
  }));
}

async function runCase(experimentalUpgrades) {
  const track = new GPTCircuit(HARBOR_RING);
  const vehicles = makeHosts();
  const race = new RaceState(track, vehicles, 4);
  vehicles.forEach((vehicle, index) => {
    const slot = race.gridPosition(index);
    vehicle.resetTo(track, slot.distance, slot.lateral);
  });
  race.reset();

  const bridges = await createNativeEngineBridges({
    track,
    vehicles,
    race,
    experimentalUpgrades,
    onStatus: () => {}
  });
  const tacticalCalls = new Map();
  for (const entry of bridges.entries) {
    const combat = entry.controller?.combatEngine;
    if (!combat?.evaluate) continue;
    const evaluate = combat.evaluate;
    let calls = 0;
    combat.evaluate = function wrappedEvaluate(params) {
      calls += 1;
      return evaluate.call(this, params);
    };
    tacticalCalls.set(entry.id, () => calls);
  }

  const maxSpeed = new Map(bridges.entries.map((entry) => [entry.id, 0]));
  const maxBrake = new Map(bridges.entries.map((entry) => [entry.id, 0]));
  let finiteControls = true;
  const steps = Math.round(SECONDS / DT);
  for (let tick = 0; tick < steps; tick += 1) {
    race.step(DT);
    bridges.step(DT, race.phase, race.raceTime);
    for (const entry of bridges.entries) {
      const controls = entry.nativeVehicle?.controls ?? entry.vehicle?.controls ?? {};
      finiteControls = finiteControls && ['throttle', 'brake', 'steer'].every((key) => Number.isFinite(controls[key]));
      maxSpeed.set(entry.id, Math.max(maxSpeed.get(entry.id), Number(entry.nativeVehicle?.speed) || 0));
      maxBrake.set(entry.id, Math.max(maxBrake.get(entry.id), Number(controls.brake) || 0));
    }
  }

  const rows = bridges.entries.map((entry) => {
    const controller = entry.controller;
    const debug = entry.debug();
    return {
      id: entry.id,
      hz: EXPECTED_HZ.get(entry.id),
      steps: entry.steps,
      maxSpeed: Number(maxSpeed.get(entry.id).toFixed(2)),
      maxBrake: Number(maxBrake.get(entry.id).toFixed(2)),
      tacticalCalls: tacticalCalls.get(entry.id)?.() ?? null,
      tacticalEvaluationCount: controller?.tacticalEvaluationCount ?? null,
      trajectoryReplanCount: controller?.trajectoryReplanCount ?? null,
      debugUpgrade: debug?.experimentalUpgrades === true
    };
  });

  const gpt = bridges.byId('gpt-racing');
  const nmpcc = bridges.byId('gemini-nmpcc');
  const grandPrix = bridges.byId('gemini-grand-prix');
  const claude = bridges.byId('claude-racing');
  const gptAgent = gpt.controller.agents.get(gpt.nativeVehicle.id);

  assert(Boolean(gpt.nativeVehicle.experimentalUpgrades) === experimentalUpgrades,
    `GPT vehicle upgrade marker mismatch (${experimentalUpgrades})`);
  assert(Boolean(gptAgent?.experimentalUpgrades) === experimentalUpgrades,
    `GPT agent upgrade marker mismatch (${experimentalUpgrades})`);
  assert(Boolean(nmpcc.controller.experimentalUpgrades) === experimentalUpgrades,
    `NMPCC upgrade marker mismatch (${experimentalUpgrades})`);
  assert(Boolean(grandPrix.controller.experimentalUpgrades) === experimentalUpgrades,
    `Grand Prix upgrade marker mismatch (${experimentalUpgrades})`);
  assert(Boolean(claude.controller.experimentalUpgrades) === experimentalUpgrades
    && Boolean(claude.controller.racecraft.experimentalUpgrades) === experimentalUpgrades,
  `Claude upgrade marker mismatch (${experimentalUpgrades})`);
  assert(finiteControls, `${experimentalUpgrades ? 'upgraded' : 'baseline'} controls became non-finite`);

  for (const row of rows) {
    assert(row.steps === row.hz * SECONDS, `${row.id}: wrong native step count ${row.steps}`);
    assert(row.maxSpeed > 20, `${row.id}: never reached racing speed (${row.maxSpeed})`);
    assert(row.maxBrake > 0.25, `${row.id}: native controller never braked (${row.maxBrake})`);
  }

  if (experimentalUpgrades) {
    const nmpccPlans = nmpcc.controller.trajectoryReplanCount;
    const gpPlans = grandPrix.controller.trajectoryReplanCount;
    assert(nmpccPlans <= SECONDS * 35 + 12, `NMPCC upgrade lattice exceeded bounded cadence (${nmpccPlans})`);
    assert(gpPlans <= SECONDS * 35 + 12, `Grand Prix upgrade lattice exceeded bounded cadence (${gpPlans})`);
    assert(nmpcc.controller.tacticalEvaluationCount <= SECONDS * 16 + 12,
      `NMPCC upgrade tactical cadence exceeded bound (${nmpcc.controller.tacticalEvaluationCount})`);
    assert(grandPrix.controller.tacticalEvaluationCount <= SECONDS * 16 + 12,
      `Grand Prix upgrade tactical cadence exceeded bound (${grandPrix.controller.tacticalEvaluationCount})`);
    assert(nmpcc.controller.tacticalEvaluationCount > 0 && grandPrix.controller.tacticalEvaluationCount > 0,
      'upgraded Gemini tactical cache never evaluated');
    assert(rows.every((row) => row.debugUpgrade || row.id === 'gpt-racing' || row.id === 'claude-racing'),
      'upgraded Gemini debug markers were not exposed');
  } else {
    assert(nmpcc.controller.tacticalCache === null && grandPrix.controller.tacticalCache === null,
      'baseline Gemini unexpectedly retained a tactical cache');
    assert(nmpcc.controller.tacticalEvaluationCount === 0 && grandPrix.controller.tacticalEvaluationCount === 0,
      'baseline Gemini unexpectedly used upgrade tactical counters');
    assert(nmpcc.controller.trajectoryReplanCount === 0 && grandPrix.controller.trajectoryReplanCount === 0,
      'baseline Gemini unexpectedly used upgrade replan counters');
    assert(rows.every((row) => !row.debugUpgrade), 'baseline debug exposed upgrade marker');
  }

  return { experimentalUpgrades, rows };
}

function capacityAab() {
  const baseline = new GPTVehicle({ id: 'capacity-baseline', spec: 'gt' });
  const upgraded = new GPTVehicle({ id: 'capacity-upgraded', spec: 'gt' });
  upgraded.experimentalUpgrades = true;
  const baselineCapacity = lateralCapacity(baseline, 55, 0);
  const upgradedCapacity = lateralCapacity(upgraded, 55, 0);
  assert(Number.isFinite(baselineCapacity) && Number.isFinite(upgradedCapacity), 'GPT capacity became non-finite');
  assert(upgradedCapacity > 0.75 && upgradedCapacity <= 23.5, `GPT upgraded capacity outside bound (${upgradedCapacity})`);
  assert(Math.abs(upgradedCapacity - baselineCapacity) > 0.1,
    `GPT upgraded capacity did not differ from baseline (${baselineCapacity} vs ${upgradedCapacity})`);
  return { baselineCapacity: Number(baselineCapacity.toFixed(3)), upgradedCapacity: Number(upgradedCapacity.toFixed(3)) };
}

const baseline = await runCase(false);
const upgraded = await runCase(true);
const capacity = capacityAab();
console.log(JSON.stringify({ status: 'upgraded-native-ab-passed', seconds: SECONDS, capacity, baseline, upgraded }, null, 2));
