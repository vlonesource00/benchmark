import { AIRaceDirector } from '../subjects/gpt-racing/src/ai/AIRaceDirector.js';
import { Circuit as CloudCircuit } from '../subjects/claude-racing/src/sim/Track.js';
import { Vehicle as CloudVehicle } from '../subjects/claude-racing/src/sim/Vehicle.js';
import { TrackGrid } from '../subjects/claude-racing/src/sim/TrackGrid.js';
import { cloneSpec } from '../subjects/claude-racing/src/sim/CarSpecs.js';
import { Pilot } from '../subjects/claude-racing/src/ai/Pilot.js';
import { HARBOR_RING as CLOUD_HARBOR_RING } from '../subjects/claude-racing/src/scenarios/HarborRing.js';
import { NextGenAIController as NmpccController } from '../subjects/gemini-nmpcc/src/ai/v2/NextGenAIController.js';
import { NextGenAIController as GrandPrixController } from '../subjects/gemini-grand-prix/src/ai/v2/NextGenAIController.js';
import cloudGtLine from '../subjects/claude-racing/public/lines/harbor-ring-gt.json' with { type: 'json' };
import { makeAstraBridge } from './astra-bridge.js';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrapAngle = (value) => {
  let wrapped = value % (Math.PI * 2);
  if (wrapped > Math.PI) wrapped -= Math.PI * 2;
  if (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
};

export const CANDIDATES = Object.freeze([
  {id:'astra',label:'Astra',branch:'benchamrk-made',commit:'709ed88d4aa0bb5f58b8ec8e655a40d016d23cbb',color:'#df482d',stack:'v1.1 racecraft → TacticalPlanner → dynamic chassis rollouts → AdaptiveDriver'},
  {
    id: 'gpt-racing',
    label: 'GPT Racing',
    branch: 'codex/flat-track-racecraft',
    commit: '0dcd4744d4e5f4036db0894a62ab9976d091e370',
    color: '#44e1cc',
    stack: 'AIRaceDirector → RacecraftAgent → TrajectoryPlanner → VehicleController'
  },
  {
    id: 'claude-racing',
    label: 'Cloud Racing',
    branch: 'main',
    commit: '96334bc195255ecccf47416894c9ab072c447aed',
    color: '#ffb454',
    stack: 'Pilot → Racecraft → Lattice → Driver'
  },
  {
    id: 'gemini-nmpcc',
    label: 'Gemini Gauntlet · NMPCC',
    branch: 'feat/apex-nmpcc-combat-ai',
    commit: '17ccafbd3a65a4b8cc0f4b3d32342c6a127c714a',
    color: '#6d9cff',
    stack: 'NextGenAIController → global optimum → game theoretic combat → coupled MPCC'
  },
  {
    id: 'gemini-grand-prix',
    label: 'Gemini Gauntlet · Grand Prix',
    branch: 'feat/grand-prix-sim-and-cockpit-hud',
    commit: 'cbced43f5538bc72a497b17fbc74849f21955397',
    color: '#e472d1',
    stack: 'NextGenAIController → revised global optimum → game theoretic combat'
  }
]);

function applyControls(vehicle, controls = {}) {
  Object.assign(vehicle.controls, {
    throttle: clamp(finite(controls.throttle), 0, 1),
    brake: clamp(finite(controls.brake), 0, 1),
    steer: clamp(finite(controls.steer), -1, 1),
    handbrake: clamp(finite(controls.handbrake), 0, 1)
  });
}

function syncCloudShadow(shadow, host, hostTrack, cloudTrack) {
  const projection = hostTrack.closest(host.position.x, host.position.z);
  const frame = cloudTrack.frameAt(projection.s);
  const localVelocity = host.localVelocity ?? {};
  const localAcceleration = host.localAcceleration ?? {};

  // GPT normal is +Z (projection.lateral > 0). Claude normal is -Z (cloudQ > 0).
  const cloudQ = -projection.lateral;
  shadow.x = frame.x + frame.nx * cloudQ;
  shadow.y = finite(frame.y) - cloudQ * Math.tan(finite(frame.bank));
  shadow.z = frame.z + frame.nz * cloudQ;

  // The host measures yaw from +Z and Cloud from +X; this preserves the actual
  // world orientation seen by the shared physics car.
  shadow.yaw = wrapAngle(Math.PI * 0.5 - host.yaw);
  shadow.u = finite(localVelocity.z, host.speed);
  // Under the yaw-basis conversion, host local +X is Cloud body-left.
  shadow.v = finite(localVelocity.x);
  shadow.ax = finite(localAcceleration.z);
  shadow.ay = finite(localAcceleration.x);
  shadow.accelLong = shadow.ax;
  shadow.accelLat = shadow.ay;
  shadow.r = finite(host.yawRate);

  shadow.s = projection.s;
  shadow.q = cloudQ;
  shadow.node = frame.node;
  shadow.trackHeading = frame.heading;
  shadow.headingError = wrapAngle(shadow.yaw - frame.heading);
  shadow.steerAngle = finite(host.steering);
  shadow.lapDistance = projection.s;
  shadow.totalDistance = finite(host.totalDistance, host.distance);

  shadow.offTrack = Math.max(0, Math.abs(cloudQ) - finite(frame.halfWidth, 8.2) - finite(cloudTrack.curbWidth, 1.25) * 0.5);
  shadow.dirtyAir = finite(host.wake?.dragReduction);
  shadow.slipstream = finite(host.wake?.strength);
  shadow.surfaceGrip = finite(host.surface?.grip, 1);
  shadow.spinTimer = finite(host.spinTimer);

  for (let index = 0; index < shadow.slipRatio.length; index += 1) {
    const wheel = host.wheels?.[index];
    shadow.slipRatio[index] = finite(wheel?.tyre?.slipRatio ?? wheel?.slipRatio);
    shadow.slipAngle[index] = finite(wheel?.tyre?.slipAngle ?? wheel?.slipAngle);
    shadow.wheelLocked[index] = Boolean(wheel?.locked);
    shadow.wheelGrip[index] = finite(wheel?.grip, shadow.wheelGrip[index] ?? 1);
    shadow.fz[index] = finite(wheel?.normalLoad, shadow.fz[index]);
  }
}

function makeGPTBridge(candidate, vehicle, track, vehicles, race) {
  const director = new AIRaceDirector({ track, vehicles: [vehicle] });
  return {
    ...candidate,
    vehicle,
    controller: director,
    errors: 0,
    step(dt) {
      const external = vehicles.filter((other) => other !== vehicle);
      const originalPlayerFlags = external.map((other) => other.player);
      // AIRaceDirector treats player vehicles as traffic, but does not claim their controls.
      external.forEach((other) => { other.player = true; });
      try {
        const commands = director.step({ vehicles, track, race, dt });
        director.apply(commands, { vehicles, track });
      } finally {
        external.forEach((other, index) => { other.player = originalPlayerFlags[index]; });
      }
    },
    debug() {
      const debug = director.agents.get(vehicle.id)?.debugState ?? director.debugSnapshot?.() ?? {};
      return {
        ...debug,
        controllerCadence: '120 Hz source director on shared host',
        routeKind: 'GPT native TrajectoryPlanner route'
      };
    }
  };
}

function makeGeminiBridge(candidate, vehicle, track, vehicles, race, Controller, index) {
  const controller = new Controller(index, { track });
  controller.setDebugEnabled?.(true);
  return {
    ...candidate,
    vehicle,
    controller,
    errors: 0,
    step(dt) {
      controller.update(vehicle, vehicles, track, race, dt);
    },
    debug() {
      const debug = controller.getDebugState?.() ?? controller.telemetry?.() ?? {};
      return {
        ...debug,
        controllerCadence: '120 Hz source NextGenAIController',
        routeKind: `${candidate.label} native candidate/MPCC route`
      };
    }
  };
}

async function makeCloudBridge(candidate, vehicle, track, vehicles, onStatus) {
  onStatus('Cloud Racing is reconstructing its pinned TrackGrid and baked Harbor Ring line…');
  // Yield once so the loading panel paints before the source architecture performs its
  // intentionally expensive offline grid construction.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const cloudTrack = new CloudCircuit({ scenario: CLOUD_HARBOR_RING });
  if (Math.abs(cloudTrack.length - track.length) > 0.05) {
    throw new Error(`Cloud Racing Harbor Ring length ${cloudTrack.length} does not match host ${track.length}.`);
  }
  const grid = new TrackGrid(cloudTrack, cloneSpec('gt'), { solution: cloudGtLine });
  const shadows = vehicles.map((host, index) => new CloudVehicle(cloneSpec('gt'), cloudTrack, {
    id: `mirror-${host.id}`,
    name: host.name,
    tint: host.color,
    isPlayer: false,
    index
  }));
  const shadowByHostId = new Map(vehicles.map((host, index) => [host.id, shadows[index]]));
  const syncAllShadows = () => {
    for (const host of vehicles) syncCloudShadow(shadowByHostId.get(host.id), host, track, cloudTrack);
  };
  const newPilot = () => new Pilot(shadowByHostId.get(vehicle.id), grid, { field: shadows, name: candidate.label });
  syncAllShadows();
  let pilot = newPilot();
  let lastNativeSteps = 0;
  let totalNativeSteps = 0;

  const bridge = {
    ...candidate,
    vehicle,
    get controller() { return pilot; },
    cloudTrack,
    cloudGrid: grid,
    shadows,
    errors: 0,
    step(dt) {
      syncAllShadows();
      // Pilot is dt-aware, so call the untouched source once per shared physics
      // step. Replaying it at 400 Hz against a frozen 120 Hz state aliases the
      // lattice observer and is not equivalent to Cloud's native 400 Hz physics.
      pilot.update(dt);
      lastNativeSteps = 1;
      totalNativeSteps += 1;
      applyControls(vehicle, {
        throttle: pilot.controls.throttle,
        brake: pilot.controls.brake,
        steer: pilot.controls.steer,
        handbrake: pilot.controls.handbrake
      });
    },
    debug() {
      const base = pilot.debug?.() ?? { mode: pilot.mode, reason: pilot.reason };
      // This is the exact object the source Driver is following. Before the first
      // lattice search it is LinePlan; afterwards it is the selected TacticalPlan.
      const plan = pilot.driver?.plan;
      const shadow = shadowByHostId.get(vehicle.id);
      const s0 = shadow?.s ?? vehicle.distance;
      const path = [];
      const sampled = { q: 0, dqds: 0, v: 0, kappa: 0 };
      if (plan && typeof plan.sample === 'function') {
        for (let k = 0; k < 24; k += 1) {
          const sampleS = cloudTrack.wrapS(s0 + k * 4);
          plan.sample(sampleS, sampled);
          path.push({
            s: sampleS,
            q: -finite(sampled.q),
            targetSpeed: finite(sampled.v),
            curvature: finite(sampled.kappa)
          });
        }
      }
      const target = { q: 0, dqds: 0, v: 0, kappa: 0 };
      plan?.sample?.(cloudTrack.wrapS(s0 + 16), target);
      const planName = plan?.constructor?.name ?? 'NoPlan';
      return {
        ...base,
        planPath: path,
        path,
        targetQ: -finite(target.q),
        targetSpeed: Number.isFinite(pilot.driver?.vAllow) ? pilot.driver.vAllow : finite(target.v),
        planTargetSpeed: finite(target.v),
        targetCurvature: finite(target.kappa),
        minimumClearance: Number.isFinite(pilot.view?.gapAhead) ? pilot.view.gapAhead : null,
        routeKind: `Cloud ${planName} · actual Driver.plan`,
        planKind: planName,
        controllerCadence: '120 Hz shared physics · dt-aware Pilot (native project: 400 Hz)',
        controllerHz: 120,
        lastNativeSteps,
        totalNativeSteps,
        nativeRoutePoints: path.length
      };
    },
    reset() {
      syncAllShadows();
      pilot = newPilot();
      lastNativeSteps = 0;
      totalNativeSteps = 0;
    }
  };
  return bridge;
}

/**
 * Builds one source-preserving controller bridge per candidate. Source modules are
 * imported directly from the pinned checkouts; this file only owns the shared host
 * state boundary and never changes controller source or tunes its pace/risk values.
 */
export async function createControllerBridges({ track, vehicles, race, onStatus = () => {} }) {
  const byId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const candidate = (id) => CANDIDATES.find((entry) => entry.id === id);
  const entries = [];
  entries.push(makeAstraBridge(candidate('astra'),byId.get('astra'),track,vehicles));

  onStatus('Binding GPT Racing’s original field director to the common GT host…');
  entries.push(makeGPTBridge(candidate('gpt-racing'), byId.get('gpt-racing'), track, vehicles, race));

  entries.push(await makeCloudBridge(candidate('claude-racing'), byId.get('claude-racing'), track, vehicles, onStatus));

  onStatus('Binding the two pinned Gemini controller generations…');
  entries.push(makeGeminiBridge(candidate('gemini-nmpcc'), byId.get('gemini-nmpcc'), track, vehicles, race, NmpccController, 3));
  entries.push(makeGeminiBridge(candidate('gemini-grand-prix'), byId.get('gemini-grand-prix'), track, vehicles, race, GrandPrixController, 4));

  return {
    entries,
    step(dt) {
      for (const entry of entries) {
        try {
          entry.step(dt);
        } catch (error) {
          entry.errors += 1;
          entry.lastError = error;
          applyControls(entry.vehicle, { brake: 1 });
        }
      }
    },
    reset() {
      for (const entry of entries) {
        if (entry.reset) entry.reset({ vehicles, track });
        else entry.controller.reset?.({ vehicles, track });
        entry.errors = 0;
        entry.lastError = null;
      }
    },
    byId(id) {
      return entries.find((entry) => entry.id === id);
    }
  };
}
