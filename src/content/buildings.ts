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

export interface TerminalLevel {
  readonly level: number;
  readonly cost: number;
  /** Multiplier applied to every landing fee collected. */
  readonly fareMultiplier: number;
  /**
   * Passengers this terminal can process in a day. The second axis of the whole game: a
   * longer runway lets a bigger aeroplane land, and this is what decides whether the people
   * on board are worth anything once it has.
   */
  readonly passengerCapacity: number;
  /** How many retail units the terminal has room for. */
  readonly shopSlots: number;
}

/**
 * Level 0 is a windsock and a gate in a hedge: it will take a handful of people off a light
 * aircraft and nothing more.
 */
export const TERMINAL_LEVELS: readonly TerminalLevel[] = [
  { level: 0, cost: 0, fareMultiplier: 1, passengerCapacity: 60, shopSlots: 0 },
  { level: 1, cost: 900, fareMultiplier: 1.15, passengerCapacity: 220, shopSlots: 1 },
  { level: 2, cost: 5_500, fareMultiplier: 1.3, passengerCapacity: 560, shopSlots: 2 },
  { level: 3, cost: 26_000, fareMultiplier: 1.45, passengerCapacity: 1_300, shopSlots: 3 },
  { level: 4, cost: 110_000, fareMultiplier: 1.6, passengerCapacity: 2_600, shopSlots: 4 },
];

/**
 * What each *additional* terminal costs, as a multiple of a level-1 terminal, indexed by how
 * many the airport already has.
 *
 * Capacity pools across terminals, so without this a second level-1 building (£900) is a far
 * cheaper way to buy 220 passengers a day than upgrading to level 2 (£5,500) — and the whole
 * upgrade ladder becomes strictly worse than building sheds. Rising, so the fourth terminal
 * is a considered decision rather than loose change.
 */
export const ADDITIONAL_TERMINAL_COST_MULTIPLIER: readonly number[] = [1, 3, 6, 10];

export function towerLevel(level: number): TowerLevel {
  return TOWER_LEVELS[Math.min(Math.max(level, 0), TOWER_LEVELS.length - 1)]!;
}

export function terminalLevel(level: number): TerminalLevel {
  return TERMINAL_LEVELS[Math.min(Math.max(level, 0), TERMINAL_LEVELS.length - 1)]!;
}

/** What a processed passenger is worth at the gate, before retail. */
export const PASSENGER_FARE = 8;

/**
 * Each shop's take, per passenger passing through the terminal.
 *
 * Kept modest because it stacks with the terminal's fare multiplier and with every passenger
 * of every flight: at four pounds a head with four shops and a doubling terminal, the late
 * campaign earned more in a day than everything on the map cost to build.
 */
export const SHOP_REVENUE_PER_PASSENGER = 3;

/**
 * What one passenger is worth. Shops multiply the value of terminal capacity rather than
 * replacing it, so the two upgrades pull in the same direction instead of competing.
 *
 * Takes the multiplier rather than a `TerminalLevel`, because with several terminals pooled
 * there is no single level to hand it — the rate is a capacity-weighted blend of all of them.
 */
export function passengerRevenue(fareMultiplier: number, shops: number): number {
  return (PASSENGER_FARE + shops * SHOP_REVENUE_PER_PASSENGER) * fareMultiplier;
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
