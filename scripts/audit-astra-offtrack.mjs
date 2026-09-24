import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField, TRIAD_CANDIDATES } from '../sandbox/bridges/index.js';
import { TRIAD_GRID_PERMUTATIONS } from './run-triad.mjs';

async function auditAstra(laps) {
  console.log(`\n==================================================`);
  console.log(`AUDITING ASTRA OFFTRACK FOR ${laps}-LAP TRIAD (6 HEATS)`);
  console.log(`==================================================\n`);

  for (let h = 0; h < TRIAD_GRID_PERMUTATIONS.length; h++) {
    const grid = TRIAD_GRID_PERMUTATIONS[h];
    const track = new Track('harbor-ring');
    const session = new Session(track, { classId: 'gt', mixed: false });
    session.laps = laps;
    session.field = 3;
    session.cars = session.cars.slice(0, 3);
    session.drivers = session.drivers.slice(0, 3);
    session.autopilot = true;

    const field = createField({
      session,
      hostTrack: track,
      order: grid,
      candidatesList: TRIAD_CANDIDATES
    });
    session.start({ freshTrack: true });
    field.attach(true);
    session.phase = 'racing';
    session.countdown = 0;

    const astraBridge = field.bridges.find(b => b.candidateId === 'astra');
    const astraCar = session.cars[astraBridge.carId];

    let prevOfftrack = 0;
    const episodes = [];
    const DT = 1 / 120;
    const maxSteps = Math.ceil((laps * 100 + 40) / DT);
    let steps = 0;

    while (steps < maxSteps) {
      if (session.phase === 'finished' && !session.activeCars.every(c => c.race.finishTime !== null)) {
        session.phase = 'racing';
      }
      session.step(DT, { throttle: 0, brake: 0, steer: 0 });
      steps++;

      const dOff = astraCar.race.offtrack - prevOfftrack;
      if (dOff > 0.001) {
        if (episodes.length === 0 || session.time - episodes.at(-1).endTime > 1.0) {
          episodes.push({
            start: session.time,
            end: session.time,
            duration: dOff,
            s: astraCar.s,
            lap: astraCar.race.lap,
            lateral: astraCar.lateral,
            speed: astraCar.speed * 3.6
          });
        } else {
          episodes.at(-1).end = session.time;
          episodes.at(-1).duration += dOff;
        }
      }
      prevOfftrack = astraCar.race.offtrack;

      if (session.activeCars.every(c => c.race.finishTime !== null)) break;
    }

    console.log(`Heat ${h + 1} [${grid.join(' / ')}] -> Total Astra Offtrack: ${astraCar.race.offtrack.toFixed(3)}s across ${episodes.length} episodes`);
    for (const ep of episodes) {
      console.log(`   Lap ${ep.lap} @ s=${ep.s.toFixed(1)}m (t=${ep.start.toFixed(2)}-${ep.end.toFixed(2)}s, dur=${ep.duration.toFixed(3)}s, q=${ep.lateral.toFixed(2)}m, v=${ep.speed.toFixed(1)}km/h)`);
    }
  }
}

async function run() {
  const lapsArg = process.argv.find(a => a.startsWith('--laps='));
  const laps = lapsArg ? parseInt(lapsArg.split('=')[1], 10) : (process.argv[2] ? parseInt(process.argv[2], 10) : 3);
  await auditAstra(laps);
}

run().catch(console.error);
