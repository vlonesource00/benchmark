import * as THREE from 'three';
import { createSafeWebGLRenderer } from './safe-renderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Track } from '../host/astra/src/sim/track.js';
import { Session } from '../host/astra/src/sim/session.js';
import { Keyboard } from '../host/astra/src/sim/input.js';
import { World } from '../host/astra/src/render/world.js';
import { CarModel } from '../host/astra/src/render/car.js';
import { CarEffects } from '../host/astra/src/render/effects.js';
import { VisualFinish } from '../host/astra/src/render/finish.js';
import {
  CANDIDATES_5ARCH,
  SUPREME_CANDIDATES,
  PLAYER_CANDIDATE,
  SUPREME_WITH_PLAYER,
  ALL_KNOWN_CANDIDATES,
  CANDIDATES,
  CANDIDATE_IDS,
  TRIAD_CANDIDATES,
  createField,
  rotations
} from './bridges/index.js';
import { SpectatorCamera } from './spectator.js';
import { MultiCarVisualDebugger } from './visual-debugger.js';

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
const debugMasterBadge = byId('debug-master-badge');
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
let activeCanvas = canvas;
const { renderer } = createSafeWebGLRenderer(THREE, {
  canvas,
  appName: 'HARBOR RING 5-ARCHITECTURE BENCHMARK',
  onCanvasReplaced: (newCanvas) => {
    activeCanvas = newCanvas;
  }
});
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
const spectator = new SpectatorCamera(camera, activeCanvas);

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
const visualDebugger = new MultiCarVisualDebugger(scene, track, 8);
const keyboard = new Keyboard(() => {});
let simPaused = false;
let stepOnce = false;

// --- Benchmark Architecture Modes & Presets ---
export const MODES = {
  '5-arch': {
    id: '5-arch',
    title: '5-Architecture Grand Prix',
    subtitle: 'Astra, GPT Racing, Claude Racing, Gemini Supreme, Gemini Grand Prix',
    specText: '5 × GT Class (5 Architectures)',
    candidates: CANDIDATES_5ARCH,
    order: CANDIDATES_5ARCH.map((c) => c.id),
    defaultAutopilot: true
  },
  '5-supreme': {
    id: '5-supreme',
    title: 'Gemini Supreme 5-Car Cup',
    subtitle: '5 × Pinned Gemini Supreme GT Cars (Coupled MPCC)',
    specText: '5 × GT Class (All Gemini Supreme)',
    candidates: SUPREME_CANDIDATES,
    order: SUPREME_CANDIDATES.map((c) => c.id),
    defaultAutopilot: true
  },
  '5-supreme-player': {
    id: '5-supreme-player',
    title: 'Gemini Supreme 5 + Player',
    subtitle: '5 × Gemini Supreme AI Bots + Human Driver (WASD/Arrows)',
    specText: '6 × GT Class (5 Supreme AI + You)',
    candidates: SUPREME_WITH_PLAYER,
    order: SUPREME_WITH_PLAYER.map((c) => c.id),
    defaultAutopilot: false
  },
  'triad': {
    id: 'triad',
    title: 'Harbor Triad Showcase',
    subtitle: 'Astra vs Gemini Supreme V3.2 vs DeepSeek NOVA',
    specText: '3 × GT Class (Canonical Triad)',
    candidates: TRIAD_CANDIDATES,
    order: ['nova', 'gemini-supreme', 'astra'],
    defaultAutopilot: true
  }
};

const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
let initialModeId = '5-arch';
if (urlParams.get('mode') === 'triad' || urlParams.has('triad')) {
  initialModeId = 'triad';
} else if (urlParams.has('mode') && MODES[urlParams.get('mode')]) {
  initialModeId = urlParams.get('mode');
}

let customGridOrder = null;
if (urlParams.has('grid') || urlParams.has('drivers')) {
  const parsedOrder = (urlParams.get('grid') || urlParams.get('drivers')).split(',').map((s) => s.trim()).filter(Boolean);
  if (parsedOrder.length > 0) {
    customGridOrder = parsedOrder;
  }
}

let currentModeId = initialModeId;
let activeCandidates = customGridOrder
  ? customGridOrder.map((id) => ALL_KNOWN_CANDIDATES.find((c) => c.id === id) ?? { id, label: id, color: '#ffffff', stack: id })
  : MODES[currentModeId].candidates;

const session = new Session(track, { classId: 'gt', mixed: false });
session.laps = RACE_LAPS;
session.field = customGridOrder ? customGridOrder.length : MODES[currentModeId].order.length;
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

function initField(order = MODES[currentModeId].order, candidates = MODES[currentModeId].candidates) {
  activeCandidates = candidates;
  const modeDef = MODES[currentModeId] || MODES['5-arch'];

  const titleEl = byId('masthead-title');
  if (titleEl) {
    titleEl.innerHTML = `Harbor Ring <span>${modeDef.title}</span>`;
  }
  const specEl = document.querySelector('.protocol-panel dl div:nth-child(2) dd');
  if (specEl) {
    specEl.textContent = modeDef.specText;
  }

  statusLine.textContent = `Binding ${order.length} cars to Harbor Ring 120 Hz host…`;

  // Clean up any existing 3D models
  models.forEach((m) => scene.remove(m.root));
  models = [];

  session.laps = RACE_LAPS;
  session.field = order.length;
  session.aggression = 0.72;
  session.autopilot = modeDef.defaultAutopilot;

  // Initialize car telemetry map for all active candidates
  carTelemetry.clear();
  candidates.forEach((cand) => {
    carTelemetry.set(cand.id, {
      id: cand.id,
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

  field = createField({
    session,
    hostTrack: track,
    order,
    candidatesList: candidates,
    playerInput: keyboard,
    onStatus: (msg) => { statusLine.textContent = msg; }
  });

  session.start({ freshTrack: true });
  field.attach();
  session.autopilot = modeDef.defaultAutopilot;
  updatePilotHud();

  // Only instantiate visual 3D models for active racing cars in the field
  models = session.activeCars.map((car, index) => {
    const model = new CarModel(car);
    const candidateId = field.bridges[index]?.candidateId;
    const candidate = candidates.find((c) => c.id === candidateId) ?? candidates[index];
    if (candidate) model.setColor(candidate.color);
    scene.add(model.root);
    return model;
  });

  // Ensure inactive cars in the session roster are moved far off-track so they never appear or collide
  for (let i = session.field; i < session.cars.length; i += 1) {
    const inactive = session.cars[i];
    inactive.place(track, -9999, -9999);
    inactive.speed = 0;
  }

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

  selectVehicle(order[0], true);
  ready = true;
  statusLine.textContent = `Harbor Ring ready · ${modeDef.title} (${order.length} cars on 120 Hz host physics).`;
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
    const cand = activeCandidates.find((c) => c.id === candId) ?? ALL_KNOWN_CANDIDATES.find((c) => c.id === candId);
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
  const cand = activeCandidates.find((c) => c.id === selectedId) ?? ALL_KNOWN_CANDIDATES.find((c) => c.id === selectedId);
  const candIndex = activeCandidates.findIndex((c) => c.id === selectedId);

  selectedName.textContent = cand?.label ?? car?.name ?? 'Candidate';
  selectedName.style.color = cand?.color ?? '#50e4d3';
  selectedNumberBadge.textContent = `#${candIndex >= 0 ? candIndex + 1 : 1}`;
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
  const thead = byId('compare-table-head');
  if (thead) {
    thead.innerHTML = `
      <tr>
        <th>Metric / Dimension</th>
        ${activeCandidates.map((c) => `<th style="color: ${c.color}">${c.label}</th>`).join('')}
      </tr>
    `;
  }

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
      ${activeCandidates.map((c) => `<td>${r.getter(c.id)}</td>`).join('')}
    </tr>
  `).join('');
}

function showDebriefModal() {
  const standings = getStandings();
  const winner = standings[0];
  const winnerBridge = field?.byCarId(winner.id);
  const winnerCand = activeCandidates.find((c) => c.id === winnerBridge?.candidateId) ?? ALL_KNOWN_CANDIDATES.find((c) => c.id === winnerBridge?.candidateId);

  byId('debrief-winner-title').textContent = `Winner: ${winnerCand?.label ?? winner.name} (${formatTime(winner.race.finishTime ?? session.time)})`;

  let fastestLap = Infinity;
  let fastestDriver = '—';
  let topSpeed = 0;
  let topSpeedDriver = '—';
  let peakG = 0;
  let peakGDriver = '—';

  activeCandidates.forEach((cand) => {
    const stats = carTelemetry.get(cand.id);
    if (stats?.bestLapTime && stats.bestLapTime < fastestLap) {
      fastestLap = stats.bestLapTime;
      fastestDriver = cand.label;
    }
    if (stats && stats.topSpeedKmh > topSpeed) {
      topSpeed = stats.topSpeedKmh;
      topSpeedDriver = cand.label;
    }
    if (stats && stats.peakLatG > peakG) {
      peakG = stats.peakLatG;
      peakGDriver = cand.label;
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
    const cand = activeCandidates.find((c) => c.id === candId) ?? ALL_KNOWN_CANDIDATES.find((c) => c.id === candId);
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
  const modeDef = MODES[currentModeId] || MODES['5-arch'];
  const exportData = {
    benchmark: modeDef.title,
    modeId: currentModeId,
    visualEngine: 'Astra PBR & Harbor Scenery',
    generatedAt: new Date().toISOString(),
    circuit: { name: 'Harbor Ring', lengthM: track.length, laps: RACE_LAPS },
    raceTimeS: session.time,
    standings: getStandings().map((car, idx) => {
      const bridge = field?.byCarId(car.id);
      const candId = bridge?.candidateId;
      const cand = activeCandidates.find((c) => c.id === candId) ?? ALL_KNOWN_CANDIDATES.find((c) => c.id === candId);
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
  a.download = `harbor-ring-${currentModeId}-telemetry-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
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

  const playerControls = keyboard.update(session.player, FIXED_DT, true);
  session.step(FIXED_DT, playerControls);

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
const raceMenuModal = byId('race-menu-modal');

function updateCameraHud() {
  const modeStr = spectator.mode.toUpperCase();
  const candIndex = activeCandidates.findIndex((c) => c.id === selectedId);
  const target = activeCandidates[candIndex] ?? ALL_KNOWN_CANDIDATES.find((c) => c.id === selectedId);
  const targetLabel = spectator.mode === 'free' || !target ? '' : ` #${candIndex + 1} · ${target.label}`;
  if (btnCameraMode) btnCameraMode.textContent = `🎥 Cam: ${modeStr}${spectator.mode === 'free' ? '' : ` #${candIndex + 1}`} (C)`;
  if (camTipMode) camTipMode.textContent = `CAMERA: ${modeStr}${targetLabel}`;
  document.querySelectorAll('.cam-pill').forEach((pill) => {
    pill.classList.toggle('active', pill.getAttribute('data-cam') === spectator.mode);
  });
}

function updatePilotHud() {
  const btnPilot = byId('btn-toggle-pilot');
  const pilotBadge = byId('pilot-badge');
  const optWatch = byId('menu-opt-watch');
  const optDrive = byId('menu-opt-drive');

  if (session.autopilot) {
    if (btnPilot) {
      btnPilot.textContent = '👁️ Watch [P]';
      btnPilot.classList.remove('drive');
      btnPilot.title = 'Current Mode: WATCH (Autopilot AI driving car #1). Press P to Drive.';
    }
    if (pilotBadge) {
      pilotBadge.textContent = 'AUTOPILOT';
      pilotBadge.style.background = 'rgba(0, 210, 255, 0.2)';
      pilotBadge.style.color = '#00d2ff';
    }
    optWatch?.classList.add('active');
    optDrive?.classList.remove('active');
  } else {
    if (btnPilot) {
      btnPilot.textContent = '🎮 Drive [P]';
      btnPilot.classList.add('drive');
      btnPilot.title = 'Current Mode: DRIVE (WASD / Arrows driving car #1). Press P to Watch.';
    }
    if (pilotBadge) {
      pilotBadge.textContent = 'MANUAL PILOT';
      pilotBadge.style.background = 'rgba(255, 140, 0, 0.25)';
      pilotBadge.style.color = '#ff9d00';
    }
    optWatch?.classList.remove('active');
    optDrive?.classList.add('active');
  }
}

function setAutopilot(enabled) {
  session.autopilot = Boolean(enabled);
  updatePilotHud();
  if (!session.autopilot) {
    const firstCarId = activeCandidates[0]?.id;
    if (firstCarId && selectedId !== firstCarId) {
      selectVehicle(firstCarId, true);
    }
  }
}

function toggleAutopilot() {
  setAutopilot(!session.autopilot);
}

function updateDebugScopeHud() {
  const btnScope = byId('btn-debug-scope');
  const optScopeSelected = byId('menu-opt-scope-selected');
  const optScopeAll = byId('menu-opt-scope-all');

  const isAll = visualDebugger.scope === 'all';
  if (btnScope) {
    btnScope.textContent = isAll ? 'SCOPE: ALL GRID [G]' : 'SCOPE: SELECTED [G]';
    btnScope.classList.toggle('scope-all', isAll);
  }
  if (optScopeSelected) optScopeSelected.classList.toggle('active', !isAll);
  if (optScopeAll) optScopeAll.classList.toggle('active', isAll);
}

function toggleDebugScope() {
  visualDebugger.toggleScope();
  updateDebugScopeHud();
}

function setDebugScope(scope) {
  visualDebugger.setScope(scope);
  updateDebugScopeHud();
}

function toggleRaceMenu(show) {
  if (!raceMenuModal) return;
  const isHidden = raceMenuModal.classList.contains('hidden');
  const target = show !== undefined ? !show : !isHidden;
  raceMenuModal.classList.toggle('hidden', target);
}

function selectModeCard(modeId) {
  if (!MODES[modeId]) return;
  currentModeId = modeId;
  document.querySelectorAll('.mode-card').forEach((card) => {
    card.classList.toggle('active', card.getAttribute('data-mode') === modeId);
  });
}

function launchSelectedMode() {
  toggleRaceMenu(false);
  const mode = MODES[currentModeId];
  if (!mode) return;
  initField(mode.order, mode.candidates);
}

function updateVisualDebugHud() {
  const btnToggle = byId('btn-toggle-visual-debug');
  const badge = debugMasterBadge || byId('debug-master-badge');
  const panel = byId('visual-debug-panel');

  if (visualDebugger.enabled) {
    if (btnToggle) {
      btnToggle.classList.add('active');
      btnToggle.textContent = '👁️ AI Debug (V)';
    }
    if (badge) {
      badge.textContent = 'ONLINE [V]';
      badge.classList.remove('off');
      badge.classList.add('active');
    }
    if (panel) panel.classList.remove('hidden');
  } else {
    if (btnToggle) {
      btnToggle.classList.remove('active');
      btnToggle.textContent = '👁️ AI Debug: OFF (V)';
    }
    if (badge) {
      badge.textContent = 'OFF [V]';
      badge.classList.add('off');
      badge.classList.remove('active');
    }
    if (panel) panel.classList.add('hidden');
  }

  updateDebugScopeHud();

  for (let i = 1; i <= 7; i++) {
    const chip = byId(`layer-btn-${i}`);
    if (chip) {
      chip.classList.toggle('active', Boolean(visualDebugger.layers[i]));
    }
  }
}

btnCameraMode?.addEventListener('click', () => {
  spectator.toggleMode();
  updateCameraHud();
});

byId('btn-toggle-visual-debug')?.addEventListener('click', () => {
  visualDebugger.toggleMaster();
  updateVisualDebugHud();
});

byId('btn-debug-scope')?.addEventListener('click', () => {
  toggleDebugScope();
});

byId('btn-race-menu')?.addEventListener('click', () => {
  toggleRaceMenu();
});

byId('btn-close-menu')?.addEventListener('click', () => {
  toggleRaceMenu(false);
});

byId('btn-toggle-pilot')?.addEventListener('click', () => {
  toggleAutopilot();
});

byId('menu-opt-watch')?.addEventListener('click', () => {
  setAutopilot(true);
});

byId('menu-opt-drive')?.addEventListener('click', () => {
  setAutopilot(false);
});

byId('menu-opt-scope-selected')?.addEventListener('click', () => {
  setDebugScope('selected');
});

byId('menu-opt-scope-all')?.addEventListener('click', () => {
  setDebugScope('all');
});

byId('btn-launch-mode')?.addEventListener('click', () => {
  launchSelectedMode();
});

document.querySelectorAll('.mode-card').forEach((card) => {
  card.addEventListener('click', () => {
    const modeId = card.getAttribute('data-mode');
    if (modeId) selectModeCard(modeId);
  });
});

byId('btn-sim-pause')?.addEventListener('click', () => {
  simPaused = !simPaused;
  const btnPause = byId('btn-sim-pause');
  if (btnPause) btnPause.textContent = simPaused ? '▶️ Resume (Space)' : '⏸️ Freeze (Space)';
});

byId('btn-sim-step')?.addEventListener('click', () => {
  simPaused = true;
  stepOnce = true;
  const btnPause = byId('btn-sim-pause');
  if (btnPause) btnPause.textContent = '▶️ Resume (Space)';
});

document.querySelectorAll('.cam-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    const mode = pill.getAttribute('data-cam');
    if (mode) {
      spectator.setMode(mode);
      updateCameraHud();
    }
  });
});

for (let i = 1; i <= 7; i++) {
  byId(`layer-btn-${i}`)?.addEventListener('click', () => {
    visualDebugger.toggleLayer(i);
    updateVisualDebugHud();
  });
}

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
  raceMenuModal?.classList.add('hidden');
  initField();
});
byId('btn-debrief-restart')?.addEventListener('click', () => {
  debriefModal.classList.add('hidden');
  compareModal.classList.add('hidden');
  raceMenuModal?.classList.add('hidden');
  initField();
});

byId('btn-export')?.addEventListener('click', exportTelemetryJson);
byId('btn-download-telemetry')?.addEventListener('click', exportTelemetryJson);
byId('btn-close-debrief')?.addEventListener('click', () => debriefModal.classList.add('hidden'));

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyM') {
    event.preventDefault();
    toggleRaceMenu();
    return;
  }
  if (event.code === 'KeyP') {
    event.preventDefault();
    toggleAutopilot();
    return;
  }
  if (event.code === 'KeyG') {
    event.preventDefault();
    toggleDebugScope();
    return;
  }
  if (event.code === 'KeyV') {
    event.preventDefault();
    visualDebugger.toggleMaster();
    updateVisualDebugHud();
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    simPaused = !simPaused;
    const btnPause = byId('btn-sim-pause');
    if (btnPause) btnPause.textContent = simPaused ? '▶️ Resume (Space)' : '⏸️ Freeze (Space)';
    return;
  }
  if (event.code === 'Period') {
    event.preventDefault();
    simPaused = true;
    stepOnce = true;
    const btnPause = byId('btn-sim-pause');
    if (btnPause) btnPause.textContent = '▶️ Resume (Space)';
    return;
  }
  if (event.code === 'KeyC') {
    event.preventDefault();
    spectator.toggleMode();
    updateCameraHud();
    return;
  }
  if (event.code.startsWith('Digit')) {
    const digit = Number(event.code.slice(-1));
    if (event.shiftKey || !visualDebugger.enabled) {
      const index = digit - 1;
      if (activeCandidates[index]) {
        selectVehicle(activeCandidates[index].id, true);
      }
    } else if (digit >= 1 && digit <= 7) {
      event.preventDefault();
      visualDebugger.toggleLayer(digit);
      updateVisualDebugHud();
    }
    return;
  }
  if (event.code === 'Tab') {
    event.preventDefault();
    compareModal.classList.toggle('hidden');
    if (!compareModal.classList.contains('hidden')) updateCompareTable();
    return;
  }
  if (event.code === 'KeyT') {
    telemetryPanel.classList.toggle('hidden');
    return;
  }
  if (event.code === 'KeyR') {
    raceMenuModal?.classList.add('hidden');
    debriefModal.classList.add('hidden');
    compareModal.classList.add('hidden');
    initField();
    return;
  }
  if (event.code === 'Escape') {
    raceMenuModal?.classList.add('hidden');
    compareModal.classList.add('hidden');
    debriefModal.classList.add('hidden');
    return;
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
    if (!simPaused || stepOnce) {
      fixedStep();
      if (stepOnce) stepOnce = false;
    }
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

    // 3D Visual AI Introspection update
    visualDebugger.update(field, selectedId);
    if (visualDebugger.enabled && debugMasterBadge) {
      debugMasterBadge.textContent = visualDebugger.isStale ? 'ONLINE [V] (STALE)' : 'ONLINE [V]';
    }
  }

  if (canvas.width > 0 && canvas.height > 0) {
    finish.render();
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
updatePilotHud();
updateDebugScopeHud();
initField(customGridOrder || MODES[currentModeId].order, activeCandidates);
