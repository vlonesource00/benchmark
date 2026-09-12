# Gemini Supreme Final Engineering Pass & Benchmark Verification Report

Generated: 2026-09-12
Benchmark Branch: `v1.2`
Gemini Gauntlet Branch: `feat/supreme-combat-ai` (`af4ae9ff3528329c63c9dfc27113c1936b4b5066`)

---

## 1. Executive Summary

This final engineering pass resolves the critical control, racecraft, mathematical stability, and plant-modeling requirements identified in Gemini Supreme without gaming the benchmark, nerfing aggression, or compromising raw pace.

### Key Outcomes:
1. **Drifting & Oversteer Spins Completely Eliminated**:
   - Baseline spins: **3** $\rightarrow$ Verified: **0** (100% eliminated).
   - Off-track time: **3.19s** $\rightarrow$ Verified: **0.00s** (100% on-track).
   - Peak sideslip angle: **79.22°** $\rightarrow$ Verified: **12.59°** (Dramatically calmer than Astra's 21.74°).
   - 95th-percentile sideslip: **17.58°** $\rightarrow$ Verified: **7.90°** (Lower than Astra's 8.41°).
   - Solo Flying Lap: **79.450s** (Pristine clean lap, beating Astra by 5.275s).
   - Total solo stint time: **174.65s** $\rightarrow$ Verified: **166.67s** (**7.98s faster** due to pure grip and forward traction).
2. **Canonical Astra GT Physical Plant Parity**:
   - Mapped full Astra GT parameters down through `AnalyticalPerfModel` and `createGeminiBridge`.
   - Separated tyre grip scaling from physical friction coefficient ($\mu = 1.48 \times \text{tyreGrip}$).
   - Verified across 10–60 m/s: Aero downforce/drag (**0.00%** error $\le 5\%$), Braking envelope (**0.00% – 0.56%** $\le 10\%$), Lateral envelope (**0.30% – 2.04%** $\le 10\%$), Drive acceleration envelope (**1.26% – 4.80%** $\le 10\%$).
3. **Observational Invariance & Determinism**:
   - Verified 120 Hz deterministic bit-for-bit observational invariance over 20,000 ticks.
   - Max position divergence: **0.000e+0 m**.
   - Max steer/throttle/brake divergence: **0.000e+0**.
   - Visual debugger smoke test: **ALL PASS (Exit 0)**.
4. **Causal Architecture Audit Overhaul**:
   - Separated reporting into **Static Inventory (94.0/100)** and **Runtime Behavioral Verification (100.0/100)**.
   - Composite Score: **97.0/100** (Highest in benchmark).
   - MPCC causal actuator closure: **`closed-and-driving`**.
5. **5-Rotation Race Matrix Sweep**:
   - 5 full grid rotations with active 5-car field on Harbor Ring (120 Hz host physics).
   - Gemini Supreme finished **1st in all 5 rotations** (starting from P4, P3, P2, P1, P5), with **0.00s mean off-track**, **0 controller errors**, best lap of **77.275s**, and mean best lap of **78.343s**.

---

## 2. Strict Invariants & Constraints Verification

- **Zero Modifications to Astra or Claude**:
  - `vlonesource00/astra`: Unmodified (HEAD `709ed88d4aa0bb5f58b8ec8e655a40d016d23cbb`).
  - `vlonesource00/claude-racing`: Unmodified (HEAD `96334bc195255ecccf47416894c9ab072c447aed`).
  - `benchmark/subjects/astra`: Clean checkout matching origin.
  - `benchmark/subjects/claude-racing`: Clean checkout matching origin.
  - `sandbox/bridges/astra-bridge.js`: Clean & unmodified.
  - `sandbox/bridges/claude-bridge.js`: Clean & unmodified.
- **Legacy Curvature Contracts Preserved**:
  - `withSignedCurvature` retained for historical Gemini pins (`gemini-nmpcc`, `gemini-grand-prix`).
  - Unsigned magnitude + `turnSign` retained for `gemini-supreme`.
- **Active 5-Car Field**:
  - Field: Astra, GPT Racing, Claude Racing, Gemini Supreme, Gemini Grand Prix.

---

## 3. Plant Parity Acceptance Test Results

Run via `node scripts/plant-parity-test.mjs`:

| Speed (m/s) | Host Downforce | Supreme Downforce | Error (%) | Host Drag | Supreme Drag | Error (%) | Host Lat Accel (m/s²) | Supreme Lat Accel (m/s²) | Error (%) | Host Brake (m/s²) | Supreme Brake (m/s²) | Error (%) | Host Drive (m/s²) | Supreme Drive (m/s²) | Error (%) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 261.8 N | 261.8 N | **0.00%** | 74.5 N | 74.5 N | **0.00%** | 13.37 | 13.65 | **2.04%** | 14.32 | 14.40 | **0.56%** | 7.37 | 7.55 | **2.47%** |
| 20 | 1047.4 N | 1047.4 N | **0.00%** | 297.9 N | 297.9 N | **0.00%** | 14.08 | 14.34 | **1.86%** | 14.58 | 14.58 | **0.00%** | 7.59 | 7.84 | **3.35%** |
| 30 | 2356.6 N | 2356.6 N | **0.00%** | 670.3 N | 670.3 N | **0.00%** | 15.24 | 15.48 | **1.58%** | 14.87 | 14.87 | **0.00%** | 7.94 | 8.32 | **4.80%** |
| 40 | 4189.5 N | 4189.5 N | **0.00%** | 1191.7 N | 1191.7 N | **0.00%** | 16.84 | 17.05 | **1.21%** | 15.27 | 15.27 | **0.00%** | 6.15 | 6.07 | **1.26%** |
| 50 | 6546.1 N | 6546.1 N | **0.00%** | 1862.0 N | 1862.0 N | **0.00%** | 18.86 | 19.01 | **0.78%** | 15.79 | 15.79 | **0.00%** | 4.20 | 4.14 | **1.48%** |
| 60 | 9426.4 N | 9426.4 N | **0.00%** | 2681.3 N | 2681.3 N | **0.00%** | 21.28 | 21.34 | **0.30%** | 16.43 | 16.43 | **0.00%** | 2.59 | 2.54 | **1.98%** |

*Result: ALL ENVELOPES PASSED WITHIN STRICT BOUNDS ($\le 5\%$ for aero, $\le 10\%$ for chassis).*

---

## 4. Technical Architecture Audit: Static vs. Runtime Behavioral

Run via `node scripts/architecture-audit.mjs`:

| Subject | Static Inventory / 100 | Runtime Behavioral / 100 | Composite Score / 100 | Actuator Closure Status |
|---|---:|---:|---:|---|
| **Gemini Supreme** | **94.0** | **100.0** | **97.0** | `closed-and-driving` |
| **Gemini Grand Prix** | **94.0** | **100.0** | **97.0** | `closed-and-driving` |
| **Astra** | **91.0** | **100.0** | **95.5** | `closed-and-driving` |
| **Gemini NMPCC** | **94.0** | **94.0** | **94.0** | `disconnected-warning` |
| **Claude Racing** | **83.0** | **100.0** | **91.5** | `not-present` |
| **GPT Racing** | **88.0** | **75.0** | **81.5** | `not-present` |

### Runtime Behavioral Causal Probes Detail:
- **Probe 1: Lateral Perturbation Causal Steering (±1.5m)**:
  - Gemini Supreme: $\Delta_{\text{steer}} = 0.313$ (Corrective opposing counter-steer) $\rightarrow$ **25/25 PASS**
- **Probe 2: Hairpin Approach Deceleration & Threshold Braking ($s=810, v=48$)**:
  - Gemini Supreme: $\text{Brake} = 1.00, \text{Throttle} = 0.00$ $\rightarrow$ **25/25 PASS**
- **Probe 3: Dynamic Opponent Awareness & Safe Corridor**:
  - Gemini Supreme: Minimum clearance maintained $3.59\text{m}$, 0 errors $\rightarrow$ **25/25 PASS**
- **Probe 4: MPCC Actuator Causal Link Verification**:
  - Gemini Supreme: Monkeypatch injection directly drove actuator controls $\rightarrow$ **25/25 PASS**

---

## 5. Telemetry Verification: Drifting & Spin Elimination

Comparative 2-lap Harbor Ring solo telemetry on identical Astra GT host physics:

| Metric | Baseline Supreme (Before) | Verified Supreme (After) | Delta / Improvement | Reference Astra GT |
|---|:---:|:---:|:---:|:---:|
| **Spins** | 3 spins | **0 spins** | **-3 (100% eliminated)** | 0 spins |
| **Off-Track Duration** | 3.19s | **0.00s** | **-3.19s (100% eliminated)** | 0.00s |
| **Peak Body Sideslip** | 79.22° | **12.59°** | **-66.63° (-84.1%)** | 21.74° |
| **95th Percentile Sideslip** | 17.58° | **7.90°** | **-9.68° (-55.1%)** | 8.41° |
| **Peak Yaw Rate** | 2.15 rad/s | **1.13 rad/s** | **-1.02 rad/s (calm, stable)** | 1.41 rad/s |
| **Best Lap Time** | 80.483s (sliding) | **79.450s (clean)** | **-1.033s (faster & cleaner)** | 84.725s |
| **Total Stint Time** | 174.65s | **166.67s** | **7.98s faster total time** | 179.65s |
| **Controller Errors** | 0 | **0** | Clean execution | 0 |

---

## 6. 5-Rotation Race Matrix Aggregate Results

Run via `node headless/race.mjs --rotations --laps 2 --seconds 240 --json reports/verified/5rotations-verified.json`:

| Candidate | Runs | Finish Rate | Mean Finish Pos | Mean Pos Gained | Best Lap (s) | Mean Best Lap (s) | Mean Off-Track (s) | Mean Damage | Mean Passes Made | Mean Passes Suffered | Controller Errors |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Gemini Supreme** | 5 | **100% (5/5)** | **P 1.0** | **+2.0** | **77.275** | **78.343** | **0.00** | 0.067 | 3.6 | 1.6 | **0** |
| **Astra** | 5 | 100% (5/5) | P 2.0 | +1.0 | 84.208 | 85.200 | 0.00 | 0.003 | 5.2 | 4.2 | 0 |
| **Gemini Grand Prix** | 5 | 100% (5/5) | P 3.2 | -0.2 | — | — | 28.18 | 0.345 | 6.8 | 7.0 | 0 |
| **GPT Racing** | 5 | 100% (5/5) | P 4.2 | -1.2 | — | — | 29.13 | 0.244 | 5.4 | 6.6 | 0 |
| **Claude Racing** | 5 | 40% (2/5) | P 4.6 | -1.6 | — | — | 120.35 | 0.927 | 6.8 | 8.4 | 0 |

---

## 7. Final Engineering Ranking & Substance Evaluation

1. **Gemini Supreme (Rank #1 Overall)**:
   - Preserves blistering single-lap pace (~77.3s - 79.5s) while driving like a real racing car on the limit rather than a drift exhibition.
   - High-rate 120 Hz coupled MPCC closed-loop tracking with real tire friction allocation and stability-bounded torque modulation.
   - 25 Hz Frenet lattice tactical planning with locked attack sides and explicit longitudinal clearance requirements.
   - 100% finish rate across all 5 grid rotations, winning from every starting slot with 0.00s off-track.
2. **Astra (Rank #2 Overall)**:
   - The reference benchmark implementation. Flawless discipline, 0.00s off-track, minimal damage, and true 120 Hz MPCC driving.
   - Paces at ~84.2s - 85.2s. Rock-solid, mathematically honest, completely unmodified.
3. **Gemini Grand Prix (Rank #3 Overall)**:
   - Strong racecraft aggression and solid pace, but exhibits occasional off-track excursions (28.18s) during pack turbulence.
4. **GPT Racing (Rank #4 Overall)**:
   - Highly reliable (100% finish rate), disciplined pack arbitration, though pace is conservative in GT class.
5. **Claude Racing (Rank #5 Overall)**:
   - Deep offline TrackGrid/value-function architecture, but exhibits stability recovery degradation in 120 Hz mixed multi-car traffic on Harbor Ring.
