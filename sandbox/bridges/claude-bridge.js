import { Circuit as CloudCircuit } from '../../subjects/claude-racing/src/sim/Track.js';
import { Vehicle as CloudVehicle } from '../../subjects/claude-racing/src/sim/Vehicle.js';
import { TrackGrid } from '../../subjects/claude-racing/src/sim/TrackGrid.js';
import { cloneSpec } from '../../subjects/claude-racing/src/sim/CarSpecs.js';
import { Pilot } from '../../subjects/claude-racing/src/ai/Pilot.js';
import { HARBOR_RING } from '../../host/astra/src/sim/harbor-ring.js';
import { finite, wrapAngle } from './shadow.js';

// Cloud's per-zone grip (subjects/claude-racing/src/sim/Track.js:34-39). The
// host car carries no `surfaceGrip` field of its own, so the host surface zone
// (host/astra/src/sim/track.js:98) is mapped onto it. Feeding the old constant
// 1.0 under-reported the road by 8 %, i.e. the car was permanently planning
// against grip it did not have.
const SURFACE_ROAD_GRIP = 1.08;
const CLOUD_GRIP_BY_HOST_ZONE = Object.freeze({
  asphalt: 1.08,
  kerb: 0.93,
  gravel: 0.62,
  grass: 0.39
});

/** Cloud corner order [FL, FR, RL, RR] (Vehicle.js:48) → Astra wheel index. */
const HOST_TO_CLOUD_WHEEL = Object.freeze([1, 0, 3, 2]);

/** CarSpecs.js:124 — the road-wheel angle the Cloud GT's `steer` is normalised to. */
const CLOUD_MAX_ANGLE = 0.540;

export const CLOUD_CANDIDATE = Object.freeze({
  id: 'claude-racing',
  label: 'Cloud Racing',
  color: '#ffb454',
  stack: 'Pilot → Racecraft → Lattice → Driver'
});

/**
 * Cloud Racing is hosted on the *shared* Harbor Ring rather than its own baked
 * scenario: its `Circuit` is rebuilt from the host control points so every
 * architecture solves and races the identical geometry. Its TrackGrid then runs
 * its own offline value iteration on that geometry, which is exactly what the
 * source architecture does on a new circuit.
 *
 * Verified conventions (measured, not guessed). See the notes above each mapping
 * in `syncShadow` for the source lines and the experiment behind every sign.
 *
 *   yaw   host  yaw = atan2(fwdX, fwdZ) · fwd = (sin yaw, cos yaw)
 *         cloud yaw = atan2(fwdZ, fwdX) · fwd = (cos yaw, sin yaw)
 *         → cloudYaw = π/2 − hostYaw.            (measured err < 1.2e-3 rad)
 *
 *   lateral  BOTH hosts derive their lateral axis the same way —
 *         host  track.js:45   nx = tz,  nz = −tx   (body v axis: vehicle.js:45/80)
 *         cloud Track.js:185  hx = dz,  hz = −dx   (body v axis: Vehicle.js:592-593)
 *         — so the two normals are the *same world vector*. Nothing is negated.
 *         Measured: a world point placed at host lateral +5.000 m projects on
 *         the Cloud circuit to q = +5.000 m.
 *
 *   steer BOTH stacks turn the same way for +steer: host steer > 0 loads the
 *         wheel at w.x > 0 (vehicle.js:79/80) and yields tyre force along the
 *         shared normal (vehicle.js:107/114); Cloud steer > 0 gives the
 *         front-LEFT wheel the inner lock (Vehicle.js:311-315, wy > 0 = left per
 *         Vehicle.js:425) and force along the same normal. Measured: host
 *         steer +0.5 → lateral +19 m / yawRate +0.91; Cloud steer +0.5 on the
 *         same circuit → q +30 m / r +0.88. Same sign, no flip.
 */
function buildCloudCircuit(hostTrack) {
  const scenario = {
    id: 'harbor-ring',
    name: 'Harbor Ring',
    controlPoints: HARBOR_RING.controlPoints.map((point) => ({ x: point.x, z: point.z })),
    roadHalfWidth: HARBOR_RING.roadHalfWidth,
    curbWidth: HARBOR_RING.curbWidth,
    runoffWidth: HARBOR_RING.runoffWidth,
    elevation: { profile: 'flat' },
    // Match the host's sampling so the two lengths agree to well under a metre.
    fineSteps: HARBOR_RING.sampleDensity,
    nodeSpacing: 5
  };
  const circuit = new CloudCircuit({ scenario });
  return { circuit, scale: hostTrack.length > 0 ? circuit.length / hostTrack.length : 1 };
}

export function createCloudBridge({ cars, hostTrack, index, onStatus = () => {} }) {
  onStatus('Cloud Racing is solving its TrackGrid value iteration on the shared Harbor Ring…');
  const { circuit: cloudTrack, scale } = buildCloudCircuit(hostTrack);
  if (Math.abs(cloudTrack.length - hostTrack.length) > 1.5) {
    console.warn(`[cloud-bridge] Harbor Ring length differs: host ${hostTrack.length.toFixed(2)} m vs cloud ${cloudTrack.length.toFixed(2)} m; mapping by arc-length ratio ${scale.toFixed(5)}.`);
  }
  const grid = new TrackGrid(cloudTrack, cloneSpec('gt'));
  const shadows = cars.map((host, i) => new CloudVehicle(cloneSpec('gt'), cloudTrack, {
    id: `mirror-${host.id}`,
    name: host.name,
    tint: host.color,
    isPlayer: false,
    index: i
  }));
  const shadowByHostId = new Map(cars.map((host, i) => [host.id, shadows[i]]));
  const self = shadows[index];

  // Astra's lateral axis and Cloud's are the same world vector (see header), so
  // the per-zone grip table is indexed by the host zone directly.
  const gripForHostZone = (zone) => CLOUD_GRIP_BY_HOST_ZONE[zone] ?? SURFACE_ROAD_GRIP;

  const syncShadow = (shadow, host, hostProjection, wake = 0, dt = 0) => {
    const cloudS = finite(hostProjection.s) * scale;
    const frame = cloudTrack.frameAt(cloudTrack.wrapS(cloudS));
    // No flip. host track.js:45 (nx = tz, nz = −tx) and cloud Track.js:185
    // (hx = dz, hz = −dx) build the identical normal from the identical tangent,
    // and cloud.project() returns q = +5.000 for a point at host lateral +5.000.
    const cloudQ = finite(hostProjection.lateral);
    shadow.x = frame.x + frame.nx * cloudQ;
    shadow.y = finite(frame.y) - cloudQ * Math.tan(finite(frame.bank));
    shadow.z = frame.z + frame.nz * cloudQ;
    shadow.yaw = wrapAngle(Math.PI * 0.5 - finite(host.yaw));
    shadow.u = finite(host.u);
    // Both body-lateral axes are the shared normal: host vehicle.js:45
    // (v = vx·cos yaw − vz·sin yaw, the (cos, −sin) = normal axis) and cloud
    // Vehicle.js:592-593 (v multiplies (sin yaw, −cos yaw) = the same vector at
    // cloudYaw = π/2 − hostYaw). Measured: host steer +0.5 → v −11.4, cloud
    // steer +0.5 → v −0.3…−11.5. Same sign, no flip.
    shadow.v = finite(host.v);
    // cloudYaw = π/2 − hostYaw and cloud Vehicle.js:588 does `yaw -= r·dt`, so
    // r = −d(cloudYaw)/dt = +d(hostYaw)/dt = host.yawRate. Both are
    // left-positive. Measured: host steer +0.5 → yawRate +0.91, cloud +0.88.
    shadow.r = finite(host.yawRate);
    shadow.ax = finite(host.ax);
    shadow.ay = finite(host.ay);
    shadow.accelLong = shadow.ax;
    shadow.accelLat = shadow.ay;
    shadow.s = cloudS;
    shadow.q = cloudQ;
    shadow.node = frame.node;
    shadow.lastNode = frame.node;
    shadow.trackHeading = frame.heading;
    shadow.headingError = wrapAngle(shadow.yaw - frame.heading);
    // Cloud's own steerAngle is a road-wheel angle in radians (Vehicle.js:305);
    // Astra's `steering` is also radians (vehicle.js:47), and both turn the same
    // way, so it passes through.
    shadow.steerAngle = finite(host.steering);
    shadow.surfaceGrip = gripForHostZone(hostTrack.zoneAt(cloudQ));
    // Same expression Cloud's own Vehicle.js:434 computes for itself.
    shadow.offTrack = Math.max(0, Math.abs(cloudQ) - finite(frame.halfWidth, 8.2) - cloudTrack.curbWidth * 0.5);
    shadow.dirtyAir = finite(wake);
    shadow.slipstream = finite(wake);
    shadow.lap = host.race?.lap ?? 1;
    // Astra numbers its wheels [FR, FL, RR, RL]: vehicle.js:23 gives wheel i the
    // body-lateral offset x = [-1,1,-1,1][i]·track/2, and +x is the shared
    // normal (cloud LEFT). Cloud numbers them [FL, FR, RL, RR]: Vehicle.js:48
    // gives wheel i the offset wy = +halfTrack for i = 0 and 2, and +wy is left
    // (Vehicle.js:425, q left-positive). Front/rear averages are unaffected but
    // the per-axle split is not, so the corners are remapped rather than copied.
    for (let i = 0; i < 4; i += 1) {
      const tyre = host.wheels?.[HOST_TO_CLOUD_WHEEL[i]]?.tyre;
      shadow.slipRatio[i] = finite(tyre?.kappa);
      shadow.slipAngle[i] = finite(tyre?.alpha);
      if (shadow.tires?.[i] && tyre) {
        shadow.tires[i].wear = finite(tyre.wear);
        shadow.tires[i].temp = finite(tyre.core);
      }
    }
    // Vehicle.js:598-599. The Driver reads this to decide a slide has become a
    // spin (Driver.js:699 / 792 / 811 / 850); left at zero it can never tell.
    const slipMag = Math.abs(Math.atan2(shadow.v, Math.max(1, Math.abs(shadow.u))));
    const spinning = slipMag > 0.42 && Math.hypot(shadow.u, shadow.v) > 6;
    shadow.spinTimer = spinning ? shadow.spinTimer + dt : Math.max(0, shadow.spinTimer - dt * 2);
    return shadow;
  };

  const newPilot = () => new Pilot(self, grid, { field: shadows, name: CLOUD_CANDIDATE.label });

  let pilot = newPilot();

  return {
    ...CLOUD_CANDIDATE,
    cloudTrack,
    cloudGrid: grid,
    shadows,
    arcScale: scale,
    errors: 0,
    get controller() { return pilot; },
    update(car, _cars, dt, context) {
      try {
        const projections = context?.projections;
        cars.forEach((host, i) => {
          const projection = projections?.get(host.id) ?? hostTrack.nearest(host.x, host.z);
          syncShadow(shadows[i], host, projection, 0, dt);
        });
        // Pilot is dt-aware, so call the untouched source once per shared
        // physics step. Replaying it at 400 Hz against a frozen 120 Hz state
        // aliases the lattice observer and is not equivalent to its native loop.
        pilot.update(dt);
        const controls = pilot.controls ?? {};
        // The Driver's steer is a fraction of CLOUD_MAX_ANGLE and its internal
        // gains are in radians of road-wheel angle (Driver.js:436); the host
        // reads its own steer as a fraction of `car.spec.steeringLock`
        // (vehicle.js:47). Passing the fraction straight through silently throws
        // away 11 % of the lock the controller asked for (0.48 vs 0.54 rad), so
        // the request is converted to an angle and back into the host's units.
        const hostLock = finite(car.spec?.steeringLock, CLOUD_MAX_ANGLE);
        const steerAngle = finite(controls.steer) * CLOUD_MAX_ANGLE;
        car.controls = {
          throttle: Math.min(1, Math.max(0, finite(controls.throttle))),
          brake: Math.min(1, Math.max(0, finite(controls.brake))),
          steer: Math.min(1, Math.max(-1, steerAngle / hostLock))
        };
      } catch (error) {
        this.errors += 1;
        this.lastError = error;
        car.controls = { throttle: 0, brake: 0.6, steer: 0 };
      }
    },
    reset() {
      cars.forEach((host, i) => syncShadow(shadows[i], host, hostTrack.nearest(host.x, host.z)));
      pilot = newPilot();
      this.errors = 0;
      this.lastError = null;
    },
    debug() {
      const base = pilot.debug?.() ?? { mode: pilot.mode, reason: pilot.reason };
      return {
        architecture: 'Cloud Racing',
        planSource: `native ${pilot.driver?.plan?.constructor?.name ?? 'LinePlan'} · actual Driver.plan`,
        controllerCadence: '12–22 Hz budgeted lattice on 120 Hz physics',
        ...base
      };
    }
  };
}
