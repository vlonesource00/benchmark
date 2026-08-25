import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, git, loadManifest, subjectPath, assertCommit } from './lib.mjs';

const manifest = loadManifest();
const failures = [];
const rows = [];

for (const subject of manifest.subjects) {
  try {
    assertCommit(subject.commit, `${subject.id}.commit`);
    const dir = subjectPath(subject);
    await fs.access(path.join(dir, '.git'));
    const actual = git(dir, ['rev-parse', 'HEAD']).toLowerCase();
    const origin = git(dir, ['config', '--get', 'remote.origin.url']);
    const ok = actual === subject.commit.toLowerCase() && origin === subject.repoUrl;
    rows.push({ id: subject.id, commit: actual.slice(0, 12), origin, status: ok ? 'OK' : 'MISMATCH' });
    if (!ok) failures.push(`${subject.id}: expected ${subject.commit}, got ${actual} from ${origin}`);
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
