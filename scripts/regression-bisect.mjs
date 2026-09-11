import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const COMMITS = [
  { id: 'aa0eb65', name: 'aa0eb650 (Temporal Decoupled Baseline)', hash: 'aa0eb65072e6fd96867fe072aec5250cf1f85572' },
  { id: '444e16f', name: '444e16fe (Pace Model Pass)', hash: '444e16fe76d0f9cdba2d8fcfcb22280f15599e3e' },
  { id: '02986e0', name: '02986e07 (Initial 3D Visual Debug)', hash: '02986e0754568cd81f89d94ce451138d161c02f5' },
  { id: '04368fc', name: '04368fcc (Corridor Discretization)', hash: '04368fcca9d7bb63d615394ea300a5dd546be9f1' },
  { id: 'd9e4969', name: 'd9e49693 (Current Head)', hash: 'd9e49693081113570ac9c09f00f8a368c27a7a67' }
];

const SUBJECT_DIR = resolve('subjects/gemini-supreme');
console.log('=== Regression Bisection Harness: Gemini Supreme on Harbor Ring ===');
console.log(`Target subject repo: ${SUBJECT_DIR}`);

const results = [];

try {
  for (const c of COMMITS) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`>>> Checking out [${c.id}] ${c.name}...`);
    execSync(`git checkout ${c.hash}`, { cwd: SUBJECT_DIR, stdio: 'inherit' });

    console.log(`>>> Running deterministic Harbor Ring 2-lap solo evaluation...`);
    const stdout = execSync(`node scripts/eval-single-commit.mjs`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    
    // Parse the JSON block from stdout
    const jsonStart = stdout.indexOf('{');
    const jsonEnd = stdout.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      const parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
      parsed.commit = c.id;
      parsed.commitName = c.name;
      parsed.hash = c.hash;
      results.push(parsed);

      console.log(`  Lap 1: ${parsed.lapTimes[0]?.time?.toFixed(3) ?? 'DNF'} s`);
      console.log(`  Flying Lap (Lap 2): ${parsed.flyingLap?.toFixed(3) ?? 'DNF'} s (valid: ${parsed.flyingLapValid})`);
      console.log(`  Best Clean Lap: ${parsed.bestCleanLap?.toFixed(3) ?? 'NONE'}`);
      console.log(`  Spins: ${parsed.spins}, Off-track: ${parsed.offTrackSeconds.toFixed(2)} s (${parsed.offTrackEvents} events)`);
      console.log(`  Max Slip Beta: ${parsed.maxBodySlipDeg.toFixed(1)}°, P95 Beta: ${parsed.p95BodySlipDeg.toFixed(1)}°`);
      console.log(`  Trajectory Switches / s: ${parsed.trajectorySwitchesPerSec.toFixed(2)}`);
      console.log(`  Dynamic Limit Selected: ${parsed.dynamicLimitSelectedCount}`);
    } else {
      console.error(`Failed to parse JSON from commit ${c.id}`);
      console.error(stdout);
    }
  }
} finally {
  console.log(`\n>>> Restoring subject repository to origin/feat/supreme-combat-ai...`);
  execSync(`git checkout feat/supreme-combat-ai`, { cwd: SUBJECT_DIR, stdio: 'inherit' });
}

// Print comparison table
console.log(`\n========================================================================================================================`);
console.log(`                                        REGRESSION BISECTION SUMMARY TABLE`);
console.log(`========================================================================================================================`);
console.log(`Commit   | Flying Lap | Best Clean | Spins | Off-Track (s) | Max Slip Beta | P95 Beta | Max YawRate | Traj Sw/s | DynLimit Sel`);
console.log(`---------+------------+------------+-------+---------------+---------------+----------+-------------+-----------+-------------`);

for (const r of results) {
  const fLap = r.flyingLap ? `${r.flyingLap.toFixed(2)}s` : 'DNF';
  const cLap = r.bestCleanLap ? `${r.bestCleanLap.toFixed(2)}s` : 'NONE';
  const offT = `${r.offTrackSeconds.toFixed(2)}s (${r.offTrackEvents})`;
  const maxB = `${r.maxBodySlipDeg.toFixed(1)}°`;
  const p95B = `${r.p95BodySlipDeg.toFixed(1)}°`;
  const maxY = `${r.maxYawRateRadS.toFixed(2)}`;
  const swS = `${r.trajectorySwitchesPerSec.toFixed(2)}`;
  const dynL = `${r.dynamicLimitSelectedCount}`;

  console.log(
    `${r.commit.padEnd(8)} | ${fLap.padStart(10)} | ${cLap.padStart(10)} | ${String(r.spins).padStart(5)} | ${offT.padStart(13)} | ${maxB.padStart(13)} | ${p95B.padStart(8)} | ${maxY.padStart(11)} | ${swS.padStart(9)} | ${dynL.padStart(12)}`
  );
}
console.log(`========================================================================================================================`);

writeFileSync('bisection-results.json', JSON.stringify(results, null, 2), 'utf-8');
console.log(`Results saved to bisection-results.json`);
