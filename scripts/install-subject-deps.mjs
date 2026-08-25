import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { commandForNode, loadManifest, npmExecutable, subjectPath } from './lib.mjs';

const args = process.argv.slice(2);
const subjectFlag = args.find((arg) => arg.startsWith('--subject='));
const subjectIndex = args.indexOf('--subject');
const selected = subjectFlag
  ? subjectFlag.slice('--subject='.length)
  : subjectIndex >= 0
    ? args[subjectIndex + 1]
    : undefined;
const manifest = loadManifest();
const subjects = selected ? manifest.subjects.filter((subject) => subject.id === selected) : manifest.subjects;
if (selected && subjects.length === 0) throw new Error(`Unknown subject: ${selected}`);

for (const subject of subjects) {
  const dir = subjectPath(subject);
  const lock = path.join(dir, 'package-lock.json');
  try {
    await fs.access(lock);
  } catch {
    console.log(`SKIP   ${subject.label}: no package-lock.json (no npm install required)`);
    continue;
  }

  console.log(`INSTALL ${subject.label}: npm ci --ignore-scripts`);
  const npmCommand = process.platform === 'win32'
    ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${npmExecutable()} ci --ignore-scripts --no-audit --no-fund`]]
    : [npmExecutable(), ['ci', '--ignore-scripts', '--no-audit', '--no-fund']];
  const result = spawnSync(npmCommand[0], npmCommand[1], {
    cwd: dir,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${subject.id}: npm ci failed with exit code ${result.status}`);
}

console.log('Subject dependency installation complete.');
