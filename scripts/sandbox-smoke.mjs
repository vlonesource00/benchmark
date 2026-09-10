import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AIRaceDirector } from '../subjects/gpt-racing/src/ai/AIRaceDirector.js';
import { Circuit } from '../subjects/gpt-racing/src/simulation/Track.js';
import { Vehicle } from '../subjects/gpt-racing/src/simulation/Vehicle.js';
import { RaceState } from '../subjects/gpt-racing/src/simulation/Race.js';
import { updateAerodynamicWakes, resolveVehicleCollisions } from '../subjects/gpt-racing/src/simulation/VehicleInteractions.js';
import { HARBOR_RING } from '../subjects/gpt-racing/src/scenarios/HarborRing.js';
import { Circuit as CloudCircuit } from '../subjects/claude-racing/src/sim/Track.js';
import { Vehicle as CloudVehicle } from '../subjects/claude-racing/src/sim/Vehicle.js';
import { TrackGrid } from '../subjects/claude-racing/src/sim/TrackGrid.js';
import { cloneSpec } from '../subjects/claude-racing/src/sim/CarSpecs.js';
import { Pilot } from '../subjects/claude-racing/src/ai/Pilot.js';
import { HARBOR_RING as CLOUD_HARBOR_RING } from '../subjects/claude-racing/src/scenarios/HarborRing.js';
import { NextGenAIController as NmpccController } from '../subjects/gemini-nmpcc/src/ai/v2/NextGenAIController.js';
import { NextGenAIController as GrandPrixController } from '../subjects/gemini-grand-prix/src/ai/v2/NextGenAIController.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DT = 1 / 120;
const TICKS = Math.max(1, Math.floor(Number(process.env.SANDBOX_TICKS ?? 480)) || 480);
const REQUIRE_COMPLETE = process.env.SANDBOX_REQUIRE_COMPLETE === '1';
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function applyControls(vehicle, controls = {}) {
  Object.assign(vehicle.controls, {
    throttle: clamp(finite(controls.throttle), 0, 1),
    brake: clamp(finite(controls.brake), 0, 1),
    steer: clamp(finite(controls.steer), -1, 1),
    handbrake: clamp(finite(controls.handbrake), 0, 1)
  });
}

function wrapAngle(a) {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function syncCloudShadow(shadow, host, hostTrack, cloudTrack) {
  const projection = hostTrack.closest(host.position.x, host.position.z);
  const frame = cloudTrack.frameAt(projection.s);
  const localVelocity = host.localVelocity ?? {};
  const localAcceleration = host.localAcceleration ?? {};
  const cloudQ = -projection.lateral;

  shadow.x = frame.x + frame.nx * cloudQ;
  shadow.y = finite(frame.y) - cloudQ * Math.tan(finite(frame.bank));
  shadow.z = frame.z + frame.nz * cloudQ;

  shadow.yaw = wrapAngle(Math.PI * 0.5 - host.yaw);
  shadow.u = finite(localVelocity.z, host.speed);
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const candidateIds = ['gpt-racing', 'claude-racing', 'gemini-nmpcc', 'gemini-grand-prix'];
const track = new Circuit(HARBOR_RING);
const vehicles = candidateIds.map((id) => new Vehicle({ id, name: id, spec: 'gt', player: false }));
const race = new RaceState(track, vehicles, 4);

vehicles.forEach((vehicle, index) => {
  const grid = race.gridPosition(index);
  vehicle.resetTo(track, grid.distance, grid.lateral);
});

// This is the common host's green-light boundary; no controller receives a
// special start command or pace adjustment.
race.phase = 'racing';
race.countdown = 0;

const gptVehicle = vehicles[0];
const gptDirector = new AIRaceDirector({ track, vehicles: [gptVehicle] });
const cloudTrack = new CloudCircuit({ scenario: CLOUD_HARBOR_RING });
assert(Math.abs(cloudTrack.length - track.length) <= 0.05, 'Harbor Ring track lengths diverged between host and Cloud source.');
const cloudLine = JSON.parse(await readFile(resolve(root, 'subjects/claude-racing/public/lines/harbor-ring-gt.json'), 'utf8'));
const cloudGrid = new TrackGrid(cloudTrack, cloneSpec('gt'), { solution: cloudLine });
const shadows = vehicles.map((host, index) => new CloudVehicle(cloneSpec('gt'), cloudTrack, {
  id: `mirror-${host.id}`,
  name: host.name,
  tint: host.color,
  isPlayer: false,
  index
}));
const shadowByHostId = new Map(vehicles.map((host, index) => [host.id, shadows[index]]));
const cloudPilot = new Pilot(shadowByHostId.get('claude-racing'), cloudGrid, { field: shadows, name: 'Cloud Racing' });
const nmpcc = new NmpccController(3, { track });
const grandPrix = new GrandPrixController(4, { track });

let elapsedTicks = 0;
let cloudControllerSteps = 0;
let sawCloudThrottle = false;
let sawCloudBrake = false;
let sawCloudRoute = false;
let maxCloudOffTrack = 0;
let maxCloudOffTrackState = null;
let firstCloudOffTrackState = null;
for (let tick = 0; tick < TICKS; tick += 1) {
  const external = vehicles.filter((vehicle) => vehicle !== gptVehicle);
  const playerFlags = external.map((vehicle) => vehicle.player);
  external.forEach((vehicle) => { vehicle.player = true; });
  try {
    const commands = gptDirector.step({ vehicles, track, race, dt: DT });
    gptDirector.apply(commands, { vehicles, track });
  } finally {
    external.forEach((vehicle, index) => { vehicle.player = playerFlags[index]; });
  }

  for (const host of vehicles) syncCloudShadow(shadowByHostId.get(host.id), host, track, cloudTrack);
  cloudPilot.update(DT);
  cloudControllerSteps += 1;
  applyControls(vehicles[1], {
    throttle: cloudPilot.controls.throttle,
    brake: cloudPilot.controls.brake,
    steer: cloudPilot.controls.steer,
    handbrake: cloudPilot.controls.handbrake
  });
  sawCloudThrottle ||= cloudPilot.controls.throttle > 0.2;
  sawCloudBrake ||= cloudPilot.controls.brake > 0.08;
  sawCloudRoute ||= typeof cloudPilot.driver?.plan?.sample === 'function';
  const cloudShadow = shadowByHostId.get('claude-racing');
  if (!firstCloudOffTrackState && cloudShadow.offTrack > 0.05) {
    const firstTarget = { q: 0, dqds: 0, v: 0, kappa: 0 };
    cloudPilot.driver?.plan?.sample?.(cloudTrack.wrapS(cloudShadow.s + 16), firstTarget);
    firstCloudOffTrackState = {
      tick,
      s: Number(cloudShadow.s.toFixed(2)),
      q: Number(cloudShadow.q.toFixed(2)),
      headingError: Number(cloudShadow.headingError.toFixed(3)),
      speedKmh: Number((vehicles[1].speed * 3.6).toFixed(1)),
      steer: Number(cloudPilot.controls.steer.toFixed(3)),
      throttle: Number(cloudPilot.controls.throttle.toFixed(3)),
      brake: Number(cloudPilot.controls.brake.toFixed(3)),
      targetQ: Number((-finite(firstTarget.q)).toFixed(2)),
      targetSpeedKmh: Number((finite(firstTarget.v) * 3.6).toFixed(1)),
      mode: cloudPilot.mode,
      reason: cloudPilot.reason
    };
  }
  if (cloudShadow.offTrack > maxCloudOffTrack) {
    maxCloudOffTrack = cloudShadow.offTrack;
    const routeTarget = { q: 0, dqds: 0, v: 0, kappa: 0 };
    cloudPilot.driver?.plan?.sample?.(cloudTrack.wrapS(cloudShadow.s + 16), routeTarget);
    maxCloudOffTrackState = {
      tick,
      s: Number(cloudShadow.s.toFixed(2)),
      q: Number(cloudShadow.q.toFixed(2)),
      headingError: Number(cloudShadow.headingError.toFixed(3)),
      speedKmh: Number((vehicles[1].speed * 3.6).toFixed(1)),
      steer: Number(cloudPilot.controls.steer.toFixed(3)),
      throttle: Number(cloudPilot.controls.throttle.toFixed(3)),
      brake: Number(cloudPilot.controls.brake.toFixed(3)),
      targetQ: Number((-finite(routeTarget.q)).toFixed(2)),
      targetSpeedKmh: Number((finite(routeTarget.v) * 3.6).toFixed(1)),
      mode: cloudPilot.mode,
      reason: cloudPilot.reason
    };
  }
  nmpcc.update(vehicles[2], vehicles, track, race, DT);
  grandPrix.update(vehicles[3], vehicles, track, race, DT);

  for (const vehicle of vehicles) {
    assert(Object.values(vehicle.controls).every(Number.isFinite), `${vehicle.id} emitted a non-finite control.`);
  }
  updateAerodynamicWakes(vehicles);
  vehicles.forEach((vehicle) => vehicle.step(DT, track, true));
  resolveVehicleCollisions(vehicles, 3);
  race.step(DT);
  elapsedTicks = tick + 1;
  if (race.phase === 'complete') break;
}

const results = vehicles.map((vehicle) => ({
  id: vehicle.id,
  speedKmh: Number((vehicle.speed * 3.6).toFixed(1)),
  throttle: Number(vehicle.controls.throttle.toFixed(3)),
  brake: Number(vehicle.controls.brake.toFixed(3)),
  steer: Number(vehicle.controls.steer.toFixed(3))
}));

for (const [index, result] of results.entries()) {
  if (!vehicles[index].finished) {
    assert(result.speedKmh > 3, `${result.id} did not become an active racing participant.`);
  }
}
assert(!/off track/i.test(String(cloudPilot.reason ?? '')), `Cloud Racing re-entered recovery: ${cloudPilot.reason}`);
assert(sawCloudThrottle, 'Cloud Racing never issued a launch/racing throttle command.');
assert(sawCloudRoute, 'Cloud Racing Driver never exposed the route it was following.');
assert(cloudControllerSteps === elapsedTicks, 'Cloud Racing did not run once per shared physics tick.');
if (TICKS >= 5000) assert(sawCloudBrake, 'Cloud Racing never issued a braking command over a corner-complete run.');
if (REQUIRE_COMPLETE) assert(race.phase === 'complete', `Race did not complete after ${TICKS} ticks.`);

console.log(JSON.stringify({
  status: 'four-controller smoke passed',
  ticks: elapsedTicks,
  racePhase: race.phase,
  cloudMode: cloudPilot.mode,
  cloudReason: cloudPilot.reason,
  cloudControllerSteps,
  cloudControllerHz: 120,
  sawCloudThrottle,
  sawCloudBrake,
  sawCloudRoute,
  maxCloudOffTrack: Number(maxCloudOffTrack.toFixed(3)),
  maxCloudOffTrackState,
  firstCloudOffTrackState,
  finishOrder: race.finishOrder.map((vehicle) => vehicle.id),
  laps: Object.fromEntries(vehicles.map((vehicle) => [vehicle.id, race.entries.get(vehicle.id)?.lap ?? 0])),
  results
}, null, 2));
