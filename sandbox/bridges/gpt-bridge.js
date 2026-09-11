import { AIRaceDirector } from '../../subjects/gpt-racing/src/ai/AIRaceDirector.js';
import { CAR_SPECS } from '../../subjects/gpt-racing/src/simulation/CarSpecs.js';
import { CAR_CLASSES } from '../../host/astra/src/sim/car-specs.js';
import { createShadowVehicle, shadowRace } from './shadow.js';

/**
 * The shadow is the AI's only sensor. Reporting the host car's true mass and
 * aerodynamic coefficients is accurate perception, not tuning: GPT's own pace
 * constants are untouched, it simply stops budgeting for a car it is not driving.
 */
const HOST = CAR_CLASSES.gt;
const hostSpec = {
  ...(CAR_SPECS?.gt ?? {}),
  key: 'gt',
  classKey: 'gt',
  mass: HOST.mass,
  drive: HOST.drive,
  aero: {
    ...(CAR_SPECS?.gt?.aero ?? {}),
    area: HOST.area,
    frontCl: HOST.cl * HOST.frontAero,
    rearCl: HOST.cl * 0.57,
    groundEffect: 0
  },
  handling: { ...(CAR_SPECS?.gt?.handling ?? {}), tcSlipTarget: 0.14 }
};

export const GPT_CANDIDATE = Object.freeze({
  id: 'gpt-racing',
  label: 'GPT Racing',
  color: '#44e1cc',
  stack: 'AIRaceDirector → RacecraftAgent → TrajectoryPlanner → VehicleController'
});

/**
 * GPT Racing receives a shadow of its own `Vehicle`/`Circuit`. Only the harness
 * boundary translates; no GPT source, pace profile or behavioural tuning is
 * modified. The director treats `player` cars as traffic it must not claim, so
 * every rival shadow is flagged before each step and restored afterwards.
 */
export function createGptBridge({ cars, hostTrack, shadowTrack, index }) {
  const spec = hostSpec;
  const shadows = cars.map((car, i) => createShadowVehicle(car, hostTrack, car.id, {
    classKey: 'gt',
    spec,
    name: car.name
  }));
  const self = shadows[index];
  const director = new AIRaceDirector({ track: shadowTrack, vehicles: [self] });

  return {
    ...GPT_CANDIDATE,
    controller: director,
    shadows,
    errors: 0,
    update(car, _cars, dt) {
      try {
        for (const shadow of shadows) shadow.sync();
        const external = shadows.filter((shadow) => shadow !== self);
        const playerFlags = external.map((shadow) => shadow.player);
        external.forEach((shadow) => { shadow.player = true; });
        try {
          const commands = director.step({ vehicles: shadows, track: shadowTrack, race: shadowRace, dt });
          director.apply(commands, { vehicles: shadows, track: shadowTrack });
        } finally {
          external.forEach((shadow, i) => { shadow.player = playerFlags[i]; });
        }
        self.applyToHost();
      } catch (error) {
        this.errors += 1;
        this.lastError = error;
        car.controls = { throttle: 0, brake: 0.6, steer: 0 };
      }
    },
    reset() {
      director.reset?.({ vehicles: shadows, track: shadowTrack });
      this.errors = 0;
      this.lastError = null;
    },
    debug() {
      const state = director.agents?.get(self.id)?.debugState ?? director.debugSnapshot?.() ?? {};
      return {
        architecture: 'GPT Racing',
        planSource: 'native TrajectoryPlanner proposal + central field arbitration',
        controllerCadence: '15 Hz planning on 120 Hz physics',
        ...state
      };
    },
    visualDebug() {
      const agent = director.agents?.get(self.id);
      const trajectory = agent?.trajectory ?? agent?.plan?.trajectory;
      const target = agent?.targetPoint ?? agent?.aim;
      return {
        selectedTrajectory: trajectory?.points ? {
          points: trajectory.points.map((p) => ({
            x: p.x,
            y: p.y ?? 0,
            z: p.z,
            speed: p.speed ?? self.speed
          })),
          color: '#44e1cc',
          mode: agent?.mode ?? 'PACE'
        } : null,
        trackingPoint: target ? { x: target.x, y: target.y ?? 0, z: target.z } : null
      };
    }
  };
}
