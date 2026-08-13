import { aircraftClass, isRotorcraft } from '@/content/aircraft';
import {
  CRASH_COST,
  FUEL_FARM_TURNAROUND_FACTOR,
  passengerRevenue,
  towerLevel,
} from '@/content/buildings';
import {
  hasWorkingFuelFarm,
  workingShops,
  workingTerminalCapacity,
  workingTowerLevel,
} from './airport';
import { assignHoldingAircraft } from './assignment';
import { buildServices, helipadById, runwayById, standById } from './connectivity';
import {
  runwayLength,
  SURFACE_RANK,
  type Aircraft,
  type Airport,
  type DayEvent,
  type DayState,
  type GameState,
  type ScheduledArrival,
} from './types';

/** Simulation tick rate. Rendering is decoupled; speed controls run this more times a frame. */
export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;

/**
 * How long a day runs before the airport closes to new arrivals.
 *
 * Short on purpose: the interesting part of this game is the planning between days, so a day
 * should resolve quickly enough that the player is never waiting to get back to building.
 */
export const DAY_SECONDS = 50;

/**
 * Phases where an aeroplane is still *arriving*.
 *
 * The day ends once every inbound has been dealt with — landed, diverted or crashed. It
 * deliberately does not wait for turnarounds and departures: those carry on for a couple of
 * minutes after the last landing, and watching an empty sky is not gameplay. Departures
 * still compete for runways while the day runs, so the throughput pressure they create is
 * unchanged.
 */
const ARRIVAL_PHASES = new Set(['holding', 'approach', 'landing', 'taxi-in']);

/**
 * Reasons no amount of waiting can fix, because they describe something the airport does not
 * have rather than something it is busy with.
 */
const STRUCTURAL_REASONS: ReadonlySet<string> = new Set([
  'no-military-runway',
  'no-civil-runway',
  'no-runway-length',
  'no-runway-surface',
  'no-road-runway',
  'no-taxi-link',
  'no-stand-size',
  'no-road-stand',
  'no-helipad',
  'no-road-helipad',
  'no-fuel-farm',
  'no-fire-station',
]);

/**
 * How long an aeroplane holds before being turned away for a structural reason.
 *
 * Long enough for the player to see it arrive and register the warning, short enough that a
 * day is not spent watching aircraft orbit for something that is never going to appear.
 */
const STRUCTURAL_HOLD_SECONDS = 10;

/** Phases driven by `aircraft.timer` counting down. */
const TIMED_PHASES = new Set([
  'approach',
  'landing',
  'taxi-in',
  'parked',
  'taxi-out',
  'departing',
]);

/**
 * A day is over when every scheduled arrival has appeared and been dealt with.
 *
 * There is deliberately no "wait for the clock to run out": arrivals are only scheduled into
 * the first three quarters of the day, so waiting for `DAY_SECONDS` just adds dead air after
 * the last aeroplane is down. A well-run airport therefore finishes its day early, which is
 * a reward rather than an inconsistency.
 */
export function isDayFinished(day: DayState): boolean {
  return (
    day.nextArrival >= day.schedule.length &&
    !day.aircraft.some((a) => ARRIVAL_PHASES.has(a.phase))
  );
}

export function startDay(state: GameState, schedule: readonly ScheduledArrival[]): DayState {
  for (const runway of state.airport.runways) {
    runway.reservedBy = null;
    runway.closed = false;
  }
  for (const stand of state.airport.stands) {
    stand.reservedBy = null;
  }
  for (const pad of state.airport.helipads) {
    pad.reservedBy = null;
  }

  const day: DayState = {
    day: state.day,
    schedule,
    elapsed: 0,
    nextArrival: 0,
    nextAircraftId: 1,
    aircraft: [],
    events: [],
    services: buildServices(state.airport),
    passengersHandled: 0,
    passengersTurnedAway: 0,
  };
  // The campaign's service record counts everything that was booked in, whether or not it
  // ever gets down. Counted here rather than at the debrief so a day abandoned mid-flight
  // still shows up as traffic the airport was offered.
  state.scheduledTotal += schedule.length;
  state.current = day;
  state.phase = 'day';
  return day;
}

function spawnArrivals(day: DayState): void {
  while (day.nextArrival < day.schedule.length) {
    const arrival = day.schedule[day.nextArrival]!;
    if (arrival.atSeconds > day.elapsed) break;
    day.aircraft.push({
      id: day.nextAircraftId++,
      classId: arrival.classId,
      phase: 'holding',
      fuel: aircraftClass(arrival.classId).endurance,
      timer: 0,
      managed: false,
      runwayId: null,
      standId: null,
      padId: null,
      blockedReason: null,
    });
    day.nextArrival++;
  }
}

/**
 * The tower can only look after so many aeroplanes at once. Those inside the stack are
 * sequenced and can divert safely; the overflow is unmanaged and will crash if it runs dry.
 * Arrival order decides who is inside — first come, first managed.
 */
function updateStackManagement(airport: Airport, day: DayState): void {
  const capacity = towerLevel(workingTowerLevel(airport, day.services)).stackCapacity;
  const holding = day.aircraft.filter((a) => a.phase === 'holding').sort((a, b) => a.id - b.id);
  holding.forEach((aircraft, index) => {
    aircraft.managed = index < capacity;
  });
}

function releaseRunway(airport: Airport, aircraft: Aircraft): void {
  if (!aircraft.runwayId) return;
  const runway = runwayById(airport, aircraft.runwayId);
  if (runway?.reservedBy === aircraft.id) runway.reservedBy = null;
  aircraft.runwayId = null;
}

function releaseStand(airport: Airport, aircraft: Aircraft): void {
  if (!aircraft.standId) return;
  const stand = standById(airport, aircraft.standId);
  if (stand?.reservedBy === aircraft.id) stand.reservedBy = null;
  aircraft.standId = null;
}

/**
 * A pad is the rotorcraft's runway and its stand at once, so it is held from approach right
 * through the turnaround and released in one go — there is no pushback that frees a gate
 * early, which is exactly what makes a second pad worth buying.
 */
function releasePad(airport: Airport, aircraft: Aircraft): void {
  if (!aircraft.padId) return;
  const pad = helipadById(airport, aircraft.padId);
  if (pad?.reservedBy === aircraft.id) pad.reservedBy = null;
  aircraft.padId = null;
}

function record(state: GameState, day: DayState, event: DayEvent): void {
  day.events.push(event);
  state.cash += event.cash;
  if (event.outcome === 'landed') state.landedTotal += 1;
}

/**
 * A landing pays twice: a landing fee that is always collected, and the passengers — but
 * only as many of them as the terminal can process today.
 *
 * That split is the whole point of the terminal. A bigger runway lets a bigger aeroplane in;
 * it does not let you do anything with the three hundred people on board. Freighters carry
 * nobody, which is what makes a long runway worth building before a big terminal.
 */
function land(state: GameState, day: DayState, aircraft: Aircraft): void {
  const spec = aircraftClass(aircraft.classId);
  // Pooled across every working terminal: capacity sums, the fare rate is a capacity-weighted
  // blend. See `workingTerminalCapacity`.
  const terminals = workingTerminalCapacity(state.airport, day.services);

  const room = Math.max(0, terminals.passengerCapacity - day.passengersHandled);
  const processed = Math.min(spec.passengers, room);
  const turnedAway = spec.passengers - processed;
  day.passengersHandled += processed;
  day.passengersTurnedAway += turnedAway;

  const shops = workingShops(state.airport, day.services);
  const fare = Math.round(spec.fare * terminals.fareMultiplier);
  const fromPassengers = Math.round(processed * passengerRevenue(terminals.fareMultiplier, shops));

  record(state, day, {
    aircraftId: aircraft.id,
    classId: aircraft.classId,
    outcome: 'landed',
    reason: null,
    atSeconds: day.elapsed,
    cash: fare + fromPassengers,
    passengers: processed,
    passengersTurnedAway: turnedAway,
  });
}

function divert(state: GameState, day: DayState, aircraft: Aircraft): void {
  aircraft.phase = 'diverted';
  releaseRunway(state.airport, aircraft);
  releaseStand(state.airport, aircraft);
  releasePad(state.airport, aircraft);
  record(state, day, {
    aircraftId: aircraft.id,
    classId: aircraft.classId,
    outcome: 'diverted',
    reason: aircraft.blockedReason,
    atSeconds: day.elapsed,
    cash: 0,
    passengers: 0,
    passengersTurnedAway: 0,
  });
}

/**
 * A pad holding wreckage rather than an aeroplane.
 *
 * `Runway` has a `closed` flag for this; a helipad does not need one, because its whole
 * occupancy model is a single reservation. Reserving it to an id no aircraft can have keeps
 * it out of the assignment pass for the rest of the day and is released by `startDay` with
 * every other reservation.
 */
const CLOSED_BY_WRECKAGE = -1;

/**
 * An aircraft the tower never had control of comes down on the airfield. The wreckage closes
 * the longest runway for the rest of the day — losing exactly the strip the biggest earners
 * needed.
 */
function crash(state: GameState, day: DayState, aircraft: Aircraft): void {
  aircraft.phase = 'crashed';

  // A rotorcraft comes down on its pad, and a pad has no "longest" to sort by — there is only
  // the one it was using. Closing a runway instead would take the strip the airliners needed
  // for something that never touched it.
  if (isRotorcraft(aircraft.classId)) {
    const pad = aircraft.padId ? helipadById(state.airport, aircraft.padId) : undefined;
    releasePad(state.airport, aircraft);
    if (pad) pad.reservedBy = CLOSED_BY_WRECKAGE;
  } else {
    releaseRunway(state.airport, aircraft);
    releaseStand(state.airport, aircraft);
    const longest = [...state.airport.runways].sort((a, b) => runwayLength(b) - runwayLength(a))[0];
    if (longest) longest.closed = true;
  }

  record(state, day, {
    aircraftId: aircraft.id,
    classId: aircraft.classId,
    outcome: 'crashed',
    reason: aircraft.blockedReason ?? 'stack-overflow',
    atSeconds: day.elapsed,
    cash: -CRASH_COST,
    passengers: 0,
    passengersTurnedAway: 0,
  });
}

/** Picks any free runway this aircraft could depart from. Departures reuse landing minima. */
function findDepartureRunway(airport: Airport, day: DayState, aircraft: Aircraft): string | null {
  const spec = aircraftClass(aircraft.classId);
  const runway = airport.runways.find(
    (r) =>
      !r.closed &&
      r.reservedBy === null &&
      r.use === spec.use &&
      runwayLength(r) >= spec.runwayLength &&
      SURFACE_RANK[r.surface] >= SURFACE_RANK[spec.minSurface] &&
      day.services.roadServed.has(r.id),
  );
  return runway?.id ?? null;
}

function advanceTimed(state: GameState, day: DayState, aircraft: Aircraft, dt: number): void {
  const spec = aircraftClass(aircraft.classId);
  aircraft.timer -= dt;
  if (aircraft.timer > 0) return;

  switch (aircraft.phase) {
    case 'approach':
      aircraft.phase = 'landing';
      aircraft.timer = spec.landingSeconds;
      break;

    case 'landing': {
      // Touchdown complete: the runway is free again and the fare is banked.
      releaseRunway(state.airport, aircraft);
      land(state, day, aircraft);

      // A rotorcraft has nothing to taxi between — it is already on the pad it will park on,
      // so it goes straight to `parked`. Branching here rather than giving the two classes a
      // zero taxi time: that would technically work and would leave a phase every other piece
      // of code touching `AircraftPhase` has to know is a one-tick no-op for two classes.
      const factor = hasWorkingFuelFarm(state.airport, day.services)
        ? FUEL_FARM_TURNAROUND_FACTOR
        : 1;
      if (isRotorcraft(aircraft.classId)) {
        aircraft.phase = 'parked';
        aircraft.timer = spec.turnaroundSeconds * factor;
      } else {
        aircraft.phase = 'taxi-in';
        aircraft.timer = spec.taxiSeconds;
      }
      break;
    }

    case 'taxi-in': {
      aircraft.phase = 'parked';
      const factor = hasWorkingFuelFarm(state.airport, day.services)
        ? FUEL_FARM_TURNAROUND_FACTOR
        : 1;
      aircraft.timer = spec.turnaroundSeconds * factor;
      break;
    }

    case 'parked':
      // Pushback: the gate is free from here, which is both realistic and a meaningful
      // chunk of apron throughput. A rotorcraft has no pushback and no runway to queue for —
      // it lifts off the pad it is standing on, and only then is the pad free.
      if (isRotorcraft(aircraft.classId)) {
        aircraft.phase = 'departing';
        aircraft.timer = spec.departSeconds;
        break;
      }
      releaseStand(state.airport, aircraft);
      aircraft.phase = 'taxi-out';
      aircraft.timer = spec.taxiSeconds;
      break;

    case 'taxi-out': {
      // Holds the stand until a runway frees up, which is exactly the congestion the player
      // has to design their way out of.
      const runwayId = findDepartureRunway(state.airport, day, aircraft);
      if (!runwayId) {
        aircraft.timer = 1;
        break;
      }
      const runway = runwayById(state.airport, runwayId)!;
      runway.reservedBy = aircraft.id;
      aircraft.runwayId = runwayId;
      aircraft.phase = 'departing';
      aircraft.timer = spec.departSeconds;
      break;
    }

    case 'departing':
      releaseRunway(state.airport, aircraft);
      releasePad(state.airport, aircraft);
      aircraft.phase = 'done';
      break;

    default:
      break;
  }
}

/**
 * Advances the simulation by `dt` seconds. Mutates `state` in place — no I/O, no rendering
 * and no fresh randomness, so a given starting state and schedule always produces the same
 * day. That is what makes the day harness and the tests trustworthy.
 */
export function stepDay(state: GameState, dt: number): void {
  const day = state.current;
  if (!day || state.phase !== 'day') return;

  day.elapsed += dt;
  spawnArrivals(day);
  updateStackManagement(state.airport, day);

  // Burn fuel and resolve anyone who has run out before handing out slots: an aeroplane that
  // has just diverted should not still be occupying the tower's attention this tick.
  for (const aircraft of day.aircraft) {
    if (aircraft.phase !== 'holding') continue;
    aircraft.fuel -= dt;
    if (aircraft.fuel > 0) continue;
    if (aircraft.managed) {
      if (aircraft.blockedReason === null) aircraft.blockedReason = 'tower-capacity';
      divert(state, day, aircraft);
    } else {
      crash(state, day, aircraft);
    }
  }

  assignHoldingAircraft(state.airport, day);

  // Turn away anything the airport fundamentally cannot take, rather than letting it burn a
  // full tank first. The outcome is identical; the day is far shorter and the feedback is
  // immediate.
  for (const aircraft of day.aircraft) {
    if (aircraft.phase !== 'holding' || !aircraft.managed) continue;
    if (!STRUCTURAL_REASONS.has(aircraft.blockedReason ?? '')) continue;
    const held = aircraftClass(aircraft.classId).endurance - aircraft.fuel;
    if (held >= STRUCTURAL_HOLD_SECONDS) divert(state, day, aircraft);
  }

  for (const aircraft of day.aircraft) {
    if (TIMED_PHASES.has(aircraft.phase)) advanceTimed(state, day, aircraft, dt);
  }

  if (isDayFinished(day)) state.phase = 'debrief';
}

/** Runs a whole day to completion. Used by the tests and the headless day harness. */
export function runDay(state: GameState, schedule: readonly ScheduledArrival[]): DayState {
  const day = startDay(state, schedule);
  // Bounded so a bug that strands an aircraft fails the test rather than hanging it.
  const maxTicks = SIM_HZ * (DAY_SECONDS + 600);
  for (let tick = 0; tick < maxTicks && state.phase === 'day'; tick++) {
    stepDay(state, SIM_DT);
  }
  return day;
}

/** Puts a block reason into the words the debrief uses. */
export function explainReason(reason: string | null): string {
  switch (reason) {
    case 'no-military-runway':
      return 'no military runway — airliner strips will not take it';
    case 'no-civil-runway':
      return 'no civilian runway — the only strips here are military';
    case 'no-runway-length':
      return 'no runway long enough';
    case 'no-runway-surface':
      return 'no runway with a hard enough surface';
    case 'no-road-runway':
      return 'no road reaching a long enough runway';
    case 'no-taxi-link':
      return 'no taxiway linking a runway to a stand';
    case 'no-stand':
      return 'every suitable stand was occupied';
    case 'no-stand-size':
      return 'no stand big enough for it';
    case 'no-road-stand':
      return 'no road reaching a stand of the right size';
    case 'no-helipad':
      return 'no helipad — it does not use a runway';
    case 'no-road-helipad':
      return 'no road reaching a helipad';
    case 'helipad-busy':
      return 'every helipad was occupied';
    case 'runway-busy':
      return 'every suitable runway was occupied';
    case 'tower-capacity':
      return 'the tower could not sequence it in time';
    case 'stack-overflow':
      return 'the holding stack was over capacity';
    case 'no-fuel-farm':
      return 'no fuel farm';
    case 'no-fire-station':
      return 'no fire station';
    default:
      return 'unknown';
  }
}
