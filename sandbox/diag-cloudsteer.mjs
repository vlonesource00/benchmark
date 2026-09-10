import { Circuit as CloudCircuit } from '../subjects/claude-racing/src/sim/Track.js';
import { Vehicle as CloudVehicle } from '../subjects/claude-racing/src/sim/Vehicle.js';
import { cloneSpec } from '../subjects/claude-racing/src/sim/CarSpecs.js';
import { HARBOR_RING } from '../host/astra/src/sim/harbor-ring.js';

const circuit = new CloudCircuit({
  scenario: {
    id: 'harbor-ring',
    name: 'Harbor Ring',
    controlPoints: HARBOR_RING.controlPoints.map((p) => ({ x: p.x, z: p.z })),
    roadHalfWidth: HARBOR_RING.roadHalfWidth,
    curbWidth: HARBOR_RING.curbWidth,
    runoffWidth: HARBOR_RING.runoffWidth,
    elevation: { profile: 'flat' },
    fineSteps: HARBOR_RING.sampleDensity,
    nodeSpacing: 5
  }
});

const f = (v, n = 3) => (Number.isFinite(v) ? v.toFixed(n).padStart(9) : '      n/a');

for (const steer of [0.5, -0.5]) {
  const car = new CloudVehicle(cloneSpec('gt'), circuit, { id: 'c', name: 'C', isPlayer: false, index: 0 });
  car.reset(600, 0, 30);
  car.setControls({ throttle: 0.4, brake: 0, steer, handbrake: 0 });
  console.log(`\n=== CLOUD steer = ${steer}  (start s=600 q=0, 30 m/s) ===`);
  console.log('     t |      yaw |        r |       u |       v |       q |       s | headErr');
  for (let i = 0; i < 240; i++) {
    car.step(1 / 120);
    if (i % 30 === 29) {
      console.log(
        `${((i + 1) / 120).toFixed(3).padStart(6)} |${f(car.yaw)} |${f(car.r)} |${f(car.u)} |${f(car.v)} |${f(car.q)} |${f(car.s, 1)} |${f(car.headingError)}`
      );
    }
  }
}
