import fs from 'node:fs/promises';
import path from 'node:path';
import { RESULTS_ROOT } from './lib.mjs';

const requested = process.argv.find((arg) => arg.startsWith('--run='))?.slice('--run='.length);
const entries = (await fs.readdir(RESULTS_ROOT, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory());
const latest = entries.sort((a, b) => b.name.localeCompare(a.name))[0]?.name;
if (!requested && !latest) throw new Error('No result runs found. Run npm run benchmark first.');
const runDir = requested ? path.resolve(RESULTS_ROOT, requested) : path.join(RESULTS_ROOT, latest);
const run = JSON.parse(await fs.readFile(path.join(runDir, 'run.json'), 'utf8'));

const metricValue = (value) => typeof value === 'object' ? JSON.stringify(value) : String(value);
const metricText = (metrics) => Object.entries(metrics || {}).map(([key, value]) => `${key}=${metricValue(value)}`).join(', ');
const compactFailure = (text) => {
  const assertion = text.match(/AssertionError \[[^\]]+\]:[^\n]*(?:\n[^\n]*)?/);
  if (assertion) return assertion[0].replace(/\s+/g, ' ').trim().slice(0, 240);
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1)?.slice(0, 240);
};
const lines = [
  '# Racing AI benchmark report',
  '',
  `Run: \`${run.runId}\`  `, 
  `Suite: **${run.suite}**  `,
  `Node: \`${run.node}\` on \`${run.platform}\``,
  '',
  '| Subject | Pinned commit | Test | Status | Duration (s) | Parsed metrics | Failure |',
  '|---|---|---|---:|---:|---|---|'
];
for (const record of run.records) {
  let failure = record.failureReason;
  if (!failure && record.passed === false && record.stderrFile) {
    const stderr = await fs.readFile(path.join(runDir, record.stderrFile), 'utf8').catch(() => '');
    failure = compactFailure(stderr);
  }
  failure = failure ? failure.replaceAll('|', '\\|') : '—';
  lines.push(`| ${record.subjectLabel} | \`${record.commit.slice(0, 12)}\` | ${record.testLabel} | ${record.passed === null ? 'planned' : record.passed ? 'PASS' : 'FAIL'} | ${record.durationSeconds.toFixed(3)} | ${metricText(record.metrics).replaceAll('|', '\\|') || '—'} | ${failure} |`);
}
lines.push('', 'Raw stdout and stderr logs are stored beside `run.json`. Parsed metrics are convenience fields; use the raw logs for audit.', '');
await fs.writeFile(path.join(runDir, 'summary.md'), `${lines.join('\n')}\n`, 'utf8');
console.log(path.join(runDir, 'summary.md'));
