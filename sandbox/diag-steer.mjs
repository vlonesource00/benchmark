import { Track } from '../host/astra/src/sim/track.js';
import { Vehicle } from '../host/astra/src/sim/vehicle.js';

const track = new Track('harbor-ring');
const f = (v, n = 3) => (Number.isFinite(v) ? v.toFixed(n).padStart(9) : '      n/a');

for (const steer of [0.5, -0.5]) {
  const car = new Vehicle(0, 'T', '#fff', 'gt');
  car.place(track, 600, 0, 30);
  car.controls = { throttle: 0.4, brake: 0, steer, reverse: false };
  console.log(`\n=== host steer = ${steer}  (start s=600 lateral=0, 30 m/s) ===`);
  console.log('     t |      yaw |  yawRate |       u |       v |  lateral |       s');
  for (let i = 0; i < 240; i++) {
    car.step(1 / 120, track, 0);
    if (i % 30 === 29) {
      console.log(
        `${((i + 1) / 120).toFixed(3).padStart(6)} |${f(car.yaw)} |${f(car.yawRate)} |${f(car.u)} |${f(car.v)} |${f(car.lateral)} |${f(car.s, 1)}`
      );
    }
  }
}
