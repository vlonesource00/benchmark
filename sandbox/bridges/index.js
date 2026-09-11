import { createShadowTrack } from './shadow.js';
import { createAstraBridge, ASTRA_CANDIDATE } from './astra-bridge.js';
import { createGptBridge, GPT_CANDIDATE } from './gpt-bridge.js';
import { createGeminiBridge, GEMINI_SUPREME, GEMINI_NMPCC, GEMINI_GRAND_PRIX } from './gemini-bridge.js';
import { createCloudBridge, CLOUD_CANDIDATE } from './claude-bridge.js';
import { NextGenAIController as SupremeController } from '../../subjects/gemini-supreme/src/ai/v2/NextGenAIController.js';
import { NextGenAIController as NmpccController } from '../../subjects/gemini-nmpcc/src/ai/v2/NextGenAIController.js';
import { NextGenAIController as GrandPrixController } from '../../subjects/gemini-grand-prix/src/ai/v2/NextGenAIController.js';

export const CANDIDATES = Object.freeze([
  ASTRA_CANDIDATE,
  GPT_CANDIDATE,
  CLOUD_CANDIDATE,
  GEMINI_SUPREME,
  GEMINI_GRAND_PRIX
]);

export const CANDIDATE_IDS = Object.freeze(CANDIDATES.map((candidate) => candidate.id));

/**
 * Builds one source-preserving controller bridge per architecture, in grid-slot
 * order. Pass a rotated `order` to remove grid-position bias across races.
 *
 * The host supplies the canonical race state; each bridge translates only at its
 * own boundary. No controller source, pace profile or behavioural tuning changes.
 */
export function createField({ session, hostTrack, order = CANDIDATE_IDS, onStatus = () => {} }) {
  const cars = session.cars;
  const field = order.slice(0, cars.length);
  // One shared shadow track: Gemini's global solver caches per track identity,
  // and sharing is also what makes the solved line identical for both branches.
  const shadowTrack = createShadowTrack(hostTrack, { id: 'harbor-ring' });
  const bridges = new Array(field.length);

  field.forEach((id, index) => {
    const car = cars[index];
    const candidate = CANDIDATES.find((entry) => entry.id === id)
      ?? [GEMINI_NMPCC, GEMINI_GRAND_PRIX, GEMINI_SUPREME].find((e) => e.id === id);
    car.name = candidate.label.toUpperCase();
    car.color = candidate.color;

    if (id === 'astra') {
      bridges[index] = createAstraBridge({ line: session.lineFor(car), index, aggression: session.aggression });
    } else if (id === 'gpt-racing') {
      onStatus('Binding GPT Racing’s original field director to the shared host…');
      bridges[index] = createGptBridge({ cars, hostTrack, shadowTrack, index });
    } else if (id === 'claude-racing') {
      bridges[index] = createCloudBridge({ cars, hostTrack, index, onStatus });
    } else if (id === 'gemini-supreme') {
      onStatus('Binding the pinned Gemini Supreme controller…');
      bridges[index] = createGeminiBridge({ candidate, cars, hostTrack, shadowTrack, index, Controller: SupremeController });
    } else if (id === 'gemini-nmpcc') {
      onStatus('Binding the pinned Gemini NMPCC controller…');
      bridges[index] = createGeminiBridge({ candidate, cars, hostTrack, shadowTrack, index, Controller: NmpccController });
    } else if (id === 'gemini-grand-prix') {
      onStatus('Binding the pinned Gemini Grand Prix controller…');
      bridges[index] = createGeminiBridge({ candidate, cars, hostTrack, shadowTrack, index, Controller: GrandPrixController });
    } else {
      throw new Error(`Unknown benchmark candidate: ${id}`);
    }
    bridges[index].candidateId = id;
    bridges[index].gridSlot = index;
    bridges[index].carId = car.id;
  });

  return {
    order: field,
    bridges,
    /** Installs the bridges as the session's driver stack. */
    attach() {
      session.autopilot = true;
      for (let i = 0; i < session.drivers.length; i += 1) {
        session.drivers[i] = bridges[i] ?? session.drivers[i];
      }
    },
    step() {
      for (const bridge of bridges) bridge.errors += 0;
    },
    reset() {
      for (const bridge of bridges) bridge.reset?.({ cars, track: hostTrack });
    },
    byId(id) {
      return bridges.find((bridge) => bridge.candidateId === id);
    },
    byCarId(carId) {
      return bridges.find((bridge) => bridge.carId === carId);
    }
  };
}

/** Deterministic round-robin rotations so every car starts in every slot. */
export function rotations(ids = CANDIDATE_IDS) {
  return ids.map((_, offset) => ids.map((_, i) => ids[(i + offset) % ids.length]));
}
