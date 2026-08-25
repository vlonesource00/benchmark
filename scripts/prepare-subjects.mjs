import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ROOT,
  SUBJECTS_ROOT,
  ensureDir,
  git,
  loadManifest,
  subjectPath,
  trackedChanges,
  assertCommit
} from './lib.mjs';

const manifest = loadManifest();
await ensureDir(SUBJECTS_ROOT);

function directoryExists(dir) {
  return fs.access(dir).then(() => true, () => false);
}

function clone(repoUrl, destination) {
  const result = spawnSync('git', [
    'clone',
    '--no-checkout',
    '--filter=blob:none',
    '--no-single-branch',
    '--origin',
    'origin',
    repoUrl,
    destination
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git clone failed for ${repoUrl}: ${(result.stderr || result.stdout || '').trim()}`);
  }
}

for (const subject of manifest.subjects) {
  assertCommit(subject.commit, `${subject.id}.commit`);
  const destination = subjectPath(subject);
  const exists = await directoryExists(destination);

  if (!exists) {
    console.log(`CLONE  ${subject.label} -> ${path.relative(ROOT, destination)}`);
    clone(subject.repoUrl, destination);
  } else {
    const gitDir = path.join(destination, '.git');
    if (!(await directoryExists(gitDir))) {
      throw new Error(`Refusing to use non-git directory as ${subject.id}: ${destination}`);
    }
    const origin = git(destination, ['config', '--get', 'remote.origin.url']);
    if (origin !== subject.repoUrl) {
      throw new Error(`Refusing to reuse ${destination}: origin is ${origin}, expected ${subject.repoUrl}`);
    }
    if (trackedChanges(destination)) {
      throw new Error(`Refusing to change ${subject.id}: tracked changes exist in benchmark-owned checkout ${destination}`);
    }
    console.log(`FETCH  ${subject.label}`);
  }

  git(destination, ['fetch', '--no-tags', 'origin', subject.commit]);
  git(destination, ['checkout', '--detach', subject.commit]);
  const actual = git(destination, ['rev-parse', 'HEAD']).toLowerCase();
  if (actual !== subject.commit.toLowerCase()) {
    throw new Error(`${subject.id} resolved to ${actual}, expected ${subject.commit}`);
  }
  console.log(`PIN    ${subject.label}: ${actual.slice(0, 12)} (${subject.branch})`);
}

console.log(`\nPrepared ${manifest.subjects.length} isolated benchmark subjects under ${path.relative(ROOT, SUBJECTS_ROOT)}.`);
console.log('Original development folders were not used as working directories.');
