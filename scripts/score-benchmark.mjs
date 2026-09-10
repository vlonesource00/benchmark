import fs from 'node:fs/promises';
import path from 'node:path';
import { RESULTS_ROOT, loadManifest } from './lib.mjs';

const argv = process.argv.slice(2);
function flagValue(name) {
  const equals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function latestFile(prefix) {
  const entries = await fs.readdir(RESULTS_ROOT, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.json'))
    .map((entry) => entry.name).sort().reverse();
  if (!names[0]) throw new Error(`No ${prefix} artifact found in ${RESULTS_ROOT}`);
  return path.join(RESULTS_ROOT, names[0]);
}

async function latestRunJson() {
  const entries = await fs.readdir(RESULTS_ROOT, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
  for (const name of names) {
    const file = path.join(RESULTS_ROOT, name, 'run.json');
    if (await fs.stat(file).catch(() => null)) return file;
  }
  throw new Error(`No native run artifact found in ${RESULTS_ROOT}`);
}

async function resolveJson(value, fallbackPrefix) {
  if (!value) return JSON.parse(await fs.readFile(await latestFile(fallbackPrefix), 'utf8'));
  const resolved = path.resolve(value);
  const stat = await fs.stat(resolved);
  return JSON.parse(await fs.readFile(stat.isDirectory() ? path.join(resolved, 'run.json') : resolved, 'utf8'));
}

const runFlag = flagValue('--run');
const run = runFlag ? await resolveJson(runFlag, '') : JSON.parse(await fs.readFile(await latestRunJson(), 'utf8'));
const audit = await resolveJson(flagValue('--audit'), 'architecture-audit-');
const tactical = await resolveJson(flagValue('--tactical'), 'tactical-replay-');
const outputFlag = flagValue('--output');
const outputBase = outputFlag
  ? path.resolve(outputFlag)
  : path.join(RESULTS_ROOT, `full-comparison-${run.runId}.json`);

const manifest = loadManifest();
const auditById = new Map(audit.subjects.map((subject) => [subject.id, subject]));
const tacticalById = new Map(tactical.subjects.map((subject) => [subject.id, subject]));
const recordsById = new Map();
for (const record of run.records) {
  if (!recordsById.has(record.subjectId)) recordsById.set(record.subjectId, []);
  recordsById.get(record.subjectId).push(record);
}

const nativeScenarioIds = ['solo-pace', 'stability', 'pack-race', 'collision-safety', 'endurance', 'obstacle-bypass', 'slower-pass', 'defense', 'planner-budget', 'track-complexity', 'wake-awareness', 'generation-head-to-head', 'tactical-combat'];
const subjects = manifest.subjects.map((subject) => {
  const records = recordsById.get(subject.id) || [];
  const passed = records.filter((record) => record.passed).length;
  const tacticalResult = tacticalById.get(subject.id);
  const auditResult = auditById.get(subject.id);
  const nativeScenarios = Object.fromEntries(nativeScenarioIds.map((scenarioId) => {
    const mapped = records.filter((record) => record.scenarioIds?.includes(scenarioId));
    return [scenarioId, {
      tests: mapped.map((record) => ({ testId: record.testId, passed: record.passed, metrics: record.metrics })),
      status: mapped.length === 0 ? 'not-mapped' : mapped.every((record) => record.passed) ? 'pass' : 'fail'
    }];
  }));
  return {
    id: subject.id,
    label: subject.label,
    branch: subject.branch,
    commit: subject.commit,
    technicalScore: auditResult?.totalScore ?? null,
    technicalRawScore: auditResult?.rawDimensionScore ?? null,
    technicalPenalties: auditResult?.penalties ?? null,
    dimensions: auditResult?.dimensions ?? {},
    closureChecks: auditResult?.closureChecks ?? [],
    native: {
      tests: records.length,
      passed,
      failed: records.length - passed,
      passRate: records.length ? passed / records.length : 0,
      scenarios: nativeScenarios
    },
    tactical: tacticalResult?.summary ?? null,
    tacticalScenarios: tacticalResult?.scenarios ?? []
  };
});

const comparison = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runId: run.runId,
  suite: run.suite,
  protocol: {
    technical: 'Static source-evidence rubric against the pinned checkout; closure warnings are reported separately.',
    tactical: tactical.protocol,
    native: 'Each architecture’s own physics/test harness, with semantic scenario mappings.'
  },
  subjects
};

function compact(value) {
  return value == null ? '—' : String(value).replaceAll('|', '\\|');
}

const lines = [
  '# Full racing architecture comparison',
  '',
  `Run: \`${run.runId}\`  `,
  `Suite: **${run.suite}**`,
  '',
  'This report separates three kinds of evidence: technical source architecture, same-input tactical decisions, and native simulation outcomes. It does not pretend that incompatible physics engines produce directly comparable lap seconds.',
  '',
  '## Executive comparison',
  '',
  '| Subject | Technical evidence | Tactical decision accuracy | Tactical determinism | Non-pace phases | Native tests | Closure warnings |',
  '|---|---:|---:|---:|---|---:|---:|'
];
for (const subject of subjects) {
  const warnings = subject.closureChecks.filter((check) => ['warning', 'combat-bursting'].includes(check.status)).map((check) => check.id).join(', ') || '—';
  lines.push(`| ${subject.label} | ${subject.technicalScore?.toFixed(1) ?? '—'} / 100 | ${subject.tactical ? `${(subject.tactical.decisionAccuracy * 100).toFixed(0)}%` : '—'} | ${subject.tactical ? `${(subject.tactical.deterministicRate * 100).toFixed(0)}%` : '—'} | ${compact(subject.tactical?.nonPacePhases?.join(', '))} | ${subject.native.passed}/${subject.native.tests} passed | ${compact(warnings)} |`);
}

lines.push('', '## Technical dimensions', '', '| Subject | Global planning | Runtime planning | Racecraft | Dynamics | Field coordination | Safety | Integration | Observability |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const subject of subjects) {
  const d = subject.dimensions;
  lines.push(`| ${subject.label} | ${d['global-planning']?.score ?? '—'}/${d['global-planning']?.maxPoints ?? '—'} | ${d['runtime-planning']?.score ?? '—'}/${d['runtime-planning']?.maxPoints ?? '—'} | ${d['racecraft-traffic']?.score ?? '—'}/${d['racecraft-traffic']?.maxPoints ?? '—'} | ${d['vehicle-dynamics']?.score ?? '—'}/${d['vehicle-dynamics']?.maxPoints ?? '—'} | ${d['field-coordination']?.score ?? '—'}/${d['field-coordination']?.maxPoints ?? '—'} | ${d['safety-recovery']?.score ?? '—'}/${d['safety-recovery']?.maxPoints ?? '—'} | ${d['integration-closure']?.score ?? '—'}/${d['integration-closure']?.maxPoints ?? '—'} | ${d['observability-validation']?.score ?? '—'}/${d['observability-validation']?.maxPoints ?? '—'} |`);
}

lines.push('', '## Same-input tactical replay', '', '| Subject | Scenario | Expected | Decision | Phase | Correct | Safe target | Deterministic |', '|---|---|---|---|---|---:|---:|---:|');
for (const subject of subjects) {
  for (const scenario of subject.tacticalScenarios) {
    lines.push(`| ${subject.label} | ${scenario.scenarioId} | ${scenario.expected} | ${scenario.error ? 'ERROR' : scenario.decision} | ${scenario.phase || '—'} | ${scenario.decisionCorrect ? 'yes' : 'no'} | ${scenario.targetSafe ? 'yes' : 'no'} | ${scenario.deterministic ? 'yes' : 'no'} |`);
  }
}

lines.push('', '## Native scenario evidence', '', '| Subject | Scenario | Status | Native test evidence |', '|---|---|---|---|');
for (const subject of subjects) {
  for (const [scenarioId, value] of Object.entries(subject.native.scenarios)) {
    if (value.status === 'not-mapped') continue;
    const evidence = value.tests.map((test) => `${test.testId}:${test.passed ? 'pass' : 'fail'}`).join(', ');
    lines.push(`| ${subject.label} | ${scenarioId} | ${value.status} | ${evidence} |`);
  }
}

lines.push('', '## Interpretation guardrails', '', '- Technical scores are evidence coverage plus integration-closure penalties, not a learned measure of controller quality.', '- Same-input replay compares tactical intent selection on identical abstract states; it does not integrate all five controllers in one shared physics world.', '- Native simulation metrics are architecture-native. Use them for robustness and failure analysis, not as a universal lap-time leaderboard.', '');

await fs.mkdir(path.dirname(outputBase), { recursive: true });
await fs.writeFile(outputBase, `${JSON.stringify(comparison, null, 2)}\n`, 'utf8');
const markdownPath = outputBase.replace(/\.json$/i, '.md');
await fs.writeFile(markdownPath, `${lines.join('\n')}\n`, 'utf8');
console.table(subjects.map((subject) => ({ subject: subject.label, technical: subject.technicalScore, tactical: subject.tactical ? `${(subject.tactical.decisionAccuracy * 100).toFixed(0)}%` : '—', native: `${subject.native.passed}/${subject.native.tests}` })));
console.log(`JSON: ${outputBase}`);
console.log(`Markdown: ${markdownPath}`);
