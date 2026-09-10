/** Throwaway: dump host track node geometry/curvature. */
import { Track } from '../host/astra/src/sim/track.js';
const t = new Track('harbor-ring');
console.log('len', t.length.toFixed(1), 'nodes', t.nodes.length, 'halfWidth', t.halfWidth);
const from = Number(process.argv[2] ?? 820);
const to = Number(process.argv[3] ?? 960);
const step = Number(process.argv[4] ?? 5);
let out = '';
for (let s = from; s <= to; s += step) {
  const p = t.at(s);
  out += `${s.toFixed(0).padStart(5)} x=${p.x.toFixed(1).padStart(7)} z=${p.z.toFixed(1).padStart(7)} h=${(p.heading * 180 / Math.PI).toFixed(1).padStart(7)} k=${p.curvature.toFixed(5).padStart(9)} i=${String(p.index).padStart(4)}\n`;
}
console.log(out);
