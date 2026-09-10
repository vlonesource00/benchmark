import * as THREE from '/vendor/three.module.js';

const ui = {
  canvas: document.querySelector('#raceCanvas'),
  cameraSelect: document.querySelector('#cameraSelect'),
  carSelect: document.querySelector('#carSelect'),
  fullscreenButton: document.querySelector('#fullscreenButton'),
  runStatus: document.querySelector('#runStatus'),
  lapReadout: document.querySelector('#lapReadout'),
  seedReadout: document.querySelector('#seedReadout'),
  leaderboard: document.querySelector('#leaderboard'),
  selectedColor: document.querySelector('#selectedColor'),
  selectedName: document.querySelector('#selectedName'),
  selectedBranch: document.querySelector('#selectedBranch'),
  selectedDecision: document.querySelector('#selectedDecision'),
  selectedPhase: document.querySelector('#selectedPhase'),
  selectedSpeed: document.querySelector('#selectedSpeed'),
  selectedGap: document.querySelector('#selectedGap'),
  selectedRank: document.querySelector('#selectedRank'),
  selectedLap: document.querySelector('#selectedLap'),
  selectedReason: document.querySelector('#selectedReason'),
  decisionStrip: document.querySelector('#decisionStrip'),
  eventLog: document.querySelector('#eventLog'),
  timeReadout: document.querySelector('#timeReadout'),
  playButton: document.querySelector('#playButton'),
  restartButton: document.querySelector('#restartButton'),
  speedSelect: document.querySelector('#speedSelect'),
  timeline: document.querySelector('#timeline'),
  finishedLabel: document.querySelector('#finishedLabel'),
  loadError: document.querySelector('#loadError')
};

const COLORS = {
  'gpt-racing': '#4be0c5',
  'claude-racing': '#ffb65c',
  'gemini-grand-prix': '#a997ff',
  PACE: '#9bb0b8',
  ATTACK: '#ffb65c',
  DEFEND: '#ff718f'
};

const state = {
  data: null,
  run: null,
  subjects: [],
  sampler: null,
  scene: null,
  renderer: null,
  camera: null,
  cameraTarget: new THREE.Vector3(),
  carObjects: new Map(),
  currentTime: 0,
  playing: true,
  speed: 1,
  cameraMode: 'tv',
  selectedCarId: null,
  lastTick: performance.now(),
  lastHudPaint: 0
};

const WORLD_SCALE = 0.16;
const ROAD_Y = 0.08;

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function wrap(value, length) { return ((value % length) + length) % length; }
function colorFor(id) { return COLORS[id] || '#d8e5e8'; }
function subjectFor(id) { return state.subjects.find((subject) => subject.id === id); }
function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(2).padStart(5, '0')}`;
}

function buildSampler(track) {
  const nodes = track.centerline;
  const segments = [];
  let total = 0;
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const from = nodes[index];
    const to = nodes[index + 1];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    segments.push({ from, to, start: total, length });
    total += length;
  }
  return { nodes, segments, total, lengthM: track.lengthM, halfWidth: track.roadHalfWidthM };
}

function sampleTrack(distance, lateral = 0) {
  const sampler = state.sampler;
  const scaledDistance = wrap(distance, sampler.lengthM) / sampler.lengthM * sampler.total;
  const segment = sampler.segments.find((candidate) => scaledDistance >= candidate.start && scaledDistance <= candidate.start + candidate.length) || sampler.segments.at(-1);
  const ratio = clamp((scaledDistance - segment.start) / segment.length, 0, 1);
  const dx = segment.to.x - segment.from.x;
  const dz = segment.to.y - segment.from.y;
  const tangent2 = new THREE.Vector2(dx, dz).normalize();
  const centerX = segment.from.x + dx * ratio;
  const centerZ = segment.from.y + dz * ratio;
  const normalX = -tangent2.y;
  const normalZ = tangent2.x;
  const lapFraction = wrap(distance, sampler.lengthM) / sampler.lengthM;
  const elevation = 0.25 + Math.sin(lapFraction * Math.PI * 4) * 0.22 + Math.sin(lapFraction * Math.PI * 11) * 0.08;
  return {
    position: new THREE.Vector3((centerX + normalX * lateral) * WORLD_SCALE, elevation, (centerZ + normalZ * lateral) * WORLD_SCALE),
    tangent: new THREE.Vector3(tangent2.x, 0, tangent2.y).normalize(),
    yaw: Math.atan2(tangent2.x, tangent2.y)
  };
}

function makeRibbon(track, width, yOffset = 0, colors = null) {
  const vertices = [];
  const vertexColors = [];
  const indices = [];
  const halfWidth = width * WORLD_SCALE;
  const sampler = state.sampler;
  sampler.segments.forEach((segment, index) => {
    const from = segment.from;
    const to = segment.to;
    const tangent = new THREE.Vector2(to.x - from.x, to.y - from.y).normalize();
    const normal = new THREE.Vector2(-tangent.y, tangent.x);
    const fromLeft = [(from.x + normal.x * halfWidth) * WORLD_SCALE, ROAD_Y + yOffset, (from.y + normal.y * halfWidth) * WORLD_SCALE];
    const fromRight = [(from.x - normal.x * halfWidth) * WORLD_SCALE, ROAD_Y + yOffset, (from.y - normal.y * halfWidth) * WORLD_SCALE];
    const toLeft = [(to.x + normal.x * halfWidth) * WORLD_SCALE, ROAD_Y + yOffset, (to.y + normal.y * halfWidth) * WORLD_SCALE];
    const toRight = [(to.x - normal.x * halfWidth) * WORLD_SCALE, ROAD_Y + yOffset, (to.y - normal.y * halfWidth) * WORLD_SCALE];
    const base = vertices.length / 3;
    [fromLeft, fromRight, toLeft, toRight].forEach((point) => vertices.push(...point));
    if (colors) {
      const color = new THREE.Color(colors[index % colors.length]);
      for (let count = 0; count < 4; count += 1) vertexColors.push(color.r, color.g, color.b);
    }
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addTrack() {
  const track = state.data.track;
  const roadWidth = track.roadHalfWidthM * 2;
  const roadGeometry = makeRibbon(track, roadWidth, 0);
  const road = new THREE.Mesh(roadGeometry, new THREE.MeshStandardMaterial({ color: 0x26343b, roughness: 0.94, metalness: 0.03 }));
  road.receiveShadow = true;
  state.scene.add(road);

  const edgeGeometry = makeRibbon(track, roadWidth + 0.32, 0.015, [0xece4d6, 0xc84f58]);
  const edge = new THREE.Mesh(edgeGeometry, new THREE.MeshBasicMaterial({ vertexColors: true }));
  state.scene.add(edge);

  const centerPoints = state.sampler.nodes.map((node) => new THREE.Vector3(node.x * WORLD_SCALE, ROAD_Y + 0.026, node.y * WORLD_SCALE));
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(centerPoints), new THREE.LineBasicMaterial({ color: 0x82939a, transparent: true, opacity: 0.38 }));
  state.scene.add(line);

  const water = new THREE.Mesh(new THREE.CircleGeometry(190, 80), new THREE.MeshStandardMaterial({ color: 0x0b2734, roughness: 0.33, metalness: 0.18 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.32;
  state.scene.add(water);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x12241e, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.28;
  ground.receiveShadow = true;
  state.scene.add(ground);
  const grid = new THREE.GridHelper(260, 52, 0x2b4a44, 0x193027);
  grid.position.y = -0.26;
  grid.material.transparent = true;
  grid.material.opacity = 0.17;
  state.scene.add(grid);

  const start = sampleTrack(0);
  const startLine = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.035, roadWidth * WORLD_SCALE * 2), new THREE.MeshBasicMaterial({ color: 0xf1f5eb }));
  startLine.position.copy(start.position);
  startLine.position.y = ROAD_Y + 0.045;
  startLine.rotation.y = start.yaw;
  state.scene.add(startLine);
}

function addHarborScenery() {
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0x34434a, roughness: 0.84 }),
    new THREE.MeshStandardMaterial({ color: 0x57483e, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x263c43, roughness: 0.77 })
  ];
  for (let index = 0; index < 27; index += 1) {
    const s = (index / 27) * state.data.track.lengthM + (index % 3) * 17;
    const side = index % 2 === 0 ? 1 : -1;
    const lateral = side * (13 + (index % 4) * 2.5);
    const sample = sampleTrack(s, lateral);
    const height = 1.8 + (index % 5) * 0.75;
    const width = 2.4 + (index % 3) * 1.1;
    const depth = 3.3 + (index % 4) * 1.2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[index % materials.length]);
    mesh.position.copy(sample.position);
    mesh.position.y = height * 0.5 - 0.22;
    mesh.rotation.y = sample.yaw + (index % 2 ? 0.18 : -0.12);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    state.scene.add(mesh);
    if (index % 4 === 0) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6.4, 8), new THREE.MeshStandardMaterial({ color: 0x77848a, metalness: 0.7, roughness: 0.32 }));
      mast.position.copy(sample.position);
      mast.position.y = 3.1;
      mast.rotation.z = 0.02;
      state.scene.add(mast);
      const boom = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 3.1), new THREE.MeshStandardMaterial({ color: 0x9b7549, metalness: 0.5, roughness: 0.35 }));
      boom.position.copy(sample.position);
      boom.position.y = 5.75;
      boom.rotation.y = sample.yaw + Math.PI / 2;
      state.scene.add(boom);
    }
  }
  const beacon = new THREE.PointLight(0x4be0c5, 12, 28, 2);
  const beaconSample = sampleTrack(0, -12);
  beacon.position.copy(beaconSample.position);
  beacon.position.y = 4.2;
  state.scene.add(beacon);
}

function labelSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 420;
  canvas.height = 110;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(5, 10, 14, 0.78)';
  context.roundRect(3, 3, 414, 104, 14);
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = 4;
  context.stroke();
  context.font = '700 34px system-ui, sans-serif';
  context.fillStyle = '#edf6f6';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 210, 57);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(4.2, 1.1, 1);
  sprite.position.y = 2.35;
  return sprite;
}

function makeCar(subject, index) {
  const color = new THREE.Color(colorFor(subject.id));
  const group = new THREE.Group();
  group.name = subject.label;
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.28 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x101a20, roughness: 0.32, metalness: 0.2 });
  const glowMaterial = new THREE.MeshBasicMaterial({ color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.34, 3.1), bodyMaterial);
  body.position.y = 0.48;
  body.castShadow = true;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.18, 0.88), bodyMaterial);
  nose.position.set(0, 0.58, 1.23);
  nose.castShadow = true;
  group.add(nose);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.34, 1.12), darkMaterial);
  cabin.position.set(0, 0.78, -0.18);
  cabin.castShadow = true;
  group.add(cabin);
  const rearWing = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.1, 0.28), bodyMaterial);
  rearWing.position.set(0, 0.78, -1.36);
  group.add(rearWing);
  const frontGlow = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.06, 0.05), glowMaterial);
  frontGlow.position.set(0, 0.59, 1.68);
  group.add(frontGlow);
  const wheelGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.17, 12);
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x070a0c, roughness: 0.92 });
  const wheels = [];
  for (const x of [-0.76, 0.76]) {
    for (const z of [-1.02, 1.03]) {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.31, z);
      wheel.castShadow = true;
      wheels.push(wheel);
      group.add(wheel);
    }
  }
  group.add(labelSprite(`#${index + 1}  ${subject.label}`, colorFor(subject.id)));
  group.userData = { id: subject.id, wheels, baseScale: 1 };
  state.scene.add(group);
  state.carObjects.set(subject.id, group);
}

function createScene() {
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0x071117);
  state.scene.fog = new THREE.Fog(0x071117, 105, 240);
  state.camera = new THREE.PerspectiveCamera(47, 1, 0.1, 500);
  state.camera.position.set(0, 82, 108);
  state.cameraTarget.set(0, 0, 0);
  state.renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, powerPreference: 'high-performance' });
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  state.renderer.shadowMap.enabled = true;
  state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  state.renderer.outputColorSpace = THREE.SRGBColorSpace;
  state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  state.renderer.toneMappingExposure = 1.1;
  state.scene.add(new THREE.HemisphereLight(0x9cbac6, 0x17271d, 2.2));
  const key = new THREE.DirectionalLight(0xffe2b2, 4.2);
  key.position.set(-48, 95, 60);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -125;
  key.shadow.camera.right = 125;
  key.shadow.camera.top = 125;
  key.shadow.camera.bottom = -125;
  state.scene.add(key);
  const rim = new THREE.DirectionalLight(0x4be0c5, 1.4);
  rim.position.set(65, 30, -75);
  state.scene.add(rim);
  state.sampler = buildSampler(state.data.track);
  addTrack();
  addHarborScenery();
  state.run.subjects.forEach((id, index) => makeCar(subjectFor(id), index));
  resize();
}

function frameAt(time) {
  const frames = state.run.frames;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle].t <= time) low = middle;
    else high = middle - 1;
  }
  const first = frames[low] || frames[0];
  const second = frames[Math.min(low + 1, frames.length - 1)] || first;
  const alpha = second.t > first.t ? clamp((time - first.t) / (second.t - first.t), 0, 1) : 0;
  const secondById = new Map(second.cars.map((car) => [car.id, car]));
  return {
    t: time,
    cars: first.cars.map((car) => {
      const next = secondById.get(car.id) || car;
      return {
        ...car,
        s: car.s + (next.s - car.s) * alpha,
        q: car.q + (next.q - car.q) * alpha,
        speed: car.speed + (next.speed - car.speed) * alpha
      };
    })
  };
}

function updateCars(frame) {
  frame.cars.forEach((car) => {
    const object = state.carObjects.get(car.id);
    if (!object) return;
    const sample = sampleTrack(car.s, car.q);
    object.position.copy(sample.position);
    object.position.y += 0.36;
    object.rotation.y = sample.yaw;
    object.scale.setScalar(car.finished ? 0.9 : 1);
    object.userData.wheels.forEach((wheel) => { wheel.rotation.x -= car.speed * 0.012; });
  });
}

function updateCamera(frame, delta) {
  const selected = frame.cars.find((car) => car.id === state.selectedCarId) || frame.cars[0];
  if (!selected) return;
  const selectedSample = sampleTrack(selected.s, selected.q);
  const forward = selectedSample.tangent.clone().normalize();
  const desired = new THREE.Vector3();
  const target = new THREE.Vector3();
  if (state.cameraMode === 'tv') {
    const orbit = Math.sin(state.currentTime * 0.018) * 7;
    desired.set(orbit, 87, 119);
    target.set(0, 0, 0);
  } else if (state.cameraMode === 'chase') {
    desired.copy(selectedSample.position).addScaledVector(forward, -12).add(new THREE.Vector3(0, 6.5, 0));
    target.copy(selectedSample.position).addScaledVector(forward, 15).add(new THREE.Vector3(0, 0.9, 0));
  } else if (state.cameraMode === 'cockpit') {
    desired.copy(selectedSample.position).addScaledVector(forward, 1.15).add(new THREE.Vector3(0, 1.04, 0));
    target.copy(selectedSample.position).addScaledVector(forward, 24).add(new THREE.Vector3(0, 0.8, 0));
  } else {
    const orbit = state.currentTime * 0.22;
    desired.copy(selectedSample.position).add(new THREE.Vector3(Math.cos(orbit) * 17, 7.5, Math.sin(orbit) * 17));
    target.copy(selectedSample.position).add(new THREE.Vector3(0, 0.6, 0));
  }
  const ease = 1 - Math.pow(0.001, Math.max(0.001, delta));
  state.camera.position.lerp(desired, ease);
  state.cameraTarget.lerp(target, ease);
  state.camera.lookAt(state.cameraTarget);
}

function renderLeaderboard(frame) {
  const ordered = [...frame.cars].sort((a, b) => a.rank - b.rank);
  const leader = ordered[0];
  ui.leaderboard.replaceChildren();
  ordered.forEach((car) => {
    const gap = leader ? Math.max(0, leader.s - car.s) : 0;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `leader-row${car.id === state.selectedCarId ? ' selected' : ''}`;
    button.style.setProperty('--driver-color', colorFor(car.id));
    button.setAttribute('aria-label', `Select ${subjectFor(car.id)?.label || car.id}, position ${car.rank}`);
    button.innerHTML = `<span class="leader-rank">P${car.rank}</span><span class="leader-main"><span class="leader-name">${subjectFor(car.id)?.label || car.id}</span><span class="leader-sub">${car.decision} · ${String(car.phase).replaceAll('_', ' ')}</span></span><span class="leader-gap">${car.rank === 1 ? 'LEAD' : `+${gap.toFixed(1)}m`}</span>`;
    button.addEventListener('click', () => { state.selectedCarId = car.id; ui.carSelect.value = car.id; paintHud(frame); });
    ui.leaderboard.append(button);
  });
}

function renderDecisions(frame) {
  ui.decisionStrip.replaceChildren();
  [...frame.cars].sort((a, b) => a.rank - b.rank).forEach((car) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `decision-card${car.id === state.selectedCarId ? ' selected' : ''}`;
    button.style.setProperty('--driver-color', colorFor(car.id));
    button.setAttribute('aria-label', `Select ${subjectFor(car.id)?.label || car.id}: ${car.decision} ${car.phase}`);
    button.innerHTML = `<span class="driver-name">${subjectFor(car.id)?.label || car.id}</span><span class="driver-speed">${car.speed.toFixed(1)} m/s</span><span class="driver-action">${car.decision}</span><span class="driver-phase">${String(car.phase).replaceAll('_', ' ')}</span>`;
    button.addEventListener('click', () => { state.selectedCarId = car.id; ui.carSelect.value = car.id; paintHud(frame); });
    ui.decisionStrip.append(button);
  });
}

function renderEvents() {
  const events = state.run.events.filter((event) => event.t <= state.currentTime + 0.001).slice(-3).reverse();
  ui.eventLog.replaceChildren();
  if (!events.length) { ui.eventLog.innerHTML = '<span class="event-item">Formation lights on</span>'; return; }
  events.forEach((event) => {
    const item = document.createElement('span');
    item.className = 'event-item';
    item.style.setProperty('--event-color', event.carId ? colorFor(event.carId) : 'var(--teal)');
    item.innerHTML = `<strong>${event.tag}</strong>${event.detail}`;
    ui.eventLog.append(item);
  });
}

function paintHud(frame) {
  const ordered = [...frame.cars].sort((a, b) => a.rank - b.rank);
  const leader = ordered[0];
  const selected = frame.cars.find((car) => car.id === state.selectedCarId) || ordered[0];
  if (!selected) return;
  const subject = subjectFor(selected.id);
  const gap = leader ? Math.max(0, leader.s - selected.s) : 0;
  const reasonEvent = state.run.events.filter((event) => event.carId === selected.id && event.t <= state.currentTime && event.type === 'decision').at(-1);
  ui.runStatus.textContent = state.playing ? 'LIVE REPLAY' : state.currentTime >= state.run.duration ? 'CHEQUERED FLAG' : 'PAUSED';
  ui.playButton.textContent = state.playing ? 'Pause' : 'Play';
  ui.lapReadout.textContent = `LAP ${Math.max(...frame.cars.map((car) => car.lap))}/${state.data.track.laps}`;
  ui.timeReadout.textContent = `${formatTime(state.currentTime)} / ${formatTime(state.run.duration)}`;
  ui.finishedLabel.textContent = state.currentTime >= state.run.duration ? 'FINISHED' : state.playing ? 'RUNNING' : 'PAUSED';
  ui.timeline.value = String(state.currentTime);
  ui.selectedColor.style.setProperty('--driver-color', colorFor(selected.id));
  ui.selectedName.textContent = subject?.label || selected.id;
  ui.selectedBranch.textContent = `${subject?.branch || 'pinned branch'} @ ${(subject?.commit || '').slice(0, 7)}`;
  ui.selectedDecision.textContent = selected.decision;
  ui.selectedDecision.style.setProperty('--decision-color', COLORS[selected.decision] || colorFor(selected.id));
  ui.selectedPhase.textContent = String(selected.phase).replaceAll('_', ' ');
  ui.selectedSpeed.textContent = selected.speed.toFixed(1);
  ui.selectedGap.textContent = selected.rank === 1 ? '—' : gap.toFixed(1);
  ui.selectedRank.textContent = `P${selected.rank}`;
  ui.selectedLap.textContent = `lap ${Math.min(state.data.track.laps, selected.lap)}/${state.data.track.laps}`;
  ui.selectedReason.textContent = reasonEvent?.detail || `${subject?.label || selected.id} is following the shared GT reference line.`;
  renderLeaderboard(frame);
  renderDecisions(frame);
  renderEvents();
}

function bindControls() {
  ui.playButton.addEventListener('click', () => { state.playing = !state.playing; state.lastTick = performance.now(); paintHud(frameAt(state.currentTime)); });
  ui.restartButton.addEventListener('click', () => { state.currentTime = 0; state.playing = true; state.lastTick = performance.now(); paintHud(frameAt(0)); });
  ui.speedSelect.addEventListener('change', () => { state.speed = Number(ui.speedSelect.value); });
  ui.cameraSelect.addEventListener('change', () => { state.cameraMode = ui.cameraSelect.value; });
  ui.carSelect.addEventListener('change', () => { state.selectedCarId = ui.carSelect.value; paintHud(frameAt(state.currentTime)); });
  ui.timeline.addEventListener('input', () => { state.currentTime = Number(ui.timeline.value); state.playing = false; paintHud(frameAt(state.currentTime)); });
  ui.fullscreenButton.addEventListener('click', async () => { if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.(); else await document.exitFullscreen?.(); });
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.code === 'Space') { event.preventDefault(); ui.playButton.click(); }
    if (event.key === '1') { state.cameraMode = 'tv'; ui.cameraSelect.value = 'tv'; }
    if (event.key === '2') { state.cameraMode = 'chase'; ui.cameraSelect.value = 'chase'; }
    if (event.key === '3') { state.cameraMode = 'cockpit'; ui.cameraSelect.value = 'cockpit'; }
    if (event.key === '4') { state.cameraMode = 'orbit'; ui.cameraSelect.value = 'orbit'; }
  });
}

function resize() {
  if (!state.renderer || !state.camera) return;
  state.camera.aspect = window.innerWidth / window.innerHeight;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(window.innerWidth, window.innerHeight, false);
}

function animate(now) {
  requestAnimationFrame(animate);
  const delta = Math.min(0.08, Math.max(0, (now - state.lastTick) / 1000));
  state.lastTick = now;
  if (state.playing) {
    state.currentTime = Math.min(state.run.duration, state.currentTime + delta * state.speed);
    if (state.currentTime >= state.run.duration) state.playing = false;
  }
  const frame = frameAt(state.currentTime);
  updateCars(frame);
  updateCamera(frame, delta);
  state.renderer.render(state.scene, state.camera);
  if (now - state.lastHudPaint > 110 || !state.playing) {
    state.lastHudPaint = now;
    paintHud(frame);
  }
}

async function load() {
  try {
    const response = await fetch('./race-data.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`race-data.json returned HTTP ${response.status}`);
    state.data = await response.json();
    state.run = state.data.sandbox?.run || state.data.heats?.[0];
    if (!state.run || state.run.subjects?.length !== 3) throw new Error('Expected a three-car sandbox run. Regenerate the benchmark data.');
    state.subjects = state.data.subjects.filter((subject) => state.run.subjects.includes(subject.id));
    state.selectedCarId = state.run.subjects[0];
    state.sampler = buildSampler(state.data.track);
    ui.seedReadout.textContent = String(state.data.seed);
    ui.timeline.max = String(state.run.duration);
    state.run.subjects.forEach((id) => { const option = document.createElement('option'); option.value = id; option.textContent = subjectFor(id)?.label || id; ui.carSelect.append(option); });
    ui.carSelect.value = state.selectedCarId;
    createScene();
    bindControls();
    paintHud(frameAt(0));
    requestAnimationFrame((now) => { state.lastTick = now; animate(now); });
  } catch (error) {
    ui.loadError.hidden = false;
    ui.loadError.textContent = `The 3D sandbox could not start: ${error.message}`;
  }
}

load();
