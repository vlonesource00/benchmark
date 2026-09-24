import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField } from '../sandbox/bridges/index.js';

const DT = 1 / 120;

function runNovaSolo(laps = 5, maxSeconds = 500) {
  const track = new Track('harbor-ring');
  const session = new Session(track, { classId: 'gt', mixed: false });
  session.laps = laps;
  session.field = 1;
  session.aggression = 0.72;
  session.autopilot = true;

  const field = createField({ session, hostTrack: track, order: ['nova'], onStatus: () => {} });
  session.start({ freshTrack: true });
  field.attach();

  const car = session.cars[0];
  const bridge = field.bridges[0];
  const novaDriver = bridge.driver;
  const cc = novaDriver.coupledController;

  let elapsed = 0;
  let countdownDuration = 0;
  let countdownRecorded = false;
  let lastLapRecorded = 1;
  let lapTimes = [];
  let tyreStates = [];

  while (elapsed < maxSeconds && car.race.finishTime == null) {
    const prevPhase = session.phase;
    session.step(DT, { throttle: 0, brake: 0, steer: 0 });
    elapsed += DT;

    if (!countdownRecorded && session.phase === 'racing') {
      countdownDuration = session.time;
      countdownRecorded = true;
    }

    if (session.phase === 'finished') session.phase = 'racing';

    if (car.race.lap > lastLapRecorded) {
      const lTime = car.race.lastLap;
      lapTimes.push(lTime);
      lastLapRecorded = car.race.lap;

      if (car.wheels && car.wheels.length >= 4) {
        const [fl, fr, rl, rr] = car.wheels.map(w => w.tyre);
        const tScale = cc ? cc.computeTyreScale(car) : 1.0;
        tyreStates.push({
          lap: lapTimes.length,
          time: lTime,
          tScale,
          flCore: fl.core,
          rrCore: rr.core,
          rrSurf: rr.surface,
          rrWear: rr.wear
        });
      }
    }
  }

  if (car.race.finishTime !== null && lapTimes.length < laps) {
    const finalLap = car.race.lastLap;
    lapTimes.push(finalLap);
  }

  console.log(`\n=== NOVA SOLO ${laps}-LAP RESULTS ===`);
  console.log(`Pre-race / Countdown: ${countdownDuration.toFixed(3)}s`);
  lapTimes.forEach((t, i) => {
    const ts = tyreStates[i];
    const detail = ts ? `(tScale: ${ts.tScale.toFixed(4)}, RR Core: ${ts.rrCore.toFixed(1)}°C, RR Surf: ${ts.rrSurf.toFixed(1)}°C, RR Wear: ${(ts.rrWear*100).toFixed(2)}%)` : '';
    console.log(`  Lap ${i + 1}: ${t.toFixed(3)}s ${detail}`);
  });
  console.log(`Finish Time: ${car.race.finishTime?.toFixed(3) ?? elapsed.toFixed(3)}s`);
  console.log(`Offtrack: ${car.race.offtrack.toFixed(3)}s, Damage: ${car.damage.toFixed(4)}, Errors: ${bridge.errors}`);
  if (bridge.lastError) console.error('Last error:', bridge.lastError);
  return { lapTimes, tyreStates };
}

const lapsArg = process.argv.find((a, i) => process.argv[i - 1] === '--laps' || a.startsWith('--laps='));
const lapsCount = lapsArg ? parseInt(lapsArg.replace('--laps=', ''), 10) : 5;
runNovaSolo(lapsCount);

