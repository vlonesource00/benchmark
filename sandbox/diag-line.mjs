import { Circuit as CloudCircuit } from '../subjects/claude-racing/src/sim/Track.js';
import { TrackGrid } from '../subjects/claude-racing/src/sim/TrackGrid.js';
import { cloneSpec } from '../subjects/claude-racing/src/sim/CarSpecs.js';
import { HARBOR_RING } from '../host/astra/src/sim/harbor-ring.js';
import { Track } from '../host/astra/src/sim/track.js';

const hostTrack = new Track('harbor-ring');
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
const grid = new TrackGrid(circuit, cloneSpec('gt'));

const line = {};
const frame = {};
let sum = 0, n = 0, maxAbs = 0, offCount = 0;
let sPosKPos = 0, sNegKNeg = 0, mismatch = 0;
console.log('    s |  cloudK |  lineQ |  lineV | halfW');
for (let s = 0; s < circuit.length; s += 60) {
  circuit.frameAt(s, frame);
  grid.lineAt(s, line);
  const k = frame.curv;
  const q = line.q;
  sum += q; n += 1;
  maxAbs = Math.max(maxAbs, Math.abs(q));
  if (Math.abs(q) > frame.halfWidth) offCount += 1;
  if (Math.abs(k) > 0.002) {
    if (k * q > 0) { if (k > 0) sPosKPos++; else sNegKNeg++; } else mismatch++;
  }
  console.log(`${String(s).padStart(5)} | ${k.toFixed(5).padStart(7)} | ${q.toFixed(2).padStart(6)} | ${(line.v ?? 0).toFixed(1).padStart(6)} | ${frame.halfWidth.toFixed(2)}`);
}
console.log(`\nmean q = ${(sum / n).toFixed(3)}  max|q| = ${maxAbs.toFixed(2)}  samples off road = ${offCount}/${n}`);
console.log(`curvature-signed agreement: k>0&q>0 ${sPosKPos}, k<0&q<0 ${sNegKNeg}, mismatch ${mismatch}`);
console.log(`circuit.length=${circuit.length.toFixed(2)} host=${hostTrack.length.toFixed(2)}  ds=${circuit.ds} nodeCount=${circuit.nodeCount} H=${grid.H}`);
