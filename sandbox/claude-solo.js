import * as THREE from 'three';
import { createSafeWebGLRenderer } from './safe-renderer.js';
import { Circuit } from '../subjects/claude-racing/src/sim/Track.js';
import { Race } from '../subjects/claude-racing/src/sim/Race.js';
import { TrackGrid } from '../subjects/claude-racing/src/sim/TrackGrid.js';
import { cloneSpec } from '../subjects/claude-racing/src/sim/CarSpecs.js';
import { Pilot } from '../subjects/claude-racing/src/ai/Pilot.js';
import { PlanBudget } from '../subjects/claude-racing/src/ai/Scheduler.js';
import { HARBOR_RING } from '../subjects/claude-racing/src/scenarios/HarborRing.js';
import { AssetLibrary } from '../subjects/claude-racing/src/render/AssetLibrary.js';
import { CircuitEnvironment } from '../subjects/claude-racing/src/render/Environment.js';
import { CarVisual } from '../subjects/claude-racing/src/render/CarVisual.js';
import { CameraRig } from '../subjects/claude-racing/src/render/Cameras.js';
import { AIDebugRenderer } from '../subjects/claude-racing/src/render/AIDebugRenderer.js';
import harborRingGtLine from '../subjects/claude-racing/public/lines/harbor-ring-gt.json';

const PHYSICS_DT = 1 / 400;
const MAX_STEPS = 48;
const LAPS = 4;
const byId = (id) => document.getElementById(id);
const canvas = byId('solo-canvas');

const { renderer } = createSafeWebGLRenderer(THREE, {
  canvas,
  appName: 'CLAUDE SOLO BENCHMARK'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 1, 0.035, 1800);
const rig = new CameraRig(camera, { mode: 'chase' });
const circuit = new Circuit({ scenario: HARBOR_RING });
const environment = new CircuitEnvironment(scene, circuit);

let grid = null;
let race = null;
let pilot = null;
let visual = null;
let debugRenderer = null;
let physicsSteps = 0;
let debugVisible = true;
let completed = false;

const keys = new Set();
let mouseX = 0;
let mouseY = 0;

const resize = () => {
  const width = window.innerWidth;
  const height = Math.max(1, window.innerHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
};
window.addEventListener('resize', resize);
resize();

const formatTime = (seconds) => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, '0')}:${(safe - minutes * 60).toFixed(3).padStart(6, '0')}`;
};

function startNativeRace() {
  debugRenderer?.dispose?.();
  visual?.dispose?.();
  const entries = [{
    classId: 'gt',
    spec: cloneSpec('gt'),
    name: 'CLAUDE RACING',
    isPlayer: false,
    tint: '#ffb454'
  }];
  race = new Race(circuit, { entries, laps: LAPS, countdown: 4.0 });
  const budget = new PlanBudget(1);
  pilot = new Pilot(race.cars[0], grid, {
    field: race.cars,
    phase: 0,
    budget,
    name: 'CLAUDE RACING',
    skill: 0.96,
    aggression: 0.72
  });
  race.setDriver(0, pilot);
  visual = new CarVisual(scene, race.cars[0], circuit);
  const model = window.__claudeSoloAssets?.cloneCar('gt', race.cars[0].tint);
  if (model) visual.attachAsset(model);
  debugRenderer = new AIDebugRenderer(scene, circuit, race.cars, [pilot]);
  debugRenderer.setVisible(true);
  physicsSteps = 0;
  completed = false;
  rig.setMode('chase');
  rig.snap();
  updateHud();
}

function freeAxes(dt) {
  const scale = Math.max(1e-4, dt);
  const axes = {
    forward: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
    right: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
    up: (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0),
    yaw: mouseX * 0.00135 / (1.65 * scale),
    pitch: -mouseY * 0.00115 / (1.35 * scale),
    boost: keys.has('ShiftLeft') || keys.has('ShiftRight')
  };
  mouseX = 0;
  mouseY = 0;
  return axes;
}

function updateHud() {
  if (!race || !pilot) return;
  const entrant = race.entrants[0];
  const car = entrant.car;
  const debug = pilot.debug();
  const plan = pilot.driver?.plan;
  const planPoint = { q: 0, dqds: 0, v: 0, kappa: 0 };
  plan?.sample?.(circuit.wrapS(car.s + 16), planPoint);
  const lap = entrant.finished ? LAPS : Math.min(LAPS, entrant.lap + 1);
  byId('solo-phase').textContent = race.state === 'countdown' ? `START ${Math.max(0, race.startTimer).toFixed(1)}` : race.state.toUpperCase();
  byId('solo-status').textContent = entrant.finished ? `Native four-lap run complete · best ${formatTime(entrant.bestLap)}` : 'Original Claude controller, vehicle, tyres, drivetrain, track grid, and race loop.';
  byId('solo-lap').textContent = `LAP ${lap}/${LAPS}`;
  byId('solo-speed').textContent = `${Math.round(car.speedKph)} km/h`;
  byId('solo-target-speed').textContent = `${Math.round((pilot.driver?.vAllow ?? planPoint.v ?? 0) * 3.6)} km/h`;
  byId('solo-q').textContent = `${car.q >= 0 ? '+' : ''}${car.q.toFixed(2)} m`;
  byId('solo-offtrack').textContent = `${car.offTrack.toFixed(2)} m`;
  byId('solo-offtrack').style.color = car.offTrack > 0.05 ? '#ff5577' : '#75efb8';
  byId('solo-mode').textContent = debug.mode ?? pilot.mode;
  byId('solo-plan').textContent = plan?.constructor?.name ?? 'NoPlan';
  const throttle = Math.round(car.controls.throttle * 100);
  const brake = Math.round(car.controls.brake * 100);
  const steer = Math.round(car.controls.steer * 100);
  byId('solo-throttle').style.width = `${throttle}%`;
  byId('solo-brake').style.width = `${brake}%`;
  byId('solo-steer').style.left = `${50 + steer * 0.45}%`;
  byId('solo-throttle-value').textContent = `${throttle}%`;
  byId('solo-brake-value').textContent = `${brake}%`;
  byId('solo-steer-value').textContent = `${steer > 0 ? '+' : ''}${steer}%`;
  byId('solo-reason').textContent = debug.reason ?? pilot.reason ?? 'Native pace plan';
  byId('solo-clock').textContent = `${formatTime(race.clock)} · ${physicsSteps.toLocaleString()} physics steps · ${(physicsSteps / Math.max(PHYSICS_DT, race.clock || PHYSICS_DT)).toFixed(0)} Hz source clock`;
}

function updateCameraLabel() {
  byId('solo-camera').textContent = `Camera: ${rig.mode[0].toUpperCase()}${rig.mode.slice(1)} (C)`;
}

window.addEventListener('keydown', (event) => {
  keys.add(event.code);
  if (event.code === 'KeyC') { rig.cycle(); updateCameraLabel(); }
  if (event.code === 'KeyF') { rig.toggleFree(); updateCameraLabel(); }
  if (event.code === 'KeyJ') {
    debugVisible = !debugVisible;
    debugRenderer?.setVisible(debugVisible);
    byId('solo-debug').textContent = `Native Debug: ${debugVisible ? 'On' : 'Off'} (J)`;
  }
  if (event.code === 'KeyR' && grid) startNativeRace();
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== canvas) return;
  mouseX += event.movementX;
  mouseY += event.movementY;
});
canvas.addEventListener('click', () => canvas.requestPointerLock?.());
byId('solo-camera').addEventListener('click', () => { rig.cycle(); updateCameraLabel(); });
byId('solo-debug').addEventListener('click', () => {
  debugVisible = !debugVisible;
  debugRenderer?.setVisible(debugVisible);
  byId('solo-debug').textContent = `Native Debug: ${debugVisible ? 'On' : 'Off'} (J)`;
});
byId('solo-restart').addEventListener('click', () => { if (grid) startNativeRace(); });

let previous = performance.now() * 0.001;
let accumulator = 0;
function frame(nowMs) {
  requestAnimationFrame(frame);
  const now = nowMs * 0.001;
  const dt = Math.min(0.25, Math.max(1e-4, now - previous));
  previous = now;
  if (race && !completed) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= PHYSICS_DT && steps < MAX_STEPS) {
      race.step(PHYSICS_DT);
      accumulator -= PHYSICS_DT;
      steps += 1;
      physicsSteps += 1;
    }
    if (steps >= MAX_STEPS) accumulator = 0;
    completed = race.state === 'finished';
  }
  visual?.update(dt);
  environment.update(dt);
  if (debugVisible) debugRenderer?.update(dt, [pilot], race?.cars);
  const target = race?.cars?.[0];
  rig.update(dt, target, visual, freeAxes(dt));
  updateHud();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

async function initialise() {
  try {
    const assets = new AssetLibrary({ onStatus: ({ state, key }) => { byId('solo-status').textContent = `${state.toUpperCase()} ${String(key).toUpperCase()}`; } });
    await assets.preload();
    window.__claudeSoloAssets = assets;
    environment.installAssets(assets);
    byId('solo-status').textContent = 'Building Claude’s original Harbor Ring TrackGrid…';
    await new Promise((resolve) => setTimeout(resolve, 0));
    grid = new TrackGrid(circuit, cloneSpec('gt'), { solution: harborRingGtLine, stationSpacing: 10.0 });
    startNativeRace();
    window.__claudeNativeSolo = { circuit, grid, get race() { return race; }, get pilot() { return pilot; }, restart: startNativeRace };
  } catch (error) {
    byId('solo-phase').textContent = 'FAILED';
    byId('solo-status').textContent = error.message;
    console.error(error);
  }
}
initialise();
