import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESULTS_ROOT, loadManifest } from './lib.mjs';

const manifest = loadManifest();

async function latestJson(prefix) {
  const entries = await fs.readdir(RESULTS_ROOT, { withFileTypes: true }).catch(() => []);
  const names = entries.filter((e) => e.isFile() && e.name.startsWith(prefix) && e.name.endsWith('.json'))
    .map((e) => e.name).sort().reverse();
  if (!names[0]) return null;
  return JSON.parse(await fs.readFile(path.join(RESULTS_ROOT, names[0]), 'utf8'));
}

const audit = await latestJson('architecture-audit-');
const tactical = await latestJson('tactical-replay-');

console.log('\n========================================================================================');
console.log('                 HARBOR RING · 4-ARCHITECTURE DEEP BENCHMARK REPORT');
console.log('========================================================================================\n');

console.log('1. EXECUTIVE ARCHITECTURAL SCORES (100-Point Rubric)');
console.log('----------------------------------------------------------------------------------------');
if (audit) {
  console.table(audit.subjects.map((s) => ({
    'Subject': s.label,
    'Total Score': `${s.totalScore}/100`,
    'Global Plan': `${s.dimensions['global-planning']?.score ?? 0}/15`,
    'Runtime Lattice': `${s.dimensions['runtime-planning']?.score ?? 0}/15`,
    'Racecraft': `${s.dimensions['racecraft-traffic']?.score ?? 0}/15`,
    'Vehicle Dynamics': `${s.dimensions['vehicle-dynamics']?.score ?? 0}/15`,
    'Safety Gates': `${s.dimensions['safety-recovery']?.score ?? 0}/10`
  })));
}

console.log('\n2. TACTICAL COMBAT REACTION MATRIX');
console.log('----------------------------------------------------------------------------------------');
if (tactical) {
  console.table(tactical.subjects.map((s) => {
    const correctCount = s.scenarios.filter((sc) => sc.decisionCorrect).length;
    const detCount = s.scenarios.filter((sc) => sc.deterministic).length;
    return {
      'Subject': s.label,
      'Slow Car Ahead': s.scenarios.find((sc) => sc.scenarioId === 'slow-car-ahead')?.phase ?? '—',
      'Corner Attack': s.scenarios.find((sc) => sc.scenarioId === 'corner-attack')?.phase ?? '—',
      'Defending Threat': s.scenarios.find((sc) => sc.scenarioId === 'defending-threat')?.phase ?? '—',
      'Side-by-Side': s.scenarios.find((sc) => sc.scenarioId === 'side-by-side')?.phase ?? '—',
      'Tactical Accuracy': `${Math.round((correctCount / s.scenarios.length) * 100)}%`,
      'Determinism': `${Math.round((detCount / s.scenarios.length) * 100)}%`
    };
  }));
}

console.log('\n3. ARCHITECTURAL STRENGTHS & CONTROL HIGHLIGHTS');
console.log('----------------------------------------------------------------------------------------');
const PROFILES = [
  {
    name: 'GPT Racing',
    engine: 'AIRaceDirector -> RacecraftAgent -> TrajectoryPlanner -> VehicleController',
    keyFeatures: [
      'Central whole-field traffic arbitration (prevents conflicting moves)',
      'Tight physical vehicle integration with instant countersteering',
      'Defensive APEX_SHIELD and dynamic SWITCHBACK overtaking maneuvers',
      'Dynamic trail braking and road-legality friction limiters'
    ]
  },
  {
    name: 'Cloud Racing',
    engine: 'Pilot -> Racecraft -> Lattice -> TrackGrid Value Function -> Driver',
    keyFeatures: [
      'Offline global dynamic programming TrackGrid value function',
      'Multi-rate planning budget scheduler (smooth frame rate stability)',
      'Tow / slipstream drafting and slingshot overtaking tactics',
      'Curvature-bounded smoothed Frenet corridor search'
    ]
  },
  {
    name: 'Gemini Gauntlet (NMPCC)',
    engine: 'NextGenAIController -> 3D DP Solver -> Game Theoretic Combat -> Coupled MPCC',
    keyFeatures: [
      '3D global time-optimal dynamic programming trajectory solver',
      'Stackelberg leader-follower game theoretic combat reasoning',
      '400 Hz Coupled MPCC tracking friction circle envelope',
      'High-aggression late divebombing and contact-tolerant rubbing model'
    ]
  },
  {
    name: 'Gemini Gauntlet (Grand Prix)',
    engine: 'NextGenAIController -> 25Hz Frenet Lattice -> Counterfactual Defender -> GP Controller',
    keyFeatures: [
      'Strict 25 Hz rate-limited Frenet lattice candidate replanning',
      'Counterfactual defender prediction model before committing to overtakes',
      'Along-path friction-circle velocity propagation envelope',
      'Committed SIDE_BY_SIDE spatial corridor locking'
    ]
  }
];

PROFILES.forEach((p, idx) => {
  console.log(`[#${idx + 1}] ${p.name}`);
  console.log(`    Stack: ${p.engine}`);
  p.keyFeatures.forEach((feat) => console.log(`    * ${feat}`));
  console.log('');
});

console.log('========================================================================================');
console.log('Live Interactive Sandbox: Run "npm run sandbox" and open http://127.0.0.1:4174');
console.log('========================================================================================\n');
