import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField } from '../sandbox/bridges/index.js';

const DT = 1 / 120;
const K_LAT = 2.35, K_LAT_V = 6.5, K_HEAD = 1.05, K_YAW = 0.145;
const PREVIEW_T = 0.42, PREVIEW_MIN = 6, PREVIEW_MAX = 34;
const SAT_RATIO = 1.12, BETA_SLACK = 1.15, BETA_CAP = 0.16;

const track = new Track('harbor-ring');
const session = new Session(track, { classId: 'gt', mixed: false });
session.laps = 2; session.field = 1; session.aggression = 0.72; session.autopilot = true;
const field = createField({ session, hostTrack: track, order: ['claude-racing'], onStatus: () => {} });
session.start({ freshTrack: true });
field.attach();

const bridge = field.byId('claude-racing');
const car = session.cars[0];
const sh = bridge.shadows[0];
const drv = () => bridge.controller.driver;
const spec = sh.spec;
const c = bridge.cloudTrack;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angleDelta = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2; return d; };
const f = (v, n = 2) => (Number.isFinite(v) ? v.toFixed(n).padStart(7) : '    n/a');

const pNow = {}, pl = {};
console.log(`spec wheelbase=${spec.wheelbase} maxAngle=${spec.steering.maxAngle} alphaPeak=${spec.tire.alphaPeak}`);
console.log('   t |    s |    q | tgtQ |  beta |  eq |  eLat |  eHead |  rDes |    r |  eYaw | yawInt |  aF |  aR |  sat | gvUp |   ff |   cmd |  out');
for (let i = 0; i < Math.round(Number(process.argv[2] ?? 40) / DT); i++) {
  session.step(DT, { throttle: 0, brake: 0, steer: 0 });
  if (session.phase === 'finished') session.phase = 'racing';
  if (i % 24 !== 0) continue;
  const d = drv();
  const spd = Math.max(0.35, sh.speed);
  const beta = Math.atan2(sh.v, Math.max(1.0, sh.u));
  const course = sh.yaw - beta;
  const lead = clamp(spd * PREVIEW_T, PREVIEW_MIN, PREVIEW_MAX);
  d.plan.sample(sh.s, pNow);
  d.plan.sample(c.wrapS(sh.s + lead), pl);
  const ff = pl.kappa * spec.wheelbase;
  const eq = pNow.q - sh.q;
  const eLat = K_LAT * Math.atan2(eq, K_LAT_V + spd);
  const kTrack = c.curv[sh.node];
  const psiPath = sh.trackHeading - Math.atan2(pNow.dqds, Math.max(0.2, 1 - kTrack * pNow.q));
  const eHead = -angleDelta(psiPath, course);
  const rDes = pNow.kappa * spd;
  const eYaw = rDes - sh.r;
  const alphaF = (sh.slipAngle[0] + sh.slipAngle[1]) * 0.5;
  const alphaR = (sh.slipAngle[2] + sh.slipAngle[3]) * 0.5;
  const sat = Math.abs(alphaF) / (spec.tire.alphaPeak * SAT_RATIO);
  const satR = Math.abs(alphaR) / spec.tire.alphaPeak;
  const giveUp = clamp((satR - 1.0) / 0.45, 0, 1);
  const cmd = ff * (1 - giveUp * 0.7) + (eLat + K_HEAD * eHead + d.yawInt) * (1 - giveUp) + K_YAW * (1 + 3.0 * giveUp) * eYaw;
  console.log(
    `${((i * DT).toFixed(2)).padStart(5)} |${f(sh.s, 0)} |${f(sh.q)} |${f(pNow.q)} |${f(beta)} |${f(eq)} |${f(eLat)} |${f(eHead)} |${f(rDes)} |${f(sh.r)} |${f(eYaw)} |${f(d.yawInt, 3)} |${f(alphaF, 3)} |${f(alphaR, 3)} |${f(sat)} |${f(giveUp)} |${f(ff, 3)} |${f(cmd, 3)} |${f(car.controls?.steer)}`
  );
}
console.log('errors', bridge.errors);
