import { createShadowVehicle, shadowRace, clamp, finite } from './shadow.js';

/**
 * Gemini Gauntlet receives a shadow of its own `Vehicle`/`Circuit`, which share
 * a lineage with GPT Racing's, so the same adapter serves both.
 *
 * `Controller` is injected so the two pinned Gemini branches (NMPCC and Grand
 * Prix) can each be hosted without duplicating the boundary.
 */
export function createGeminiBridge({ candidate, cars, hostTrack, shadowTrack, index, Controller, options = {} }) {
  const shadows = cars.map((car) => {
    const hostSpec = car?.spec ?? {};
    const adaptedSpec = {
      mass: finite(hostSpec.mass, 1290),
      wheelBase: finite(hostSpec.wheelbase, 2.70),
      trackWidth: finite(hostSpec.track, 1.95),
      steeringLock: finite(hostSpec.steeringLock, 0.51),
      steering: {
        maxAngle: finite(hostSpec.steeringLock, 0.51),
        maxRate: 11
      },
      tire: {
        alphaPeak: 0.140,
        grip: finite(hostSpec.tyreGrip, 1.0)
      },
      aero: {
        cl: finite(hostSpec.cl, 1.25),
        cd: finite(hostSpec.cd, 0.38),
        area: finite(hostSpec.area, 2.1)
      },
      brakeBias: 0.58
    };
    return createShadowVehicle(car, hostTrack, car.id, {
      classKey: 'gt',
      spec: adaptedSpec,
      name: car.name
    });
  });
  const self = shadows[index];
  const track = shadowTrack;
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
