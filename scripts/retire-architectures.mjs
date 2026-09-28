import fs from 'node:fs';
const p = new URL('../benchmark/subjects.json', import.meta.url);
const m = JSON.parse(fs.readFileSync(p, 'utf8'));
const RETIRE = ['gpt-racing', 'claude-racing', 'gemini-nmpcc', 'gemini-grand-prix', 'musespark'];
const ACTIVE = ['astra', 'gemini-supreme', 'nova', 'vortex'];

const retired = m.subjects.filter((s) => RETIRE.includes(s.id));
const active = ACTIVE.map((id) => m.subjects.find((s) => s.id === id)).filter(Boolean);
if (active.length !== 4) throw new Error('expected 4 active subjects, got ' + active.length);
if (retired.length !== 5) throw new Error('expected 5 retired subjects, got ' + retired.length);

const out = {
  schemaVersion: 2,
  createdAt: m.createdAt,
  retiredAt: '2026-09-28',
  description: 'Pinned benchmark subjects. Each checkout is created under this benchmark repo and is never read from or written to the original development folders. `subjects` is the ACTIVE / CURRENT GENERATION field; `retired` preserves the LEGACY / ARCHIVED architectures with their pins, kept for inspection but excluded from the test matrix and the benchmark game.',
  subjects: active,
  retired: retired.map((s) => ({
    ...s,
    retiredReason: {
      'gpt-racing': 'Field-arbitrated racecraft, superseded by architectures with richer spatial reasoning and physical trajectory planning.',
      'claude-racing': 'Offline TrackGrid / value-function + runtime lattice. Architecturally distinct, archived rather than deleted. Rendered in-game as "Cloud Racing".',
      'gemini-nmpcc': 'Earlier V2/NMPCC branch, superseded by Gemini Supreme 3.2.',
      'gemini-grand-prix': '25 Hz tactical committed-side-by-side concept; Supreme is the Gemini representative worth keeping.',
      'musespark': 'Global-optimum / belief / strategy / MPCC stack; no benchmark-native test suite, not under active development.',
    }[s.id],
  })),
};

fs.writeFileSync(p, JSON.stringify(out, null, 2) + '\n');
console.log('active :', active.map((s) => s.id).join(', '));
console.log('retired:', retired.map((s) => s.id).join(', '));
