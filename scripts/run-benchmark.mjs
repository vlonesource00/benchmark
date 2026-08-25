import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  RESULTS_ROOT,
  commandForNode,
  ensureDir,
  git,
  isoRunId,
  loadManifest,
  subjectPath
} from './lib.mjs';

const argv = process.argv.slice(2);
function flagValue(name, fallback) {
  const equals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}
const suite = flagValue('--suite', 'full');
const selected = flagValue('--subject', undefined);
const dryRun = argv.includes('--dry-run');
if (!['quick', 'full'].includes(suite)) throw new Error(`Unsupported suite ${suite}; use quick or full`);

const manifest = loadManifest();
const subjects = selected ? manifest.subjects.filter((subject) => subject.id === selected) : manifest.subjects;
if (selected && subjects.length === 0) throw new Error(`Unknown subject: ${selected}`);

const runId = isoRunId();
const runDir = path.join(RESULTS_ROOT, runId);
await ensureDir(runDir);
const records = [];

function parseClock(text) {
  const match = text.match(/(?:Flying Lap|best|laps?)[^\n]*?([0-9]+):([0-9]+\.[0-9]+)/i);
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

function parseMetrics(stdout) {
  const metrics = {};
  const soloPace = [...stdout.matchAll(/^\s*([a-z]+):\s*([0-9.]+)\s+s,\s+minimum\s+([0-9.]+)\s+m\/s,\s+maximum\s+slip\s+([0-9.]+)°/gim)]
    .map((match) => ({
      class: match[1].toLowerCase(),
      lapTimeSeconds: Number(match[2]),
      minimumRacingSpeedMps: Number(match[3]),
      maxSlipDeg: Number(match[4])
    }));
  if (soloPace.length) {
    metrics.soloPace = soloPace;
    metrics.bestLapSeconds = Math.min(...soloPace.map((item) => item.lapTimeSeconds));
    metrics.maxSlipDeg = Math.max(...soloPace.map((item) => item.maxSlipDeg));
  }
  const jsonLines = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('{') && line.endsWith('}'));
  for (const line of jsonLines) {
    try {
      const value = JSON.parse(line);
      for (const key of ['time', 'contactFrames', 'maxImpact', 'offTrackVehicleSeconds', 'maxSlipDeg', 'deepOverlaps', 'finishCount']) {
        if (value[key] !== undefined) metrics[key] = value[key];
      }
    } catch {
      // A line that only looks like JSON is still retained in the raw log.
    }
  }

  const bestLaps = [...stdout.matchAll(/^\s*best\s+0:([0-9]+\.[0-9]+)\s+([+-]?[0-9.]+)%\s+off optimum/gim)]
    .map((match) => ({ bestLapSeconds: Number(match[1]), gapToOptimumPercent: Number(match[2]) }));
  if (bestLaps.length) {
    metrics.bestLapSeconds = bestLaps[0].bestLapSeconds;
    metrics.gapToOptimumPercent = bestLaps[0].gapToOptimumPercent;
    metrics.classLaps = bestLaps;
  } else {
    const lap = parseClock(stdout);
    if (lap !== undefined) metrics.firstReportedLapSeconds = lap;
  }
  const offTrack = stdout.match(/Off-Track:\s*([0-9.]+)s|off-track\s+([0-9.]+)s/i);
  if (offTrack) metrics.offTrackSeconds = Number(offTrack[1] || offTrack[2]);
  const gap = stdout.match(/off optimum\s*([+-]?[0-9.]+)%/i);
  if (gap) metrics.gapToOptimumPercent = Number(gap[1]);
  const maxError = stdout.match(/Max Error:\s*([0-9.]+)m|max \|error\|\s*([0-9.]+)\s*m/i);
  if (maxError) metrics.maxLateralErrorMeters = Number(maxError[1] || maxError[2]);
  const finish = stdout.match(/(\d+)\/\d+\s+in\s+([0-9.]+)\s+s/i);
  if (finish) metrics.finishCount = Number(finish[1]);
  const contacts = stdout.match(/contact(?:Frames|s)?[=: ]+([0-9.]+)/i);
  if (contacts && metrics.contactFrames === undefined) metrics.contactFrames = Number(contacts[1]);
  const overlap = stdout.match(/deep(?:Overlaps| overlap frames)?[=: ]+([0-9.]+)/i);
  if (overlap && metrics.deepOverlaps === undefined) metrics.deepOverlaps = Number(overlap[1]);
  return metrics;
}

function failureReason(stdout, stderr) {
  const text = `${stderr}\n${stdout}`;
  const assertion = text.match(/AssertionError \[[^\]]+\]:[^\n]*(?:\n[^\n]*)?/);
  if (assertion) return assertion[0].replace(/\s+/g, ' ').trim().slice(0, 240);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.at(-1)?.slice(0, 240);
}

for (const subject of subjects) {
  const dir = subjectPath(subject);
  const actualCommit = git(dir, ['rev-parse', 'HEAD']);
  if (actualCommit.toLowerCase() !== subject.commit.toLowerCase()) {
    throw new Error(`${subject.id} is not pinned to ${subject.commit}; run npm run prepare`);
  }

  for (const test of subject.tests.filter((item) => item.suites.includes(suite))) {
    const command = commandForNode(test.command);
    const commandText = command.map((part) => JSON.stringify(part)).join(' ');
    const safeName = `${subject.id}--${test.id}`;
    const stdoutPath = path.join(runDir, `${safeName}.stdout.log`);
    const stderrPath = path.join(runDir, `${safeName}.stderr.log`);
    console.log(`${dryRun ? 'PLAN  ' : 'RUN   '}${subject.label} / ${test.label}`);
    console.log(`      ${commandText}`);

    const startedAt = new Date().toISOString();
    const started = performance.now();
    let result = { status: 0, stdout: '', stderr: '', error: null, signal: null };
    if (!dryRun) {
      const child = spawnSync(command[0], command.slice(1), {
        cwd: dir,
        env: { ...process.env, RACING_BENCHMARK_SUBJECT: subject.id, RACING_BENCHMARK_RUN: runId },
        encoding: 'utf8',
        windowsHide: true,
        timeout: (test.timeoutSeconds || 300) * 1000,
        maxBuffer: 16 * 1024 * 1024
      });
      result = {
        status: child.status,
        stdout: child.stdout || '',
        stderr: child.stderr || '',
        error: child.error ? String(child.error.message || child.error) : null,
        signal: child.signal || null
      };
    }
    const durationSeconds = (performance.now() - started) / 1000;
    await fs.writeFile(stdoutPath, result.stdout, 'utf8');
    await fs.writeFile(stderrPath, result.stderr, 'utf8');
    const record = {
      subjectId: subject.id,
      subjectLabel: subject.label,
      branch: subject.branch,
      commit: subject.commit,
      testId: test.id,
      testLabel: test.label,
      scenarioIds: test.scenarioIds || [],
      suite,
      command,
      startedAt,
      durationSeconds: Number(durationSeconds.toFixed(3)),
      exitCode: dryRun ? null : result.status,
      signal: result.signal,
      timedOut: result.error?.includes('ETIMEDOUT') || false,
      passed: dryRun ? null : result.status === 0,
      failureReason: dryRun || result.status === 0 ? null : failureReason(result.stdout, result.stderr),
      metrics: dryRun ? {} : parseMetrics(result.stdout),
      stdoutFile: path.basename(stdoutPath),
      stderrFile: path.basename(stderrPath)
    };
    records.push(record);
    if (!dryRun) console.log(`      ${record.passed ? 'PASS' : 'FAIL'} in ${record.durationSeconds.toFixed(2)}s`);
  }
}

const run = {
  schemaVersion: 1,
  runId,
  createdAt: new Date().toISOString(),
  suite,
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  dryRun,
  records
};
await fs.writeFile(path.join(runDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
console.log(`\n${dryRun ? 'Planned' : 'Recorded'} ${records.length} test runs in ${path.relative(process.cwd(), runDir)}.`);
if (!dryRun && records.some((record) => !record.passed)) process.exitCode = 1;
