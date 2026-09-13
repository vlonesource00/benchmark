# Astra final-kink arc — 2026-09-13

Pin: `956ffe4517bf31ea2bbb6c45f63e4b76aefa2aad` (`v1.2`).
Previous: `379c3e628020eb921a62784bbf373d682884a17c`.

Astra alone receives a cached, bounded curvature refinement of Harbor GT's
2410–2570 m driving arc. Adjacent corners remain fixed. Native and benchmark
drivers install the same arc without mutating the host road or shared line.
This also includes best-valid/last-lap trace export and a corner audit utility.

Shared two-lap solo: 79.067/78.775 s versus 80.183/80.425 s. Solo, wet 0.5,
eight-lap stint and eight-Astra field tests complete without spins, off-track
time or damage. Wet best is 86.300 s; the eight-lap final lap is 98.550 s.
Native GT solo/mixed: 79.783/84.858 s. Touring/prototype remain unchanged.
106 unit tests, build, Harbor checks, passing checks and showcase checks pass.

Canonical two-lap, five-rotation comparison used benchmark
`2fe9ea053f716a083a4cccaacc28e76bbb7075f8` and unchanged Supreme
`0a97e974d5c71fbb6125dabea3f4efa992282fb2`.

| Rotation | Previous best | Arc best | Previous finish | Arc finish |
| --- | ---: | ---: | ---: | ---: |
| 1 | 81.392 | 80.942 | 173.975 | 172.458 |
| 2 | 81.900 | 80.825 | 176.325 | 174.650 |
| 3 | 81.783 | 79.600 | 174.742 | 171.633 |
| 4 | 85.000 | 82.333 | 197.292 | 178.067 |
| 5 | 80.900 | 80.508 | 177.533 | 175.992 |

Every rotation finishes P2, faster than its baseline. Mean best lap improves
82.195→80.842 s; reported mean damage falls 0.042915→0.033135 and mean off-track
time falls 1.957→0 s. Incident/pass counters include post-finish cooldown until
the whole harness stops; they are not retained-pass statistics.

Raw comparisons: `astra-arc-baseline-matrix.json` and
`astra-arc-candidate-matrix.json` in this directory. Candidate provenance records
the pre-commit parent plus exact controller source hashes; the pin above commits
that tested implementation. Neither host physics nor opponent pins were changed.
Further braking, exit acceleration, lane use and assertive racecraft remain work
in progress; this checkpoint does not claim the human 73.200-second target.
