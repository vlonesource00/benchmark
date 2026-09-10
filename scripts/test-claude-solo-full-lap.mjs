import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Circuit } from '../subjects/gpt-racing/src/simulation/Track.js';
import { Vehicle } from '../subjects/gpt-racing/src/simulation/Vehicle.js';
import { RaceState } from '../subjects/gpt-racing/src/simulation/Race.js';
import { HARBOR_RING } from '../subjects/gpt-racing/src/scenarios/HarborRing.js';
import { Circuit as CloudCircuit } from '../subjects/claude-racing/src/sim/Track.js';
import { Vehicle as CloudVehicle } from '../subjects/claude-racing/src/sim/Vehicle.js';
import { TrackGrid } from '../subjects/claude-racing/src/sim/TrackGrid.js';
import { cloneSpec } from '../subjects/claude-racing/src/sim/CarSpecs.js';
import { Pilot } from '../subjects/claude-racing/src/ai/Pilot.js';
import { HARBOR_RING as CLOUD_HARBOR_RING } from '../subjects/claude-racing/src/scenarios/HarborRing.js';

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

const track = new Circuit(HARBOR_RING);
const vehicle = new Vehicle({ id: 'claude-racing', name: 'Claude', spec: 'gt', player: false });
const race = new RaceState(track, [vehicle], 4);
const grid = race.gridPosition(1);
vehicle.resetTo(track, grid.distance, grid.lateral);
race.phase = 'racing';
race.countdown = 0;

const shadow = new CloudVehicle(cloneSpec('gt'), cloudTrack, { id: 'mirror-claude', name: 'Claude', isPlayer: false });
const pilot = new Pilot(shadow, cloudGrid, { field: [shadow], name: 'Claude Racing' });

function syncCloudShadow(shadow, host) {
  const projection = track.closest(host.position.x, host.position.z);
  const frame = cloudTrack.frameAt(projection.s);
  const localVelocity = host.localVelocity ?? {};
  const localAcceleration = host.localAcceleration ?? {};
  const cloudQ = -projection.lateral;

  const hostTrackHeading = Math.atan2(projection.tangent.x, projection.tangent.z);
  const hostHeadingError = wrapAngle(host.yaw - hostTrackHeading);

  shadow.x = frame.x + frame.nx * cloudQ;
  shadow.y = (frame.y ?? 0) - cloudQ * Math.tan(frame.bank ?? 0);
  shadow.z = frame.z + frame.nz * cloudQ;

  shadow.yaw = frame.heading + hostHeadingError;
  shadow.u = localVelocity.z ?? host.speed;
  shadow.v = -(localVelocity.x ?? 0);
  shadow.ax = localAcceleration.z ?? 0;
  shadow.ay = -(localAcceleration.x ?? 0);
  shadow.accelLong = shadow.ax;
  shadow.accelLat = shadow.ay;
  shadow.r = host.yawRate ?? 0;
  shadow.s = projection.s;
  shadow.q = cloudQ;
  shadow.node = frame.node;
  shadow.trackHeading = frame.heading;
  shadow.headingError = hostHeadingError;
  shadow.steerAngle = -(host.steering ?? 0);
  shadow.lapDistance = projection.s;
  shadow.totalDistance = host.distance;
  shadow.offTrack = Math.max(0, Math.abs(cloudQ) - (frame.halfWidth ?? 8.2) - (cloudTrack.curbWidth ?? 1.25) * 0.5);
  shadow.dirtyAir = 0;
  shadow.slipstream = 0;
  shadow.surfaceGrip = 1;
  shadow.spinTimer = 0;
  shadow.active = true;

  for (let index = 0; index < shadow.slipRatio.length; index += 1) {
    const wheel = host.wheels?.[index];
    shadow.slipRatio[index] = wheel?.tyre?.slipRatio ?? wheel?.slipRatio ?? 0;
    shadow.slipAngle[index] = wheel?.tyre?.slipAngle ?? wheel?.slipAngle ?? 0;
    shadow.wheelLocked[index] = Boolean(wheel?.locked);
    shadow.wheelGrip[index] = wheel?.grip ?? 1;
    shadow.fz[index] = wheel?.normalLoad ?? 0;
  }
}

syncCloudShadow(shadow, vehicle);
pilot._plan();

console.log('--- STARTING 60-SECOND FULL LAP RUN ---');
for (let tick = 0; tick < 7200; tick++) {
  syncCloudShadow(shadow, vehicle);
  pilot.update(DT);
  vehicle.controls.throttle = pilot.controls.throttle;
  vehicle.controls.brake = pilot.controls.brake;
  vehicle.controls.steer = -pilot.controls.steer;
  vehicle.controls.handbrake = pilot.controls.handbrake;
  vehicle.step(DT, track, true);
  race.step(DT);

  if (tick % 120 === 0) {
    const d = pilot.driver;
    console.log(`t=${(tick*DT).toFixed(1)}s | s=${shadow.s.toFixed(1)}m | q=${shadow.q.toFixed(2)} | spd=${(vehicle.speed*3.6).toFixed(1)}km/h | str=${vehicle.controls.steer.toFixed(3)} | thr=${vehicle.controls.throttle.toFixed(2)} | brk=${vehicle.controls.brake.toFixed(2)} | mode=${pilot.mode} | off=${shadow.offTrack.toFixed(2)}`);
  }
}
