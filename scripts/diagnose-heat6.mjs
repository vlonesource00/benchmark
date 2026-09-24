import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField, TRIAD_CANDIDATES } from '../sandbox/bridges/index.js';

export async function diagnoseHeat6() {
  const grid = ['astra', 'gemini-supreme', 'nova'];
  const track = new Track('harbor-ring');
  const session = new Session(track, { classId: 'gt' });
  session.laps = 3;
  session.field = 3;
  session.cars = session.cars.slice(0, 3);
  session.drivers = session.drivers.slice(0, 3);
  session.autopilot = true;

  const field = createField({ session, hostTrack: track, order: grid, candidatesList: TRIAD_CANDIDATES });
  session.start({ freshTrack: true });
  field.attach(true);
  session.phase = 'racing';
  session.countdown = 0;

  const novaBridge = field.bridges.find(b => b.candidateId === 'nova');
  const novaCar = session.cars[novaBridge.carId];
  const novaDriver = novaBridge.driver;
  const astraCar = session.cars[0];
  const geminiCar = session.cars[1];

  let prevContacts = 0;
  const contactEvents = [];
  const buffer = [];
  let steps = 0;
  const maxSteps = Math.ceil(300 * 120);

  console.log('Simulating Grid 6 [astra, gemini-supreme, nova] for 3 laps...');

  while (steps < maxSteps) {
    if (session.phase === 'finished' && !session.activeCars.every((c) => c.race.finishTime !== null)) {
      session.phase = 'racing';
    }

    const deltaContacts = session.contacts - prevContacts;
    const snapshot = {
      step: steps,
      time: session.time,
      s: novaCar.s,
      q: novaCar.lateral,
      speed: novaCar.speed,
      impact: novaCar.impact,
      steer: novaCar.controls.steer,
      throttle: novaCar.controls.throttle,
      brake: novaCar.controls.brake,
      intent: novaDriver.topologyResult?.activeTopology ?? novaDriver.state?.intent,
      phase: novaDriver.topologyResult?.phase ?? novaDriver.topologyPlanner?.phase,
      targetQ: novaDriver.coupledController?.state?.targetQ,
      speedCap: novaDriver.topologyPlanner?.targetSpeedCap,
      speedCapReason: novaDriver.topologyPlanner?.lastSpeedCapReason,
      // Opponent states
      astS: astraCar.s,
      astQ: astraCar.lateral,
      astV: astraCar.speed,
      astImpact: astraCar.impact,
      gemS: geminiCar.s,
      gemQ: geminiCar.lateral,
      gemV: geminiCar.speed,
      gemImpact: geminiCar.impact,
      distToAst: Math.hypot(novaCar.x - astraCar.x, novaCar.z - astraCar.z),
      distToGem: Math.hypot(novaCar.x - geminiCar.x, novaCar.z - geminiCar.z),
    };
    buffer.push(snapshot);
    if (buffer.length > 400) buffer.shift();

    if (deltaContacts > 0 && novaCar.impact > 0.05) {
      contactEvents.push({
        time: session.time,
        station: novaCar.s,
        speed: (novaCar.speed * 3.6).toFixed(1),
        impact: novaCar.impact.toFixed(3),
        preBuffer: [...buffer.slice(-360)], // 3s before
      });
    }
    prevContacts = session.contacts;

    session.step(1 / 120, { throttle: 0, brake: 0, steer: 0 });
    steps++;

    if (session.activeCars.every(c => c.race.finishTime !== null)) break;
  }

  console.log(`Simulation finished. Total contacts: ${session.contacts}, Nova recorded contact events: ${contactEvents.length}`);
  contactEvents.forEach((ce, i) => {
    console.log(`\n=== CONTACT EVENT ${i + 1} ===`);
    console.log(`  Time: ${ce.time.toFixed(3)}s | Station: ${ce.station.toFixed(1)}m | Speed: ${ce.speed} km/h | Nova Impact: ${ce.impact}`);
    console.log(`  --- 3 SECONDS BEFORE CONTACT (sampled every 0.5s) ---`);
    console.log(`  Time (s) | Nova(s,q,v) | Ast(s,q,v) | Gem(s,q,v) | Dist Ast | Dist Gem | Intent | Phase | SpeedCap`);
    const pre = ce.preBuffer;
    for (let k = 0; k < pre.length; k += 60) {
      const snap = pre[k];
      console.log(
        `  ${snap.time.toFixed(2).padStart(8)} | ` +
        `N(${snap.s.toFixed(1)}, ${snap.q.toFixed(2)}, ${(snap.speed*3.6).toFixed(0)}) | ` +
        `A(${snap.astS.toFixed(1)}, ${snap.astQ.toFixed(2)}, ${(snap.astV*3.6).toFixed(0)}) | ` +
        `G(${snap.gemS.toFixed(1)}, ${snap.gemQ.toFixed(2)}, ${(snap.gemV*3.6).toFixed(0)}) | ` +
        `${snap.distToAst.toFixed(2).padStart(8)}m | ` +
        `${snap.distToGem.toFixed(2).padStart(8)}m | ` +
        `${(snap.intent ?? 'NONE').padEnd(8)} | ` +
        `${(snap.phase ?? 'NONE').padEnd(10)} | ` +
        `${Number.isFinite(snap.speedCap) ? (snap.speedCap*3.6).toFixed(1) : 'none'}`
      );
    }
    // Print immediate impact steps
    console.log(`  --- IMPACT ONSET (-0.1s to contact) ---`);
    const onsetStart = Math.max(0, pre.length - 12);
    for (let k = onsetStart; k < pre.length; k += 2) {
      const snap = pre[k];
      console.log(
        `  ${snap.time.toFixed(3)} | s=${snap.s.toFixed(1)} q=${snap.q.toFixed(2)} | dAst=${snap.distToAst.toFixed(2)}m dGem=${snap.distToGem.toFixed(2)}m | throt=${snap.throttle.toFixed(2)} brk=${snap.brake.toFixed(2)} steer=${snap.steer.toFixed(2)} | cap=${Number.isFinite(snap.speedCap) ? (snap.speedCap*3.6).toFixed(0) : 'none'}`
      );
    }
  });
}

diagnoseHeat6().catch(console.error);
