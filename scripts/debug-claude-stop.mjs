import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
import { AIRaceDirector } from '../subjects/gpt-racing/src/ai/AIRaceDirector.js';
import { NextGenAIController as NmpccController } from '../subjects/gemini-nmpcc/src/ai/v2/NextGenAIController.js';
import { NextGenAIController as GrandPrixController } from '../subjects/gemini-grand-prix/src/ai/v2/NextGenAIController.js';

function wrapAngle(a) {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

const DT = 1 / 120;
const cloudTrack = new CloudCircuit({ scenario: CLOUD_HARBOR_RING });
const cloudLine = JSON.parse(await readFile(resolve('subjects/claude-racing/public/lines/harbor-ring-gt.json'), 'utf8'));
const cloudGrid = new TrackGrid(cloudTrack, cloneSpec('gt'), { solution: cloudLine });

const candidateIds = ['gpt-racing', 'claude-racing', 'gemini-nmpcc', 'gemini-grand-prix'];
const track = new Circuit(HARBOR_RING);
const vehicles = candidateIds.map((id) => new Vehicle({ id, name: id, spec: 'gt', player: false }));
const race = new RaceState(track, vehicles, 4);

vehicles.forEach((vehicle, index) => {
  const grid = race.gridPosition(index);
  vehicle.resetTo(track, grid.distance, grid.lateral);
});

const gptVehicle = vehicles[0];
const gptDirector = new AIRaceDirector({ track, vehicles: [gptVehicle] });

const shadows = vehicles.map((host, index) => new CloudVehicle(cloneSpec('gt'), cloudTrack, {
  id: `mirror-${host.id}`, name: host.name, isPlayer: false, index
}));
const shadowByHostId = new Map(vehicles.map((host, index) => [host.id, shadows[index]]));
const cloudPilot = new Pilot(shadowByHostId.get('claude-racing'), cloudGrid, { field: shadows, name: 'Cloud Racing' });
const nmpcc = new NmpccController(3, { track });
const grandPrix = new GrandPrixController(4, { track });

function syncCloudShadow(shadow, host) {
  const projection = track.closest(host.position.x, host.position.z);
  const frame = cloudTrack.frameAt(projection.s);
  const localVelocity = host.localVelocity ?? {};
  const localAcceleration = host.localAcceleration ?? {};
  const cloudQ = -projection.lateral;

  shadow.x = frame.x + frame.nx * cloudQ;
  shadow.y = (frame.y ?? 0) - cloudQ * Math.tan(frame.bank ?? 0);
  shadow.z = frame.z + frame.nz * cloudQ;

  const hostTrackHeading = Math.atan2(projection.tangent.x, projection.tangent.z);
  const hostHeadingError = wrapAngle(host.yaw - hostTrackHeading);

  shadow.yaw = frame.heading + hostHeadingError;
  shadow.u = localVelocity.z ?? host.speed;
  shadow.v = -localVelocity.x ?? 0;
  shadow.ax = localAcceleration.z ?? 0;
  shadow.ay = -localAcceleration.x ?? 0;
  shadow.accelLong = shadow.ax;
  shadow.accelLat = shadow.ay;
  shadow.r = -host.yawRate ?? 0;
  shadow.s = projection.s;
  shadow.q = cloudQ;
  shadow.node = frame.node;
  shadow.trackHeading = frame.heading;
  shadow.headingError = hostHeadingError;
  shadow.steerAngle = host.steering ?? 0;
  shadow.lapDistance = projection.s;
  shadow.totalDistance = host.distance;
  shadow.offTrack = Math.max(0, Math.abs(cloudQ) - (frame.halfWidth ?? 8.2) - (cloudTrack.curbWidth ?? 1.25) * 0.5);
  shadow.dirtyAir = host.wake?.dragReduction ?? 0;
  shadow.slipstream = host.wake?.strength ?? 0;
  shadow.surfaceGrip = host.surface?.grip ?? 1;
  shadow.spinTimer = host.spinTimer ?? 0;
  shadow.active = !host.finished && !host.despawned;

  for (let index = 0; index < shadow.slipRatio.length; index += 1) {
    const wheel = host.wheels?.[index];
    shadow.slipRatio[index] = wheel?.tyre?.slipRatio ?? wheel?.slipRatio ?? 0;
    shadow.slipAngle[index] = -(wheel?.tyre?.slipAngle ?? wheel?.slipAngle ?? 0);
    shadow.wheelLocked[index] = Boolean(wheel?.locked);
    shadow.wheelGrip[index] = wheel?.grip ?? 1;
    shadow.fz[index] = wheel?.normalLoad ?? 0;
  }
}

for (let tick = 0; tick < 7500; tick++) {
  race.step(DT);

  if (race.phase !== 'racing') {
    for (const vehicle of vehicles) {
      Object.assign(vehicle.controls, { throttle: 0, brake: 1, steer: 0, handbrake: 0 });
      vehicle.step(DT, track, true);
    }
  } else {
    const external = vehicles.filter((v) => v !== gptVehicle);
    const flags = external.map((v) => v.player);
    external.forEach((v) => { v.player = true; });
    try {
      const commands = gptDirector.step({ vehicles, track, race, dt: DT });
      gptDirector.apply(commands, { vehicles, track });
    } finally {
      external.forEach((v, i) => { v.player = flags[i]; });
    }

    for (const host of vehicles) syncCloudShadow(shadowByHostId.get(host.id), host);
    cloudPilot.update(DT);
    
    vehicles[1].controls.throttle = cloudPilot.controls.throttle;
    vehicles[1].controls.brake = cloudPilot.controls.brake;
    vehicles[1].controls.steer = -cloudPilot.controls.steer;
    vehicles[1].controls.handbrake = cloudPilot.controls.handbrake;

    nmpcc.update(vehicles[2], vehicles, track, race, DT);
    grandPrix.update(vehicles[3], vehicles, track, race, DT);

    updateAerodynamicWakes(vehicles);
    for (const vehicle of vehicles) vehicle.step(DT, track, true);
    resolveVehicleCollisions(vehicles, 3);
  }

  if (tick >= 5400 && tick <= 7200 && tick % 60 === 0) {
    const c = vehicles[1];
    const sh = shadowByHostId.get('claude-racing');
    const d = cloudPilot.driver;
    console.log(`t=${(tick*DT).toFixed(1)}s | s=${sh.s.toFixed(1)} | q=${sh.q.toFixed(2)} | spd=${(c.speed*3.6).toFixed(1)}km/h | thr=${c.controls.throttle.toFixed(2)} | brk=${c.controls.brake.toFixed(2)} | steer=${c.controls.steer.toFixed(2)} | vAllow=${d.vAllow?.toFixed(1)} | satAvg=${d.satAvg?.toFixed(2)} | alphaF=${d.alphaF?.toFixed(3)} | alphaR=${d.alphaR?.toFixed(3)} | pace=${d.paceScalar?.toFixed(2)} | mode=${cloudPilot.mode} | rsn="${cloudPilot.reason}"`);
  }
}
