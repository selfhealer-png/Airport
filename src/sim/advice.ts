import { aircraftClass } from '@/content/aircraft';
import { terminalLevel, towerLevel } from '@/content/buildings';
import { arrivalsForDay, generateSchedule } from '@/content/schedule';
import { workingTerminalLevel, workingTowerLevel } from './airport';
import { structuralBlock } from './assignment';
import { buildServices, type Services } from './connectivity';
import { explainReason } from './step';
import { STAND_RANK, type AircraftClassId, type GameState } from './types';

/**
 * Advice shown during planning.
 *
 * The debrief explains aeroplanes that were *lost*. This covers the other failure: money
 * spent on something that quietly does nothing — a runway with no taxiway to a stand, a
 * second runway when the tower can only work one aeroplane at a time, or since roads
 * arrived, a building nothing can drive to. Without this the player sees an idle runway and
 * concludes the game is broken.
 *
 * Pure, like the rest of `sim/`, so the wording is testable.
 */

export type AdviceTone = 'warn' | 'info';

export interface Advice {
  readonly tone: AdviceTone;
  readonly text: string;
}

/** Buildings that are standing there doing nothing because no road reaches them. */
function roadAdvice(state: GameState, services: Services): Advice[] {
  const { airport } = state;
  const advice: Advice[] = [];

  /*
   * Said first, and in preference to everything below, because it is the one failure whose
   * symptom looks nothing like its cause. A player who has dutifully put a road tile beside
   * the runway *and* beside the stand is then told the runway has no road — which reads as a
   * bug, not as "those two bits of road never met".
   */
  if (services.roadIslands > 1) {
    advice.push({
      tone: 'warn',
      text:
        `Your roads are in ${services.roadIslands} separate pieces. Only the biggest one counts ` +
        'as the airport road, so anything served by the others is shut. Join them into a ' +
        'single run that passes everything: the runway, every stand, and every building.',
    });
  }

  const stranded = airport.facilities.filter((f) => !services.roadServed.has(f.id));
  if (stranded.length > 0) {
    const names = [...new Set(stranded.map((f) => f.type.replace('-', ' ')))].join(', ');
    advice.push({
      tone: 'warn',
      text:
        `No road reaches your ${names}. A building with no road has no staff and no ` +
        'deliveries, so it does nothing at all — join it to the rest of your road network.',
    });
  }

  const unroadedRunways = airport.runways.filter((r) => !services.roadServed.has(r.id));
  if (unroadedRunways.length > 0) {
    advice.push({
      tone: 'warn',
      text:
        unroadedRunways.length === 1
          ? 'One runway has no road alongside it, so it cannot be opened — fire cover has to ' +
            'be able to reach it.'
          : `${unroadedRunways.length} runways have no road alongside them, so they cannot ` +
            'be opened.',
    });
  }

  const unroadedStands = airport.stands.filter((s) => !services.roadServed.has(s.id));
  if (unroadedStands.length > 0 && unroadedStands.length === airport.stands.length) {
    advice.push({
      tone: 'warn',
      text: 'No road reaches your stands, so there is no way to get passengers off an aeroplane.',
    });
  } else if (unroadedStands.length > 0) {
    advice.push({
      tone: 'warn',
      text:
        unroadedStands.length === 1
          ? 'One stand has no road to it and cannot be used.'
          : `${unroadedStands.length} stands have no road to them and cannot be used.`,
    });
  }

  return advice;
}

/**
 * Military work, which is the one part of the airport that cannot share anything.
 *
 * Both directions are worth saying out loud, because the exclusivity is the whole mechanic and
 * neither failure looks like a failure: booked military traffic with nowhere to put it, and a
 * dedicated strip sitting empty because nothing military is due.
 */
function militaryAdvice(state: GameState): Advice[] {
  const advice: Advice[] = [];
  const schedule = generateSchedule(state.day, state.reputation, state.seed);
  const militaryBooked = schedule.filter((a) => aircraftClass(a.classId).use === 'military').length;
  const strips = state.airport.runways.filter((r) => r.use === 'military');

  if (militaryBooked > 0 && strips.length === 0) {
    advice.push({
      tone: 'warn',
      text:
        `${militaryBooked} military movement${militaryBooked === 1 ? ' is' : 's are'} booked in ` +
        'and you have no military strip. They will not use an airliner runway, and an airliner ' +
        'will not use theirs — it has to be a runway of its own.',
    });
  }

  if (militaryBooked === 0 && strips.length > 0) {
    advice.push({
      tone: 'info',
      text:
        'Nothing military is booked today, so your military strip will sit idle. No airliner ' +
        'can be sent to it.',
    });
  }

  return advice;
}

/** Whether the terminal can cope with what is booked in, and whether retail is paying. */
function terminalAdvice(state: GameState, services: Services): Advice[] {
  const advice: Advice[] = [];
  const level = terminalLevel(workingTerminalLevel(state.airport, services));

  const expected = generateSchedule(state.day, state.reputation, state.seed).reduce(
    (sum, arrival) => sum + aircraftClass(arrival.classId).passengers,
    0,
  );

  if (expected > level.passengerCapacity) {
    advice.push({
      tone: 'warn',
      text:
        `About ${expected} passengers are booked in and the terminal can process ` +
        `${level.passengerCapacity}. The overflow still lands, but you earn only the landing ` +
        'fee for them and they remember it. Upgrade the terminal.',
    });
  }

  const shopsBuilt = state.airport.facilities.filter((f) => f.type === 'shop').length;
  const shopsWorking = state.airport.facilities.filter(
    (f) => f.type === 'shop' && services.roadServed.has(f.id),
  ).length;

  if (shopsBuilt > level.shopSlots) {
    advice.push({
      tone: 'warn',
      text:
        `Your terminal has room for ${level.shopSlots} shop${level.shopSlots === 1 ? '' : 's'}` +
        ` and you have built ${shopsBuilt}. The extras trade nothing.`,
    });
  } else if (shopsBuilt === 0 && level.shopSlots > 0 && expected > 80) {
    advice.push({
      tone: 'info',
      text: 'Shops next to the terminal earn on every passenger who walks past. You have none.',
    });
  } else if (shopsWorking < shopsBuilt) {
    advice.push({
      tone: 'warn',
      text: 'A shop only trades if it sits next to the terminal and has a road to it.',
    });
  }

  return advice;
}

export function airportAdvice(state: GameState): Advice[] {
  const { airport } = state;
  const advice: Advice[] = [];
  const services = buildServices(airport);

  if (airport.runways.length === 0) {
    advice.push({ tone: 'info', text: 'Drag out a runway to get started.' });
    return advice;
  }

  if (airport.stands.length === 0) {
    advice.push({
      tone: 'warn',
      text: 'No stands. A landed aeroplane needs somewhere to park, or it blocks the runway.',
    });
  }

  advice.push(...roadAdvice(state, services));

  const orphans = airport.runways.filter(
    (runway) => (services.links.get(runway.id) ?? []).length === 0,
  );
  if (orphans.length > 0 && airport.stands.length > 0) {
    advice.push({
      tone: 'warn',
      text:
        orphans.length === 1
          ? 'One runway has no taxiway to a stand, so nothing can land on it.'
          : `${orphans.length} runways have no taxiway to a stand, so nothing can land on them.`,
    });
  }

  // The constraint players hit first and understand last: runways are useless beyond what
  // the tower can sequence at once.
  const towerLevelNow = workingTowerLevel(airport, services);
  const movements = towerLevel(towerLevelNow).movements;
  const usable = airport.runways.length - orphans.length;
  if (usable > movements) {
    advice.push({
      tone: 'warn',
      text:
        towerLevelNow === 0
          ? 'Without a working control tower only one aeroplane can move at a time, so your ' +
            'extra runways sit idle. Build a tower.'
          : `Your tower can work ${movements} aeroplanes at once, so ${usable} runways is more ` +
            'than it can use. Upgrade the tower.',
    });
  }

  // A stand nothing can reach is money sitting idle just as surely as an orphan runway.
  const linked = new Set([...services.links.values()].flat());
  const strandedStands = airport.stands.filter((stand) => !linked.has(stand.id));
  if (strandedStands.length > 0) {
    advice.push({
      tone: 'warn',
      text:
        strandedStands.length === 1
          ? 'One stand has no taxiway back to a runway.'
          : `${strandedStands.length} stands have no taxiway back to a runway.`,
    });
  }

  advice.push(...militaryAdvice(state));
  advice.push(...terminalAdvice(state, services));

  // Largest stand caps the biggest aircraft the airport can accept at all.
  const biggest = airport.stands.reduce(
    (best, stand) => (STAND_RANK[stand.size] > STAND_RANK[best] ? stand.size : best),
    'small' as const satisfies string as 'small' | 'medium' | 'large',
  );
  if (advice.length === 0 && biggest === 'small') {
    advice.push({
      tone: 'info',
      text: 'Only small stands here. Bigger aeroplanes will need bigger parking.',
    });
  }

  return advice;
}

export interface ForecastEntry {
  readonly classId: AircraftClassId;
  readonly name: string;
  readonly count: number;
  /** Why this airport cannot take the class today, or null if it can. */
  readonly problem: string | null;
}

/**
 * What is booked in for the coming day, and which of it the airport cannot currently handle.
 *
 * This is the information the player was missing: traffic escalates on a fixed schedule, and
 * without seeing it coming there is no way to know that tomorrow needs a longer runway or a
 * harder surface until the aeroplanes are already turning away. It shares
 * `structuralBlock` with the assignment pass, so it cannot promise something the simulation
 * would then refuse.
 */
export function tomorrowsTraffic(state: GameState): ForecastEntry[] {
  const schedule = generateSchedule(state.day, state.reputation, state.seed);
  const services = buildServices(state.airport);

  const counts = new Map<AircraftClassId, number>();
  for (const arrival of schedule) {
    counts.set(arrival.classId, (counts.get(arrival.classId) ?? 0) + 1);
  }

  return [...counts]
    .map(([classId, count]) => {
      const blocked = structuralBlock(state.airport, services, classId);
      return {
        classId,
        name: aircraftClass(classId).name,
        count,
        problem: blocked ? explainReason(blocked) : null,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/** Passengers booked in for the day, for the planning HUD. */
export function expectedPassengers(state: GameState): number {
  return generateSchedule(state.day, state.reputation, state.seed).reduce(
    (sum, arrival) => sum + aircraftClass(arrival.classId).passengers,
    0,
  );
}

/** How busy the coming day is, for the planning HUD. */
export function expectedArrivals(state: GameState): number {
  return arrivalsForDay(state.day);
}
