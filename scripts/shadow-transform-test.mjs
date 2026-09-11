import assert from 'node:assert/strict';

console.log('=== Running Shadow Acceleration & Yaw Rotation Test Suite ===');

function computeShadowAcceleration(car, yaw) {
  const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };

  const aForward = car.ax; // longitudinal / forward
  const aRight = car.ay;   // lateral / right

  const localAcceleration = {
    x: aRight,
    z: aForward
  };

  const worldAcceleration = {
    x: right.x * aRight + forward.x * aForward,
    z: right.z * aRight + forward.z * aForward
  };

  return { forward, right, localAcceleration, worldAcceleration };
}

const EPS = 1e-9;

// 1. YAW = 0
{
  const res = computeShadowAcceleration({ ax: -10, ay: 2 }, 0);
  console.log('  -> YAW = 0:');
  console.log(`     local: x=${res.localAcceleration.x}, z=${res.localAcceleration.z}`);
  console.log(`     world: x=${res.worldAcceleration.x}, z=${res.worldAcceleration.z}`);
  assert.equal(res.localAcceleration.x, 2);
  assert.equal(res.localAcceleration.z, -10);
  assert.ok(Math.abs(res.worldAcceleration.x - 2) < EPS);
  assert.ok(Math.abs(res.worldAcceleration.z - (-10)) < EPS);
  console.log('     [PASS] Matches exact local (+2, -10) and world (+2, -10)');
}

// 2. YAW = +90° (PI / 2)
{
  const res = computeShadowAcceleration({ ax: -10, ay: 2 }, Math.PI / 2);
  console.log('  -> YAW = +90° (PI/2):');
  console.log(`     local: x=${res.localAcceleration.x}, z=${res.localAcceleration.z}`);
  console.log(`     world: x=${res.worldAcceleration.x}, z=${res.worldAcceleration.z}`);
  assert.equal(res.localAcceleration.x, 2);
  assert.equal(res.localAcceleration.z, -10);
  assert.ok(Math.abs(res.worldAcceleration.x - (-10)) < EPS);
  assert.ok(Math.abs(res.worldAcceleration.z - (-2)) < EPS);
  console.log('     [PASS] Matches exact world (-10, -2)');
}

// 3. YAW = 180° (PI)
{
  const res = computeShadowAcceleration({ ax: -10, ay: 2 }, Math.PI);
  console.log('  -> YAW = 180° (PI):');
  console.log(`     local: x=${res.localAcceleration.x}, z=${res.localAcceleration.z}`);
  console.log(`     world: x=${res.worldAcceleration.x}, z=${res.worldAcceleration.z}`);
  assert.equal(res.localAcceleration.x, 2);
  assert.equal(res.localAcceleration.z, -10);
  assert.ok(Math.abs(res.worldAcceleration.x - (-2)) < EPS);
  assert.ok(Math.abs(res.worldAcceleration.z - 10) < EPS);
  console.log('     [PASS] Matches exact world (-2, +10)');
}

// 4. YAW = -90° (-PI / 2)
{
  const res = computeShadowAcceleration({ ax: -10, ay: 2 }, -Math.PI / 2);
  console.log('  -> YAW = -90° (-PI/2):');
  console.log(`     local: x=${res.localAcceleration.x}, z=${res.localAcceleration.z}`);
  console.log(`     world: x=${res.worldAcceleration.x}, z=${res.worldAcceleration.z}`);
  assert.equal(res.localAcceleration.x, 2);
  assert.equal(res.localAcceleration.z, -10);
  assert.ok(Math.abs(res.worldAcceleration.x - 10) < EPS);
  assert.ok(Math.abs(res.worldAcceleration.z - 2) < EPS);
  console.log('     [PASS] Matches exact world (+10, +2)');
}

console.log('\n>>> ALL SHADOW TRANSFORM TESTS PASSED CLEANLY (Exit 0) <<<');
