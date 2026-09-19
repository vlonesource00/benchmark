import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField, TRIAD_CANDIDATES } from '../sandbox/bridges/index.js';

// The 6 canonical grid permutations for the 3-car Triad
export const TRIAD_GRID_PERMUTATIONS = [
  ['nova', 'gemini-supreme', 'astra'],
  ['nova', 'astra', 'gemini-supreme'],
  ['gemini-supreme', 'nova', 'astra'],
  ['gemini-supreme', 'astra', 'nova'],
  ['astra', 'nova', 'gemini-supreme'],
  ['astra', 'gemini-supreme', 'nova']
];

export const TRIAD_SUBJECTS = {
  'nova': { id: 'nova', name: 'DeepSeek NOVA', label: 'NOVA' },
  'gemini-supreme': { id: 'gemini-supreme', name: 'Gemini Supreme V3.2', label: 'GEMINI' },
  'astra': { id: 'astra', name: 'Astra (Host Baseline)', label: 'ASTRA' }
};

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    laps: 3,
    rotations: 1, // 1 to 5 sets of the 6 permutations (default 1 = 6 heats)
    seed: 20260919,
    json: null,
    verbose: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--laps' && args[i + 1]) {
      options.laps = parseInt(args[++i], 10);
    } else if (arg.startsWith('--laps=')) {
      options.laps = parseInt(arg.slice(7), 10);
    } else if (arg === '--rotations' && args[i + 1]) {
      options.rotations = parseInt(args[++i], 10);
    } else if (arg.startsWith('--rotations=')) {
      options.rotations = parseInt(arg.slice(12), 10);
    } else if (arg === '--seed' && args[i + 1]) {
      options.seed = parseInt(args[++i], 10);
    } else if (arg.startsWith('--seed=')) {
      options.seed = parseInt(arg.slice(7), 10);
    } else if (arg === '--json' && args[i + 1]) {
      options.json = args[++i];
    } else if (arg.startsWith('--json=')) {
      options.json = arg.slice(7);
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    }
  }

  return options;
}

export function runTriadHeat({ grid, laps = 3, trackName = 'harbor-ring' }) {
  const track = new Track(trackName);
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
  field.attach(true);

  session.start({ freshTrack: true });
  // Skip the 4-second standing countdown to begin green-flag racing immediately
  session.phase = 'racing';
  session.countdown = 0;

  const DT = 1 / 120;
  const maxTime = laps * 100 + 40; // Max 100s per lap + buffer
  const maxSteps = Math.ceil(maxTime / DT);

  let steps = 0;
  let prevOrder = grid.slice();
  const passes = { 'nova': 0, 'gemini-supreme': 0, 'astra': 0 };
  const contactTracker = new Map(grid.map(id => [id, 0]));

  while (steps < maxSteps) {
    const prevContacts = session.contacts;
    if (session.phase === 'finished' && !session.activeCars.every((c) => c.race.finishTime !== null)) {
      session.phase = 'racing';
    }
    session.step(DT, { throttle: 0, brake: 0, steer: 0 });
    steps++;

    // Track contacts delta
    const deltaContacts = session.contacts - prevContacts;
    if (deltaContacts > 0) {
      for (const car of session.activeCars) {
        if (car.impact > 0.05) {
          const id = field.bridges[car.id]?.candidateId;
          if (id) contactTracker.set(id, contactTracker.get(id) + deltaContacts);
        }
      }
    }

    // Check overtakes
    const standings = session.standings();
    const currentOrder = standings.map(c => field.bridges[c.id]?.candidateId);
    for (let pos = 0; pos < currentOrder.length; pos++) {
      const id = currentOrder[pos];
      const prevPos = prevOrder.indexOf(id);
      if (prevPos > pos) {
        passes[id] = (passes[id] || 0) + (prevPos - pos);
      }
    }
    prevOrder = currentOrder;

    // Check if all 3 cars have finished
    const allFinished = session.activeCars.every(c => c.race.finishTime !== null);
    if (allFinished) break;
  }

  const finalStandings = session.standings();
  const results = finalStandings.map((car, pos) => {
    const bridge = field.bridges[car.id];
    const candId = bridge?.candidateId;
    return {
      position: pos + 1,
      id: candId,
      name: car.name,
      gridSlot: grid.indexOf(candId) + 1,
      finishTime: car.race.finishTime,
      bestLap: car.race.bestLap,
      lastLap: car.race.lastLap,
      completedLaps: car.race.lap - 1,
      offtrackSec: car.race.offtrack,
      contacts: contactTracker.get(candId) || 0,
      passes: passes[candId] || 0,
      valid: car.race.valid
    };
  });

  const winner = results[0];
  const leaderTime = winner.finishTime ?? 0;
  for (const res of results) {
    res.gap = res.finishTime !== null && leaderTime > 0 ? res.finishTime - leaderTime : null;
  }

  return {
    grid,
    laps,
    elapsedSimTime: session.time,
    totalContacts: session.contacts,
    winner: winner.id,
    results
  };
}

export function runTriadBenchmark(options) {
  const { laps, rotations, json, verbose } = options;
  console.log(`\n================================================================================`);
  console.log(`HARBOR TRIAD BENCHMARK — CANONICAL ASTRA HOST (120 Hz)`);
  console.log(`Subjects: Astra vs Gemini Supreme V3.2 vs DeepSeek NOVA`);
  console.log(`Format: ${rotations} rotation(s) × 6 canonical grid heats = ${rotations * 6} total heats (${laps} laps/heat)`);
  console.log(`================================================================================\n`);

  const heats = [];
  const stats = {
    'nova': { id: 'nova', label: 'NOVA', wins: 0, p2: 0, p3: 0, finishTimes: [], gaps: [], bestLaps: [], offtrackSec: 0, passes: 0, contacts: 0 },
    'gemini-supreme': { id: 'gemini-supreme', label: 'GEMINI', wins: 0, p2: 0, p3: 0, finishTimes: [], gaps: [], bestLaps: [], offtrackSec: 0, passes: 0, contacts: 0 },
    'astra': { id: 'astra', label: 'ASTRA', wins: 0, p2: 0, p3: 0, finishTimes: [], gaps: [], bestLaps: [], offtrackSec: 0, passes: 0, contacts: 0 }
  };

  let heatCount = 0;
  for (let rot = 0; rot < rotations; rot++) {
    for (let permIdx = 0; permIdx < TRIAD_GRID_PERMUTATIONS.length; permIdx++) {
      heatCount++;
      const grid = TRIAD_GRID_PERMUTATIONS[permIdx];
      const gridStr = grid.map(id => TRIAD_SUBJECTS[id]?.label || id).join(' / ');
      process.stdout.write(`Heat ${String(heatCount).padStart(2, '0')}/${rotations * 6} [${gridStr}] ... `);

      const heatResult = runTriadHeat({ grid, laps });
      heats.push({ heatIndex: heatCount, rotation: rot + 1, ...heatResult });

      const w = heatResult.winner;
      const wLabel = TRIAD_SUBJECTS[w]?.label || w;
      const wTime = heatResult.results[0]?.finishTime?.toFixed(2) ?? 'DNF';
      const gap2 = heatResult.results[1]?.gap?.toFixed(3) ?? '—';
      const gap3 = heatResult.results[2]?.gap?.toFixed(3) ?? '—';

      console.log(`P1: ${wLabel.padEnd(7)} (${wTime}s) | +${gap2}s | +${gap3}s`);

      for (const res of heatResult.results) {
        const s = stats[res.id];
        if (!s) continue;
        if (res.position === 1) s.wins++;
        else if (res.position === 2) s.p2++;
        else if (res.position === 3) s.p3++;

        if (res.finishTime !== null) s.finishTimes.push(res.finishTime);
        if (res.gap !== null) s.gaps.push(res.gap);
        if (res.bestLap !== null) s.bestLaps.push(res.bestLap);
        s.offtrackSec += res.offtrackSec;
        s.passes += res.passes;
        s.contacts += res.contacts;
      }
    }
  }

  // Compute aggregate averages
  console.log(`\n================================================================================`);
  console.log(`TRIAD BENCHMARK SUMMARY (${heatCount} HEATS)`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`| Driver         | Wins  | P2  | P3  | Win % | Mean Best Lap | Mean Gap (s) | Offtrack (s) | Passes |`);
  console.log(`--------------------------------------------------------------------------------`);

  const summary = {};
  for (const id of ['nova', 'gemini-supreme', 'astra']) {
    const s = stats[id];
    const winPct = ((s.wins / heatCount) * 100).toFixed(1);
    const meanBestLap = s.bestLaps.length ? (s.bestLaps.reduce((a, b) => a + b, 0) / s.bestLaps.length).toFixed(3) : '—';
    const meanGap = s.gaps.length ? (s.gaps.reduce((a, b) => a + b, 0) / s.gaps.length).toFixed(3) : '—';
    const offtrack = s.offtrackSec.toFixed(2);

    summary[id] = {
      label: s.label,
      wins: s.wins,
      p2: s.p2,
      p3: s.p3,
      winPct: Number(winPct),
      meanBestLap: Number(meanBestLap) || null,
      meanGap: Number(meanGap) || 0,
      totalOfftrackSec: s.offtrackSec,
      totalPasses: s.passes,
      totalContacts: s.contacts
    };

    console.log(
      `| ${TRIAD_SUBJECTS[id].name.padEnd(14)} | ${String(s.wins).padStart(5)} | ${String(s.p2).padStart(3)} | ${String(s.p3).padStart(3)} | ${winPct.padStart(5)}% | ${meanBestLap.padStart(13)} | ${meanGap.padStart(12)} | ${offtrack.padStart(12)} | ${String(s.passes).padStart(6)} |`
    );
  }
  console.log(`================================================================================\n`);

  const benchmarkPayload = {
    benchmark: 'harbor-triad',
    timestamp: new Date().toISOString(),
    config: { laps, rotations, totalHeats: heatCount },
    summary,
    heats
  };

  if (json) {
    const fullPath = resolve(json);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, JSON.stringify(benchmarkPayload, null, 2));
    console.log(`Saved benchmark report to ${fullPath}`);
  }

  return benchmarkPayload;
}

if (process.argv[1] && process.argv[1].endsWith('run-triad.mjs')) {
  const options = parseArgs();
  runTriadBenchmark(options);
}
