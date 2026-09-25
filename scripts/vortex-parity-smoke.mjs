import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { VortexDriver } from '../subjects/vortex/src/ai/vortex/vortex-driver.js';
import { createVortexBridge } from '../sandbox/bridges/vortex-bridge.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const immutable = [
  'src/sim/vehicle.js', 'src/sim/tyre.js', 'src/sim/track.js',
  'src/sim/harbor-ring.js', 'src/sim/car-specs.js', 'src/sim/session.js',
  'src/render/world.js', 'src/render/car.js', 'public/assets/gt-wheel.glb'
];
const hash = (directory, relative) => createHash('sha256').update(readFileSync(resolve(directory, relative))).digest('hex');
for (const relative of immutable) {
  assert.equal(hash(resolve(root, 'subjects/vortex'), relative), hash(resolve(root, 'host/astra'), relative), `Canonical file changed: ${relative}`);
}

const track = new Track('harbor-ring');
const session = new Session(track, { classId: 'gt' });
session.field = 2;
session.autopilot = true;
session.start({ freshTrack: true });
const index = 1;
const standalone = new VortexDriver(index, session.lineFor(session.cars[index]), { aggression: session.aggression });
const bridge = createVortexBridge({ line: session.lineFor(session.cars[index]), index, aggression: session.aggression });
let samples = 0;
let nonLeadingSamples = 0;
session.drivers[index] = {
  update(car, cars, dt, context) {
    const copy = structuredClone(car);
    const copies = cars.map((candidate) => candidate.id === car.id ? copy : structuredClone(candidate));
    standalone.update(copy, copies, dt, context);
    bridge.update(car, cars, dt, context);
    assert.equal(bridge.errors, 0, bridge.lastError?.stack);
    for (const key of ['steer', 'throttle', 'brake']) {
      assert.ok(Number.isFinite(car.controls[key]), `Non-finite ${key}`);
      assert.strictEqual(car.controls[key], copy.controls[key], `${key} differs at ${context.time}`);
    }
    assert.strictEqual(Boolean(car.controls.reverse), Boolean(copy.controls.reverse));
    samples += 1;
    if (context.order.findIndex((candidate) => candidate.id === car.id) > 0) nonLeadingSamples += 1;
  }
};

while (session.time < 25) session.step(1 / 120, {});
assert.ok(nonLeadingSamples > 0, 'Parity must exercise a non-leading grid slot');
console.log(JSON.stringify({
  seconds: session.time,
  samples,
  nonLeadingSamples,
  immutableFiles: immutable.length,
  controlsBitIdentical: true,
  bridgeErrors: bridge.errors
}));
