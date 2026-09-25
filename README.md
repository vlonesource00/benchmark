# Racing AI benchmark

This is a separate benchmark repository for the five racing architectures discussed in the comparison:

- Astra — `benchamrk-made` at `709ed88d4aa0bb5f58b8ec8e655a40d016d23cbb`

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
2. **Same-input tactical replay** — feeds identical normalized state cards (clear track, slow car, corner attack, defending threat, and side-by-side) into adapters for all five tactical layers. The report records each architecture’s decision (`PACE`, `ATTACK`, `DEFEND`), maneuver phase, target corridor, safety bound, and deterministic repeatability.
3. **Native simulation suite** — runs each repository’s own physics-accurate pace, racecraft, field, and endurance tests, mapped to common semantic scenario labels.

The aggregate `full-comparison-<run-id>.md` report keeps those evidence types separate. The tactical replay is a fair same-input architecture comparison, but it is not a shared physics race; the native tests provide the physics and endurance evidence. Absolute lap seconds remain architecture-native because the simulators use different tracks, vehicle models, and integration rates.

## What is and is not comparable

The native tests are the most reliable way to exercise each architecture because they use its own physics, track representation, controller, and invariants. The scenario map in [`benchmark/scenarios.json`](benchmark/scenarios.json) names the common questions and directional metrics.

Exact lap seconds should not be pooled across repositories: the simulators use different integration rates, vehicle parameters, and track implementations. Treat the benchmark as a two-layer evaluation:

1. **Within-subject validity:** did the architecture pass its own pace, stability, racecraft, and field invariants?
2. **Cross-subject evidence:** compare normalized directions (completion, off-track time, contact/deep-overlap safety, clean passes, and stability) while retaining the raw logs and pinned SHAs.

The runner deliberately does not rewrite source tests or inject a shared controller API. That keeps the comparison honest and makes every result reproducible from this repository alone.

## Open the 3D Harbor Ring sandbox

The visual benchmark is a three-car sandbox: GPT Racing, Claude Racing, and the pinned Gemini Grand Prix architecture run as GT cars on one shared Harbor Ring scene and one shared reference physics loop. The 3D renderer has race-TV, chase, orbit, and driver-camera views, live architecture decisions, a leaderboard, race radio, scrubbing, and replay speed controls.

Generate the benchmark-owned race tape and start the local viewer:

```powershell
npm run race:generate
npm run viewer
```

Or use `npm run race:watch` to regenerate and serve in one command.

Open the printed `http://127.0.0.1:4180` address. The scene uses local Three.js from a benchmark-owned subject dependency; no network asset is required.

The architecture source checkouts under `subjects/` are read-only benchmark inputs. The host runner supplies the same canonical race state to each unchanged tactical layer and translates only at the harness boundary into the input shape that layer already expects. The source files are not patched or copied over; their commit SHAs are pinned and can be verified before and after a run. This is the only honest way to put incompatible controller APIs into one common physics sandbox without silently changing the architectures.

## Live five-controller Harbor Ring race

The live sandbox is separate from the replay viewer above. It imports all five pinned controller stacks directly: Astra, GPT Racing, Cloud Racing, Gemini NMPCC, and the newer Gemini Grand Prix branch. Every car uses the same GT `Vehicle`, `Circuit`, `RaceState`, collision loop, exact Harbor Ring scene, and authored local assets.

```powershell
npm run sandbox
```

Open `http://127.0.0.1:4174`. Press `1`–`5` (or click a timing row) to select and chase that AI; `V` cycles chase, free no-clip, and bonnet views. Click the scene to mouse-lock free flight, then use `WASD`, `Q/E`, and `Shift`. The host holds every car on the same grid/countdown, releases all five controllers on the common green flag, and ends when each has completed four laps. The debug overlay highlights the selected controller's published route while retaining all five routes, and the cockpit panel shows the selected AI's architecture, controller clock, plan source, actuation, targets, tires, and strategy state.

The only compatibility code is the explicit host-state boundary required by the incompatible engine APIs. In particular, the untouched Cloud `Pilot → Racecraft → Lattice → Driver` stack receives its own track-coordinate convention and emits its original controls; no controller source, pace profile, or behavioural tuning is changed.

Build and run the repeatable smoke race with:

```powershell
npm run sandbox:build
npm run sandbox:smoke
```

For a full headless four-lap validation, run:

```powershell
$env:SANDBOX_TICKS = 70000
$env:SANDBOX_REQUIRE_COMPLETE = 1
npm run sandbox:smoke
```

## VORTEX on the canonical Harbor host

The `VORTEX Harbor Quad` mode runs VORTEX with Astra, Gemini Supreme, and DeepSeek NOVA in the existing 120 Hz Astra host. `VORTEX Nine-Architecture Grand Prix` adds a ninth canonical GT `Vehicle` to the session roster so VORTEX can race all eight existing controllers. The original eight-car mode remains available. VORTEX is a separate sibling project. Its benchmark checkout under `subjects/vortex` is detached at the exact commit in `benchmark/subjects.json`; the live sandbox never imports the development checkout. Neither mode changes the canonical vehicle, tyre, track, collision, renderer, or timing source.

```powershell
npm run prepare -- --subject vortex
npm run verify:vortex
npm run sandbox:vortex:parity
npm run benchmark:vortex:solo -- --laps=3
npm run benchmark:vortex -- --laps=3 --rotations=4
npm run sandbox
```

Choose either VORTEX mode from the race menu or open the sandbox with `?mode=vortex-quad` or `?mode=vortex-all-arch`. `benchmark:vortex:solo -- --subject=astra` measures the pinned Astra bridge under the same host. The parity smoke checks copied physical assets and bit-identical VORTEX commands from standalone and bridge entry points on a non-leading 120 Hz stint.
