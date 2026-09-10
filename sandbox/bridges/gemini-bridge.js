import { createShadowVehicle, shadowRace, clamp, finite } from './shadow.js';

/**
 * Gemini's own `Circuit` reports an unsigned `curvature` (Track.js:108 builds it
 * from `Math.acos`, so it is always >= 0) and carries the corner direction
 * separately in `turnSign`. `NextGenAIController` nevertheless feeds
 * `atDistance(distance).curvature` straight into
 * `PaceOptimizer.computeSteering({ currentCurvature })` under the name
 * `signedCurv` (NextGenAIController.js:435/558). There the term is used as a
 * feed-forward road-wheel angle, `atan(wheelBase * effCurv)`, in a command where
 * positive steers right — so that call site needs a *signed, right-positive*
 * curvature.
 *
 * PaceOptimizer recovers the missing sign from the pursuit heading error
 * (PaceOptimizer.js:328-332), but only when |headingError| > 0.03 rad. Below
 * that — i.e. exactly while the car is tracking its line — it falls back to the
 * raw (positive) value, so on a left-hander `rDes = effCurv * v` becomes a
 * right-hand yaw demand. The integral understeer learner then integrates
 * `eYaw = rDes - yawRate` (a large positive number) up to its +0.16 rad clamp,
 * and that bias cancels most of the path-tracking term for the whole corner.
 *
 * The host track knows the sign (Astra: curvature > 0 is a right-hand turn), so
 * supplying it is accurate perception rather than tuning. It is done here and
 * not in shadow.js because GPT's VehicleController.js:46-47 treats a negative
 * curvature as "straight" and would lose its corner speed limit on left-handers.
 */
function withSignedCurvature(track) {
  const sign = (frame) => {
    if (frame && Number.isFinite(frame.curvature)) {
      // shadow turnSign: +1 = left, -1 = right; +curvature must mean right.
      frame.curvature = Math.abs(frame.curvature) * (frame.turnSign < 0 ? 1 : -1);
    }
    return frame;
  };
  return {
    ...track,
    atDistance: (distance) => sign(track.atDistance(distance)),
    scalarAtDistance: (distance) => track.scalarAtDistance(distance),
    surfaceAt: (x, z) => sign(track.surfaceAt(x, z)),
    closest: (x, z) => sign(track.closest(x, z))
  };
}

/**
 * Gemini Gauntlet receives a shadow of its own `Vehicle`/`Circuit`, which share
 * a lineage with GPT Racing's, so the same adapter serves both.
 *
 * `Controller` is injected so the two pinned Gemini branches (NMPCC and Grand
 * Prix) can each be hosted without duplicating the boundary.
 */
export function createGeminiBridge({ candidate, cars, hostTrack, shadowTrack, index, Controller, options = {} }) {
  const shadows = cars.map((car) => createShadowVehicle(car, hostTrack, car.id, {
    classKey: 'gt',
    name: car.name
  }));
  const self = shadows[index];
  const track = withSignedCurvature(shadowTrack);
  // The id is read for replan time-slicing and used as a debug key.
  const controller = new Controller(index, { track, aggression: 0.9, ...options });
  controller.setDebugEnabled?.(true);

  return {
    ...candidate,
    controller,
    shadows,
    errors: 0,
    update(car, _cars, dt) {
      try {
        for (const shadow of shadows) shadow.sync();
        controller.update(self, shadows, track, shadowRace, dt);
        self.applyToHost();
      } catch (error) {
        this.errors += 1;
        this.lastError = error;
        car.controls = { throttle: 0, brake: 0.6, steer: 0 };
      }
    },
    reset() {
      controller.resetForRace?.(self);
      this.errors = 0;
      this.lastError = null;
    },
    debug() {
      const state = controller.getDebugState?.() ?? {};
      return {
        architecture: candidate.label,
        planSource: 'native NextGenAIController candidate lattice',
        controllerCadence: '25 Hz tactical replan on 120 Hz physics',
        ...state
      };
    }
  };
}

export const GEMINI_NMPCC = Object.freeze({
  id: 'gemini-nmpcc',
  label: 'Gemini Gauntlet · NMPCC',
  color: '#6d9cff',
  stack: 'NextGenAIController → global optimum → combat engine → coupled MPCC'
});

export const GEMINI_GRAND_PRIX = Object.freeze({
  id: 'gemini-grand-prix',
  label: 'Gemini Gauntlet · Grand Prix',
  color: '#e472d1',
  stack: 'NextGenAIController → global optimum → combat engine'
});
