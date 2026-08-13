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
 */
export function passengerRevenue(terminal: TerminalLevel, shops: number): number {
  return (PASSENGER_FARE + shops * SHOP_REVENUE_PER_PASSENGER) * terminal.fareMultiplier;
}

/** Cash penalty for a crash, on top of the lost fare. */
export const CRASH_COST = 2_500;

/** A fuel farm speeds every turnaround, freeing stands sooner. */
export const FUEL_FARM_TURNAROUND_FACTOR = 0.7;
