import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField } from '../sandbox/bridges/index.js';

const DT = 1 / 120;
const track = new Track('harbor-ring');
const session = new Session(track, { classId: 'gt', mixed: false });
session.laps = Number(process.argv[2] ?? 2);
session.field = 1;
session.aggression = 0.72;
session.autopilot = true;
const field = createField({ session, hostTrack: track, order: ['claude-racing'], onStatus: () => {} });
session.start({ freshTrack: true });
field.attach();

const car = session.cars[0];
let elapsed = 0;
let inEp = false, epStart = 0, epS = 0, epMax = 0, epMinU = 1e9;
const episodes = [];
while (elapsed < Number(process.argv[3] ?? 240)) {
  session.step(DT, { throttle: 0, brake: 0, steer: 0 });
  if (session.phase === 'finished') session.phase = 'racing';
  elapsed += DT;
  const off = Math.abs(car.lateral) > track.halfWidth;
  if (off && !inEp) { inEp = true; epStart = elapsed; epS = car.s; epMax = 0; epMinU = 1e9; }
  if (inEp) {
    epMax = Math.max(epMax, Math.abs(car.lateral));
    if (elapsed > 6) epMinU = Math.min(epMinU, car.u);
    if (!off) {
      inEp = false;
      episodes.push({ t0: epStart, s0: epS, dur: elapsed - epStart, maxLat: epMax, minU: epMinU });
    }
  }
  if (car.race.finishTime != null) break;
}
if (inEp) episodes.push({ t0: epStart, s0: epS, dur: elapsed - epStart, maxLat: epMax, minU: epMinU });

let total = 0;
console.log('  # | start t | start s |  dur s | max|lat| | min u');
episodes.forEach((e, i) => {
  total += e.dur;
  console.log(
    `${String(i + 1).padStart(3)} |${e.t0.toFixed(1).padStart(8)} |${e.s0.toFixed(0).padStart(8)} |${e.dur.toFixed(2).padStart(7)} |${e.maxLat.toFixed(1).padStart(9)} |${(e.minU === 1e9 ? 0 : e.minU).toFixed(1).padStart(6)}`
  );
});
console.log(`\nepisodes=${episodes.length} totalOffRoad=${total.toFixed(2)}s (host race.offtrack=${car.race.offtrack.toFixed(2)}) laps=${car.race.lap - 1} best=${car.race.bestLap} damage=${car.damage.toFixed(4)} t=${elapsed.toFixed(1)}`);
