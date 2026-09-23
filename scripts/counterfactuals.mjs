import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField, TRIAD_CANDIDATES } from '../sandbox/bridges/index.js';
import { RACECRAFT_PHASE } from '../subjects/nova/src/ai/nova/topology-planner.js';

async function runCounterfactual(branchName, branchFn) {
  const track = new Track('harbor-ring');
  const session = new Session(track, { classId: 'gt', mixed: false });
  session.laps = 4;
  session.field = 3;
  session.cars = session.cars.slice(0, 3);
  session.drivers = session.drivers.slice(0, 3);
  session.autopilot = true;

  const field = createField({
    session,
    hostTrack: track,
    order: ['nova', 'gemini-supreme', 'astra'],
    candidatesList: TRIAD_CANDIDATES
  });

  session.start({ freshTrack: true });
  field.attach(true);

  const DT = 1 / 120;
  const maxSeconds = 4 * 110 + 60;
  const maxSteps = Math.ceil(maxSeconds / DT);

  const novaBridge = field.bridges.find((b) => b.candidateId === 'nova');
  const novaCar = session.cars[novaBridge.carId];
  const novaDriver = novaBridge.driver;
  const cc = novaDriver.coupledController;
  const tp = novaDriver.topologyPlanner;

  let branchTriggered = false;
  let lap4StartTime = null;
  let lap4Time = null;
  let steps = 0;
  let lapTimes = [];

  while (steps < maxSteps) {
    if (session.phase === 'finished' && session.activeCars.every((c) => c.race.finishTime !== null)) {
      break;
    }

    session.step(DT, { throttle: 0, brake: 0, steer: 0 });
    steps++;

    // Track completed laps
    if (novaCar.race.lastLap !== null && novaCar.race.lap > lapTimes.length + 1) {
      lapTimes.push(novaCar.race.lastLap);
      if (lapTimes.length === 3 && !branchTriggered) {
        branchTriggered = true;
        lap4StartTime = session.time;
        // Apply the counterfactual mutation at the boundary of Lap 3 and Lap 4
        branchFn({ session, track, field, novaCar, novaDriver, cc, tp });
      }
    }

    if (novaCar.race.finishTime !== null) {
      lap4Time = novaCar.race.lastLap;
      break;
    }
  }

  return {
    branch: branchName,
    lap1: lapTimes[0],
    lap2: lapTimes[1],
    lap3: lapTimes[2],
    lap4: lap4Time ?? (session.time - lap4StartTime),
    total: novaCar.race.finishTime
  };
}

async function main() {
  console.log('================================================================================');
  console.log('SECTION 3: CAUSAL LAP-BOUNDARY COUNTERFACTUAL EXPERIMENTS');
  console.log('================================================================================');

  const branches = [
    {
      name: 'Experiment A (Baseline / Original)',
      fn: () => {} // No-op
    },
    {
      name: 'Experiment B (Remove Opponents at Lap 3 boundary)',
      fn: ({ session, track }) => {
        session.field = 1;
        for (let i = 1; i < session.cars.length; i++) {
          session.cars[i].place(track, -9999, -9999);
          session.cars[i].speed = 0;
        }
      }
    },
    {
      name: 'Experiment C (Reset Tactical State Only at Lap 3 boundary)',
      fn: ({ novaDriver, tp }) => {
        if (novaDriver.beliefEngine) {
          novaDriver.beliefEngine.physicalStates.clear();
          novaDriver.beliefEngine.beliefs.clear();
          novaDriver.beliefEngine.latestTubes = [];
          novaDriver.beliefEngine.latestOpponents = [];
        }
        if (tp) {
          tp.currentTopology = 'FREE_AIR';
          tp.phase = RACECRAFT_PHASE.FREE;
          tp.targetId = null;
          tp.episodeId = 0;
          tp.selectedSide = 0;
          tp.commitmentTime = 0;
          tp.targetQ = 0;
          tp.targetSpeedCap = Infinity;
          tp.lastAttackId = null;
          tp.abortUntil = -Infinity;
          tp.attackCooldownUntil = -Infinity;
          tp.lastSpeedCapReason = null;
        }
      }
    },
    {
      name: 'Experiment D (Fresh Tyres Only at Lap 3 boundary: 85C, 2.15 bar, 0 wear)',
      fn: ({ novaCar }) => {
        novaCar.wheels.forEach(w => {
          w.tyre.core = 85;
          w.tyre.surface = 85;
          w.tyre.pressure = 2.15;
          w.tyre.wear = 0;
        });
      }
    },
    {
      name: 'Experiment E (Disable Offline Speed Derating Only at Lap 3 boundary)',
      fn: ({ cc }) => {
        if (cc) {
          cc.disableOfflineDerating = true;
        }
      }
    }
  ];

  const results = [];
  for (const b of branches) {
    process.stdout.write(`Running ${b.name}... `);
    const t0 = Date.now();
    const res = await runCounterfactual(b.name, b.fn);
    const elapsedMs = Date.now() - t0;
    console.log(`Lap 4: ${res.lap4.toFixed(3)}s (${(elapsedMs/1000).toFixed(1)}s wall)`);
    results.push(res);
  }

  console.log('\n================================================================================');
  console.log('COUNTERFACTUAL RESULTS SUMMARY');
  console.log('================================================================================');
  console.log('Experiment                                    | Lap 1   | Lap 2   | Lap 3   | Lap 4   | Total');
  console.log('----------------------------------------------|---------|---------|---------|---------|--------');
  results.forEach(r => {
    console.log(`${r.branch.padEnd(46)} | ${r.lap1.toFixed(3)} | ${r.lap2.toFixed(3)} | ${r.lap3.toFixed(3)} | ${r.lap4.toFixed(3)} | ${r.total.toFixed(3)}`);
  });

  const baseL4 = results[0].lap4;
  const idealL4 = 75.05; // Solo baseline
  const deltaTotal = Math.max(0.1, baseL4 - idealL4); // ~8.5s collapse

  console.log('\n--- ROOT CAUSE DECOMPOSITION ---');
  results.slice(1).forEach(r => {
    const recovery = baseL4 - r.lap4;
    const pct = Math.max(0, (recovery / deltaTotal) * 100);
    console.log(`  ${r.branch.padEnd(46)}: Recovery = ${recovery >= 0 ? '+' : ''}${recovery.toFixed(3)}s (${pct.toFixed(1)}% of total collapse)`);
  });
}

main().catch(console.error);
