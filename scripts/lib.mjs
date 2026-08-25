import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_PATH = path.join(ROOT, 'benchmark', 'subjects.json');
export const SUBJECTS_ROOT = path.join(ROOT, 'subjects');
export const RESULTS_ROOT = path.join(ROOT, 'results');

export function loadManifest() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

export function subjectPath(subject) {
  const destination = path.resolve(ROOT, subject.workdir || path.join('subjects', subject.id));
  assertInside(ROOT, destination, `subject ${subject.id}`);
  return destination;
}

export function assertInside(parent, child, label) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`${label} must stay inside ${path.resolve(parent)} (got ${path.resolve(child)})`);
  }
}

export async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

export function git(cwd, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim();
    throw new Error(`git ${args.join(' ')} failed in ${cwd}${detail ? `: ${detail}` : ''}`);
  }
  return (result.stdout || '').trim();
}

export function gitStatus(cwd) {
  const result = spawnSync('git', ['status', '--short'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

export function trackedChanges(cwd) {
  const unstaged = spawnSync('git', ['diff', '--quiet'], { cwd, windowsHide: true });
  const staged = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd, windowsHide: true });
  if (unstaged.error) throw unstaged.error;
  if (staged.error) throw staged.error;
  return unstaged.status !== 0 || staged.status !== 0;
}

export function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function commandForNode(command) {
  if (command[0] === 'node') return [process.execPath, ...command.slice(1)];
  if (command[0] === 'npm') return [npmExecutable(), ...command.slice(1)];
  return command;
}

export function isoRunId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function assertCommit(commit, label) {
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error(`${label} is not a full 40-character commit SHA`);
}
