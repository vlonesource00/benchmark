import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, git, gitStatus, loadManifest, subjectPath, assertCommit } from './lib.mjs';

const manifest = loadManifest();
const subjectIndex=process.argv.indexOf('--subject');
const selected=process.argv.find(a=>a.startsWith('--subject='))?.slice(10)??(subjectIndex>=0?process.argv[subjectIndex+1]:undefined);
const subjects=selected?manifest.subjects.filter(s=>s.id===selected):manifest.subjects;
if(!subjects.length)throw new Error(`Unknown subject: ${selected}`);
const failures = [];
const rows = [];

for (const subject of subjects) {
  try {
    assertCommit(subject.commit, `${subject.id}.commit`);
    const dir = subjectPath(subject);
    await fs.access(path.join(dir, '.git'));
    const actual = git(dir, ['rev-parse', 'HEAD']).toLowerCase();
    const origin = git(dir, ['config', '--get', 'remote.origin.url']);
    const changes = gitStatus(dir).stdout.trim();
    const clean = changes.length === 0;
    const ok = actual === subject.commit.toLowerCase() && origin === subject.repoUrl && clean;
    rows.push({ id: subject.id, commit: actual.slice(0, 12), origin, status: ok ? 'OK' : clean ? 'MISMATCH' : 'DIRTY' });
    if (!ok) {
      if (actual !== subject.commit.toLowerCase() || origin !== subject.repoUrl) failures.push(`${subject.id}: expected ${subject.commit} from ${subject.repoUrl}, got ${actual} from ${origin}`);
      if (!clean) failures.push(`${subject.id}: benchmark-owned checkout has tracked or untracked changes:\n${changes}`);
    }
  } catch (error) {
    failures.push(`${subject.id}: ${error.message}`);
    rows.push({ id: subject.id, commit: '-', origin: '-', status: 'MISSING' });
  }
}

console.table(rows);
if (failures.length) {
  console.error('\nPin verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Verified ${rows.length} subject pins under ${path.relative(ROOT, path.join(ROOT, 'subjects'))}.`);
