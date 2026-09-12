# Astra pace checkpoint — 2026-09-12

Pin Astra to `379c3e628020eb921a62784bbf373d682884a17c` on `v1.2`.
This adds a read-only tactical debugger and corrected driver-facing direction
labels to the tested pace candidate `b2e4895176e2c51e006395366dcbefaadaacf967`.
Its only simulation-module change is explanatory side-name text; the driving
decisions retain the tested pace checkpoint. 101 unit tests and build pass.
Previous pin: `709ed88d4aa0bb5f58b8ec8e655a40d016d23cbb`.
Only Astra's subject changes; the common host and every opponent pin remain
unchanged from benchmark `9aebaab57e523eecec6f92021145312f309a705d`.

The candidate removes duplicate reference-line speed ceilings and uses the
selected trajectory's live grip limits. Extra braking/lateral demand fades out
near traffic and with thermal degradation. Native steering geometry is retained.

| Measurement | Previous pin | Candidate |
|---|---:|---:|
| Shared solo lap 1 | 84.725 s | 80.183 s |
| Shared solo lap 2 | 85.617 s | 80.425 s |
| Five-rotation mean best lap | 84.678 s | 82.962 s |
| Five-rotation finish rate | 5/5 | 5/5 |
| Finish positions | all P2 | all P2 |
| Mean off-track seconds | 0 | 0 |
| Mean reported damage | 0.00812 | 0.06151 |

Four of five race finish times improve; rotation four is 1.200 s slower.
Canonical counters include post-finish running until the entire race stops.
This pin represents verified pace progress, not a claim of improved close
racing, defense, or parity with Supreme. Full-width outside–apex–exit geometry
and assertive racecraft remain open work. The user's 73.200 s human lap is
not an AI baseline.

Candidate validation: 98 unit tests, production build, all three native Harbor
classes, native mixed-class pack, lost-momentum scenarios and three-lap showcase
pass. Eight-lap shared solo and wetness-0.5 solo have no spins/off-track/damage.
Eight-car Astra pack: all finish with zero off-track time, no severe contacts,
and maximum damage 0.01315.

Raw canonical before/after matrices are saved beside this report. They record
the old manifest because the candidate was injected for comparison before pin
promotion. Source hashes identify the tested controller code. Reproduce using
the pinned Astra repository's `scripts/benchmark-candidate.mjs`; `--baseline`
uses whichever Astra revision is currently pinned, so recovering the old
comparison requires an isolated copy with the previous Astra manifest/checkout.

After promotion, pin verification and native/shared bridge smoke checks pass.
The actual pinned controller reproduces 80.183 / 80.425 s with zero spins,
off-track time and damage. Host hashes match the comparison exactly. Controller
sources match after normalizing Git checkout CRLF/LF line endings; all opponent
pins match the pre-promotion manifest.
