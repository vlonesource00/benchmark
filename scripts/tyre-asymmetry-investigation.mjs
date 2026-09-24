import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField } from '../sandbox/bridges/index.js';

const DT = 1 / 120;

async function investigateAsymmetry() {
  const track = new Track('harbor-ring');
  const session = new Session(track, { classId: 'gt', mixed: false });
  session.laps = 2;
  session.field = 1;
  session.autopilot = true;

  const field = createField({ session, hostTrack: track, order: ['nova'] });
  session.start({ freshTrack: true });
  field.attach();

  const car = session.cars[0];

  let elapsed = 0;
  let inLap2 = false;

  const cornerStats = {
    'Turn 1 Chicane (s: 700-1000m)': { range: [700, 1000], leftTurns: 0, rightTurns: 0, loadRL: 0, loadRR: 0, spRL: 0, spRR: 0, fxRL: 0, fxRR: 0, fyRL: 0, fyRR: 0, kappaRL: 0, kappaRR: 0, samples: 0 },
    'Harbor Sweeper (s: 1150-1350m)': { range: [1150, 1350], leftTurns: 0, rightTurns: 0, loadRL: 0, loadRR: 0, spRL: 0, spRR: 0, fxRL: 0, fxRR: 0, fyRL: 0, fyRR: 0, kappaRL: 0, kappaRR: 0, samples: 0 },
    'Marina Section (s: 1550-1850m)': { range: [1550, 1850], leftTurns: 0, rightTurns: 0, loadRL: 0, loadRR: 0, spRL: 0, spRR: 0, fxRL: 0, fxRR: 0, fyRL: 0, fyRR: 0, kappaRL: 0, kappaRR: 0, samples: 0 },
    'West Loop Hairpin (s: 2150-2350m)': { range: [2150, 2350], leftTurns: 0, rightTurns: 0, loadRL: 0, loadRR: 0, spRL: 0, spRR: 0, fxRL: 0, fxRR: 0, fyRL: 0, fyRR: 0, kappaRL: 0, kappaRR: 0, samples: 0 },
    'Exit & Main Straight (s: 2350-2650m)': { range: [2350, 2650], leftTurns: 0, rightTurns: 0, loadRL: 0, loadRR: 0, spRL: 0, spRR: 0, fxRL: 0, fxRR: 0, fyRL: 0, fyRR: 0, kappaRL: 0, kappaRR: 0, samples: 0 }
  };

  while (elapsed < 300 && car.race.finishTime == null) {
    session.step(DT, { throttle: 0, brake: 0, steer: 0 });
    elapsed += DT;

    if (session.phase === 'finished') session.phase = 'racing';

    if (car.race.lap === 2) {
      inLap2 = true;
      const s = ((car.s % track.length) + track.length) % track.length;
      const rlW = car.wheels[2];
      const rrW = car.wheels[3];
      const rl = rlW.tyre;
      const rr = rrW.tyre;

      for (const [name, c] of Object.entries(cornerStats)) {
        if (s >= c.range[0] && s < c.range[1]) {
          c.samples++;
          c.loadRL += rlW.load;
          c.loadRR += rrW.load;
          c.spRL += rl.slipPower * DT;
          c.spRR += rr.slipPower * DT;
          c.fxRL += rl.fx;
          c.fxRR += rr.fx;
          c.fyRL += rl.fy;
          c.fyRR += rr.fy;
          c.kappaRL += rl.kappa;
          c.kappaRR += rr.kappa;
          if (car.yawRate > 0.05) c.leftTurns++;
          else if (car.yawRate < -0.05) c.rightTurns++;
        }
      }
    } else if (car.race.lap > 2) {
      break;
    }
  }

  console.log('\n================================================================================');
  console.log('REAR AXLE ASYMMETRY ANALYSIS (RL vs RR on Lap 2)');
  console.log('================================================================================');
  console.log('Corner / Section                   | Load Ratio (RR/RL) | SlipEnergy RL / RR | Fx Mean RL / RR   | Fy Mean RL / RR   | Kappa Mean RL / RR');
  console.log('-----------------------------------|--------------------|--------------------|-------------------|-------------------|-------------------');

  for (const [name, c] of Object.entries(cornerStats)) {
    const n = Math.max(1, c.samples);
    const loadRatio = (c.loadRR / Math.max(1, c.loadRL)).toFixed(2);
    const spRL_kJ = (c.spRL / 1000).toFixed(1);
    const spRR_kJ = (c.spRR / 1000).toFixed(1);
    const fxRL = Math.round(c.fxRL / n);
    const fxRR = Math.round(c.fxRR / n);
    const fyRL = Math.round(c.fyRL / n);
    const fyRR = Math.round(c.fyRR / n);
    const kRL = (c.kappaRL / n).toFixed(4);
    const kRR = (c.kappaRR / n).toFixed(4);

    console.log(
      `${name.padEnd(34)} | ` +
      `${(loadRatio + 'x').padStart(18)} | ` +
      `${(spRL_kJ + ' / ' + spRR_kJ + ' kJ').padStart(18)} | ` +
      `${(fxRL + ' / ' + fxRR + ' N').padStart(17)} | ` +
      `${(fyRL + ' / ' + fyRR + ' N').padStart(17)} | ` +
      `${(kRL + ' / ' + kRR).padStart(17)}`
    );
  }
}

investigateAsymmetry().catch(console.error);
