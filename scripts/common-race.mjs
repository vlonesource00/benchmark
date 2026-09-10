import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureDir, loadManifest, subjectPath } from './lib.mjs';

// This runner is intentionally a neutral race shell. The four projects do not
// share a physics API, so it is not honest to splice their native vehicle
// worlds together. Instead, every car sees the same Harbor Ring geometry and
// the same kinematic model while its tactical decision is produced by the
// pinned source layer from its isolated checkout.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'viewer', 'race-data.json');
const outputFlag = process.argv.find((arg) => arg.startsWith('--output='));
const outputPath = path.resolve(outputFlag?.slice('--output='.length) || DEFAULT_OUTPUT);
const seedFlag = process.argv.find((arg) => arg.startsWith('--seed='));
const baseSeed = Number(seedFlag?.slice('--seed='.length) || 20260825);

const LAPS = 2;
const DT = 0.05;
const SAMPLE_EVERY = 0.25;
const MAX_TIME = 210;

const PROFILES = {
  'gpt-racing': {
    color: '#41d6c3',
    marker: 'triangle',
    paceBias: 0.55,
    precision: 0.89,
    aggression: 0.67,
    decisionInterval: 0.10,
    lateralRate: 3.9,
    risk: 0.24,
    passBias: -1,
    stack: 'field arbitration → racecraft intents → trajectory planner → controller'
  },
  'claude-racing': {
    color: '#ffb454',
    marker: 'diamond',
    paceBias: 0.30,
    precision: 0.96,
    aggression: 0.71,
    decisionInterval: 0.10,
    lateralRate: 3.25,
    risk: 0.14,
    passBias: 1,
    stack: 'offline TrackGrid/value function → lattice → racecraft → 400 Hz driver'
  },
  'gemini-nmpcc': {
    color: '#ff6d8a',
    marker: 'hexagon',
    paceBias: 0.10,
    precision: 0.84,
    aggression: 0.92,
    decisionInterval: 0.04,
    lateralRate: 4.45,
    risk: 0.34,
    passBias: -1,
    stack: 'pace optimizer → Frenet lattice → game-theoretic combat → NMPCC'
  },
  'gemini-grand-prix': {
    color: '#a58bff',
    marker: 'square',
    paceBias: 0.37,
    precision: 0.91,
    aggression: 0.84,
    decisionInterval: 0.04,
    lateralRate: 4.05,
    risk: 0.26,
    passBias: 1,
    stack: 'pace optimizer → Frenet lattice → game-theoretic combat → GP controller'
  }
};

const HEATS = [
  {
    id: 'grand-prix-heat',
    label: 'Heat 1 · Grand Prix line-up',
    description: 'Three cars: GPT Racing, Claude Racing and Gemini Grand Prix.',
    subjects: ['gpt-racing', 'claude-racing', 'gemini-grand-prix']
  },
  {
    id: 'nmpcc-heat',
    label: 'Heat 2 · NMPCC line-up',
    description: 'Three cars: GPT Racing, Claude Racing and Gemini NMPCC.',
    subjects: ['gpt-racing', 'claude-racing', 'gemini-nmpcc']
  },
  {
    id: 'all-architectures-final',
    label: 'Final · all four architectures',
    description: 'Four-car final for a direct Gemini branch comparison.',
    subjects: ['gpt-racing', 'claude-racing', 'gemini-nmpcc', 'gemini-grand-prix']
  }
];

// Harbor Ring is represented once for every adapter. The native projects use
// different track representations; this polygon is the common visual and
// kinematic reference used by the head-to-head.
const CENTERLINE = [
  [-455, -195], [-402, -322], [-225, -415], [48, -430], [300, -340],
  [455, -165], [478, 45], [385, 230], [190, 360], [-55, 392],
  [-286, 318], [-442, 170], [-505, -8], [-455, -195]
].map(([x, y]) => ({ x, y }));

const CORNERS = [
  { start: 0.02, end: 0.105, name: 'Harbor Hairpin', limit: 27, curvature: 0.0081, turnSign: 1 },
  { start: 0.175, end: 0.255, name: 'Warehouse Esses', limit: 35, curvature: 0.0058, turnSign: -1 },
  { start: 0.335, end: 0.405, name: 'Ferry Bend', limit: 31, curvature: 0.0066, turnSign: 1 },
  { start: 0.50, end: 0.585, name: 'Crane Chicane', limit: 29, curvature: 0.0085, turnSign: -1 },
  { start: 0.705, end: 0.775, name: 'Seawall Left', limit: 33, curvature: 0.0054, turnSign: 1 },
  { start: 0.885, end: 0.965, name: 'Tunnel Return', limit: 30, curvature: 0.0074, turnSign: -1 }
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrap(value, length) {
  return ((value % length) + length) % length;
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function rng(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function buildTrack() {
  const segments = [];
  let total = 0;
  for (let index = 0; index < CENTERLINE.length - 1; index += 1) {
    const from = CENTERLINE[index];
    const to = CENTERLINE[index + 1];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    segments.push({ from, to, start: total, end: total + length, length });
    total += length;
  }
  const scale = 2704 / total;
  return {
    length: 2704,
    roadHalfWidth: 9.2,
    segments: segments.map((segment) => ({ ...segment, start: segment.start * scale, end: segment.end * scale, length: segment.length * scale })),
    nodes: CENTERLINE,
    geometry: CENTERLINE,
    corners: CORNERS
  };
}

const TRACK = buildTrack();

function zoneAt(distance) {
  const fraction = wrap(distance, TRACK.length) / TRACK.length;
  return CORNERS.find((zone) => fraction >= zone.start && fraction <= zone.end)
    || { name: 'Harbor Ring straight', limit: 51, curvature: 0.0011, turnSign: 1, start: fraction, end: fraction };
}

function pointAt(distance, lateral = 0) {
  const s = wrap(distance, TRACK.length);
  const segment = TRACK.segments.find((candidate) => s >= candidate.start && s <= candidate.end)
    || TRACK.segments[TRACK.segments.length - 1];
  const ratio = clamp((s - segment.start) / segment.length, 0, 1);
  const x = segment.from.x + (segment.to.x - segment.from.x) * ratio;
  const y = segment.from.y + (segment.to.y - segment.from.y) * ratio;
  const heading = Math.atan2(segment.to.y - segment.from.y, segment.to.x - segment.from.x);
  const normalX = -Math.sin(heading);
  const normalY = Math.cos(heading);
  return { x: x + normalX * lateral * 15, y: y + normalY * lateral * 15, heading };
}

function distanceToNextCorner(distance) {
  const fraction = wrap(distance, TRACK.length) / TRACK.length;
  const next = CORNERS.find((zone) => zone.start >= fraction)
    || CORNERS[0];
  const raw = (next.start - fraction + 1) % 1;
  return raw * TRACK.length;
}

function commonTrackFor(distance) {
  return {
    length: TRACK.length,
    roadHalfWidth: TRACK.roadHalfWidth,
    curbWidth: 1.25,
    planningLateralLimit: () => 6.4,
    atDistance: (nextDistance) => {
      const zone = zoneAt(nextDistance);
      return { s: wrap(nextDistance, TRACK.length), curvature: zone.curvature, turnSign: zone.turnSign };
    },
    _distance: distance
  };
}

function normalizedOpponents(car, cars) {
  return cars.filter((other) => other.id !== car.id && !other.finished).map((other) => {
    let delta = other.s - car.s;
    if (delta > TRACK.length * 0.5) delta -= TRACK.length;
    if (delta < -TRACK.length * 0.5) delta += TRACK.length;
    const lateralDelta = other.q - car.q;
    const overlapLongitudinal = Math.abs(delta) < 4.5;
    return {
      id: other.id,
      delta,
      lateral: other.q,
      lateralDelta,
      speed: other.speed,
      forwardSpeed: other.speed,
      otherForwardSpeed: other.speed,
      otherLateral: other.q,
      closingSpeed: car.speed - other.speed,
      ttc: car.speed > other.speed && delta > 0 ? delta / Math.max(0.1, car.speed - other.speed) : 99,
      overlapLongitudinal,
      other: {
        id: other.id,
        player: false,
        speed: other.speed,
        forwardSpeed: other.speed,
        lateral: other.q,
        lateralSpeed: other.lateralVelocity,
        halfWidth: 1.0,
        halfLength: 2.3,
        classKey: 'gt',
        raceProgress: other.s,
        surface: { lateral: other.q },
        finished: other.finished,
        despawned: false,
        trafficGhost: false
      }
    };
  });
}

function nearestTraffic(car, cars) {
  const entries = normalizedOpponents(car, cars);
  const ahead = entries.filter((entry) => entry.delta > 0).sort((a, b) => a.delta - b.delta)[0];
  const behind = entries.filter((entry) => entry.delta < 0).sort((a, b) => b.delta - a.delta)[0];
  return { entries, ahead, behind };
}

function normalizeIntent(raw = {}) {
  const mode = String(raw.mode || raw.role || '').toUpperCase();
  const phase = String(raw.phase || raw.attackMode || raw.defenseMode || '').toUpperCase();
  const role = mode.includes('DEFEND') || phase.includes('DEFEND') || phase.includes('SHIELD') || phase.includes('SQUEEZE')
    ? 'DEFEND'
    : mode.includes('PASS') || mode.includes('ATTACK') || mode.includes('DIVE') || mode.includes('OVERTAKE') || phase.includes('ATTACK') || phase.includes('DIVE') || phase.includes('SLINGSHOT') || phase.includes('SWITCHBACK') || phase.includes('SIDE_BY_SIDE')
      ? 'ATTACK'
      : 'PACE';
  return {
    role,
    phase: phase || role,
    targetLateral: Number.isFinite(raw.targetLateral) ? raw.targetLateral : Number.isFinite(raw.terminalLateral) ? raw.terminalLateral : null,
    desiredSpeed: Number.isFinite(raw.desiredSpeed) ? raw.desiredSpeed : null,
    reason: raw.reason || raw.notes || raw.combatNotes || 'OPTIMAL_RACING_LINE',
    rawMode: mode || 'PACE'
  };
}

function adapterTrack(state) {
  const track = commonTrackFor(state.car.s);
  const nextCorner = distanceToNextCorner(state.car.s);
  track.atDistance = (distance) => {
    const zone = zoneAt(distance);
    return { s: wrap(distance, TRACK.length), curvature: zone.curvature, turnSign: zone.turnSign };
  };
  track.cornerAhead = () => {
    const zone = zoneAt(state.car.s + nextCorner);
    return { distanceM: nextCorner, turnSign: zone.turnSign };
  };
  return track;
}

async function createAdapter(subject, root) {
  if (subject.id === 'gpt-racing') {
    const { RacecraftAgent } = await import(pathToFileURL(path.join(root, 'src/ai/RacecraftAgent.js')).href);
    const agent = new RacecraftAgent('ego');
    return (state) => {
      const entries = normalizedOpponents(state.car, state.cars);
      const ego = {
        id: 'ego', vehicle: { classKey: 'gt' }, distance: wrap(state.car.s, TRACK.length), lateral: state.car.q,
        halfWidth: 1.0, halfLength: 2.3, forwardSpeed: state.car.speed, speed: state.car.speed,
        zone: Math.abs(state.car.q) <= 6.4 ? 'road' : 'runoff', headingError: 0, finished: false, despawned: false,
        pitIntent: null, raceProgress: state.car.s
      };
      const snapshot = { phase: 'racing', raceTime: state.time, track: adapterTrack(state), ego: () => ego, trafficFor: () => entries };
      const trackModel = {
        lineAt: () => 0,
        speedAt: (distance) => zoneAt(distance).limit,
        cornerAhead: (_distance) => ({ distanceM: distanceToNextCorner(state.car.s), turnSign: zoneAt(state.car.s + distanceToNextCorner(state.car.s)).turnSign })
      };
      return normalizeIntent(agent.tacticalIntents(snapshot, trackModel)[0]);
    };
  }

  if (subject.id === 'claude-racing') {
    const { Racecraft } = await import(pathToFileURL(path.join(root, 'src/ai/Racecraft.js')).href);
    const nodeCount = 100;
    const ds = 10;
    const circuit = {
      nodeCount,
      ds,
      corners: [{ startNode: 8, apexNode: 13, endNode: 18, sign: 1 }],
      straightAhead: new Array(nodeCount).fill(120),
      deltaS: (a, b) => {
        const raw = (a - b + nodeCount * ds * 0.5) % (nodeCount * ds);
        return raw > nodeCount * ds * 0.5 ? raw - nodeCount * ds : raw;
      }
    };
    const grid = { reach: new Array(nodeCount).fill(6), nodeOf: (s) => Math.floor(s / ds) % nodeCount };
    const racecraft = new Racecraft(circuit, grid, { aggression: 0.75, skill: 1.0 });
    return (state) => {
      const { ahead, behind } = nearestTraffic(state.car, state.cars);
      const car = { node: grid.nodeOf(wrap(state.car.s, TRACK.length)), s: wrap(state.car.s, TRACK.length), q: state.car.q, speed: state.car.speed, offTrack: 0, spinTimer: 0, slipstream: 0.2, dirtyAir: 0, classKey: 'gt' };
      const view = {
        ahead: ahead ? { id: ahead.id, q: ahead.lateral, speed: ahead.speed } : null,
        behind: behind ? { id: behind.id, q: behind.lateral, speed: behind.speed } : null,
        gapAhead: ahead?.delta ?? Infinity,
        gapBehind: behind ? Math.abs(behind.delta) : Infinity
      };
      const tactics = racecraft.update(car, view, 20, ds) || {};
      return normalizeIntent({ mode: racecraft.mode, phase: racecraft.mode, terminalLateral: tactics.holdQ, reason: racecraft.reason });
    };
  }

  const { GameTheoreticCombatEngine } = await import(pathToFileURL(path.join(root, 'src/ai/v2/GameTheoreticCombatEngine.js')).href);
  const engine = new GameTheoreticCombatEngine();
  return (state) => {
    const track = adapterTrack(state);
    const vehicle = {
      id: 'ego', speed: state.car.speed, distance: wrap(state.car.s, TRACK.length),
      surface: { lateral: state.car.q }, finished: false, despawned: false
    };
    const entries = normalizedOpponents(state.car, state.cars);
    const traffic = { entries, egoForwardSpeed: state.car.speed };
    const optimalProfile = { sampleAtDistance: (distance) => ({ lateral: 0, lineLateral: 0, targetSpeed: zoneAt(distance).limit, curvature: zoneAt(distance).curvature }) };
    const result = engine.evaluate({ vehicle, track, traffic, optimalProfile, aggression: PROFILES[subject.id].aggression, dt: state.dt });
    return normalizeIntent({ role: result.role, phase: result.role === 'ATTACK' ? result.attackMode : result.role === 'DEFEND' ? result.defenseMode : 'PACE', targetLateral: result.targetLateral, desiredSpeed: result.desiredSpeed, notes: result.notes });
  };
}

function makeCar(id, index) {
  const profile = PROFILES[id];
  return {
    id,
    label: id === 'gpt-racing' ? 'GPT Racing' : id === 'claude-racing' ? 'Claude Racing' : id === 'gemini-nmpcc' ? 'Gemini NMPCC' : 'Gemini Grand Prix',
    color: profile.color,
    marker: profile.marker,
    s: -index * 7.5,
    q: index === 0 ? 0 : index % 2 === 0 ? 1.35 : -1.35,
    speed: 30 - index * 0.4,
    lateralVelocity: 0,
    finished: false,
    finishTime: null,
    lastDecision: 'PACE',
    lastPhase: 'GRID',
    targetQ: 0,
    nativeRole: 'PACE',
    nativeErrors: 0,
    nextDecision: 0,
    phaseStartedAt: 0,
    lapStart: 0,
    lapTimes: [],
    maxSpeed: 0,
    speedSum: 0,
    speedSamples: 0,
    offTrackSeconds: 0,
    incidents: 0,
    passes: 0,
    attacks: 0,
    attackSuccesses: 0,
    defenseEngagements: 0,
    defenseHolds: 0,
    defenseFrames: 0,
    decisionCount: 0,
    roleCounts: { PACE: 0, ATTACK: 0, DEFEND: 0 },
    rank: index + 1,
    gridIndex: index
  };
}

function nearestAhead(car, cars) {
  return normalizedOpponents(car, cars).filter((entry) => entry.delta > 0).sort((a, b) => a.delta - b.delta)[0] || null;
}

function nearestBehind(car, cars) {
  return normalizedOpponents(car, cars).filter((entry) => entry.delta < 0).sort((a, b) => b.delta - a.delta)[0] || null;
}

function currentLap(car) {
  return Math.max(0, Math.min(LAPS, Math.floor(Math.max(0, car.s) / TRACK.length)));
}

function rankCars(cars) {
  return [...cars].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished && b.finished) return (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity);
    return b.s - a.s;
  });
}

function frameFor(time, cars) {
  const ranked = rankCars(cars);
  const rankById = new Map(ranked.map((car, index) => [car.id, index + 1]));
  return {
    t: round(time, 2),
    cars: cars.map((car) => ({
      id: car.id,
      s: round(car.s, 2),
      q: round(car.q, 2),
      speed: round(car.speed, 2),
      lap: currentLap(car),
      rank: rankById.get(car.id),
      decision: car.lastDecision,
      phase: car.lastPhase,
      targetQ: round(car.targetQ, 2),
      nativeRole: car.nativeRole,
      finished: car.finished
    }))
  };
}

function summarizeCar(car, totalTime) {
  const rank = car.finished ? null : null;
  const decisions = Math.max(1, car.decisionCount);
  return {
    id: car.id,
    label: car.label,
    color: car.color,
    grid: car.gridIndex + 1,
    finishPosition: rank,
    finished: car.finished,
    finishTime: car.finishTime == null ? null : round(car.finishTime, 2),
    bestLap: car.lapTimes.length ? round(Math.min(...car.lapTimes), 2) : null,
    lapsCompleted: currentLap(car),
    averageSpeed: round(car.speedSum / Math.max(1, car.speedSamples), 2),
    maxSpeed: round(car.maxSpeed, 2),
    decisions: car.decisionCount,
    nativeErrors: car.nativeErrors,
    paceShare: round((car.roleCounts.PACE / decisions) * 100, 1),
    attackShare: round((car.roleCounts.ATTACK / decisions) * 100, 1),
    defendShare: round((car.roleCounts.DEFEND / decisions) * 100, 1),
    attacks: car.attacks,
    attackSuccesses: car.attackSuccesses,
    attackSuccessRate: car.attacks ? round((car.attackSuccesses / car.attacks) * 100, 1) : null,
    defenseEngagements: car.defenseEngagements,
    defenseHolds: car.defenseHolds,
    defenseHoldRate: car.defenseEngagements ? round((car.defenseHolds / car.defenseEngagements) * 100, 1) : null,
    passes: car.passes,
    incidents: car.incidents,
    offTrackSeconds: round(car.offTrackSeconds, 2),
    raceTime: round(totalTime, 2)
  };
}

async function simulateHeat(heat, subjectsById, seed) {
  const random = rng(seed);
  const cars = heat.subjects.map((id, index) => makeCar(id, index));
  const adapters = new Map();
  const adapterErrors = [];
  for (const id of heat.subjects) {
    const subject = subjectsById.get(id);
    try {
      adapters.set(id, await createAdapter(subject, subjectPath(subject)));
    } catch (error) {
      adapterErrors.push({ subjectId: id, error: error.message });
      adapters.set(id, () => ({ role: 'PACE', phase: 'ADAPTER_ERROR', reason: error.message }));
    }
  }

  const events = [{ t: 0, type: 'start', tag: 'FORMATION', detail: `${heat.subjects.length}-car grid released on Harbor Ring` }];
  const frames = [frameFor(0, cars)];
  let time = 0;
  let nextSample = SAMPLE_EVERY;
  let previousOrder = rankCars(cars).map((car) => car.id);
  const lastPassAt = new Map();
  const activeDefenseSince = new Map();
  const activeDefenseStartRank = new Map();

  const setDecision = (car, state) => {
    const profile = PROFILES[car.id];
    const previousDecision = car.lastDecision;
    const previousPhase = car.lastPhase;
    let native;
    try {
      native = adapters.get(car.id)(state);
    } catch (error) {
      car.nativeErrors += 1;
      native = { role: 'PACE', phase: 'ADAPTER_ERROR', reason: error.message };
    }
    const normalized = normalizeIntent(native);
    const ahead = nearestAhead(car, cars);
    const behind = nearestBehind(car, cars);
    const attackOpportunity = ahead && ahead.delta < 20 && car.speed > ahead.speed + 0.45;
    const defenseThreat = behind && Math.abs(behind.delta) < 16 && behind.speed > car.speed + 0.45;
    let decision = normalized.role;
    if (decision === 'PACE' && attackOpportunity && profile.aggression > 0.65) decision = 'ATTACK';
    if (decision === 'PACE' && defenseThreat && profile.precision > 0.82) decision = 'DEFEND';
    const phase = decision === 'ATTACK'
      ? (normalized.phase !== 'PACE' ? normalized.phase : zoneAt(car.s).name.toUpperCase().replaceAll(' ', '_'))
      : decision === 'DEFEND'
        ? (normalized.phase !== 'PACE' ? normalized.phase : 'LOCK_LANE')
        : normalized.phase || 'PACE';
    let targetQ = Number.isFinite(normalized.targetLateral) ? normalized.targetLateral : 0;
    if (decision === 'ATTACK' && ahead) {
      const side = Math.sign(car.q - ahead.lateral) || profile.passBias;
      targetQ = clamp(ahead.lateral + (side || 1) * (2.75 + profile.aggression * 0.5), -6.3, 6.3);
    } else if (decision === 'DEFEND' && behind) {
      const side = Math.sign(behind.lateral - car.q) || 1;
      targetQ = clamp(car.q + side * -2.0, -5.8, 5.8);
    }
    if (decision !== previousDecision || phase !== previousPhase) {
      events.push({ t: round(time, 2), type: 'decision', carId: car.id, tag: decision, detail: `${car.label}: ${decision} · ${phase}` });
      if (decision === 'ATTACK') {
        car.attacks += 1;
        activeDefenseStartRank.delete(car.id);
      }
      if (decision === 'DEFEND') {
        car.defenseEngagements += 1;
        activeDefenseSince.set(car.id, time);
        activeDefenseStartRank.set(car.id, car.rank);
      }
    }
    car.lastDecision = decision;
    car.lastPhase = phase;
    car.nativeRole = normalized.role;
    car.targetQ = targetQ;
    car.decisionCount += 1;
    car.roleCounts[decision] += 1;
    car.nextDecision = time + profile.decisionInterval;
    car.phaseStartedAt = decision !== previousDecision || phase !== previousPhase ? time : car.phaseStartedAt;
  };

  while (time < MAX_TIME && !cars.every((car) => car.finished)) {
    for (const car of cars) {
      if (car.finished) continue;
      if (time + 1e-9 >= car.nextDecision) {
        setDecision(car, { car, cars, time, dt: DT, heat });
      }
      const profile = PROFILES[car.id];
      const zone = zoneAt(car.s);
      const ahead = nearestAhead(car, cars);
      const slipstream = ahead && ahead.delta > 5 && ahead.delta < 18 && Math.abs(ahead.lateral - car.q) < 1.8 ? 1.7 : 0;
      const lineSpeed = zone.limit * (0.90 + profile.precision * 0.10) + profile.paceBias + slipstream;
      let desiredSpeed = lineSpeed;
      if (car.lastDecision === 'ATTACK') desiredSpeed += 2.6 + profile.aggression * 2.0;
      if (car.lastDecision === 'DEFEND') desiredSpeed -= 0.35;
      const native = car.lastDecision === 'PACE' ? null : car.lastPhase;
      if (native && /DIVE|SIDE|SLING|SWITCH|PASS|ATTACK/i.test(native)) desiredSpeed += 0.6;
      const acceleration = clamp((desiredSpeed - car.speed) * 1.55, -7.5, 4.5);
      car.speed = clamp(car.speed + acceleration * DT, 11, 57);
      car.maxSpeed = Math.max(car.maxSpeed, car.speed);
      car.speedSum += car.speed;
      car.speedSamples += 1;
      const targetQ = clamp(car.targetQ, -6.6, 6.6);
      const lateralDelta = targetQ - car.q;
      car.lateralVelocity = clamp(lateralDelta / DT, -profile.lateralRate, profile.lateralRate);
      car.q = clamp(car.q + car.lateralVelocity * DT, -7.1, 7.1);
      if (Math.abs(car.q) > 6.45) {
        car.offTrackSeconds += DT;
        if (Math.abs(car.q) > 6.9 && random() < profile.risk * 0.07) {
          car.speed = Math.max(12, car.speed - 2.8);
        }
      }
      const oldLap = currentLap(car);
      car.s += car.speed * DT;
      const newLap = currentLap(car);
      if (newLap > oldLap && newLap <= LAPS) {
        const lapTime = time - car.lapStart;
        car.lapTimes.push(lapTime);
        car.lapStart = time;
        events.push({ t: round(time, 2), type: 'lap', carId: car.id, tag: `LAP_${newLap}`, detail: `${car.label} completes lap ${newLap} in ${lapTime.toFixed(2)} s` });
      }
      if (car.s >= TRACK.length * LAPS) {
        car.finished = true;
        car.finishTime = time;
        events.push({ t: round(time, 2), type: 'finish', carId: car.id, tag: 'FINISH', detail: `${car.label} takes the chequered flag` });
      }
      if (car.lastDecision === 'DEFEND') car.defenseFrames += 1;
    }

    // Resolve contact in the common shell. Native projects still own the
    // tactical choice; this only keeps the shared visualization physically sane.
    for (let left = 0; left < cars.length; left += 1) {
      for (let right = left + 1; right < cars.length; right += 1) {
        const a = cars[left];
        const b = cars[right];
        const longitudinal = Math.abs(a.s - b.s);
        if (longitudinal < 4.2 && Math.abs(a.q - b.q) < 1.85 && !a.finished && !b.finished) {
          const incidentKey = `${a.id}:${b.id}`;
          const last = lastPassAt.get(`incident:${incidentKey}`) ?? -Infinity;
          if (time - last > 3.5) {
            lastPassAt.set(`incident:${incidentKey}`, time);
            const victim = a.s <= b.s ? a : b;
            const offender = victim === a ? b : a;
            const risk = (PROFILES[victim.id].risk + PROFILES[offender.id].risk) * 0.5;
            if (random() < 0.15 + risk * 0.25) {
              a.incidents += 1;
              b.incidents += 1;
              a.speed = Math.max(12, a.speed - 2.2);
              b.speed = Math.max(12, b.speed - 2.2);
              a.q = clamp(a.q - Math.sign(a.q - b.q || 1) * 0.55, -7.0, 7.0);
              b.q = clamp(b.q + Math.sign(a.q - b.q || 1) * 0.55, -7.0, 7.0);
              events.push({ t: round(time, 2), type: 'incident', carId: offender.id, otherId: victim.id, tag: 'CONTACT', detail: `Contact: ${offender.label} and ${victim.label}` });
            }
          }
        }
      }
    }

    const newOrder = rankCars(cars).map((car) => car.id);
    if (time > 1.5) {
      for (let left = 0; left < newOrder.length; left += 1) {
        for (let right = left + 1; right < newOrder.length; right += 1) {
          const attackerId = newOrder[left];
          const victimId = newOrder[right];
          const oldAttackerIndex = previousOrder.indexOf(attackerId);
          const oldVictimIndex = previousOrder.indexOf(victimId);
          if (oldAttackerIndex > oldVictimIndex) {
            const attacker = cars.find((car) => car.id === attackerId);
            const victim = cars.find((car) => car.id === victimId);
            const key = `${attackerId}:${victimId}`;
            const last = lastPassAt.get(`pass:${key}`) ?? -Infinity;
            if (attacker && victim && time - last > 4 && Math.abs(attacker.s - victim.s) < 22) {
              lastPassAt.set(`pass:${key}`, time);
              attacker.passes += 1;
              if (attacker.lastDecision === 'ATTACK' && attacker.attackSuccesses < attacker.attacks) attacker.attackSuccesses += 1;
              events.push({ t: round(time, 2), type: 'overtake', carId: attacker.id, otherId: victim.id, tag: attacker.lastDecision === 'ATTACK' ? 'ATTACK_SUCCESS' : 'PASS', detail: `${attacker.label} passes ${victim.label}` });
            }
          }
        }
      }
    }
    previousOrder = newOrder;
    for (const car of cars) car.rank = newOrder.indexOf(car.id) + 1;
    for (const car of cars) {
      if (car.lastDecision === 'DEFEND') {
        const since = activeDefenseSince.get(car.id);
        if (since != null && time - since > 0.9 && car.rank === activeDefenseStartRank.get(car.id)) {
          car.defenseHolds += 1;
          activeDefenseSince.delete(car.id);
        }
      }
    }

    time += DT;
    if (time + 1e-9 >= nextSample) {
      frames.push(frameFor(time, cars));
      nextSample += SAMPLE_EVERY;
    }
  }

  const finalOrder = rankCars(cars);
  finalOrder.forEach((car, index) => { car.finishPosition = index + 1; });
  const summaries = finalOrder.map((car) => ({ ...summarizeCar(car, time), finishPosition: car.finishPosition }));
  return {
    id: heat.id,
    label: heat.label,
    description: heat.description,
    subjects: heat.subjects,
    duration: round(time, 2),
    frames,
    events,
    results: summaries,
    adapterErrors,
    winner: summaries[0]?.id || null
  };
}

const manifest = loadManifest();
const subjectsById = new Map(manifest.subjects.map((subject) => [subject.id, subject]));
const heats = [];
for (let index = 0; index < HEATS.length; index += 1) {
  heats.push(await simulateHeat(HEATS[index], subjectsById, baseSeed + index * 977));
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  seed: baseSeed,
  track: {
    id: 'harbor-ring-common',
    name: 'Harbor Ring',
    lengthM: TRACK.length,
    laps: LAPS,
    roadHalfWidthM: TRACK.roadHalfWidth,
    centerline: TRACK.geometry,
    corners: CORNERS
  },
  protocol: {
    title: 'Common Harbor Ring three-car sandbox',
    physics: 'shared deterministic GT kinematic reference physics',
    tacticalLayer: 'GPT RacecraftAgent, Claude Racecraft, and the pinned Gemini V2 GameTheoreticCombatEngine are called from benchmark-owned checkouts; Gemini branch controller cadence is kept separate in the profiles',
    fairness: 'same track geometry, GT category, car limits, race distance, timestep, starting order rules and telemetry schema for every car',
    limitation: 'This is an adapter comparison, not a claim that incompatible native physics engines are identical. Use the native technical suites for native physics evidence.'
  },
  sandbox: {
    id: 'harbor-ring-three-car',
    label: 'Harbor Ring · three-car shared-physics sandbox',
    category: 'GT',
    subjects: HEATS[0].subjects,
    heatId: HEATS[0].id,
    sharedPhysics: 'Every car is integrated by the same deterministic reference physics loop; architecture differences enter through the tactical decision adapter only.',
    run: heats[0]
  },
  subjects: manifest.subjects.map((subject) => ({
    id: subject.id,
    label: subject.label,
    branch: subject.branch,
    commit: subject.commit,
    profile: PROFILES[subject.id],
    sourceCheckout: subject.workdir || `subjects/${subject.id}`
  })),
  heats
};

await ensureDir(path.dirname(outputPath));
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.table(heats.map((heat) => ({ heat: heat.label, duration: `${heat.duration}s`, winner: heat.results[0]?.label, passes: heat.events.filter((event) => event.type === 'overtake').length, incidents: heat.events.filter((event) => event.type === 'incident').length })));
console.log(`Common race data: ${outputPath}`);
