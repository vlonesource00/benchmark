import assert from 'node:assert/strict';
import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { Session as OriginalSession } from '../subjects/nova/src/sim/session.js';
import { Track as OriginalTrack } from '../subjects/nova/src/sim/track.js';
import { createNovaBridge } from '../sandbox/bridges/nova-bridge.js';

const track = new Track('harbor-ring');
const session = new Session(track, { classId: 'gt' });
session.field = 2; session.autopilot = true; session.start({ freshTrack: true });
session.cars = session.cars.slice(0, 2); session.drivers = session.drivers.slice(0, 2);
const bridge = createNovaBridge({ cars: session.cars, hostTrack: track, index: 1 });
const original = new OriginalSession(new OriginalTrack('harbor-ring'), { classId: 'gt' });
original.aiKind = 'nova'; original.aiOptions = { lineVariant: 'measured', novaSpeedScale: 1, strict: false };
const reference = original.makeDriver(original.cars[0]);
let samples = 0, secondPlaceSamples = 0;
session.drivers[1] = {
  update(car, cars, dt, context) {
    const position = context.order.findIndex(c => c.id === car.id) + 1;
    const referenceCar = structuredClone(car);
    const referenceCars = cars.map(c => c.id === car.id ? referenceCar : structuredClone(c));
    reference.update(referenceCar, referenceCars, dt, { ...context, position });
    bridge.update(car, cars, dt, context);
    assert.equal(bridge.errors, 0, bridge.lastError?.stack);
    for (const key of ['steer', 'throttle', 'brake']) {
      assert.ok(Number.isFinite(car.controls[key]), key);
      assert.ok(Math.abs(car.controls[key] - referenceCar.controls[key]) < 1e-12, `${key} differs at ${context.time}`);
    }
    assert.equal(car.controls.reverse, referenceCar.controls.reverse);
    samples++; if (position === 2) secondPlaceSamples++;
  }
};
while (session.time < 25) session.step(1 / 120, {});
assert.ok(secondPlaceSamples > 0, 'Must exercise a non-leading grid slot');
console.log(JSON.stringify({ seconds: session.time, samples, secondPlaceSamples, errors: bridge.errors, commandsMatchOriginal: true }));
