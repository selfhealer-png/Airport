import { aircraftClass, isRotorcraft } from '@/content/aircraft';
import {
  certificationLevel,
  CERTIFICATION_LEVELS,
  requiredCertification,
  TERMINAL_MODULES,
  towerLevel,
} from '@/content/buildings';
import { arrivalsForDay, generateSchedule } from '@/content/schedule';
import { terminalsOf, workingTerminalCapacity, workingTowerLevel } from './airport';
import { structuralBlock } from './assignment';
import { buildServices, type Services } from './connectivity';
import { explainReason } from './step';
import { STAND_RANK, type AircraftClassId, type DayState, type GameState } from './types';

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
  const schedule = generateSchedule(state.day, state.seed);
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

/**
 * Rotorcraft, which are the other traffic that shares nothing with the runways.
 *
 * The same two failures as the military strip, and the first one is the reason this exists:
 * the debrief only explains aeroplanes that were *lost*, and "no helipad" on a field covered
 * in perfectly good runways is the kind of thing a player reads as a bug rather than a
 * missing building.
 */
function rotorAdvice(state: GameState): Advice[] {
  const advice: Advice[] = [];
  const booked = generateSchedule(state.day, state.seed).filter((a) =>
    isRotorcraft(a.classId),
  ).length;
  const pads = state.airport.helipads.length;

  if (booked > 0 && pads === 0) {
    advice.push({
      tone: 'warn',
      text:
        `${booked} helicopter movement${booked === 1 ? ' is' : 's are'} booked in and you have ` +
        'no helipad. They do not use a runway at all — a pad is a runway and a stand in one ' +
        'tile, and it needs a road like everything else.',
    });
  }

  if (booked === 0 && pads > 0) {
    advice.push({
      tone: 'info',
      text: 'Nothing rotary is booked today, so your helipads will sit idle.',
    });
  }

  return advice;
}

/**
 * The aerodrome licence, which is the only thing in the game that costs money every day
 * whether it earns anything or not.
 *
 * Both directions matter and neither is visible from the map. Traffic booked in above your
 * category is turned away with nothing on the field to explain why; a category above anything
 * that is booked is a standing charge against nothing at all.
 */
function certificationAdvice(state: GameState): Advice[] {
  const advice: Advice[] = [];
  const held = state.airport.certification;
  const schedule = generateSchedule(state.day, state.seed);
  if (schedule.length === 0) return advice;

  const needed = Math.max(
    ...schedule.map((a) => requiredCertification(aircraftClass(a.classId).runwayLength)),
  );

  if (needed > held) {
    const blocked = schedule.filter(
      (a) => requiredCertification(aircraftClass(a.classId).runwayLength) > held,
    ).length;
    const next = certificationLevel(held + 1);
    advice.push({
      tone: 'warn',
      text:
        `${blocked} booked movement${blocked === 1 ? '' : 's'} need a licence you do not hold. ` +
        `${next.name} costs £${next.dailyCost.toLocaleString()} a day, every day — so it is ` +
        'worth holding only once the runways and stands to use it are there.',
    });
  }

  // Only worth saying when it is actually costing something: category A is free.
  if (held > needed && certificationLevel(held).dailyCost > 0) {
    advice.push({
      tone: 'info',
      text:
        `Nothing booked today needs ${certificationLevel(held).name}, and it is costing ` +
        `£${certificationLevel(held).dailyCost.toLocaleString()} a day. You can give it up and ` +
        'take it back later.',
    });
  }

  return advice;
}

/** Whether the terminals can cope with what is booked in, and whether every module counts. */
function terminalAdvice(state: GameState, services: Services): Advice[] {
  const advice: Advice[] = [];
  const { airport } = state;
  // Pooled: capacity is what every working module of every working terminal adds up to.
  const terminals = workingTerminalCapacity(airport, services);
  const cores = terminalsOf(airport).length;

  const expected = generateSchedule(state.day, state.seed).reduce(
    (sum, arrival) => sum + aircraftClass(arrival.classId).passengers,
    0,
  );

  if (expected > terminals.passengerCapacity) {
    advice.push({
      tone: 'warn',
      text:
        `About ${expected} passengers are booked in and your terminals can process ` +
        `${terminals.passengerCapacity}. The overflow still lands, but you earn only the ` +
        'landing fee for them. ' +
        (cores === 0
          ? 'Build a terminal.'
          : 'Add a gate hall beside the terminal — each one takes another 260 a day.'),
    });
  }

  /*
   * A module that reaches no terminal is the failure this advice exists for.
   *
   * It is the one mistake modules make possible that the build system cannot refuse: a
   * placement legal when it was made, orphaned later by demolishing the middle of a chain or
   * simply never given a road. The building is still there, so nothing looks wrong.
   */
  const modules = airport.facilities.filter((f) => TERMINAL_MODULES.has(f.type));
  const stranded = modules.filter((m) => !services.terminalModules.has(m.id)).length;
  if (stranded > 0) {
    advice.push({
      tone: 'warn',
      text:
        `${stranded} terminal ${stranded === 1 ? 'module does' : 'modules do'} nothing: ` +
        'each one needs a road, and a chain of modules back to the terminal itself.',
    });
  }

  const gateHalls = airport.facilities.filter((f) => f.type === 'gate-hall').length;
  const shops = airport.facilities.filter((f) => f.type === 'shop').length;

  if (cores > 0 && gateHalls > 0 && shops === 0 && expected > 80) {
    advice.push({
      tone: 'info',
      text: 'Retail units earn on every passenger who walks past. You have none.',
    });
  } else if (cores > 0 && shops >= gateHalls && gateHalls > 0) {
    advice.push({
      tone: 'info',
      text:
        'Every gate hall has its parade of shops. Another gate hall would make room for ' +
        'another retail unit as well as taking more passengers.',
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
  advice.push(...rotorAdvice(state));
  advice.push(...certificationAdvice(state));
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
  const schedule = generateSchedule(state.day, state.seed);
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
  return generateSchedule(state.day, state.seed).reduce(
    (sum, arrival) => sum + aircraftClass(arrival.classId).passengers,
    0,
  );
}

/**
 * Whether the airport wants the player's attention, and why.
 *
 * This is the whole of auto-play's judgement: it runs day after day while this returns null,
 * and hands control back the moment it returns a reason. Kept here, pure and beside the
 * advice it reads, so what the game considers "a problem" is one definition rather than two
 * that can drift apart — and so it can be tested without a browser.
 *
 * Three things count, in the order a player would care about them:
 *
 * 1. Something was lost in the day just played. Whatever the cause, an aeroplane that did not
 *    get down is worth looking at.
 * 2. Tomorrow brings traffic this airport structurally cannot take — the runway is too short,
 *    the surface too soft, no stand big enough, the licence not held. `structuralBlock` is the
 *    same function the assignment pass uses, so this can never claim a problem the simulation
 *    would not actually hit.
 * 3. The advice panel has a warning. This is the broad net: an undersized terminal, buildings
 *    with no road, a military strip standing idle. It will stop more often as the campaign
 *    gets busy, which is the point — by then there usually *is* something worth doing.
 *
 * `lastDay` is optional so the check also works during planning, before any day has run.
 */
export function needsAttention(state: GameState, lastDay?: DayState | null): string | null {
  if (lastDay) {
    const lost = lastDay.events.filter((event) => event.outcome !== 'landed');
    const first = lost[0];
    if (first) {
      return lost.length === 1
        ? `An aeroplane was lost — ${explainReason(first.reason)}.`
        : `${lost.length} aeroplanes were lost — ${explainReason(first.reason)}.`;
    }
  }

  const blocked = tomorrowsTraffic(state).find((entry) => entry.problem);
  if (blocked) {
    return `${blocked.count}x ${blocked.name} booked in: ${blocked.problem}.`;
  }

  const warning = airportAdvice(state).find((item) => item.tone === 'warn');
  return warning ? warning.text : null;
}

/** How busy the coming day is, for the planning HUD. */
export function expectedArrivals(state: GameState): number {
  return arrivalsForDay(state.day);
}
