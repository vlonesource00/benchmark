import { Track } from '../host/astra/src/sim/track.js';
import { Circuit as CloudCircuit } from '../subjects/claude-racing/src/sim/Track.js';
import { HARBOR_RING } from '../host/astra/src/sim/harbor-ring.js';

const hostTrack = new Track('harbor-ring');
const scenario = {
  id: 'harbor-ring',
  name: 'Harbor Ring',
  controlPoints: HARBOR_RING.controlPoints.map((p) => ({ x: p.x, z: p.z })),
  roadHalfWidth: HARBOR_RING.roadHalfWidth,
  curbWidth: HARBOR_RING.curbWidth,
  runoffWidth: HARBOR_RING.runoffWidth,
  elevation: { profile: 'flat' },
  fineSteps: HARBOR_RING.sampleDensity,
  nodeSpacing: 5
};
const cloud = new CloudCircuit({ scenario });
const scale = cloud.length / hostTrack.length;

console.log(`host length  = ${hostTrack.length.toFixed(3)}`);
console.log(`cloud length = ${cloud.length.toFixed(3)}`);
console.log(`scale        = ${scale.toFixed(8)}   diff=${(cloud.length - hostTrack.length).toFixed(3)} m`);
console.log(`host halfWidth=${hostTrack.halfWidth}  cloud halfWidth[0]=${cloud.halfWidth?.[0]}`);

const f = (v, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : String(v));

console.log('\n--- frame comparison (host s -> cloud s*scale) ---');
console.log('   s   | host(x,z)            | cloud(x,z)           | dPos  | host n      | cloud n     | hCurv   | cCurv');
for (const s of [0, 100, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2600]) {
  const hp = hostTrack.at(s);
  const cf = cloud.frameAt(cloud.wrapS(s * scale));
  const dPos = Math.hypot(hp.x - cf.x, hp.z - cf.z);
  console.log(
    `${String(s).padStart(6)} | ${f(hp.x, 1)},${f(hp.z, 1)}`.padEnd(24) +
    `| ${f(cf.x, 1)},${f(cf.z, 1)}`.padEnd(24) +
    `| ${f(dPos)}`.padEnd(8) +
    `| ${f(hp.nx, 3)},${f(hp.nz, 3)}`.padEnd(14) +
    `| ${f(cf.nx, 3)},${f(cf.nz, 3)}`.padEnd(14) +
    `| ${f(hp.curvature, 5)}`.padEnd(10) +
    `| ${f(cf.curv, 5)}`
  );
}

console.log('\n--- lateral mapping test: place a point at host lateral +5 and project onto cloud track ---');
for (const s of [0, 400, 900, 1500, 2200]) {
  const hp = hostTrack.at(s);
  const wx = hp.x + hp.nx * 5, wz = hp.z + hp.nz * 5;
  const proj = cloud.project(wx, wz, -1, {});
  const cf = cloud.frameAt(cloud.wrapS(s * scale));
  const qAnalytic = (wx - cf.x) * cf.nx + (wz - cf.z) * cf.nz;
  console.log(
    `s=${String(s).padStart(5)}  world=(${f(wx, 1)},${f(wz, 1)})  cloud.project -> s=${f(proj.s, 1)} q=${f(proj.q, 3)}   q(analytic vs cloud frame)=${f(qAnalytic, 3)}`
  );
}

console.log('\n--- heading mapping test: cloudYaw = PI/2 - hostYaw ? ---');
for (const s of [0, 400, 900, 1500, 2200]) {
  const hp = hostTrack.at(s);
  const cf = cloud.frameAt(cloud.wrapS(s * scale));
  const predicted = Math.PI * 0.5 - hp.heading;
  let d = (predicted - cf.heading) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  console.log(
    `s=${String(s).padStart(5)}  hostHeading=${f(hp.heading, 4)}  cloudHeading=${f(cf.heading, 4)}  PI/2-host=${f(predicted, 4)}  err=${f(d, 6)}`
  );
}
