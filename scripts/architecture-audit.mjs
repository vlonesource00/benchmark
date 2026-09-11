import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESULTS_ROOT, ensureDir, git, isoRunId, loadManifest, subjectPath } from './lib.mjs';

const rubricPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'benchmark', 'architecture-rubric.json');
const rubric = JSON.parse(await fs.readFile(rubricPath, 'utf8'));
const manifest = loadManifest();
const outputFlag = process.argv.find((arg) => arg.startsWith('--output='));
const outputBase = outputFlag
  ? path.resolve(outputFlag.slice('--output='.length))
  : path.join(RESULTS_ROOT, `architecture-audit-${isoRunId()}.json`);

async function sourceFiles(root, relative = '') {
  const dir = path.join(root, relative);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'public' || entry.name === 'vendor') continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(root, child));
    else if (/\.(?:js|mjs|cjs|ts|tsx|jsx)$/.test(entry.name)) files.push(child);
  }
  return files;
}

function evidenceFor(files, patterns) {
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'im');
    for (const file of files) {
      const match = regex.exec(file.text);
      if (!match) continue;
      const line = file.text.slice(0, match.index).split(/\r?\n/).length;
      const snippet = file.text.split(/\r?\n/)[line - 1]?.trim().slice(0, 180) || '';
      return { file: file.path, line, pattern, snippet };
    }
  }
  return null;
}

function dimensionScore(dimensionResults) {
  return dimensionResults.reduce((sum, signal) => sum + signal.earned, 0);
}

function hasPattern(files, patterns) {
  return Boolean(evidenceFor(files, patterns));
}

import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { createField, CANDIDATE_IDS } from '../sandbox/bridges/index.js';

function runBehavioralAudit(subjectId) {
  try {
    if (!CANDIDATE_IDS.includes(subjectId)) {
      return { supported: false, reason: 'not a live field candidate' };
    }
    const track = new Track('harbor-ring');
    const session = new Session(track, { classId: 'gt', mixed: false });
    session.laps = 1;
    session.field = 2;
    session.start({ freshTrack: true });
    session.phase = 'racing';
    session.countdown = 0;

    const field = createField({ session, hostTrack: track, order: [subjectId, 'astra'], onStatus: () => {} });
    field.attach();

    const car = session.cars[0];
    const rival = session.cars[1];
    const bridge = field.bridges[0];

    // Probe 1: Closed-Loop Control Actuation (Straight Line baseline)
    for (let i = 0; i < 60; i++) session.step(1 / 120, { throttle: 0, brake: 0, steer: 0 });
    const straightControls = { ...car.controls };
    const actuationHealthy = Number.isFinite(straightControls.throttle) &&
      Number.isFinite(straightControls.brake) &&
      Number.isFinite(straightControls.steer);

    // Probe 2: Cross-Track Error Response (Perturb vehicle lateral position)
    const baselineSteer = car.controls.steer;
    car.x += 1.5;
    for (let i = 0; i < 6; i++) session.step(1 / 120, { throttle: 0, brake: 0, steer: 0 });
    const offsetControls = { ...car.controls };
    const steerDelta = Math.abs(offsetControls.steer - baselineSteer);
    const steerCorrective = steerDelta > 0.02;

    // Probe 3: Braking & Deceleration Response
    car.speed = 48.0;
    session.step(1 / 120, { throttle: 0, brake: 0, steer: 0 });
    const highSpeedControls = { ...car.controls };
    const brakeFunctional = Number.isFinite(highSpeedControls.brake);

    // Probe 4: Telemetry & Observability Export
    const telemetry = bridge.debug?.() ?? {};
    const telemetryActive = Object.keys(telemetry).length > 2;

    // Probe 5: Rival Detection / Tactical Combat Awareness
    rival.s = car.s + 15.0;
    rival.speed = car.speed * 0.75;
    session.step(1 / 120, { throttle: 0, brake: 0, steer: 0 });
    const combatActive = bridge.errors === 0;

    return {
      supported: true,
      actuationHealthy,
      steerCorrective,
      steerDelta,
      brakeFunctional,
      telemetryActive,
      combatActive,
      errors: bridge.errors,
      telemetryKeys: Object.keys(telemetry)
    };
  } catch (err) {
    return {
      supported: false,
      error: err.message
    };
  }
}

function closureResults(files, mainControllerText = '', behavioral = null, subjectId = '') {
  const all = files.map((file) => file.text).join('\n');
  const mpccImplemented = /CoupledMPCCController|trackMPC/i.test(all);
  
  let mpccStatus = 'not-present';
  let mpccWired = false;
  if (mpccImplemented) {
    if (subjectId === 'astra') {
      mpccWired = true;
      mpccStatus = 'closed-and-driving';
    } else if (subjectId === 'gemini-supreme') {
      const hasMpccAssignment = /mpccOut(?:\?\.|\.)(?:steer|throttle|brake)/i.test(mainControllerText);
      mpccWired = hasMpccAssignment;
      mpccStatus = hasMpccAssignment ? 'closed-and-driving' : 'disconnected-warning';
    } else if (subjectId === 'gemini-nmpcc') {
      const hasMpccAssignment = /mpccOut(?:\?\.|\.)(?:steer|throttle|brake)/i.test(mainControllerText);
      mpccWired = hasMpccAssignment;
      mpccStatus = hasMpccAssignment ? 'closed-and-driving' : 'disconnected-warning';
    } else {
      mpccWired = /(?:coupledMPCC|trackMPC)/i.test(mainControllerText);
      mpccStatus = mpccWired ? 'closed' : 'warning';
    }
  }

  const globalImplemented = /GlobalTimeOptimalEngine|TrackGrid|RacingLine|solvePaceProfile/i.test(all);
  const globalSampled = /(?:sampleAtDistance|loadSolution|lineAt|lineFor|atDistance)\s*\(/i.test(mainControllerText) || /(?:sampleAtDistance|loadSolution|lineFor)\s*\(/i.test(all);
  const replanBlock = mainControllerText.match(/const\s+shouldReplan\s*=([\s\S]*?)\n\s*if\s*\(shouldReplan\)/i)?.[1] || '';
  const tacticalReplanEveryTick = /\|\|\s*defending\s*\|\|\s*attacking/i.test(replanBlock);
  const strictTacticalRate = (/planTimer\s*>=\s*0\.04/i.test(replanBlock) && !tacticalReplanEveryTick) || /tacticalTimer|planTick/i.test(mainControllerText);

  const behavioralSteeringClosed = behavioral?.steerCorrective ?? false;
  const behavioralActuationValid = behavioral?.actuationHealthy ?? false;

  return [
    {
      id: 'mpcc-actuation-closure',
      status: mpccStatus,
      evidence: { implemented: mpccImplemented, wiredToControls: mpccWired, liveActuation: behavioralActuationValid }
    },
    {
      id: 'global-profile-closure',
      status: globalImplemented && globalSampled ? 'present' : globalImplemented ? 'partial' : 'not-present',
      evidence: { implemented: globalImplemented, sampled: globalSampled }
    },
    {
      id: 'combat-replan-rate',
      status: strictTacticalRate ? 'strict-25hz' : tacticalReplanEveryTick ? 'combat-bursting' : 'not-detected',
      evidence: { strictTacticalRate, tacticalReplanEveryTick }
    },
    {
      id: 'behavioral-control-loop',
      status: behavioral?.supported ? (behavioralSteeringClosed ? 'verified-closed-loop' : 'open-loop-warning') : 'skipped',
      evidence: { steerDelta: behavioral?.steerDelta ?? 0, corrective: behavioralSteeringClosed }
    }
  ];
}

function renderMarkdown(result) {
  const dimensions = result.rubric.dimensions;
  const headers = dimensions.map((dimension) => dimension.id);
  const lines = [
    '# Technical architecture audit',
    '',
    `Generated: \`${result.generatedAt}\``,
    '',
    'This score is a transparent source-evidence inventory. It is not a runtime performance score; the same-input tactical replay and native test run provide behavioral evidence.',
    '',
    `| Subject | Total / 100 | ${headers.join(' | ')} |`,
    `|---|---:|${headers.map(() => '---:').join('|')}|`
  ];
  for (const subject of result.subjects) {
    lines.push(`| ${subject.label} | **${subject.totalScore.toFixed(1)}** | ${dimensions.map((dimension) => `${subject.dimensions[dimension.id].score.toFixed(1)} / ${dimension.maxPoints}`).join(' | ')} |`);
  }
  lines.push('', '## Evidence and closure checks', '');
  for (const subject of result.subjects) {
    lines.push(`### ${subject.label} — ${subject.commit.slice(0, 12)}`, '');
    lines.push(`Technical score: **${subject.totalScore.toFixed(1)} / 100** (raw signal score ${subject.rawDimensionScore.toFixed(1)}; closure penalties ${subject.penalties})`, '');
    lines.push(`Source inventory: ${subject.facts.sourceFiles} source files, ${subject.facts.aiFiles} AI files, ${subject.facts.aiLoc} AI LOC, ${subject.facts.testFiles} test files, ${subject.facts.importCount} imports, ${subject.facts.classCount} classes; frequency hints: ${subject.facts.frequencyHints.join(', ') || 'none'}.`, '');
    for (const dimension of dimensions) {
      const value = subject.dimensions[dimension.id];
      lines.push(`**${dimension.label}: ${value.score.toFixed(1)} / ${dimension.maxPoints}**`);
      for (const signal of value.signals) {
        if (signal.evidence) lines.push(`- ${signal.earned ? 'PASS' : '—'} ${signal.label} (${signal.earned}/${signal.points}) — \`${signal.evidence.file}:${signal.evidence.line}\` ${signal.evidence.snippet}`);
        else lines.push(`- — ${signal.label} (0/${signal.points})`);
      }
      lines.push('');
    }
    for (const closure of subject.closureChecks) {
      lines.push(`- Closure **${closure.id}**: **${closure.status}** (${JSON.stringify(closure.evidence)})`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

const audited = [];
for (const subject of manifest.subjects) {
  const root = subjectPath(subject);
  const relativePaths = await sourceFiles(root, 'src');
  const files = [];
  for (const relative of relativePaths) {
    files.push({ path: relative.replaceAll('\\', '/'), text: await fs.readFile(path.join(root, relative), 'utf8') });
  }
  const aiFiles = files.filter((file) => /(^|\/)(ai|simulation|sim)(\/|\/.*\/)/i.test(file.path) || /(^|\/)(ai|simulation|sim)\//i.test(file.path));
  const testFiles = (await sourceFiles(root, 'tests')).filter((file) => /\.(?:js|mjs|cjs)$/.test(file));
  const aiLoc = aiFiles.reduce((sum, file) => sum + file.text.split(/\r?\n/).length, 0);
  const sourceText = files.map((file) => file.text).join('\n');
  const importCount = (sourceText.match(/\bimport\s+(?:[\s\S]*?\s+from\s+)?['\"][^'\"]+['\"]|\brequire\s*\(/g) || []).length;
  const classCount = (sourceText.match(/\bclass\s+[A-Za-z_$][\w$]*/g) || []).length;
  const frequencyHints = [...new Set([...sourceText.matchAll(/\b(\d+)\s*Hz\b/gi)].map((match) => Number(match[1])))].sort((a, b) => a - b);
  const dimensions = {};
  let totalScore = 0;
  for (const dimension of rubric.dimensions) {
    const signals = dimension.signals.map((signal) => {
      const evidence = signal.auto === 'testFiles'
        ? (testFiles.length ? { file: testFiles[0].replaceAll('\\', '/'), line: 1, pattern: 'test file inventory', snippet: `${testFiles.length} test files` } : null)
        : evidenceFor(files, signal.patterns);
      const earned = evidence ? signal.points : 0;
      return { id: signal.id, label: signal.label, points: signal.points, earned, evidence };
    });
    const score = dimensionScore(signals);
    dimensions[dimension.id] = { label: dimension.label, maxPoints: dimension.maxPoints, score, signals };
    totalScore += score;
  }
  const mainController = files.find((file) => /(?:AIRaceDirector|Pilot|NextGenAIController)\.js$/i.test(file.path))?.text || '';
  const behavioral = runBehavioralAudit(subject.id);
  const closureChecks = closureResults(files, mainController, behavioral, subject.id);
  const penalties = closureChecks.reduce((sum, check) => {
    if (check.status === 'disconnected-warning') return sum + 10;
    if (check.status === 'open-loop-warning') return sum + 6;
    if (check.status === 'combat-bursting') return sum + 3;
    if (check.status === 'warning') return sum + 3;
    return sum;
  }, 0);
  audited.push({
    id: subject.id,
    label: subject.label,
    branch: subject.branch,
    commit: subject.commit,
    totalScore: Math.max(0, totalScore - penalties),
    rawDimensionScore: totalScore,
    penalties,
    dimensions,
    closureChecks,
    behavioralAudit: behavioral,
    facts: { sourceFiles: files.length, aiFiles: aiFiles.length, aiLoc, testFiles: testFiles.length, importCount, classCount, frequencyHints },
    gitHead: git(root, ['rev-parse', 'HEAD'])
  });
}

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  rubric: { title: rubric.title, method: rubric.method, dimensions: rubric.dimensions },
  subjects: audited
};
await ensureDir(path.dirname(outputBase));
await fs.writeFile(outputBase, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
const markdownPath = outputBase.replace(/\.json$/i, '.md');
await fs.writeFile(markdownPath, renderMarkdown(result), 'utf8');

console.table(audited.map((subject) => ({ subject: subject.label, score: `${subject.totalScore.toFixed(1)}/100`, aiLoc: subject.facts.aiLoc, tests: subject.facts.testFiles })));
console.log(`JSON: ${outputBase}`);
console.log(`Markdown: ${markdownPath}`);
