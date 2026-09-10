import { Circuit as CloudCircuit } from '../subjects/claude-racing/src/sim/Track.js';
import { Vehicle as CloudVehicle } from '../subjects/claude-racing/src/sim/Vehicle.js';
import { TrackGrid } from '../subjects/claude-racing/src/sim/TrackGrid.js';
import { cloneSpec } from '../subjects/claude-racing/src/sim/CarSpecs.js';
import { Pilot } from '../subjects/claude-racing/src/ai/Pilot.js';
import { HARBOR_RING } from '../host/astra/src/sim/harbor-ring.js';

const hz = Number(process.argv[2] ?? 120);
const dt = 1 / hz;
const seconds = Number(process.argv[3] ?? 240);

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
const spec = cloneSpec('gt');
const grid = new TrackGrid(circuit, spec);
const car = new CloudVehicle(spec, circuit, { id: 'c', name: 'C', isPlayer: false, index: 0 });
car.reset(2591, 2.8, 0);
const pilot = new Pilot(car, grid, { field: [car], name: 'native' });

let off = 0, t = 0, minU = 1e9, maxQ = 0;
console.log(`native cloud @ ${hz} Hz`);
console.log('     t |      s |      q |      u |    r | headErr | offTk | grip | thr |  brk | steer');
for (let i = 0; i < Math.round(seconds / dt); i++) {
  pilot.update(dt);
  car.step(dt);
  t += dt;
  if (car.offTrack > 0) off += dt;
  maxQ = Math.max(maxQ, Math.abs(car.q));
  if (t > 6) minU = Math.min(minU, car.u);
  if (i % Math.round(hz * 2) === 0) {
    const c = car.controls;
    console.log(
      `${t.toFixed(1).padStart(6)} |${car.s.toFixed(0).padStart(7)} |${car.q.toFixed(2).padStart(7)} |${car.u.toFixed(1).padStart(7)} |${car.r.toFixed(2).padStart(5)} |${car.headingError.toFixed(2).padStart(8)} |${car.offTrack.toFixed(2).padStart(6)} |${car.surfaceGrip.toFixed(2).padStart(5)} |${c.throttle.toFixed(2).padStart(5)} |${c.brake.toFixed(2).padStart(5)} |${c.steer.toFixed(2).padStart(6)}`
    );
  }
}
console.log(`\nlaps=${car.lap} offTrackSeconds=${off.toFixed(2)} damage=${car.damage.toFixed(3)} maxAbsQ=${maxQ.toFixed(2)} minU=${minU.toFixed(1)}`);
