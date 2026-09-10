import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField } from '../sandbox/bridges/index.js';

const DT = 1 / 120;
const track = new Track('harbor-ring');
const session = new Session(track, { classId: 'gt', mixed: false });
session.laps = 2;
session.field = 1;
session.aggression = 0.72;
session.autopilot = true;

const field = createField({ session, hostTrack: track, order: ['claude-racing'], onStatus: () => {} });
session.start({ freshTrack: true });
field.attach();

const bridge = field.byId('claude-racing');
const car = session.cars[0];
const shadow = bridge.shadows[0];
const pilot = () => bridge.controller;
const sampleOut = {};

const f = (v, n = 2) => (Number.isFinite(v) ? v.toFixed(n).padStart(7) : '    n/a');
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const seconds = Number(process.argv[2] ?? 20);

console.log('   t | hostS | hHead |  psi_h | latDot | hostLat | clQ | tgtQ | clHeadErr | thr |  brk | steer |    u | spd | offTk | grip | mode');
for (let i = 0; i < Math.round(seconds / DT); i++) {
  session.step(DT, { throttle: 0, brake: 0, steer: 0 });
  if (session.phase === 'finished') session.phase = 'racing';
  if (i % 30 === 0) {
    const hHead = track.at(car.s).heading;
    const psi = wrap(car.yaw - hHead);
    const latDot = car.u * Math.sin(psi) + car.v * Math.cos(psi);
    pilot().driver.plan.sample(shadow.s, sampleOut);
    const c = car.controls ?? {};
    const dbg = pilot().debug?.() ?? {};
    console.log(
      `${((i * DT).toFixed(2)).padStart(5)} |${f(car.s, 0)} |${f(hHead)} |${f(psi)} |${f(latDot)} |${f(car.lateral)} |${f(shadow.q)} |${f(sampleOut.q)} |${f(shadow.headingError)} |${f(c.throttle)} |${f(c.brake)} |${f(c.steer)} |${f(car.u)} |${f(car.speed, 1)} |${f(shadow.offTrack)} |${f(shadow.surfaceGrip)} | ${dbg.mode ?? '?'}`
    );
  }
}
console.log('\nbridge.errors =', bridge.errors, bridge.lastError ? String(bridge.lastError.stack ?? bridge.lastError) : '');
