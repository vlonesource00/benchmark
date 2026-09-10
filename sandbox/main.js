import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { World } from '../host/astra/src/render/world.js';
import { CarModel } from '../host/astra/src/render/car.js';
import { CarEffects } from '../host/astra/src/render/effects.js';
import { VisualFinish } from '../host/astra/src/render/finish.js';
import { CANDIDATES, CANDIDATE_IDS, createField, rotations } from './bridges/index.js';
import { SpectatorCamera } from './spectator.js';

const FIXED_DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 16;
const RACE_LAPS = 4;
const SECTOR_BOUNDS = [0.00, 0.235, 0.405, 0.690, 0.865, 1.00];

const byId = (id) => document.getElementById(id);
const statusLine = byId('status-line');
const racePhaseBadge = byId('race-phase-badge');
const leaderboard = byId('leaderboard');
const lapReadout = byId('lap-readout');
const sessionBestReadout = byId('session-best-lap');
const clockReadout = byId('clock-readout');
const debugReadout = byId('debug-readout');
const canvas = byId('race-canvas');

// Telemetry DOM handles
const telemetryPanel = byId('telemetry-panel');
const selectedName = byId('selected-name');
const selectedNumberBadge = byId('selected-number-badge');
const selectedBranch = byId('selected-branch');
const selectedStack = byId('selected-stack');
const selectedCadence = byId('selected-cadence');
const selectedRouteSource = byId('selected-route-source');
const barThrottle = byId('bar-throttle');
const valThrottle = byId('val-throttle');
const barBrake = byId('bar-brake');
const valBrake = byId('val-brake');
const barSteer = byId('bar-steer');
const valSteer = byId('val-steer');
const selectedSpeed = byId('selected-speed');
const selectedTopSpeed = byId('selected-top-speed');
const selectedGForces = byId('selected-g-forces');
const selectedPeakG = byId('selected-peak-g');
const selectedWake = byId('selected-wake');
const selectedWakeDesc = byId('selected-wake-desc');
const selectedMode = byId('selected-mode');
const selectedTacticPhase = byId('selected-tactic-phase');
const selectedReason = byId('selected-reason');
const selectedErrors = byId('selected-errors');
const valTargetV = byId('val-target-v');
const valTargetQ = byId('val-target-q');
const valClearance = byId('val-clearance');

// Tire DOM handles
const flSlip = byId('fl-slip'); const flGrip = byId('fl-grip');
const frSlip = byId('fr-slip'); const frGrip = byId('fr-grip');
const rlSlip = byId('rl-slip'); const rlGrip = byId('rl-grip');
const rrSlip = byId('rr-slip'); const rrGrip = byId('rr-grip');

// Sector DOM handles
const sectorCells = [byId('sec-1'), byId('sec-2'), byId('sec-3'), byId('sec-4'), byId('sec-5')];

// Modals
const compareModal = byId('compare-modal');
const compareTableBody = byId('compare-table-body');
const debriefModal = byId('debrief-modal');
const debriefTableBody = byId('debrief-table-body');

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
};

const formatLapDelta = (seconds) => {
  if (!Number.isFinite(seconds)) return '—';
  const sign = seconds >= 0 ? '+' : '-';
  return `${sign}${Math.abs(seconds).toFixed(3)}s`;
};

// --- Three.js & Astra Visual Pipeline Setup ---
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const initialWidth = Math.max(1, window.innerWidth || document.documentElement?.clientWidth || 1280);
const initialHeight = Math.max(1, window.innerHeight || document.documentElement?.clientHeight || 720);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(initialWidth, initialHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const camera = new THREE.PerspectiveCamera(52, initialWidth / initialHeight, 0.05, 10000);
const spectator = new SpectatorCamera(camera, canvas);

function resize() {
  const width = Math.max(1, window.innerWidth || document.documentElement?.clientWidth || 1);
  const height = Math.max(1, window.innerHeight || document.documentElement?.clientHeight || 1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  finish?.resize(width, height);
}
window.addEventListener('resize', resize);

// --- Astra Harbor Ring Host & 120Hz Session ---
const track = new Track('harbor-ring');
const world = new World(scene, renderer, track);
world.setLighting('golden');
const finish = new VisualFinish(renderer, scene, camera);
finish.setQuality('high');
const effects = new CarEffects(scene);

const session = new Session(track, { classId: 'gt', mixed: false });
session.laps = RACE_LAPS;
session.field = CANDIDATE_IDS.length;
session.aggression = 0.72;
session.autopilot = true;

let field = null;
let models = [];
let selectedId = CANDIDATES[0].id;
let ready = false;
let completed = false;
let lastHudUpdate = -Infinity;
let lastSampleTime = 0;
let globalBestLap = Infinity;
let globalBestSectorTimes = [Infinity, Infinity, Infinity, Infinity, Infinity];

// Telemetry State Registry per candidate
const carTelemetry = new Map();
CANDIDATE_IDS.forEach((id) => {
  carTelemetry.set(id, {
    id,
    topSpeedKmh: 0,
    peakLatG: 0,
    peakLongG: 0,
    lapTimes: [],
    lapStartTime: 0,
    currentLapTime: 0,
    lastLapTime: null,
    bestLapTime: null,
    currentSector: 0,
    sectorEntryTime: 0,
    sectorTimes: [null, null, null, null, null],
    bestSectorTimes: [null, null, null, null, null],
    combatSeconds: 0,
    totalPacingSeconds: 0,
    offTracks: 0,
    samples: []
  });
});

function initField(order = CANDIDATE_IDS) {
  statusLine.textContent = 'Binding 5 architectures to Harbor Ring 120 Hz host…';

  // Clean up any existing 3D models
  models.forEach((m) => scene.remove(m.root));
  models = [];

  session.laps = RACE_LAPS;
  session.field = order.length;
  session.aggression = 0.72;
  session.autopilot = true;

  field = createField({
    session,
    hostTrack: track,
    order,
    onStatus: (msg) => { statusLine.textContent = msg; }
  });

  session.start({ freshTrack: true });
  field.attach();

  models = session.cars.map((car, index) => {
    const model = new CarModel(car);
    const candidateId = field.bridges[index]?.candidateId;
    const candidate = CANDIDATES.find((c) => c.id === candidateId) ?? CANDIDATES[index];
    if (candidate) model.setColor(candidate.color);
    scene.add(model.root);
    return model;
  });

  // Load detailed wheel asset from public/assets
  new GLTFLoader().load(
    '/assets/gt-wheel.glb',
    (asset) => {
      models.forEach((model) => model.setWheelAsset(asset.scene));
    },
    undefined,
    () => console.warn('Built-in procedural wheels active.')
  );

  globalBestLap = Infinity;
  globalBestSectorTimes = [Infinity, Infinity, Infinity, Infinity, Infinity];
  completed = false;

  carTelemetry.forEach((stats) => {
    stats.topSpeedKmh = 0;
    stats.peakLatG = 0;
    stats.peakLongG = 0;
    stats.lapTimes = [];
    stats.lapStartTime = 0;
    stats.currentLapTime = 0;
    stats.lastLapTime = null;
    stats.bestLapTime = null;
    stats.currentSector = 0;
    stats.sectorEntryTime = 0;
    stats.sectorTimes = [null, null, null, null, null];
    stats.bestSectorTimes = [null, null, null, null, null];
    stats.combatSeconds = 0;
    stats.totalPacingSeconds = 0;
    stats.offTracks = 0;
    stats.samples = [];
  });

  selectVehicle(order[0], true);
  ready = true;
  statusLine.textContent = 'Harbor Ring race ready · 5 architectures on shared 120 Hz host physics.';
  updateHud(true);
}

function getStandings() {
  return session.standings();
}

function currentMode(bridge) {
  const dbg = bridge?.debug?.();
  return dbg?.intent ?? dbg?.mode ?? dbg?.phase ?? dbg?.state ?? 'PACING';
}

function currentReason(bridge) {
  const dbg = bridge?.debug?.();
  return dbg?.reason ?? dbg?.thought ?? dbg?.planSource ?? bridge?.stack ?? 'Optimal racing line pursuit';
}

function updateTelemetryForCar(car, bridge, dt) {
  const stats = carTelemetry.get(bridge.candidateId);
  if (!stats) return;

  const speedKmh = car.speed * 3.6;
  stats.topSpeedKmh = Math.max(stats.topSpeedKmh, speedKmh);

  // Local lateral & longitudinal acceleration
  const yaw = car.yaw ?? 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const ax = (car.ax ?? 0);
  const az = (car.az ?? 0);
  const localLongG = Math.abs((ax * s + az * c) / 9.81);
  const localLatG = Math.abs((ax * c - az * s) / 9.81);
  stats.peakLatG = Math.max(stats.peakLatG, localLatG);
  stats.peakLongG = Math.max(stats.peakLongG, localLongG);

  if (session.phase === 'racing' && car.race.finishTime === null) {
    stats.currentLapTime = session.time - stats.lapStartTime;
    const mode = String(currentMode(bridge)).toUpperCase();
    if (mode.includes('ATTACK') || mode.includes('DEFEND') || mode.includes('COMBAT') || mode.includes('DIVE') || mode.includes('SLING') || mode.includes('OVERTAKE')) {
      stats.combatSeconds += dt;
    } else {
      stats.totalPacingSeconds += dt;
    }

    // Sector Split Crossing Logic
    const fraction = ((car.s % track.length) + track.length) % track.length / track.length;
    let activeSec = 0;
    for (let i = 0; i < 5; i++) {
      if (fraction >= SECTOR_BOUNDS[i] && fraction < SECTOR_BOUNDS[i + 1]) {
        activeSec = i;
        break;
      }
    }

    if (activeSec !== stats.currentSector) {
      const sectorTime = session.time - stats.sectorEntryTime;
      if (sectorTime > 1.0 && sectorTime < 60) {
        stats.sectorTimes[stats.currentSector] = sectorTime;
        if (!stats.bestSectorTimes[stats.currentSector] || sectorTime < stats.bestSectorTimes[stats.currentSector]) {
          stats.bestSectorTimes[stats.currentSector] = sectorTime;
        }
        if (sectorTime < globalBestSectorTimes[stats.currentSector]) {
          globalBestSectorTimes[stats.currentSector] = sectorTime;
        }
      }
      stats.currentSector = activeSec;
      stats.sectorEntryTime = session.time;
    }

    // Check Lap Completion event
    if (stats.lapTimes.length < car.race.lap - 1) {
      const lapTime = stats.currentLapTime;
      stats.lapTimes.push(lapTime);
      stats.lastLapTime = lapTime;
      if (!stats.bestLapTime || lapTime < stats.bestLapTime) {
        stats.bestLapTime = lapTime;
      }
      if (lapTime < globalBestLap) {
        globalBestLap = lapTime;
      }
      stats.lapStartTime = session.time;
      stats.currentLapTime = 0;
      stats.sectorEntryTime = session.time;
    }
  }
}

function updateHud(force = false) {
  const now = performance.now() * 0.001;
  if (!force && now - lastHudUpdate < 0.045) return;
  lastHudUpdate = now;

  // Header Status & Phase
  if (session.phase === 'countdown') {
    racePhaseBadge.className = 'phase-badge countdown';
    racePhaseBadge.textContent = `COUNTDOWN ${(Math.max(0, session.countdown)).toFixed(1)}s`;
    clockReadout.textContent = `STARTING / 00:00.000`;
  } else if (session.phase === 'racing') {
    racePhaseBadge.className = 'phase-badge';
    const leaderLap = Math.max(1, ...session.cars.map((c) => c.race.lap));
    racePhaseBadge.textContent = leaderLap >= RACE_LAPS ? 'FINAL LAP' : 'GREEN FLAG · RACING';
    clockReadout.textContent = `RACE / ${formatTime(session.time)}`;
  } else {
    racePhaseBadge.className = 'phase-badge complete';
    racePhaseBadge.textContent = 'CHECKERED FLAG';
    clockReadout.textContent = `FINISHED / ${formatTime(session.time)}`;
  }

  const standings = getStandings();
  const leader = standings[0];
  const leaderLap = Math.max(1, ...session.cars.map((c) => c.race.lap));
  lapReadout.textContent = `LAP ${Math.min(RACE_LAPS, leaderLap)}/${RACE_LAPS}`;
  sessionBestReadout.textContent = Number.isFinite(globalBestLap) ? formatTime(globalBestLap) : '—';

  // Leaderboard List
  leaderboard.replaceChildren(...standings.map((car, position) => {
    const bridge = field?.byCarId(car.id);
    const candId = bridge?.candidateId;
    const cand = CANDIDATES.find((c) => c.id === candId);
    const stats = carTelemetry.get(candId);
    const element = document.createElement('li');
    element.style.setProperty('--car-color', cand?.color ?? car.color);
    if (candId === selectedId) element.classList.add('selected');

    let gapText = 'LEADER';
    if (position > 0 && leader) {
      if (car.race.finishTime !== null && leader.race.finishTime !== null) {
        gapText = formatLapDelta(car.race.finishTime - leader.race.finishTime);
      } else {
        const distGap = Math.max(0, (leader.race.progress ?? 0) - (car.race.progress ?? 0));
        const secGap = leader.speed > 3 ? (distGap / Math.max(12, leader.speed)).toFixed(2) + 's' : Math.round(distGap) + 'm';
        gapText = `+${secGap}`;
      }
    }
    if (car.race.finishTime !== null) gapText = 'FIN';

    const isFastest = stats?.bestLapTime && stats.bestLapTime === globalBestLap;
    const bestClass = isFastest ? 'mono-cell purple' : 'mono-cell';
    const bestLapStr = stats?.bestLapTime ? formatTime(stats.bestLapTime) : '—';
    const lastLapStr = stats?.lastLapTime ? formatTime(stats.lastLapTime) : (session.phase === 'racing' ? formatTime(stats?.currentLapTime) : '—');

    element.innerHTML = `
      <span class="rank-badge">${position + 1}</span>
      <div class="driver-info">
        <i class="swatch"></i>
        <button class="driver-btn" type="button">${cand?.label ?? car.name}</button>
      </div>
      <span class="mono-cell">${gapText}</span>
      <span class="${bestClass}">${bestLapStr}</span>
      <span class="mono-cell">${lastLapStr}</span>
    `;
    element.addEventListener('click', () => { selectVehicle(candId, true); });
    return element;
  }));

  // Selected Car Deep Telemetry Cockpit
  const bridge = field?.byId(selectedId);
  const car = bridge ? session.cars[bridge.carId] : session.cars[0];
  const stats = carTelemetry.get(selectedId);
  const cand = CANDIDATES.find((c) => c.id === selectedId);
  const candIndex = CANDIDATES.findIndex((c) => c.id === selectedId);

  selectedName.textContent = cand?.label ?? car?.name ?? 'Candidate';
  selectedName.style.color = cand?.color ?? '#50e4d3';
  selectedNumberBadge.textContent = `#${candIndex + 1}`;
  selectedNumberBadge.style.color = cand?.color ?? '#50e4d3';
  selectedBranch.textContent = cand ? `${cand.stack}` : 'Harbor Ring 120 Hz';

  // Pedals & Steering Gauges
  const thr = Math.round((car?.controls?.throttle ?? 0) * 100);
  const brk = Math.round((car?.controls?.brake ?? 0) * 100);
  const str = Math.round((car?.controls?.steer ?? 0) * 100);
  barThrottle.style.width = `${thr}%`;
  valThrottle.textContent = `${thr}%`;
  barBrake.style.width = `${brk}%`;
  valBrake.textContent = `${brk}%`;
  barSteer.style.left = `${50 + str * 0.45}%`;
  const steeringDegrees = (car?.steering ?? 0) * 180 / Math.PI;
  valSteer.textContent = `${steeringDegrees > 0 ? '+' : ''}${steeringDegrees.toFixed(1)}°`;

  // Speed & Accelerations
  const speed = Math.round((car?.speed ?? 0) * 3.6);
  selectedSpeed.innerHTML = `${speed} <small>km/h</small>`;
  selectedTopSpeed.textContent = `Top: ${Math.round(stats?.topSpeedKmh ?? speed)} km/h`;

  const yaw = car?.yaw ?? 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const ax = (car?.ax ?? 0);
  const az = (car?.az ?? 0);
  const localLongG = ((ax * s + az * c) / 9.81);
  const localLatG = Math.abs((ax * c - az * s) / 9.81);
  selectedGForces.textContent = `${localLatG.toFixed(2)}G / ${localLongG >= 0 ? '+' : ''}${localLongG.toFixed(2)}G`;
  selectedPeakG.textContent = `Peak Lat: ${(stats?.peakLatG ?? 0).toFixed(2)}G`;

  // Wake
  const dirty = Math.round((car?.airWake ?? 0) * 100);
  selectedWake.textContent = dirty > 10 ? `Turbulence: ${dirty}%` : 'Clean Air';
  selectedWakeDesc.textContent = dirty > 25 ? '⚠️ High Dirty Air Turbulence' : (dirty > 5 ? '💨 Moderate Wake Turbulence' : '✨ Laminar Air Envelope');

  // AI Tactical State & Reason
  const mode = currentMode(bridge);
  selectedMode.textContent = String(mode).toUpperCase();
  const dbg = bridge?.debug?.();
  selectedStack.textContent = cand?.stack ?? 'Controller stack unavailable';
  selectedCadence.textContent = dbg?.controllerCadence ?? 'Shared 120 Hz call';
  selectedRouteSource.textContent = dbg?.planSource ?? dbg?.routeKind ?? 'Harbor Ring Host Racing Line';
  selectedTacticPhase.textContent = dbg?.action ?? dbg?.phase ?? (dbg?.targetSpeed ? `Target: ${Math.round(dbg.targetSpeed * 3.6)} km/h` : 'OPTIMAL TRACK LINE');
  selectedReason.textContent = currentReason(bridge);
  selectedErrors.textContent = `${bridge?.errors ?? 0} errors`;

  valTargetV.textContent = Number.isFinite(dbg?.targetSpeed) ? `${Math.round(dbg.targetSpeed * 3.6)} km/h` : `${speed} km/h`;
  valTargetQ.textContent = Number.isFinite(dbg?.targetQ) ? `${dbg.targetQ > 0 ? '+' : ''}${dbg.targetQ.toFixed(2)}m` : (car ? `${car.lateral > 0 ? '+' : ''}${car.lateral.toFixed(2)}m` : '0.00m');
  valClearance.textContent = Number.isFinite(dbg?.minimumClearance) ? `${dbg.minimumClearance.toFixed(1)}m` : (Number.isFinite(dbg?.gapAhead) ? `${dbg.gapAhead.toFixed(1)}m` : 'CLEAR');

  // 4 Tires Contact Patch Monitor
  if (car?.wheels && car.wheels.length >= 4) {
    const [fl, fr, rl, rr] = car.wheels;
    flSlip.textContent = `${((fl?.tyre?.alpha ?? 0) * (180 / Math.PI)).toFixed(1)}°`;
    flGrip.textContent = `${Math.min(100, Math.round((fl?.load ?? 4000) / 45))}%`;
    frSlip.textContent = `${((fr?.tyre?.alpha ?? 0) * (180 / Math.PI)).toFixed(1)}°`;
    frGrip.textContent = `${Math.min(100, Math.round((fr?.load ?? 4000) / 45))}%`;
    rlSlip.textContent = `${((rl?.tyre?.alpha ?? 0) * (180 / Math.PI)).toFixed(1)}°`;
    rlGrip.textContent = `${Math.min(100, Math.round((rl?.load ?? 4000) / 45))}%`;
    rrSlip.textContent = `${((rr?.tyre?.alpha ?? 0) * (180 / Math.PI)).toFixed(1)}°`;
    rrGrip.textContent = `${Math.min(100, Math.round((rr?.load ?? 4000) / 45))}%`;
  }

  // Sector Splits Matrix (Selected Car)
  if (stats) {
    stats.sectorTimes.forEach((secTime, idx) => {
      const cell = sectorCells[idx];
      if (!cell) return;
      const strong = cell.querySelector('strong');
      if (secTime) {
        strong.textContent = secTime.toFixed(2) + 's';
        if (secTime <= globalBestSectorTimes[idx] + 0.001) {
          cell.className = 'sector-cell purple';
        } else if (secTime <= (stats.bestSectorTimes[idx] ?? Infinity) + 0.001) {
          cell.className = 'sector-cell green';
        } else {
          cell.className = 'sector-cell';
        }
      } else {
        strong.textContent = idx === stats.currentSector && session.phase === 'racing' ? `${(session.time - stats.sectorEntryTime).toFixed(1)}s` : '—';
        cell.className = idx === stats.currentSector && session.phase === 'racing' ? 'sector-cell green' : 'sector-cell';
      }
    });
  }

  if (!compareModal.classList.contains('hidden')) {
    updateCompareTable();
  }

  debugReadout.textContent = completed ? 'FOUR-LAP RESULT LOCKED' : 'ASTRA HARBOR RING · 5 ARCHITECTURES 120HZ ACTIVE';
}

function updateCompareTable() {
  const rows = [
    { label: 'Live Position', getter: (id) => {
      const bridge = field?.byId(id);
      const car = bridge ? session.cars[bridge.carId] : null;
      return car ? `#${getStandings().indexOf(car) + 1}` : '—';
    }},
    { label: 'Current Lap', getter: (id) => {
      const bridge = field?.byId(id);
      const car = bridge ? session.cars[bridge.carId] : null;
      return car ? `${Math.min(RACE_LAPS, car.race.lap)} / ${RACE_LAPS}` : '—';
    }},
    { label: 'Current Speed', getter: (id) => {
      const bridge = field?.byId(id);
      const car = bridge ? session.cars[bridge.carId] : null;
      return car ? `${Math.round(car.speed * 3.6)} km/h` : '—';
    }},
    { label: 'Top Speed Reached', getter: (id) => `${Math.round(carTelemetry.get(id)?.topSpeedKmh ?? 0)} km/h` },
    { label: 'Throttle / Brake', getter: (id) => {
      const bridge = field?.byId(id);
      const car = bridge ? session.cars[bridge.carId] : null;
      return car ? `${Math.round((car.controls?.throttle ?? 0) * 100)}% / ${Math.round((car.controls?.brake ?? 0) * 100)}%` : '—';
    }},
    { label: 'Steering Angle', getter: (id) => {
      const bridge = field?.byId(id);
      const car = bridge ? session.cars[bridge.carId] : null;
      return car ? `${((car.steering ?? 0) * 180 / Math.PI).toFixed(1)}°` : '—';
    }},
    { label: 'Peak Lateral G', getter: (id) => `${(carTelemetry.get(id)?.peakLatG ?? 0).toFixed(2)}G` },
    { label: 'AI Tactical State', getter: (id) => String(currentMode(field?.byId(id))).toUpperCase() },
    { label: 'Fastest Lap', getter: (id) => formatTime(carTelemetry.get(id)?.bestLapTime) },
    { label: 'Last Lap', getter: (id) => formatTime(carTelemetry.get(id)?.lastLapTime) },
    { label: 'Combat / Attack %', getter: (id) => {
      const stats = carTelemetry.get(id);
      const total = (stats?.combatSeconds ?? 0) + (stats?.totalPacingSeconds ?? 0);
      return total > 0 ? `${Math.round(((stats?.combatSeconds ?? 0) / total) * 100)}%` : '0%';
    }},
    { label: 'Damage Incurred', getter: (id) => {
      const bridge = field?.byId(id);
      const car = bridge ? session.cars[bridge.carId] : null;
      return car ? `${(car.damage ?? 0).toFixed(2)}` : '0';
    }},
    { label: 'Controller Errors', getter: (id) => `${field?.byId(id)?.errors ?? 0}` }
  ];

  compareTableBody.innerHTML = rows.map((r) => `
    <tr>
      <td><strong>${r.label}</strong></td>
      ${CANDIDATE_IDS.map((id) => `<td>${r.getter(id)}</td>`).join('')}
    </tr>
  `).join('');
}

function showDebriefModal() {
  const standings = getStandings();
  const winner = standings[0];
  const winnerBridge = field?.byCarId(winner.id);
  const winnerCand = CANDIDATES.find((c) => c.id === winnerBridge?.candidateId);

  byId('debrief-winner-title').textContent = `Winner: ${winnerCand?.label ?? winner.name} (${formatTime(winner.race.finishTime ?? session.time)})`;

  let fastestLap = Infinity;
  let fastestDriver = '—';
  let topSpeed = 0;
  let topSpeedDriver = '—';
  let peakG = 0;
  let peakGDriver = '—';

  CANDIDATE_IDS.forEach((id) => {
    const stats = carTelemetry.get(id);
    const cand = CANDIDATES.find((c) => c.id === id);
    if (stats.bestLapTime && stats.bestLapTime < fastestLap) {
      fastestLap = stats.bestLapTime;
      fastestDriver = cand?.label ?? id;
    }
    if (stats.topSpeedKmh > topSpeed) {
      topSpeed = stats.topSpeedKmh;
      topSpeedDriver = cand?.label ?? id;
    }
    if (stats.peakLatG > peakG) {
      peakG = stats.peakLatG;
      peakGDriver = cand?.label ?? id;
    }
  });

  byId('debrief-fastest-lap').textContent = Number.isFinite(fastestLap) ? formatTime(fastestLap) : '—';
  byId('debrief-fastest-driver').textContent = fastestDriver;
  byId('debrief-top-speed').textContent = `${Math.round(topSpeed)} km/h`;
  byId('debrief-top-driver').textContent = topSpeedDriver;
  byId('debrief-peak-g').textContent = `${peakG.toFixed(2)}G`;
  byId('debrief-peak-driver').textContent = peakGDriver;
  byId('debrief-total-time').textContent = formatTime(session.time);

  const winnerFinishTime = winner.race.finishTime ?? session.time;
  debriefTableBody.innerHTML = standings.map((car, idx) => {
    const bridge = field?.byCarId(car.id);
    const candId = bridge?.candidateId;
    const cand = CANDIDATES.find((c) => c.id === candId);
    const stats = carTelemetry.get(candId);
    const finishTime = car.race.finishTime ?? session.time;
    const gap = idx === 0 ? 'WINNER' : formatLapDelta(finishTime - winnerFinishTime);
    const totalTime = formatTime(finishTime);
    const l1 = formatTime(stats?.lapTimes[0]);
    const l2 = formatTime(stats?.lapTimes[1]);
    const l3 = formatTime(stats?.lapTimes[2]);
    const l4 = formatTime(stats?.lapTimes[3]);
    const best = formatTime(stats?.bestLapTime);
    const totalCombat = (stats?.combatSeconds ?? 0) + (stats?.totalPacingSeconds ?? 0);
    const combatPct = totalCombat > 0 ? `${Math.round(((stats?.combatSeconds ?? 0) / totalCombat) * 100)}%` : '0%';

    return `
      <tr>
        <td><strong>#${idx + 1}</strong></td>
        <td style="color: ${cand?.color ?? car.color}">${cand?.label ?? car.name}</td>
        <td>${totalTime}</td>
        <td>${gap}</td>
        <td class="${stats?.bestLapTime === fastestLap ? 'purple' : ''}"><strong>${best}</strong></td>
        <td>${l1}</td>
        <td>${l2}</td>
        <td>${l3}</td>
        <td>${l4}</td>
        <td>${Math.round(stats?.topSpeedKmh ?? 0)} km/h</td>
        <td>${(stats?.peakLatG ?? 0).toFixed(2)}G</td>
        <td>${combatPct}</td>
      </tr>
    `;
  }).join('');

  debriefModal.classList.remove('hidden');
}

function exportTelemetryJson() {
  const exportData = {
    benchmark: 'Harbor Ring 5-Architecture Grand Prix',
    visualEngine: 'Astra PBR & Harbor Scenery',
    generatedAt: new Date().toISOString(),
    circuit: { name: 'Harbor Ring', lengthM: track.length, laps: RACE_LAPS },
    raceTimeS: session.time,
    standings: getStandings().map((car, idx) => {
      const bridge = field?.byCarId(car.id);
      const candId = bridge?.candidateId;
      const cand = CANDIDATES.find((c) => c.id === candId);
      return {
        position: idx + 1,
        id: candId,
        label: cand?.label ?? car.name,
        color: cand?.color ?? car.color,
        finishTimeS: car.race.finishTime ?? session.time,
        bestLapS: car.race.bestLap,
        damage: car.damage,
        offTrackS: car.race.offtrack,
        stats: carTelemetry.get(candId)
      };
    })
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `harbor-ring-5arch-telemetry-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function selectVehicle(id, switchChaseCam = true) {
  selectedId = id;
  const bridge = field?.byId(id);
  const targetCar = bridge ? session.cars[bridge.carId] : session.cars[0];
  if (targetCar) {
    spectator.setTarget(targetCar, switchChaseCam ? 'chase' : spectator.mode);
    updateCameraHud();
  }
  updateHud(true);
}

function fixedStep() {
  if (!ready || completed) return;

  session.step(FIXED_DT, { throttle: 0, brake: 0, steer: 0 });

  const allFinished = session.activeCars.every((car) => car.race.finishTime != null);
  if (session.phase === 'finished' && !allFinished) {
    session.phase = 'racing';
  }

  // Update telemetry for every active car
  session.activeCars.forEach((car) => {
    const bridge = field?.byCarId(car.id);
    if (bridge) updateTelemetryForCar(car, bridge, FIXED_DT);
  });

  // Periodic Telemetry Sample (every 0.25s)
  if (session.time - lastSampleTime >= 0.25) {
    lastSampleTime = session.time;
    session.activeCars.forEach((car) => {
      const bridge = field?.byCarId(car.id);
      if (!bridge) return;
      const stats = carTelemetry.get(bridge.candidateId);
      stats?.samples?.push({
        t: Number(session.time.toFixed(2)),
        s: Number(car.s.toFixed(1)),
        spd: Number((car.speed * 3.6).toFixed(1)),
        thr: Number((car.controls?.throttle ?? 0).toFixed(2)),
        brk: Number((car.controls?.brake ?? 0).toFixed(2)),
        str: Number((car.controls?.steer ?? 0).toFixed(2)),
        mode: currentMode(bridge)
      });
    });
  }

  if (allFinished && !completed) {
    completed = true;
    session.phase = 'finished';
    statusLine.textContent = `Four-lap race complete · ${getStandings()[0]?.name ?? '—'} wins on shared 120 Hz host physics.`;
    updateHud(true);
    showDebriefModal();
  }
}

// UI Event Listeners & Modals
const btnCameraMode = byId('btn-camera-mode');
const camTipMode = byId('cam-tip-mode');

function updateCameraHud() {
  const modeStr = spectator.mode.toUpperCase();
  const candIndex = CANDIDATES.findIndex((c) => c.id === selectedId);
  const target = CANDIDATES[candIndex];
  const targetLabel = spectator.mode === 'free' || !target ? '' : ` #${candIndex + 1} · ${target.label}`;
  if (btnCameraMode) btnCameraMode.textContent = `🎥 Cam: ${modeStr}${spectator.mode === 'free' ? '' : ` #${candIndex + 1}`} (V)`;
  if (camTipMode) camTipMode.textContent = `CAMERA: ${modeStr}${targetLabel}`;
}

btnCameraMode?.addEventListener('click', () => {
  spectator.toggleMode();
  updateCameraHud();
});

byId('btn-toggle-compare')?.addEventListener('click', () => {
  compareModal.classList.toggle('hidden');
  if (!compareModal.classList.contains('hidden')) updateCompareTable();
});
byId('btn-close-compare')?.addEventListener('click', () => compareModal.classList.add('hidden'));

byId('btn-toggle-telemetry')?.addEventListener('click', () => {
  telemetryPanel.classList.toggle('hidden');
});

byId('btn-restart')?.addEventListener('click', () => {
  debriefModal.classList.add('hidden');
  compareModal.classList.add('hidden');
  initField(CANDIDATE_IDS);
});
byId('btn-debrief-restart')?.addEventListener('click', () => {
  debriefModal.classList.add('hidden');
  compareModal.classList.add('hidden');
  initField(CANDIDATE_IDS);
});

byId('btn-export')?.addEventListener('click', exportTelemetryJson);
byId('btn-download-telemetry')?.addEventListener('click', exportTelemetryJson);
byId('btn-close-debrief')?.addEventListener('click', () => debriefModal.classList.add('hidden'));

window.addEventListener('keydown', (event) => {
  if (event.code.startsWith('Digit')) {
    const index = Number(event.code.slice(-1)) - 1;
    if (CANDIDATES[index]) {
      selectVehicle(CANDIDATES[index].id, true);
    }
  }
  if (event.code === 'KeyV') {
    spectator.toggleMode();
    updateCameraHud();
  }
  if (event.code === 'KeyC' || event.code === 'Tab') {
    event.preventDefault();
    compareModal.classList.toggle('hidden');
    if (!compareModal.classList.contains('hidden')) updateCompareTable();
  }
  if (event.code === 'KeyT') {
    telemetryPanel.classList.toggle('hidden');
  }
  if (event.code === 'KeyR') {
    debriefModal.classList.add('hidden');
    compareModal.classList.add('hidden');
    initField(CANDIDATE_IDS);
  }
  if (event.code === 'Escape') {
    compareModal.classList.add('hidden');
    debriefModal.classList.add('hidden');
  }
});

let previousTime = performance.now() * 0.001;
let accumulator = 0;

function frame(nowMs) {
  const now = nowMs * 0.001;
  const delta = Math.min(0.125, Math.max(0, now - previousTime));
  previousTime = now;
  accumulator += delta;

  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    fixedStep();
    accumulator -= FIXED_DT;
    steps += 1;
  }
  if (steps >= MAX_STEPS_PER_FRAME) accumulator = 0;

  if (ready) {
    const focusCar = field?.byId(selectedId) ? session.cars[field.byId(selectedId).carId] : session.cars[0];
    models.forEach((m) => m.update(session.phase === 'racing' ? delta : 0));
    world.update(focusCar, session.time, session.phase === 'countdown' ? session.countdown : 0, spectator.mode === 'free');
    effects.update(session.activeCars, delta, track, window.innerHeight);
    spectator.update(delta);
    updateHud();
  }

  if (canvas.width > 0 && canvas.height > 0) {
    finish.render();
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
initField(CANDIDATE_IDS);
