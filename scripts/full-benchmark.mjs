import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { RESULTS_ROOT, ROOT, ensureDir } from './lib.mjs';

const argv = process.argv.slice(2);
function flagValue(name, fallback) {
  const equals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

const suite = flagValue('--suite', 'full');
const skipNative = argv.includes('--skip-native');
await ensureDir(RESULTS_ROOT);

function stage(label, script, args = []) {
  console.log(`\n=== ${label} ===`);
  const child = spawnSync(process.execPath, [path.join('scripts', script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  return child;
}

function artifactPath(stdout, label) {
  const match = stdout.match(new RegExp(`${label}:\\s+([^\\r\\n]+\\.json)`));
  return match ? path.resolve(match[1].trim()) : null;
}

async function newestRunJson(afterMs) {
  const entries = await fs.readdir(RESULTS_ROOT, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(RESULTS_ROOT, entry.name, 'run.json');
    const stat = await fs.stat(file).catch(() => null);
    if (stat && stat.mtimeMs >= afterMs) candidates.push({ file, mtimeMs: stat.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.file || null;
}

const audit = stage('Static architecture audit', 'architecture-audit.mjs');
if (audit.status !== 0) process.exitCode = audit.status || 1;
const auditPath = artifactPath(audit.stdout || '', 'JSON');

const tactical = stage('Same-input tactical replay', 'tactical-replay.mjs');
if (tactical.status !== 0) process.exitCode = tactical.status || 1;
const tacticalPath = artifactPath(tactical.stdout || '', 'JSON');

let runPath = null;
let nativeStatus = 0;
if (!skipNative) {
  const started = Date.now();
  const native = stage('Native simulation suite', 'run-benchmark.mjs', [`--suite=${suite}`]);
  nativeStatus = native.status || 0;
  runPath = await newestRunJson(started - 1000);
  if (!runPath) {
    console.error('Native runner did not produce a run.json artifact.');
    process.exitCode = nativeStatus || 1;
  }
} else {
  runPath = await newestRunJson(0);
  console.log(`\nNative suite skipped; using ${runPath || 'no existing run.json'} for aggregation.`);
}

if (auditPath && tacticalPath && runPath) {
  const score = stage('Aggregate comparison report', 'score-benchmark.mjs', [
    `--run=${runPath}`,
    `--audit=${auditPath}`,
    `--tactical=${tacticalPath}`
  ]);
  if (score.status !== 0) process.exitCode = score.status || 1;
} else {
  console.error(`Cannot aggregate: audit=${auditPath || 'missing'}, tactical=${tacticalPath || 'missing'}, run=${runPath || 'missing'}`);
  process.exitCode = process.exitCode || 1;
}

if (nativeStatus !== 0) process.exitCode = nativeStatus;
