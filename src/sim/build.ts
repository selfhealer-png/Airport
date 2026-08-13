import { terminalLevel, TERMINAL_LEVELS, TOWER_LEVELS } from '@/content/buildings';
import {
  DEMOLITION_REFUND,
  FACILITY_COST,
  LEVELLED_FACILITIES,
  MILITARY_RUNWAY_PREMIUM,
  MIN_RUNWAY_TILES,
  ROAD_COST_PER_TILE,
  RUNWAY_COST_PER_TILE,
  STAND_COST,
  TAXIWAY_COST_PER_TILE,
} from '@/content/costs';
import { facilityOf, shopsOf } from './airport';
import {
  isBuildable,
  runwayLength,
  SURFACE_RANK,
  terrainAt,
  type Airport,
  type FacilityType,
  type GameState,
  type Runway,
  type RunwaySurface,
  type RunwayUse,
  type StandSize,
} from './types';

/**
 * The building system: what may be placed where, what it costs, and what happens to the
 * money. Pure functions over state, like the rest of `sim/` — the UI asks whether something
 * is legal, shows the answer, and only then commits.
 *
 * Every operation comes in a `check…` / `apply…` pair. The check is what the drawer uses to
 * grey out an option and to explain itself; the apply trusts the check has passed.
 */

export type BuildError =
  | 'off-map'
  | 'terrain-blocked'
  | 'occupied'
  | 'too-short'
  | 'not-straight'
  | 'cannot-afford'
  | 'already-built'
  | 'max-level'
  | 'nothing-there'
  | 'no-downgrade'
  | 'no-shop-slot'
  | 'needs-terminal'
  | 'no-change'
  | 'use-mismatch';

export interface BuildQuote {
  readonly cost: number;
}

export type BuildCheck = BuildQuote | BuildError;

export function isAffordableQuote(result: BuildCheck): result is BuildQuote {
  return typeof result !== 'string';
}

export type Occupant = 'runway' | 'stand' | 'taxiway' | 'road' | 'facility' | null;

/** What is on a tile, if anything. One tile holds at most one thing. */
export function occupantAt(airport: Airport, x: number, y: number): Occupant {
  for (const runway of airport.runways) {
    if (runway.x === x && y >= runway.y0 && y <= runway.y1) return 'runway';
  }
  if (airport.stands.some((stand) => stand.x === x && stand.y === y)) return 'stand';
  if (airport.facilities.some((facility) => facility.x === x && facility.y === y)) {
    return 'facility';
  }
  if (airport.taxiways[y * airport.map.width + x] === 1) return 'taxiway';
  if (airport.roads[y * airport.map.width + x] === 1) return 'road';
  return null;
}

function tileIsFree(airport: Airport, x: number, y: number): BuildError | null {
  const terrain = terrainAt(airport.map, x, y);
  if (terrain === undefined) return 'off-map';
  if (!isBuildable(terrain)) return 'terrain-blocked';
  if (occupantAt(airport, x, y) !== null) return 'occupied';
  return null;
}

function afford(state: GameState, cost: number): BuildCheck {
  return cost <= state.cash ? { cost } : 'cannot-afford';
}

// --- Runways ---------------------------------------------------------------------------

export function runwayCost(tiles: number, surface: RunwaySurface, use: RunwayUse = 'civil'): number {
  const base = tiles * RUNWAY_COST_PER_TILE[surface];
  return use === 'military' ? Math.round(base * MILITARY_RUNWAY_PREMIUM) : base;
}

/**
 * A runway is a vertical strip at column `x` from row `y0` to `y1`. The drag can go either
 * way; rows are normalised here so the player never has to think about direction.
 */
export function checkRunway(
  state: GameState,
  x: number,
  y0: number,
  y1: number,
  surface: RunwaySurface,
  use: RunwayUse = 'civil',
): BuildCheck {
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const tiles = bottom - top + 1;
  if (tiles < MIN_RUNWAY_TILES) return 'too-short';

  for (let y = top; y <= bottom; y++) {
    const problem = tileIsFree(state.airport, x, y);
    if (problem) return problem;
  }

  return afford(state, runwayCost(tiles, surface, use));
}

/** Extends an existing runway at either end, paying for the new tiles only. */
export function checkExtendRunway(state: GameState, runwayId: string, tiles: number): BuildCheck {
  const runway = state.airport.runways.find((r) => r.id === runwayId);
  if (!runway) return 'nothing-there';
  if (tiles <= 0) return 'too-short';

  // Grow downwards first, then upwards — whichever direction has room.
  let added = 0;
  let y = runway.y1 + 1;
  while (added < tiles && tileIsFree(state.airport, runway.x, y) === null) {
    added++;
    y++;
  }
  y = runway.y0 - 1;
  while (added < tiles && tileIsFree(state.airport, runway.x, y) === null) {
    added++;
    y--;
  }
  if (added < tiles) return 'occupied';

  return afford(state, runwayCost(tiles, runway.surface, runway.use));
}

/**
 * Runways a drag along column `x` would modify: those its span overlaps or runs straight into.
 *
 * This is what separates "make my runway longer" from "build a second runway further down the
 * same column". Drag over the strip you have and you grow it; drag clear of it and you get a
 * new one.
 */
export function touchedRunways(
  airport: Airport,
  x: number,
  y0: number,
  y1: number,
): Runway[] {
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  // One tile of slack at each end, so a drag that stops exactly against the threshold counts
  // as continuing the runway rather than as a new one butted up against it.
  return airport.runways.filter((r) => r.x === x && r.y0 <= bottom + 1 && r.y1 >= top - 1);
}

/**
 * Growing an existing runway: longer, better surfaced, or both in one drag.
 *
 * Priced as *what the finished runway is worth, minus what has already been paid for it* —
 * so extending three tiles of grass and paving the whole thing costs exactly the same as
 * having built it that way to begin with. Anything else would punish the player for having
 * started small, which is the only way the game lets them start.
 *
 * A surface below the one already down is ignored rather than refused: dragging the grass
 * chip along a paved strip means "make it longer", not "tear the tarmac up".
 */
export function checkGrowRunway(
  state: GameState,
  runwayId: string,
  y0: number,
  y1: number,
  surface: RunwaySurface,
  use: RunwayUse = 'civil',
): BuildCheck {
  const runway = state.airport.runways.find((r) => r.id === runwayId);
  if (!runway) return 'nothing-there';
  if (runway.use !== use) return 'use-mismatch';

  const top = Math.min(Math.min(y0, y1), runway.y0);
  const bottom = Math.max(Math.max(y0, y1), runway.y1);

  for (let y = top; y <= bottom; y++) {
    if (y >= runway.y0 && y <= runway.y1) continue;
    const problem = tileIsFree(state.airport, runway.x, y);
    if (problem) return problem;
  }

  const finalSurface =
    SURFACE_RANK[surface] > SURFACE_RANK[runway.surface] ? surface : runway.surface;
  const finalLength = bottom - top + 1;
  if (finalLength === runwayLength(runway) && finalSurface === runway.surface) return 'no-change';

  const cost =
    runwayCost(finalLength, finalSurface, use) -
    runwayCost(runwayLength(runway), runway.surface, use);
  return afford(state, cost);
}

/**
 * Resurfacing pays the difference per tile. Downgrading is refused rather than refunded —
 * there is no reason to want it, and allowing it invites accidental taps.
 */
export function checkResurface(
  state: GameState,
  runwayId: string,
  surface: RunwaySurface,
): BuildCheck {
  const runway = state.airport.runways.find((r) => r.id === runwayId);
  if (!runway) return 'nothing-there';
  if (SURFACE_RANK[surface] <= SURFACE_RANK[runway.surface]) return 'no-downgrade';

  const perTile = RUNWAY_COST_PER_TILE[surface] - RUNWAY_COST_PER_TILE[runway.surface];
  return afford(state, perTile * runwayLength(runway));
}

// --- Taxiways and stands ---------------------------------------------------------------

export function checkTaxiway(state: GameState, x: number, y: number): BuildCheck {
  const problem = tileIsFree(state.airport, x, y);
  if (problem) return problem;
  return afford(state, TAXIWAY_COST_PER_TILE);
}

/** A straight run of taxiway. Diagonals are not a thing an aeroplane does. */
export function checkTaxiwayRun(
  state: GameState,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): BuildCheck {
  if (x0 !== x1 && y0 !== y1) return 'not-straight';

  const stepX = Math.sign(x1 - x0);
  const stepY = Math.sign(y1 - y0);
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));

  let tiles = 0;
  for (let i = 0; i <= steps; i++) {
    const x = x0 + stepX * i;
    const y = y0 + stepY * i;
    // Already-laid taxiway is skipped rather than rejected, so dragging over an existing
    // run to join two stubs does what the player obviously meant.
    if (occupantAt(state.airport, x, y) === 'taxiway') continue;
    const problem = tileIsFree(state.airport, x, y);
    if (problem) return problem;
    tiles++;
  }
  if (tiles === 0) return 'occupied';

  return afford(state, tiles * TAXIWAY_COST_PER_TILE);
}

// --- Roads -------------------------------------------------------------------------------

/**
 * A straight run of road. Deliberately the same shape as `checkTaxiwayRun`, including
 * dragging over an existing run to join two stubs, because to the player's thumb the two
 * tools are the same gesture and behaving differently would just be a trap.
 */
export function checkRoadRun(
  state: GameState,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): BuildCheck {
  if (x0 !== x1 && y0 !== y1) return 'not-straight';

  const stepX = Math.sign(x1 - x0);
  const stepY = Math.sign(y1 - y0);
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));

  let tiles = 0;
  for (let i = 0; i <= steps; i++) {
    const x = x0 + stepX * i;
    const y = y0 + stepY * i;
    if (occupantAt(state.airport, x, y) === 'road') continue;
    const problem = tileIsFree(state.airport, x, y);
    if (problem) return problem;
    tiles++;
  }
  if (tiles === 0) return 'occupied';

  return afford(state, tiles * ROAD_COST_PER_TILE);
}

export function checkStand(state: GameState, x: number, y: number, size: StandSize): BuildCheck {
  const problem = tileIsFree(state.airport, x, y);
  if (problem) return problem;
  return afford(state, STAND_COST[size]);
}

// --- Facilities ------------------------------------------------------------------------

export function facilityCost(type: FacilityType, level: number): number {
  if (type === 'tower') return TOWER_LEVELS[level]?.cost ?? Number.POSITIVE_INFINITY;
  if (type === 'terminal') return TERMINAL_LEVELS[level]?.cost ?? Number.POSITIVE_INFINITY;
  return FACILITY_COST[type];
}

/** Places a facility for the first time. Tower and terminal arrive at level 1. */
export function checkFacility(
  state: GameState,
  type: FacilityType,
  x: number,
  y: number,
): BuildCheck {
  if (type === 'shop') {
    // "Inside the terminal" on a tile grid means orthogonally touching it. Refusing outright
    // rather than letting it be built and quietly earn nothing: £1,800 is too much to lose
    // to a placement the game could simply have declined.
    const terminal = facilityOf(state.airport, 'terminal');
    if (!terminal) return 'needs-terminal';
    if (Math.abs(terminal.x - x) + Math.abs(terminal.y - y) !== 1) return 'needs-terminal';
    if (shopsOf(state.airport).length >= terminalLevel(terminal.level).shopSlots) {
      return 'no-shop-slot';
    }
  } else if (facilityOf(state.airport, type)) {
    return 'already-built';
  }

  const problem = tileIsFree(state.airport, x, y);
  if (problem) return problem;
  return afford(state, facilityCost(type, LEVELLED_FACILITIES.has(type) ? 1 : 0));
}

export function checkUpgradeFacility(state: GameState, type: FacilityType): BuildCheck {
  const facility = facilityOf(state.airport, type);
  if (!facility) return 'nothing-there';
  if (!LEVELLED_FACILITIES.has(type)) return 'max-level';

  const levels = type === 'tower' ? TOWER_LEVELS : TERMINAL_LEVELS;
  const next = facility.level + 1;
  if (next >= levels.length) return 'max-level';

  return afford(state, facilityCost(type, next));
}

// --- Applying ---------------------------------------------------------------------------

function spend(state: GameState, quote: BuildQuote): void {
  state.cash -= quote.cost;
}

function nextId(airport: Airport, prefix: string): string {
  return `${prefix}${airport.nextEntityId++}`;
}

export function applyRunway(
  state: GameState,
  quote: BuildQuote,
  x: number,
  y0: number,
  y1: number,
  surface: RunwaySurface,
  use: RunwayUse = 'civil',
): string {
  spend(state, quote);
  const id = nextId(state.airport, 'rwy');
  state.airport.runways.push({
    id,
    x,
    y0: Math.min(y0, y1),
    y1: Math.max(y0, y1),
    surface,
    use,
    reservedBy: null,
    closed: false,
  });
  return id;
}

export function applyGrowRunway(
  state: GameState,
  quote: BuildQuote,
  runwayId: string,
  y0: number,
  y1: number,
  surface: RunwaySurface,
): void {
  const runway = state.airport.runways.find((r) => r.id === runwayId);
  if (!runway) return;
  spend(state, quote);

  runway.y0 = Math.min(Math.min(y0, y1), runway.y0);
  runway.y1 = Math.max(Math.max(y0, y1), runway.y1);
  if (SURFACE_RANK[surface] > SURFACE_RANK[runway.surface]) runway.surface = surface;
}

export function applyExtendRunway(
  state: GameState,
  quote: BuildQuote,
  runwayId: string,
  tiles: number,
): void {
  const runway = state.airport.runways.find((r) => r.id === runwayId);
  if (!runway) return;
  spend(state, quote);

  let added = 0;
  while (added < tiles && tileIsFree(state.airport, runway.x, runway.y1 + 1) === null) {
    runway.y1 += 1;
    added++;
  }
  while (added < tiles && tileIsFree(state.airport, runway.x, runway.y0 - 1) === null) {
    runway.y0 -= 1;
    added++;
  }
}

export function applyResurface(
  state: GameState,
  quote: BuildQuote,
  runwayId: string,
  surface: RunwaySurface,
): void {
  const runway = state.airport.runways.find((r) => r.id === runwayId);
  if (!runway) return;
  spend(state, quote);
  runway.surface = surface;
}

export function applyTaxiwayRun(
  state: GameState,
  quote: BuildQuote,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  spend(state, quote);
  paint(state, x0, y0, x1, y1, 'taxiways');
}

export function applyRoadRun(
  state: GameState,
  quote: BuildQuote,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  spend(state, quote);
  paint(state, x0, y0, x1, y1, 'roads');
}

/** Marks a straight run of tiles in one of the airport's two tile masks. */
function paint(
  state: GameState,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  layer: 'taxiways' | 'roads',
): void {
  const stepX = Math.sign(x1 - x0);
  const stepY = Math.sign(y1 - y0);
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const x = x0 + stepX * i;
    const y = y0 + stepY * i;
    state.airport[layer][y * state.airport.map.width + x] = 1;
  }
}

export function applyStand(
  state: GameState,
  quote: BuildQuote,
  x: number,
  y: number,
  size: StandSize,
): string {
  spend(state, quote);
  const id = nextId(state.airport, 'std');
  state.airport.stands.push({ id, x, y, size, reservedBy: null });
  return id;
}

export function applyFacility(
  state: GameState,
  quote: BuildQuote,
  type: FacilityType,
  x: number,
  y: number,
): string {
  spend(state, quote);
  const id = nextId(state.airport, 'fac');
  state.airport.facilities.push({
    id,
    type,
    x,
    y,
    level: LEVELLED_FACILITIES.has(type) ? 1 : 0,
  });
  return id;
}

export function applyUpgradeFacility(
  state: GameState,
  quote: BuildQuote,
  type: FacilityType,
): void {
  const facility = facilityOf(state.airport, type);
  if (!facility) return;
  spend(state, quote);
  facility.level += 1;
}

// --- Demolition --------------------------------------------------------------------------

/** What removing whatever is on this tile would return, or why it cannot be removed. */
export function checkDemolish(state: GameState, x: number, y: number): BuildCheck {
  const { airport } = state;

  const runway = airport.runways.find((r) => r.x === x && y >= r.y0 && y <= r.y1);
  if (runway) {
    return {
      cost: -Math.round(
        runwayCost(runwayLength(runway), runway.surface, runway.use) * DEMOLITION_REFUND,
      ),
    };
  }

  const stand = airport.stands.find((s) => s.x === x && s.y === y);
  if (stand) return { cost: -Math.round(STAND_COST[stand.size] * DEMOLITION_REFUND) };

  const facility = airport.facilities.find((f) => f.x === x && f.y === y);
  if (facility) {
    const paid = LEVELLED_FACILITIES.has(facility.type)
      ? // Levelled facilities refund every level bought so far.
        Array.from({ length: facility.level }, (_, i) => facilityCost(facility.type, i + 1)).reduce(
          (sum, value) => sum + value,
          0,
        )
      : facilityCost(facility.type, 0);
    return { cost: -Math.round(paid * DEMOLITION_REFUND) };
  }

  if (airport.taxiways[y * airport.map.width + x] === 1) {
    return { cost: -Math.round(TAXIWAY_COST_PER_TILE * DEMOLITION_REFUND) };
  }

  if (airport.roads[y * airport.map.width + x] === 1) {
    return { cost: -Math.round(ROAD_COST_PER_TILE * DEMOLITION_REFUND) };
  }

  return 'nothing-there';
}

/**
 * Removes whatever is on the tile. A runway or a facility goes as a whole — tapping the
 * middle of a strip removes the strip, not a hole in it.
 */
export function applyDemolish(state: GameState, quote: BuildQuote, x: number, y: number): void {
  const { airport } = state;
  spend(state, quote);

  const runwayIndex = airport.runways.findIndex((r) => r.x === x && y >= r.y0 && y <= r.y1);
  if (runwayIndex >= 0) {
    airport.runways.splice(runwayIndex, 1);
    return;
  }

  const standIndex = airport.stands.findIndex((s) => s.x === x && s.y === y);
  if (standIndex >= 0) {
    airport.stands.splice(standIndex, 1);
    return;
  }

  const facilityIndex = airport.facilities.findIndex((f) => f.x === x && f.y === y);
  if (facilityIndex >= 0) {
    airport.facilities.splice(facilityIndex, 1);
    return;
  }

  airport.taxiways[y * airport.map.width + x] = 0;
  airport.roads[y * airport.map.width + x] = 0;
}

/** Turns a build error into the sentence the drawer shows. */
export function explainBuildError(error: BuildError): string {
  switch (error) {
    case 'off-map':
      return 'Outside the airfield';
    case 'terrain-blocked':
      return 'The ground will not take it';
    case 'occupied':
      return 'Something is already there';
    case 'too-short':
      return `Runways need at least ${MIN_RUNWAY_TILES} tiles`;
    case 'not-straight':
      return 'Taxiways must run straight';
    case 'cannot-afford':
      return 'Not enough cash';
    case 'already-built':
      return 'You already have one';
    case 'max-level':
      return 'Fully upgraded';
    case 'nothing-there':
      return 'Nothing to remove';
    case 'no-downgrade':
      return 'Already a better surface';
    case 'no-shop-slot':
      return 'The terminal has no room for another shop';
    case 'needs-terminal':
      return 'Shops must be built touching the terminal';
    case 'no-change':
      return 'Already this long and this well surfaced';
    case 'use-mismatch':
      return 'Military and civil runways cannot be merged';
  }
}
