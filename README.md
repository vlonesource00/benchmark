# Racing AI benchmark

This is a separate benchmark repository for the four racing architectures discussed in the comparison:

- GPT Racing — `codex/flat-track-racecraft` at `0dcd4744d4e5f4036db0894a62ab9976d091e370`
- Claude Racing — `main` at `96334bc195255ecccf47416894c9ab072c447aed`
- Gemini NMPCC — `feat/apex-nmpcc-combat-ai` at `17ccafbd3a65a4b8cc0f4b3d32342c6a127c714a`
- Gemini Grand Prix — `feat/grand-prix-sim-and-cockpit-hud` at `cbced43f5538bc72a497b17fbc74849f21955397`

The source folders next to this directory are out of scope. `scripts/prepare-subjects.mjs` clones fresh benchmark-owned copies under `subjects/`, fetches the exact SHA, and checks out each copy detached. It refuses to use a non-git destination, a mismatched origin, or a checkout with tracked edits. The original GPT, Claude, and Gemini folders are never used as test working directories.

## Run it

From this directory:

```powershell
npm run prepare
npm run verify
npm run install:subjects
npm run benchmark -- --suite quick
npm run report
```

Use `--suite full` for the longer soak/head-to-head tests, or restrict a run with `--subject gemini-grand-prix`. A dry run validates the pins and lists commands without starting a simulation:

```powershell
npm run benchmark -- --subject claude-racing --suite quick --dry-run
```

`npm ci` runs only inside the benchmark-owned clones and uses `--ignore-scripts`. Test stdout/stderr, commit metadata, exit status, duration, and a small set of parsed metrics are written under `results/<run-id>/`. Generate the Markdown summary with `npm run report`.

## Full architecture comparison

For the complete comparison, run:

```powershell
npm run benchmark:full -- --suite full
```

That command performs three separate evaluations before writing one aggregate report:

1. **Technical architecture audit** — scans only the pinned implementation source and scores explicit dimensions such as global planning, runtime lattice/control separation, racecraft, vehicle dynamics, field coordination, safety, integration closure, and observability. Every awarded signal includes an evidence file and line. It also flags gaps such as a planner that is implemented but not wired into the live control path.
2. **Same-input tactical replay** — feeds identical normalized state cards (clear track, slow car, corner attack, defending threat, and side-by-side) into adapters for all four tactical layers. The report records each architecture’s decision (`PACE`, `ATTACK`, `DEFEND`), maneuver phase, target corridor, safety bound, and deterministic repeatability.
3. **Native simulation suite** — runs each repository’s own physics-accurate pace, racecraft, field, and endurance tests, mapped to common semantic scenario labels.

The aggregate `full-comparison-<run-id>.md` report keeps those evidence types separate. The tactical replay is a fair same-input architecture comparison, but it is not a shared physics race; the native tests provide the physics and endurance evidence. Absolute lap seconds remain architecture-native because the simulators use different tracks, vehicle models, and integration rates.

## What is and is not comparable

The native tests are the most reliable way to exercise each architecture because they use its own physics, track representation, controller, and invariants. The scenario map in [`benchmark/scenarios.json`](benchmark/scenarios.json) names the common questions and directional metrics.

Exact lap seconds should not be pooled across repositories: the simulators use different integration rates, vehicle parameters, and track implementations. Treat the benchmark as a two-layer evaluation:

1. **Within-subject validity:** did the architecture pass its own pace, stability, racecraft, and field invariants?
2. **Cross-subject evidence:** compare normalized directions (completion, off-track time, contact/deep-overlap safety, clean passes, and stability) while retaining the raw logs and pinned SHAs.

The runner deliberately does not rewrite source tests or inject a shared controller API. That keeps the comparison honest and makes every result reproducible from this repository alone.
