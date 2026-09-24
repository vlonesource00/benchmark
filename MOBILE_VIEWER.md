# Phone panels, original Astra graphics

Open http://vlonethug00.tailbde88d.ts.net/?mode=all-arch&phone=1 with Tailscale connected. The existing `/mobile.html` link redirects to the same page.

The original benchmark renderer, car models, scenery, lighting, effects and browser simulation are preserved. Only phone panels change: collapsed by default, one open at a time, with camera, timing, telemetry, debug and menu buttons. `?desktop` preserves the desktop layout. This is not the simplified spectator renderer or the server-side race introduced in the earlier iteration; those have been removed.

Current Astra checkout and benchmark manifest pin: `e44ede0f8bb7bb1caf6422f1dfc8c24873cdbbf0`, the legal 74.850 s solo candidate refined for a valid 75.717 s lap in the eight-car race. The normal Astra bridge imports it from `subjects/astra/src/sim/controller.js`.

Start from this benchmark directory:

```powershell
npm run sandbox:build
npm run mobile:serve
```

Existing Tailscale route: `tailscale serve --bg --http=80 http://127.0.0.1:4186`. Keep the PC awake and the server running. Simulation and full graphics run in the viewing browser; phone performance is not guaranteed by a desktop check.
