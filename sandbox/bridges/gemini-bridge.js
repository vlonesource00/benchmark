import { createShadowVehicle, shadowRace, clamp, finite } from './shadow.js';

/**
 * Curvature adapter for legacy Gemini pins (NMPCC / Grand Prix) which
 * expected signed curvature directly on frame.curvature rather than
 * unsigned magnitude with turnSign.
 */
function withSignedCurvature(track) {
  const sign = (frame) => {
    if (frame && Number.isFinite(frame.curvature)) {
      // shadow turnSign: +1 = left, -1 = right; +curvature means right turn.
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
 * `Controller` is injected so pinned Gemini branches (Supreme, Grand Prix, NMPCC)
 * can each be hosted without duplicating the boundary.
 */
export function createGeminiBridge({ candidate, cars, hostTrack, shadowTrack, index, Controller, options = {} }) {
  const shadows = cars.map((car) => {
    const hostSpec = car?.spec ?? {};
    const adaptedSpec = {
      mass: finite(hostSpec.mass, 1290),
      wheelBase: finite(hostSpec.wheelbase, 2.78),
      trackWidth: finite(hostSpec.track, 1.72),
      steeringLock: finite(hostSpec.steeringLock, 0.48),
      steering: {
        maxAngle: finite(hostSpec.steeringLock, 0.48),
        maxRate: 11
      },
      tire: {
        alphaPeak: 0.140,
        grip: finite(hostSpec.tyreGrip, 1.0)
      },
      aero: {
        cl: finite(hostSpec.cl, 2.25),
        cd: finite(hostSpec.cd, 0.64),
        area: finite(hostSpec.area, 1.9)
      },
      brakeBias: finite(hostSpec.brakeBias, 0.58)
    };
    const s = createShadowVehicle(car, hostTrack, car.id, {
      classKey: 'gt',
      spec: adaptedSpec,
      name: car.name
    });
    // Propagate physical plant parameters directly to top-level shadow properties
    s.wheelBase = adaptedSpec.wheelBase;
    s.trackWidth = adaptedSpec.trackWidth;
    s.mass = adaptedSpec.mass;
    s.steeringLock = adaptedSpec.steeringLock;
    s.brakeBias = adaptedSpec.brakeBias;
    return s;
  });

  const self = shadows[index];
  // Supreme Gemini uses canonical unsigned curvature + turnSign contract;
  // legacy Gemini pins (nmpcc, grand-prix) receive signed curvature via withSignedCurvature.
  const isLegacy = candidate?.id !== 'gemini-supreme';
  const track = isLegacy ? withSignedCurvature(shadowTrack) : shadowTrack;

  // Pass adapted vehicle specs directly into controller options so global
  // time-optimal solvers and analytical performance models see the canonical Astra GT plant
  const controller = new Controller(index, {
    track,
    aggression: 0.9,
    spec: self.spec,
    customSpecs: { gt: self.spec },
    ...options
  });
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

export const GEMINI_SUPREME = Object.freeze({
  id: 'gemini-supreme',
  label: 'Gemini Gauntlet · Supreme',
  color: '#00d2ff',
  stack: 'NextGenAIController → global optimum → combat engine → coupled MPCC'
});

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
