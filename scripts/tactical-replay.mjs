import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RESULTS_ROOT, ensureDir, isoRunId, loadManifest, subjectPath } from './lib.mjs';
import { astraAdapter } from './astra-tactical-adapter.mjs';

const manifest = loadManifest();
const scenarioPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'benchmark', 'tactical-scenarios.json');
const outputFlag = process.argv.find((arg) => arg.startsWith('--output='));
const outputBase = outputFlag
  ? path.resolve(outputFlag.slice('--output='.length))
  : path.join(RESULTS_ROOT, `tactical-replay-${isoRunId()}.json`);

// These are deliberately abstract state cards, not a second physics engine.
// Every architecture receives the same normalized traffic situation; each
// adapter invokes its tactical decision layer and returns a normalized intent.
const scenarioConfig = JSON.parse(await fs.readFile(scenarioPath, 'utf8'));
const SCENARIOS = scenarioConfig.scenarios;

function trackFor(scenario) {
  return {
    length: 1000,
    roadHalfWidth: 8.2,
    curbWidth: 1.25,
    planningLateralLimit: () => 6.0,
    atDistance: (s) => ({
      s,
      curvature: scenario.corner && s >= 106 ? 0.006 : 0.001,
      turnSign: 1
    })
  };
}

function normalizedOpponents(scenario, egoSpeed = scenario.ego.speed) {
  return scenario.opponents.map((opponent) => ({
    id: opponent.id,
    delta: opponent.delta,
    lateral: opponent.lateral,
    lateralDelta: opponent.lateral - scenario.ego.lateral,
    speed: opponent.speed,
    forwardSpeed: opponent.speed,
    otherForwardSpeed: opponent.speed,
    otherLateral: opponent.lateral,
    closingSpeed: egoSpeed - opponent.speed,
    ttc: egoSpeed > opponent.speed && opponent.delta > 0
      ? opponent.delta / Math.max(0.1, egoSpeed - opponent.speed)
      : 99,
    overlapLongitudinal: Math.abs(opponent.delta) < 4.5,
    other: {
      id: opponent.id,
      player: false,
      speed: opponent.speed,
      forwardSpeed: opponent.speed,
      lateral: opponent.lateral,
      lateralSpeed: 0,
      halfWidth: 1.0,
      halfLength: 2.3,
      classKey: 'gt',
      raceProgress: opponent.delta,
      surface: { lateral: opponent.lateral },
      finished: false,
      despawned: false,
      trafficGhost: false
    }
  }));
}

function gptAdapter(subjectRoot, scenario) {
  return import(pathToFileURL(path.join(subjectRoot, 'src/ai/RacecraftAgent.js')).href).then(({ RacecraftAgent }) => {
    const track = trackFor(scenario);
    const ego = {
      id: 'ego', vehicle: { classKey: 'gt' }, distance: 100, lateral: scenario.ego.lateral,
      halfWidth: 1.0, halfLength: 2.3, forwardSpeed: scenario.ego.speed, speed: scenario.ego.speed,
      zone: 'road', headingError: 0, finished: false, despawned: false, pitIntent: null,
      raceProgress: 100
    };
    const entries = normalizedOpponents(scenario);
    const snapshot = {
      phase: 'racing', raceTime: 10, track,
      ego: () => ego,
      trafficFor: () => entries
    };
    const trackModel = {
      lineAt: () => 0,
      speedAt: () => 40,
      cornerAhead: () => scenario.corner ? { distanceM: 30, turnSign: 1 } : { distanceM: 200, turnSign: 1 }
    };
    const agent = new RacecraftAgent('ego');
    const intents = agent.tacticalIntents(snapshot, trackModel);
    const intent = intents[0] || { mode: 'NONE', phase: 'NONE' };
    return {
      decision: intent.mode === 'PASS' ? 'ATTACK' : intent.mode,
      phase: intent.phase,
      targetLateral: Number.isFinite(intent.terminalLateral) ? intent.terminalLateral : null,
      committed: Boolean(intent.committed),
      reason: intent.reason,
      candidateCount: intents.length
    };
  });
}

function claudeCircuit() {
  const nodeCount = 100;
  const ds = 10;
  const corners = [{ startNode: 8, apexNode: 13, endNode: 18, sign: 1 }];
  return {
    nodeCount,
    ds,
    corners,
    straightAhead: new Array(nodeCount).fill(120),
    deltaS: (a, b) => {
      const raw = (a - b + nodeCount * ds * 0.5) % (nodeCount * ds);
      return raw > nodeCount * ds * 0.5 ? raw - nodeCount * ds : raw;
    }
  };
}

function claudeAdapter(subjectRoot, scenario) {
  return import(pathToFileURL(path.join(subjectRoot, 'src/ai/Racecraft.js')).href).then(({ Racecraft }) => {
    const circuit = claudeCircuit();
    const grid = { reach: new Array(circuit.nodeCount).fill(6), nodeOf: (s) => Math.floor(s / circuit.ds) % circuit.nodeCount };
    const car = {
      node: 10, s: 100, q: scenario.ego.lateral, speed: scenario.ego.speed,
      offTrack: 0, spinTimer: 0, slipstream: 0.2, dirtyAir: 0, classKey: 'gt'
    };
    const opponents = normalizedOpponents(scenario);
    const ahead = opponents.find((entry) => entry.delta > 0);
    const behind = opponents.find((entry) => entry.delta < 0);
    const view = {
      ahead: ahead ? { id: ahead.id, q: ahead.lateral, speed: ahead.speed } : null,
      behind: behind ? { id: behind.id, q: behind.lateral, speed: behind.speed } : null,
      gapAhead: ahead?.delta ?? Infinity,
      gapBehind: behind ? Math.abs(behind.delta) : Infinity
    };
    const racecraft = new Racecraft(circuit, grid, { aggression: 0.75, skill: 1.0 });
    const tactics = racecraft.update(car, view, 20, circuit.ds);
    const attackModes = new Set(['ATTACK', 'DIVE', 'CUTBACK', 'TOW']);
    const defenseModes = new Set(['DEFEND', 'SHIELD', 'SQUEEZE']);
    const decision = attackModes.has(racecraft.mode) ? 'ATTACK'
      : defenseModes.has(racecraft.mode) ? 'DEFEND'
        : racecraft.mode;
    return {
      decision,
      phase: racecraft.mode,
      targetLateral: Number.isFinite(tactics.holdQ) ? tactics.holdQ : null,
      requestedSide: tactics.side,
      committed: Boolean(tactics.holdQ !== null || tactics.side !== 0),
      reason: racecraft.reason
    };
  });
}

function geminiAdapter(subjectRoot, scenario) {
  return import(pathToFileURL(path.join(subjectRoot, 'src/ai/v2/GameTheoreticCombatEngine.js')).href).then(({ GameTheoreticCombatEngine }) => {
    const track = trackFor(scenario);
    const vehicle = {
      id: 'ego', speed: scenario.ego.speed, distance: 100,
      surface: { lateral: scenario.ego.lateral }, finished: false, despawned: false
    };
    const entries = normalizedOpponents(scenario);
    const traffic = { entries, egoForwardSpeed: scenario.ego.speed };
    const optimalProfile = { sampleAtDistance: () => ({ lateral: 0, lineLateral: 0, targetSpeed: 40, curvature: 0.001 }) };
    const engine = new GameTheoreticCombatEngine();
    const result = engine.evaluate({ vehicle, track, traffic, optimalProfile, aggression: 0.85, dt: 1 / 120 });
    return {
      decision: result.role,
      phase: result.role === 'ATTACK' ? result.attackMode : result.role === 'DEFEND' ? result.defenseMode : 'PACE',
      targetLateral: Number.isFinite(result.targetLateral) ? result.targetLateral : null,
      committed: result.role !== 'PACE',
      reason: result.notes,
      threatScore: result.threatScore,
      attackIntensity: result.attackIntensity
    };
  });
}

const ADAPTERS = [
  { id: 'gpt-racing', run: gptAdapter },
  { id: 'claude-racing', run: claudeAdapter },
  { id: 'gemini-nmpcc', run: geminiAdapter },
  { id: 'gemini-grand-prix', run: geminiAdapter },
  { id: 'astra', run: astraAdapter }
];

function stable(a, b) {
  const lateralStable = (a.targetLateral == null && b.targetLateral == null)
    || (Number.isFinite(a.targetLateral) && Number.isFinite(b.targetLateral) && Math.abs(a.targetLateral - b.targetLateral) < 0.01);
  return a.decision === b.decision && a.phase === b.phase && lateralStable;
}

const subjectsById = new Map(manifest.subjects.map((subject) => [subject.id, subject]));
const results = [];
const selected=process.argv.find(a=>a.startsWith('--subject='))?.slice(10);
if(selected&&!ADAPTERS.some(a=>a.id===selected))throw new Error(`Unknown subject: ${selected}`);
for (const adapter of ADAPTERS.filter(a=>!selected||a.id===selected)) {
  const subject = subjectsById.get(adapter.id);
  const root = subjectPath(subject);
  const subjectResults = [];
  for (const scenario of SCENARIOS) {
    try {
      const first = await adapter.run(root, scenario);
      const second = await adapter.run(root, scenario);
      const targetSafe = first.targetLateral == null || Math.abs(first.targetLateral) <= 6.0;
      subjectResults.push({
        scenarioId: scenario.id,
        expected: scenario.expected,
        decision: first.decision,
        phase: first.phase,
        targetLateral: first.targetLateral,
        committed: first.committed,
        reason: first.reason,
        targetSafe,
        decisionCorrect: first.decision === scenario.expected,
        deterministic: stable(first, second),
        raw: first
      });
    } catch (error) {
      subjectResults.push({ scenarioId: scenario.id, expected: scenario.expected, error: error.message, decisionCorrect: false, deterministic: false });
    }
  }
  const valid = subjectResults.filter((result) => !result.error);
  results.push({
    id: subject.id,
    label: subject.label,
    branch: subject.branch,
    commit: subject.commit,
    scenarios: subjectResults,
    summary: {
      decisionAccuracy: valid.length ? valid.filter((result) => result.decisionCorrect).length / valid.length : 0,
      deterministicRate: valid.length ? valid.filter((result) => result.deterministic).length / valid.length : 0,
      safeTargetRate: valid.length ? valid.filter((result) => result.targetSafe).length / valid.length : 0,
      nonPacePhases: [...new Set(valid.map((result) => result.phase).filter((phase) => phase && phase !== 'PACE'))],
      errors: subjectResults.filter((result) => result.error).length
    }
  });
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  protocol: 'same normalized tactical inputs; native tactical decision layers; no shared physics integration',
  scenarios: SCENARIOS,
  subjects: results
};
await ensureDir(path.dirname(outputBase));
await fs.writeFile(outputBase, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
const markdownPath = outputBase.replace(/\.json$/i, '.md');
const lines = [
  '# Same-input tactical replay',
  '',
  `Generated: \`${output.generatedAt}\``,
  '',
  'All subjects received the same normalized tactical state cards. This compares intent selection and safety/determinism at the tactical layer; it is intentionally separate from each project’s native physics benchmark.',
  '',
  '| Subject | Decision accuracy | Deterministic | Safe target | Non-pace phases | Errors |',
  '|---|---:|---:|---:|---|---:|'
];
for (const subject of results) {
  lines.push(`| ${subject.label} | ${(subject.summary.decisionAccuracy * 100).toFixed(0)}% | ${(subject.summary.deterministicRate * 100).toFixed(0)}% | ${(subject.summary.safeTargetRate * 100).toFixed(0)}% | ${subject.summary.nonPacePhases.join(', ') || '—'} | ${subject.summary.errors} |`);
}
lines.push('', '## Scenario decisions', '');
for (const subject of results) {
  lines.push(`### ${subject.label}`, '', '| Scenario | Expected | Decision | Phase | Correct | Deterministic | Reason |', '|---|---|---|---|---:|---:|---|');
  for (const result of subject.scenarios) {
    lines.push(`| ${result.scenarioId} | ${result.expected} | ${result.error ? 'ERROR' : result.decision} | ${result.phase || '—'} | ${result.decisionCorrect ? 'yes' : 'no'} | ${result.deterministic ? 'yes' : 'no'} | ${(result.error || result.reason || '—').replaceAll('|', '\\|')} |`);
  }
  lines.push('');
}
await fs.writeFile(markdownPath, `${lines.join('\n')}\n`, 'utf8');
console.table(results.map((subject) => ({ subject: subject.label, decision: `${(subject.summary.decisionAccuracy * 100).toFixed(0)}%`, deterministic: `${(subject.summary.deterministicRate * 100).toFixed(0)}%`, errors: subject.summary.errors })));
console.log(`JSON: ${outputBase}`);
console.log(`Markdown: ${markdownPath}`);
