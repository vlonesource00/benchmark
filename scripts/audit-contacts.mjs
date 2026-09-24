import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField, TRIAD_CANDIDATES } from '../sandbox/bridges/index.js';
import { TRIAD_GRID_PERMUTATIONS } from './run-triad.mjs';

export async function auditContacts(laps = 3) {
  console.log(`\n==================================================`);
  console.log(`AUDITING CONTACTS FOR ${laps}-LAP TRIAD (6 HEATS)`);
  console.log(`==================================================\n`);

  const allEvents = [];

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

    const novaBridge = field.bridges.find(b => b.candidateId === 'nova');
    const novaCar = session.cars[novaBridge.carId];

    const DT = 1 / 120;
    const maxSteps = Math.ceil((laps * 100 + 40) / DT);
    let steps = 0;
    let prevContacts = 0;

    while (steps < maxSteps) {
      if (session.phase === 'finished' && !session.activeCars.every(c => c.race.finishTime !== null)) {
        session.phase = 'racing';
      }
      
      const beforeContacts = session.contacts;
      session.step(DT, { throttle: 0, brake: 0, steer: 0 });
      steps++;

      if (session.contacts > beforeContacts) {
        const delta = session.contacts - beforeContacts;
        // Check which cars had impact
        const impacting = session.activeCars.filter(c => c.impact > 0.01);
        const novaInvolved = impacting.some(c => c.id === novaCar.id);

        if (novaInvolved) {
          const otherCar = impacting.find(c => c.id !== novaCar.id) ||
            session.activeCars.filter(c => c.id !== novaCar.id).sort((a,b) => Math.hypot(a.x - novaCar.x, a.z - novaCar.z) - Math.hypot(b.x - novaCar.x, b.z - novaCar.z))[0];
          
          const otherBridge = field.bridges[otherCar.id];
          const otherId = otherBridge?.candidateId || 'unknown';

          const ds = ((otherCar.s - novaCar.s + track.length) % track.length);
          const signedDs = ds > track.length / 2 ? ds - track.length : ds;
          const dq = otherCar.lateral - novaCar.lateral;
          const relSpeed = (novaCar.speed - otherCar.speed) * 3.6;

          const event = {
            heat: h + 1,
            grid: grid.join(' / '),
            time: session.time,
            delta,
            station: novaCar.s,
            rival: otherId,
            signedDs,
            dq,
            relSpeed,
            novaV: novaCar.speed * 3.6,
            rivalV: otherCar.speed * 3.6,
            novaSteer: novaCar.controls.steer,
            rivalSteer: otherCar.controls.steer,
            novaThrottle: novaCar.controls.throttle,
            novaBrake: novaCar.controls.brake,
            rivalThrottle: otherCar.controls.throttle,
            rivalBrake: otherCar.controls.brake,
          };
          allEvents.push(event);
        }
      }

      if (session.activeCars.every(c => c.race.finishTime !== null)) break;
    }
  }

  console.log(`Captured ${allEvents.length} contact events involving NOVA:`);
  allEvents.forEach((ev, i) => {
    console.log(`\n[EVENT ${i + 1}] Heat ${ev.heat} (${ev.grid}) @ t=${ev.time.toFixed(2)}s, s=${ev.station.toFixed(1)}m`);
    console.log(`  Rival: ${ev.rival} | signedDs=${ev.signedDs.toFixed(2)}m | dq=${ev.dq.toFixed(2)}m | relSpeed=${ev.relSpeed.toFixed(1)}km/h`);
    console.log(`  NOVA:  v=${ev.novaV.toFixed(1)}km/h, steer=${ev.novaSteer.toFixed(2)}, thr=${ev.novaThrottle.toFixed(2)}, brk=${ev.novaBrake.toFixed(2)}`);
    console.log(`  Rival: v=${ev.rivalV.toFixed(1)}km/h, steer=${ev.rivalSteer.toFixed(2)}, thr=${ev.rivalThrottle.toFixed(2)}, brk=${ev.rivalBrake.toFixed(2)}`);
  });
}

const lapsArg = process.argv.find(a => a.startsWith('--laps='));
const laps = lapsArg ? parseInt(lapsArg.split('=')[1], 10) : (process.argv[2] ? parseInt(process.argv[2], 10) : 3);
auditContacts(laps).catch(console.error);
