import type { FacilityType } from '@/sim/types';

/**
 * Facility levels and their effects. Balance data only.
 */

export interface TowerLevel {
  readonly level: number;
  readonly cost: number;
  /** Aircraft that may be approaching or landing simultaneously. */
  readonly movements: number;
  /** How many holding aircraft the tower can actually manage. Overflow goes unmanaged. */
  readonly stackCapacity: number;
  /** Days of the schedule shown during planning. */
  readonly schedulePreview: number;
}

/** Level 0 is "no tower": a single unmanaged strip where you can only sequence one at a time. */
export const TOWER_LEVELS: readonly TowerLevel[] = [
  { level: 0, cost: 0, movements: 1, stackCapacity: 2, schedulePreview: 1 },
  { level: 1, cost: 1_200, movements: 2, stackCapacity: 4, schedulePreview: 1 },
  { level: 2, cost: 6_500, movements: 3, stackCapacity: 6, schedulePreview: 2 },
  { level: 3, cost: 45_000, movements: 4, stackCapacity: 9, schedulePreview: 3 },
];

/**
 * The terminal is a **footprint you extend**, not a building with a level.
 *
 * The level ladder said everything about a terminal in one number, which made the biggest
 * building in the game the least interesting decision on the map: tap upgrade, pay, done.
 * Modules put the terminal back on the field — how many gates you can fit, where the baggage
 * hall goes, whether you have the land for border control at all — and every one of them is
 * a tile of ground you are not using for something else.
 *
 * A module works only as part of a terminal: road-served, and reachable from a road-served
 * core through a chain of road-served modules. See `buildServices`.
 */
export const TERMINAL_MODULES: ReadonlySet<FacilityType> = new Set([
  'gate-hall',
  'baggage-hall',
  'shop',
  'border-control',
]);

/**
 * No terminal at all: a windsock and a gate in a hedge.
 *
 * A floor rather than zero, and it is load-bearing. It is what makes the opening days of a
 * campaign pay for the first runway, and dropping it quietly breaks day one on every level.
 */
export const NO_TERMINAL_CAPACITY = 60;

/** A core with no modules bolted on: a shed with a desk in it. */
export const TERMINAL_CORE_CAPACITY = 120;

/** Passengers a day per gate hall. The terminal's whole capacity story is this number. */
export const GATE_HALL_CAPACITY = 260;

/** What a processed passenger is worth at the gate, before any module. */
export const PASSENGER_FARE = 8;

/**
 * What each module adds to a passenger's worth.
 *
 * Additive rather than multiplied, and deliberately modest. They stack across every passenger
 * of every flight, and the last time retail compounded with a terminal multiplier the late
 * campaign earned more in a day than everything on the map had cost to build. Under modules
 * there is no build-versus-upgrade choice left to distort, so plain addition says all that
 * needs saying.
 *
 * Both were a pound higher on the first pass and the fiftieth day finished on £1.1M. The
 * trouble is that a rate per head multiplies against traffic that itself grows 150x across
 * the campaign, so a shilling here is a fortune there — see `RETAIL_PER_GATE_HALLS` for the
 * other half of the same fix.
 */
export const BAGGAGE_REVENUE_PER_PASSENGER = 3;
export const RETAIL_REVENUE_PER_PASSENGER = 2;

/**
 * What one processed passenger is worth.
 *
 * Modules multiply the value of *capacity* rather than replacing it — a shop with no gate
 * hall to fill it earns nothing, because nobody is walking past — so the two upgrades pull in
 * the same direction instead of competing.
 */
export function passengerRevenue(baggageHalls: number, retailUnits: number): number {
  return (
    PASSENGER_FARE +
    baggageHalls * BAGGAGE_REVENUE_PER_PASSENGER +
    retailUnits * RETAIL_REVENUE_PER_PASSENGER
  );
}

/**
 * How many gate halls one retail unit is allowed.
 *
 * One per hall was the first rule and it read beautifully — a concourse and its parade of
 * shops — but nine gate halls then licensed nine shops, and retail earns on every passenger
 * of every flight. Two keeps the tie between capacity and retail without letting retail
 * become the whole economy: shops are still worth building, they are just not the reason to
 * build a terminal.
 */
export const RETAIL_PER_GATE_HALLS = 2;

/** How many retail units a terminal with this many gate halls may hold. */
export function retailAllowance(gateHalls: number): number {
  return Math.floor(gateHalls / RETAIL_PER_GATE_HALLS);
}

/**
 * How much sooner a baggage hall frees the stand.
 *
 * This is what ties the terminal to apron throughput rather than only to money: without it,
 * every terminal decision is "does this earn more", and the apron and the terminal never
 * argue. Capped at three halls because past that the constraint is the apron itself, and an
 * uncapped factor would eventually turn turnaround into a rounding error.
 */
export function baggageTurnaroundFactor(halls: number): number {
  return 1 - 0.1 * Math.min(halls, 3);
}

export function towerLevel(level: number): TowerLevel {
  return TOWER_LEVELS[Math.min(Math.max(level, 0), TOWER_LEVELS.length - 1)]!;
}

/*
 * --- Running costs -----------------------------------------------------------------------
 *
 * Everything above this line is capital: you pay once and own it. These are the two costs
 * that recur, and they exist because without them the campaign runs away — the auto-player
 * used to finish day 50 having spent 22% of everything it ever earned, sitting on the rest
 * with nothing left to buy.
 *
 * Both are deliberately priced off things that scale the way income scales. Daily profit
 * grows about 150x between day 5 and day 50, so a flat charge is either fatal in the first
 * week or invisible in the last one. Handling is a fraction of what the flight is worth;
 * certification steps with the size of aeroplane you elect to accept.
 */

/**
 * Ground handling — crew, steps, tug, baggage — as a fraction of what the flight earns.
 *
 * A **proportion**, not a per-passenger or per-movement rate, and that is the whole of the
 * design. Daily profit grows about 150x across the campaign while headcount and turnaround
 * times grow perhaps 5x, so any charge priced per unit of *activity* is savagely regressive:
 * a flat £3 a passenger was 33% of passenger revenue on day 8, when a head is worth £8, and
 * 9% on day 50, when four shops and a level-4 terminal make the same head worth £32. It
 * bankrupted the early campaign and went unnoticed in the late one.
 *
 * Priced off the takings instead, the squeeze is the same at every stage and cannot spiral:
 * a bad day earns less and therefore costs less, and a diverted aeroplane — which nobody
 * handled — costs nothing at all.
 */
export const HANDLING_FEE_FRACTION = 0.08;

/** What it costs to handle one arrival, given what that arrival brought in. */
export function handlingCost(takings: number): number {
  return Math.round(takings * HANDLING_FEE_FRACTION);
}

export interface CertificationLevel {
  readonly level: number;
  readonly name: string;
  /**
   * The longest runway requirement this licence covers, which is how a class is graded.
   * Rotorcraft need no runway at all and are covered by every category including the free one.
   */
  readonly maxRunwayLength: number;
  readonly dailyCost: number;
}

/**
 * Aerodrome certification: what size of aeroplane you are *licensed* to accept, charged daily
 * whether one turns up or not.
 *
 * This is the only thing in the game that asks "should I chase this class at all?". Runway
 * length, stands and terminals all make bigger strictly better once you can afford them; a
 * standing fee against the category you hold means a well-run regional airport is a real
 * alternative to a stretched international one, rather than just a slower way to become one.
 *
 * Steps are placed where the ladder steps: category B is the commuters and regionals, C the
 * narrowbody jets and the freighter, D the widebodies. Each is priced at roughly a tenth of
 * daily income at the point the traffic that needs it first appears — dear enough to be a
 * decision, not so dear that holding it is a mistake.
 */
export const CERTIFICATION_LEVELS: readonly CertificationLevel[] = [
  { level: 0, name: 'Category A', maxRunwayLength: 5, dailyCost: 0 },
  { level: 1, name: 'Category B', maxRunwayLength: 9, dailyCost: 60 },
  { level: 2, name: 'Category C', maxRunwayLength: 13, dailyCost: 2_500 },
  // 99 rather than 16: the top category means "anything", so adding a longer class later is a
  // balance change and not a licence the player can never hold.
  { level: 3, name: 'Category D', maxRunwayLength: 99, dailyCost: 30_000 },
];

export function certificationLevel(level: number): CertificationLevel {
  return CERTIFICATION_LEVELS[Math.min(Math.max(level, 0), CERTIFICATION_LEVELS.length - 1)]!;
}

/** The cheapest category that covers an aircraft needing `runwayLength` tiles. */
export function requiredCertification(runwayLength: number): number {
  const found = CERTIFICATION_LEVELS.find((c) => runwayLength <= c.maxRunwayLength);
  return found?.level ?? CERTIFICATION_LEVELS.length - 1;
}

/** Cash penalty for a crash, on top of the lost fare. */
export const CRASH_COST = 2_500;

/** A fuel farm speeds every turnaround, freeing stands sooner. */
export const FUEL_FARM_TURNAROUND_FACTOR = 0.7;
