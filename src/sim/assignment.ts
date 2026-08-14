import { aircraftClass, isRotorcraft } from '@/content/aircraft';
import { requiredCertification, towerLevel } from '@/content/buildings';
import { hasWorkingFireStation, hasWorkingFuelFarm, workingTowerLevel } from './airport';
import { helipadById, standById, type Services } from './connectivity';
import {
  runwayLength,
  STAND_RANK,
  SURFACE_RANK,
  type Aircraft,
  type AircraftClassId,
  type Airport,
  type BlockReason,
  type DayState,
  type Runway,
} from './types';

/**
 * Runway assignment — the heart of the simulation.
 *
 * Waves play themselves, so this pass is what the player is really building against. It is
 * deliberately deterministic and explainable: every aircraft that is not assigned records
 * *why*, and that reason is what the debrief shows. If this were fuzzy or random the game
 * would be unreadable.
 */

/** Aircraft phases that occupy the tower's attention. */
const MOVEMENT_PHASES = new Set(['approach', 'landing', 'departing']);

export function countMovements(day: DayState): number {
  return day.aircraft.filter((a) => MOVEMENT_PHASES.has(a.phase)).length;
}

/** Where a fixed-wing aircraft is going: a runway to land on and a stand to park on. */
interface Candidate {
  runway: Runway;
  standId: string;
}

/**
 * Where a rotorcraft is going. A pad is both, which is why this shares no fields with
 * `Candidate` and is a separate shape rather than a widened one.
 */
interface PadCandidate {
  padId: string;
}

export type Assignment = Candidate | PadCandidate;

export function isPadCandidate(result: Assignment): result is PadCandidate {
  return 'padId' in result;
}

/**
 * Whether this airport could *ever* take this class, ignoring who is busy right now.
 *
 * Shared by the assignment pass and the planning forecast so the two can never disagree
 * about what the airport is capable of — the forecast promising traffic the simulation then
 * turns away would be worse than no forecast at all.
 */
export function structuralBlock(
  airport: Airport,
  services: Services,
  classId: AircraftClassId,
): BlockReason | null {
  const spec = aircraftClass(classId);

  if (spec.requiresFuelFarm && !hasWorkingFuelFarm(airport, services)) return 'no-fuel-farm';
  if (spec.requiresFireStation && !hasWorkingFireStation(airport, services)) {
    return 'no-fire-station';
  }

  // A rotorcraft skips the entire runway/taxi-link/stand chain: none of it describes anything
  // it uses. Ordered most fundamental first like the rest of this function — no pad at all
  // before a pad nothing can drive to.
  if (isRotorcraft(classId)) {
    // Category A covers rotorcraft, so this can only ever bite if a future heavy type is
    // graded above it — but leaving it out would make that a silent balance bug.
    if (airport.certification < requiredCertification(spec.runwayLength)) return 'not-certified';
    if (airport.helipads.length === 0) return 'no-helipad';
    if (!airport.helipads.some((pad) => services.roadServed.has(pad.id))) return 'no-road-helipad';
    return null;
  }

  // Use comes first: a strip cleared for the wrong thing is not a short runway, it is the
  // wrong runway, and telling the player to lengthen it would send them to build the wrong
  // thing entirely. An airport with nothing built at all keeps the old wording, because
  // "no runway long enough" reads correctly on an empty field.
  const rightUse = airport.runways.filter((r) => r.use === spec.use);
  if (rightUse.length === 0 && airport.runways.length > 0) {
    return spec.use === 'military' ? 'no-military-runway' : 'no-civil-runway';
  }

  const longEnough = rightUse.filter((r) => runwayLength(r) >= spec.runwayLength);
  if (longEnough.length === 0) return 'no-runway-length';

  const goodSurface = longEnough.filter(
    (r) => SURFACE_RANK[r.surface] >= SURFACE_RANK[spec.minSurface],
  );
  if (goodSurface.length === 0) return 'no-runway-surface';

  // Checked *after* the strip is proven adequate, deliberately. Certification is a standing
  // daily fee, so the player should be told to build the runway first and buy the licence
  // last — when they can actually use it — rather than paying rent on a category they have
  // nowhere to put.
  if (airport.certification < requiredCertification(spec.runwayLength)) return 'not-certified';

  // Fire cover and maintenance reach a runway by road, not by taxiway. A strip nothing can
  // drive to cannot be opened, however long it is.
  const roaded = goodSurface.filter((r) => services.roadServed.has(r.id));
  if (roaded.length === 0) return 'no-road-runway';

  let sawAnyLink = false;
  let sawSizedStand = false;
  let sawRoadedStand = false;
  for (const runway of roaded) {
    const linked = services.links.get(runway.id) ?? [];
    if (linked.length > 0) sawAnyLink = true;
    for (const standId of linked) {
      const stand = standById(airport, standId);
      if (!stand) continue;
      if (STAND_RANK[stand.size] < STAND_RANK[spec.standSize]) continue;
      sawSizedStand = true;
      if (services.roadServed.has(stand.id)) sawRoadedStand = true;
    }
  }

  if (!sawAnyLink) return 'no-taxi-link';
  if (!sawSizedStand) return 'no-stand-size';
  // Passengers and baggage leave the aeroplane by road. A stand with none is a parking space.
  if (!sawRoadedStand) return 'no-road-stand';
  return null;
}

/**
 * Finds a runway and stand for `aircraft`, or explains the closest reason it cannot fly.
 *
 * Reasons are ordered from most fundamental to most transient, so the player is told to
 * build a longer runway before being told the runway is busy.
 */
export function findAssignment(
  airport: Airport,
  day: DayState,
  aircraft: Aircraft,
): Assignment | BlockReason {
  const spec = aircraftClass(aircraft.classId);

  const structural = structuralBlock(airport, day.services, aircraft.classId);
  if (structural) return structural;

  if (isRotorcraft(aircraft.classId)) return findHelipadAssignment(airport, day);

  const usable = airport.runways.filter(
    (r) =>
      !r.closed &&
      r.use === spec.use &&
      runwayLength(r) >= spec.runwayLength &&
      SURFACE_RANK[r.surface] >= SURFACE_RANK[spec.minSurface] &&
      day.services.roadServed.has(r.id),
  );
  if (usable.length === 0) return 'runway-busy';

  const options: Candidate[] = [];
  for (const runway of usable) {
    for (const standId of day.services.links.get(runway.id) ?? []) {
      const stand = standById(airport, standId);
      if (!stand) continue;
      if (STAND_RANK[stand.size] < STAND_RANK[spec.standSize]) continue;
      if (!day.services.roadServed.has(stand.id)) continue;
      if (stand.reservedBy !== null) continue;
      if (runway.reservedBy !== null) continue;
      options.push({ runway, standId });
    }
  }

  if (options.length === 0) {
    // Something compatible exists but is occupied right now. Distinguish a busy runway from
    // a full apron so the player knows whether to build tarmac or parking.
    const anyFreeRunway = usable.some((r) => r.reservedBy === null);
    return anyFreeRunway ? 'no-stand' : 'runway-busy';
  }

  // Prefer the shortest adequate runway, keeping the long ones free for aircraft that need
  // them. This is what makes building a second, shorter strip actually pay off.
  options.sort((a, b) => runwayLength(a.runway) - runwayLength(b.runway));
  return options[0]!;
}

/**
 * A free, road-served pad, or the reason there is none right now.
 *
 * Much shorter than the fixed-wing path because a pad is a runway and a stand at once: there
 * is no length, no surface, no taxi link and no stand size to satisfy. Everything structural
 * has already been ruled out by `structuralBlock`, so the only thing left to be is busy.
 */
function findHelipadAssignment(airport: Airport, day: DayState): PadCandidate | BlockReason {
  const pad = airport.helipads.find(
    (p) => p.reservedBy === null && day.services.roadServed.has(p.id),
  );
  return pad ? { padId: pad.id } : 'helipad-busy';
}

function isCandidate(result: Assignment | BlockReason): result is Assignment {
  return typeof result !== 'string';
}

/**
 * One assignment pass. Holding aircraft are considered lowest fuel first, so the aeroplane
 * closest to trouble gets the next slot.
 */
export function assignHoldingAircraft(airport: Airport, day: DayState): void {
  const capacity = towerLevel(workingTowerLevel(airport, day.services)).movements;
  let movements = countMovements(day);

  const waiting = day.aircraft
    .filter((a) => a.phase === 'holding' && a.managed)
    .sort((a, b) => a.fuel - b.fuel);

  for (const aircraft of waiting) {
    const result = findAssignment(airport, day, aircraft);

    if (movements >= capacity) {
      // The tower being busy only counts as the reason if the aircraft could otherwise have
      // been taken. Blaming the tower for an aeroplane that has no runway long enough would
      // send the player off to buy the wrong upgrade.
      aircraft.blockedReason = isCandidate(result) ? 'tower-capacity' : result;
      continue;
    }

    if (!isCandidate(result)) {
      aircraft.blockedReason = result;
      continue;
    }

    // A rotorcraft reserves one pad instead of a runway and a stand. It still costs the tower
    // a movement: a helicopter landing is something the tower has to sequence, and exempting
    // it would let a helipad-only airport bypass the tower entirely.
    if (isPadCandidate(result)) {
      const pad = helipadById(airport, result.padId);
      if (!pad) continue;
      pad.reservedBy = aircraft.id;
      aircraft.padId = pad.id;
    } else {
      const stand = standById(airport, result.standId);
      if (!stand) continue;
      result.runway.reservedBy = aircraft.id;
      stand.reservedBy = aircraft.id;
      aircraft.runwayId = result.runway.id;
      aircraft.standId = stand.id;
    }

    aircraft.blockedReason = null;
    aircraft.phase = 'approach';
    aircraft.timer = aircraftClass(aircraft.classId).approachSeconds;
    movements++;
  }

  // Unmanaged aircraft are outside the tower's stack entirely; that is their reason.
  for (const aircraft of day.aircraft) {
    if (aircraft.phase === 'holding' && !aircraft.managed) {
      aircraft.blockedReason = 'stack-overflow';
    }
  }
}
