# NOVA original-source parity

The benchmark previously pinned `371c7a70852102736f0d4d9660c87e6939af2d63`. It now pins published DeepSeek `792e97e1fb6237745e167b4704f14024a5a4cad7`, which includes the R1 opponent physical-state estimator, latent intent posterior and fast-overlap yielding used by the original controller.

The NOVA bridge now calls the original `NativeDriver.update` rather than reproducing its command application, and supplies the current car's race position. The shared host supplies an order but does not populate the per-car position expected by the original native session. Previously the adapter fell back to position 1.

Validation: `node scripts/nova-parity-smoke.mjs` replays the same physical observations into an original driver from the pinned NOVA checkout and the benchmark bridge for 25 simulated seconds in a two-car field. All 3,001 steering, throttle, brake and reverse command samples matched, with zero bridge exceptions. This is command parity for matched observations, not a claim that an eight-architecture race has the same outcome as NOVA's original grid or flying hotlap.

The shared vehicle and car specifications match the original DeepSeek plant. Its tyre grip refactor extracts the same temperature/pressure expression into a helper; the force law is unchanged. No benchmark physics, graphics or Astra source was modified for this correction. Astra is pinned at published `e44ede0f8bb7bb1caf6422f1dfc8c24873cdbbf0`.

Historical triad captures retain their recorded older NOVA revision; they are not measurements of this new traffic revision.
