import { Circuit as GPTCircuit } from '../subjects/gpt-racing/src/simulation/Track.js';
import { Vehicle as GPTVehicle } from '../subjects/gpt-racing/src/simulation/Vehicle.js';
import { AIRaceDirector } from '../subjects/gpt-racing/src/ai/AIRaceDirector.js';
import { updateAerodynamicWakes as gptWakes } from '../subjects/gpt-racing/src/simulation/VehicleInteractions.js';
import { HARBOR_RING } from '../subjects/gpt-racing/src/scenarios/HarborRing.js';
import { Circuit as NmpccCircuit } from '../subjects/gemini-nmpcc/src/simulation/Track.js';
import { Vehicle as NmpccVehicle } from '../subjects/gemini-nmpcc/src/simulation/Vehicle.js';
import { updateAerodynamicWakes as nmpccWakes } from '../subjects/gemini-nmpcc/src/simulation/VehicleInteractions.js';
import { NextGenAIController as NmpccController } from '../subjects/gemini-nmpcc/src/ai/v2/NextGenAIController.js';
import { Circuit as GPCircuit } from '../subjects/gemini-grand-prix/src/simulation/Track.js';
import { Vehicle as GPVehicle } from '../subjects/gemini-grand-prix/src/simulation/Vehicle.js';
import { updateAerodynamicWakes as gpWakes } from '../subjects/gemini-grand-prix/src/simulation/VehicleInteractions.js';
import { NextGenAIController as GPController } from '../subjects/gemini-grand-prix/src/ai/v2/NextGenAIController.js';
import { Circuit as ClaudeCircuit } from '../subjects/claude-racing/src/sim/Track.js';
import { Vehicle as ClaudeVehicle } from '../subjects/claude-racing/src/sim/Vehicle.js';
import { Race as ClaudeRace } from '../subjects/claude-racing/src/sim/Race.js';
import { TrackGrid } from '../subjects/claude-racing/src/sim/TrackGrid.js';
import { cloneSpec } from '../subjects/claude-racing/src/sim/CarSpecs.js';
import { Pilot } from '../subjects/claude-racing/src/ai/Pilot.js';
import { PlanBudget } from '../subjects/claude-racing/src/ai/Scheduler.js';
import { HARBOR_RING as CLAUDE_HARBOR_RING } from '../subjects/claude-racing/src/scenarios/HarborRing.js';
import claudeLine from '../subjects/claude-racing/public/lines/harbor-ring-gt.json' with { type: 'json' };
import { CANDIDATES } from './controller-bridges.js';
import { makeAstraNative } from './astra-bridge.js';

const SOURCE_DT = 1 / 120;
const CLAUDE_DT = 1 / 400;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

function sourceState(engine) {
  const car = engine.nativeVehicle;
  if(engine.kind==='astra')return {id:engine.id,s:car.s,lateral:-car.lateral,x:car.x,y:car.y,z:car.z,yaw:car.yaw,speed:car.speed,
    velocity:{x:car.vx,y:0,z:car.vz},acceleration:{x:0,y:0,z:0},localVelocity:{x:car.v,z:car.u},localAcceleration:{x:car.ay,z:car.ax},
    controls:car.controls,steering:car.steering,rpm:car.rpm,wheels:car.wheels,wake:{strength:car.aero.wake}};
  if (engine.kind === 'claude') {
    const yaw = Math.PI * 0.5 - car.yaw;
    return {
      id: engine.id, s: car.s, lateral: -car.q, x: car.x, y: car.y, z: car.z, yaw,
      speed: car.speed,
      velocity: { x: Math.sin(yaw) * car.speed, y: 0, z: Math.cos(yaw) * car.speed },
      acceleration: { x: Math.sin(yaw) * finite(car.accelLong), y: 0, z: Math.cos(yaw) * finite(car.accelLong) },
      localVelocity: { x: finite(car.v), z: finite(car.u) },
      localAcceleration: { x: finite(car.accelLat), z: finite(car.accelLong) },
      controls: car.controls, steering: car.steerAngle, rpm: car.rpm, wheels: car.wheels,
      wake: { strength: car.dirtyAir, dragReduction: car.slipstream }
    };
  }
  const surface = engine.nativeTrack.surfaceAt(car.position.x, car.position.z);
  return {
    id: engine.id, s: finite(surface.s, car.distance), lateral: finite(surface.lateral),
    x: car.position.x, y: car.position.y, z: car.position.z, yaw: car.yaw, speed: car.speed,
    velocity: car.velocity, acceleration: car.acceleration, localVelocity: car.localVelocity,
    localAcceleration: car.localAcceleration, controls: car.controls, steering: car.steering,
    rpm: car.rpm, wheels: car.wheels, wake: car.wake
  };
}

function syncStandardShadow(shadow, track, state) {
  shadow.resetTo(track, state.s, state.lateral);
  const point = track.atDistance(state.s);
  shadow.speed = state.speed;
  shadow.velocity.x = point.tangent.x * state.speed;
  shadow.velocity.z = point.tangent.z * state.speed;
  shadow.localVelocity = { x: 0, z: state.speed };
  shadow.player = true;
}

function syncDisplay(engine) {
  const state = sourceState(engine);
  const host = engine.vehicle;
  host.position.x = state.x; host.position.y = state.y; host.position.z = state.z;
  host.velocity.x = finite(state.velocity?.x); host.velocity.y = finite(state.velocity?.y); host.velocity.z = finite(state.velocity?.z);
  host.acceleration.x = finite(state.acceleration?.x); host.acceleration.y = finite(state.acceleration?.y); host.acceleration.z = finite(state.acceleration?.z);
  host.localVelocity = { x: finite(state.localVelocity?.x), z: finite(state.localVelocity?.z) };
  host.localAcceleration = { x: finite(state.localAcceleration?.x), z: finite(state.localAcceleration?.z) };
  host.yaw = state.yaw; host.speed = state.speed; host.distance = state.s;
  host.steering = finite(state.steering); host.rpm = finite(state.rpm, host.rpm);
  Object.assign(host.controls, state.controls ?? {});
  if (state.wake) Object.assign(host.wake, state.wake);
  for (let i = 0; i < Math.min(host.wheels.length, state.wheels?.length ?? 0); i += 1) {
    const source = state.wheels[i], target = host.wheels[i];
    target.grip = finite(source?.grip ?? source?.surfaceGrip, target.grip);
    target.locked = Boolean(source?.locked ?? source?.wheelLocked);
    if (target.tyre) {
      target.tyre.slipAngle = finite(source?.tyre?.slipAngle ?? source?.slipAngle);
      target.tyre.slipRatio = finite(source?.tyre?.slipRatio ?? source?.slipRatio);
    }
  }
}

function makeStandard(candidate, host, slot, Circuit, Vehicle, Controller, wakes, index, isGPT = false, experimentalUpgrades = false) {
  const nativeTrack = new Circuit(HARBOR_RING);
  const nativeVehicle = new Vehicle({ id: candidate.id, name: candidate.label, color: candidate.color, player: false, spec: 'gt' });
  nativeVehicle.resetTo(nativeTrack, slot.distance, slot.lateral);
  const shadows = CANDIDATES.filter((entry) => entry.id !== candidate.id).map((entry) => new Vehicle({
    id: `shadow-${entry.id}`, name: entry.label, color: entry.color, player: true, spec: 'gt'
  }));
  const field = [nativeVehicle, ...shadows];
  const controller = isGPT
    ? new Controller({ track: nativeTrack, vehicles: field })
    : new Controller(index + 1, { track: nativeTrack, experimentalUpgrades });
  controller.setDebugEnabled?.(true);
  if (isGPT) {
    // AIRaceDirector constructs its agents internally. Mark only the native
    // vehicle and its corresponding agent after construction; the baseline
    // remains an unmarked director/vehicle pair.
    nativeVehicle.experimentalUpgrades = Boolean(experimentalUpgrades);
    const agent = controller.agents?.get(nativeVehicle.id);
    if (agent) agent.experimentalUpgrades = Boolean(experimentalUpgrades);
  }
  return {
    ...candidate, kind: 'standard', vehicle: host, nativeTrack, nativeVehicle, shadows, field, controller, errors: 0, steps: 0,
    step(states, phase, raceTime) {
      states.filter((state) => state.id !== this.id).forEach((state, i) => syncStandardShadow(shadows[i], nativeTrack, state));
      const raceView = { phase, raceTime, elapsed: raceTime, entries: new Map(field.map((car) => [car.id, { lap: 0, unwrappedDistance: car.distance }])) };
      if (isGPT) {
        const commands = controller.step({ vehicles: field, track: nativeTrack, race: raceView, dt: SOURCE_DT });
        controller.apply(commands, { vehicles: field, track: nativeTrack });
      } else controller.update(nativeVehicle, field, nativeTrack, raceView, SOURCE_DT);
      wakes([nativeVehicle]);
      nativeVehicle.step(SOURCE_DT, nativeTrack, phase === 'racing');
      this.steps += 1;
      syncDisplay(this);
    },
    debug() {
      const debug = isGPT ? (controller.agents.get(nativeVehicle.id)?.debugState ?? {}) : (controller.getDebugState?.() ?? {});
      const suffix = experimentalUpgrades ? ' · EXPERIMENTAL UPGRADE' : '';
      return { ...debug, controllerCadence: `Native 120 Hz physics + controller${suffix}`, routeKind: `${candidate.label} native route${suffix}` };
    }
  };
}

function makeClaude(candidate, host, slot, experimentalUpgrades = false) {
  const nativeTrack = new ClaudeCircuit({ scenario: CLAUDE_HARBOR_RING });
  const grid = new TrackGrid(nativeTrack, cloneSpec('gt'), { solution: claudeLine });
  const nativeRace = new ClaudeRace(nativeTrack, {
    entries: [{ classId: 'gt', spec: cloneSpec('gt'), name: candidate.label, isPlayer: false, tint: candidate.color }],
    laps: 4, countdown: 4.25
  });
  const nativeVehicle = nativeRace.cars[0];
  nativeVehicle.reset(slot.distance, -slot.lateral, 0);
  const shadows = CANDIDATES.filter((entry) => entry.id !== candidate.id).map((entry, index) => new ClaudeVehicle(cloneSpec('gt'), nativeTrack, {
    id: `shadow-${index}`, name: entry.label, tint: entry.color
  }));
  const field = [nativeVehicle, ...shadows];
  const controller = new Pilot(nativeVehicle, grid, {
    field, phase: 0, budget: new PlanBudget(1), name: candidate.label, skill: 0.96, aggression: 0.72,
    experimentalUpgrades
  });
  controller.experimentalUpgrades = Boolean(experimentalUpgrades);
  nativeRace.setDriver(0, controller);
  return {
    ...candidate, kind: 'claude', vehicle: host, nativeTrack, nativeVehicle, nativeRace, shadows, field, controller, errors: 0, steps: 0,
    step(states) {
      states.filter((state) => state.id !== this.id).forEach((state, i) => {
        shadows[i].reset(state.s, -state.lateral, state.speed);
        shadows[i].active = true;
      });
      nativeRace.step(CLAUDE_DT);
      this.steps += 1;
      syncDisplay(this);
    },
    debug() {
      const debug = controller.debug?.() ?? {};
      const plan = controller.driver?.plan, path = [], point = { q: 0, dqds: 0, v: 0, kappa: 0 };
      if (plan?.sample) for (let i = 0; i < 28; i += 1) {
        const s = nativeTrack.wrapS(nativeVehicle.s + i * 5);
        plan.sample(s, point);
        path.push({ s, q: -finite(point.q), targetSpeed: finite(point.v) });
      }
      return {
        ...debug, path, planPath: path, targetQ: path[3]?.q ?? 0,
        targetSpeed: finite(controller.driver?.vAllow, path[3]?.targetSpeed),
        minimumClearance: Number.isFinite(controller.view?.gapAhead) ? controller.view.gapAhead : null,
         controllerCadence: `Native 400 Hz physics + Driver · ${this.steps.toLocaleString()} steps${experimentalUpgrades ? ' · EXPERIMENTAL UPGRADE' : ''}`,
         routeKind: `Claude ${plan?.constructor?.name ?? 'plan'} · actual Driver.plan${experimentalUpgrades ? ' · EXPERIMENTAL UPGRADE' : ''}`
      };
    }
  };
}

export async function createNativeEngineBridges({ vehicles, race, experimentalUpgrades = false, onStatus = () => {} }) {
  onStatus(`Constructing ${CANDIDATES.length} native physics worlds behind the benchmark interface…${experimentalUpgrades ? ' EXPERIMENTAL UPGRADE' : ''}`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const hosts = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const slots = vehicles.map((_, index) => race.gridPosition(index));
  const slot=id=>slots[vehicles.findIndex(v=>v.id===id)];
  const candidate = (id) => CANDIDATES.find((entry) => entry.id === id);
  const entries = [
    makeAstraNative(candidate('astra'),hosts.get('astra'),slot('astra'),CANDIDATES),
    makeStandard(candidate('gpt-racing'), hosts.get('gpt-racing'), slot('gpt-racing'), GPTCircuit, GPTVehicle, AIRaceDirector, gptWakes, 0, true, experimentalUpgrades),
    makeClaude(candidate('claude-racing'), hosts.get('claude-racing'), slot('claude-racing'), experimentalUpgrades),
    makeStandard(candidate('gemini-nmpcc'), hosts.get('gemini-nmpcc'), slot('gemini-nmpcc'), NmpccCircuit, NmpccVehicle, NmpccController, nmpccWakes, 2, false, experimentalUpgrades),
    makeStandard(candidate('gemini-grand-prix'), hosts.get('gemini-grand-prix'), slot('gemini-grand-prix'), GPCircuit, GPVehicle, GPController, gpWakes, 3, false, experimentalUpgrades)
  ];
  let claudeAccumulator = 0;
  const byId = (id) => entries.find((entry) => entry.id === id);
  entries.forEach(syncDisplay);
  return {
    entries, byId,
    step(dt, phase, raceTime) {
      const states = entries.map(sourceState);
      for (const entry of entries) if (entry.kind !== 'claude') {entry.step(states, phase, raceTime);if(entry.kind==='astra')syncDisplay(entry);}
      claudeAccumulator += dt;
      while (claudeAccumulator + 1e-10 >= CLAUDE_DT) {
        byId('claude-racing').step(states);
        claudeAccumulator -= CLAUDE_DT;
      }
    },
    reset() { window.location.reload(); }
  };
}
