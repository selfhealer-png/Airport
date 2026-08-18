import {
  CERTIFICATION_LEVELS,
  retailAllowance,
  TERMINAL_MODULES,
  TOWER_LEVELS,
} from '@/content/buildings';
import {
  DEMOLITION_REFUND,
  FACILITY_COST,
  GROUNDWORK_COST,
  HELIPAD_COST,
  LEVELLED_FACILITIES,
  MILITARY_RUNWAY_PREMIUM,
  MIN_RUNWAY_TILES,
  ROAD_COST_PER_TILE,
  RUNWAY_COST_PER_TILE,
  STAND_COST,
  TAXIWAY_COST_PER_TILE,
} from '@/content/costs';
import { addGroundwork, facilityOf, hasGroundwork } from './airport';
import {
  runwayLength,
  SURFACE_RANK,
  terrainAllows,
  terrainAt,
  type Airport,
  type BuildKind,
  type Facility,
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
  | 'use-mismatch'
  | 'nothing-to-clear';

export interface BuildQuote {
  readonly cost: number;
}

export type BuildCheck = BuildQuote | BuildError;

export function isAffordableQuote(result: BuildCheck): result is BuildQuote {
  return typeof result !== 'string';
}

export type Occupant = 'runway' | 'stand' | 'helipad' | 'taxiway' | 'road' | 'facility' | null;

/** What is on a tile, if anything. One tile holds at most one thing. */
export function occupantAt(airport: Airport, x: number, y: number): Occupant {
  for (const runway of airport.runways) {
    if (runway.x === x && y >= runway.y0 && y <= runway.y1) return 'runway';
  }
  if (airport.stands.some((stand) => stand.x === x && stand.y === y)) return 'stand';
  if (airport.helipads.some((pad) => pad.x === x && pad.y === y)) return 'helipad';
  if (airport.facilities.some((facility) => facility.x === x && facility.y === y)) {
    return 'facility';
  }
  if (airport.taxiways[y * airport.map.width + x] === 1) return 'taxiway';
  if (airport.roads[y * airport.map.width + x] === 1) return 'road';
  return null;
}

function tileIsFree(
  airport: Airport,
  x: number,
  y: number,
  kind: BuildKind,
): BuildError | null {
  const terrain = terrainAt(airport.map, x, y);
  if (terrain === undefined) return 'off-map';
  if (!terrainAllows(terrain, hasGroundwork(airport, x, y), kind)) return 'terrain-blocked';
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
    const problem = tileIsFree(state.airport, x, y, 'structure');
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
  while (added < tiles && tileIsFree(state.airport, runway.x, y, 'structure') === null) {
    added++;
    y++;
  }
  y = runway.y0 - 1;
  while (added < tiles && tileIsFree(state.airport, runway.x, y, 'structure') === null) {
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
    const problem = tileIsFree(state.airport, runway.x, y, 'structure');
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
  const problem = tileIsFree(state.airport, x, y, 'taxiway');
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
    const problem = tileIsFree(state.airport, x, y, 'taxiway');
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
    const problem = tileIsFree(state.airport, x, y, 'road');
    if (problem) return problem;
    tiles++;
  }
  if (tiles === 0) return 'occupied';

  return afford(state, tiles * ROAD_COST_PER_TILE);
}

// --- Groundworks -------------------------------------------------------------------------

/**
 * Working a straight run of ground: felling woods, bridging water, tunnelling rock.
 *
 * One operation for all three because to the player it is one gesture — drag across what is
 * in the way — and the price is read per tile from what is actually underneath. A drag over a
 * wooded slope onto rock is therefore quoted correctly rather than at some blended rate, and
 * a single chip can serve the whole job.
 *
 * Grass in the run costs nothing and is skipped rather than refused, the same forgiveness
 * `checkGrowRunway` shows a drag along an already-paved strip: the tiles with nothing to do
 * must not spoil the drag. What is refused is a run with nothing to do *anywhere*, which is a
 * slip of the thumb rather than a purchase.
 *
 * Occupancy is not checked. There is nothing on an unworked obstacle to be occupied by, and
 * ground already worked is skipped before the question arises.
 */
export function checkClearRun(
  state: GameState,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): BuildCheck {
  if (x0 !== x1 && y0 !== y1) return 'not-straight';

  const { airport } = state;
  const stepX = Math.sign(x1 - x0);
  const stepY = Math.sign(y1 - y0);
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));

  let cost = 0;
  let tiles = 0;
  for (let i = 0; i <= steps; i++) {
    const x = x0 + stepX * i;
    const y = y0 + stepY * i;
    const terrain = terrainAt(airport.map, x, y);
    if (terrain === undefined) return 'off-map';
    if (terrain === 'grass' || hasGroundwork(airport, x, y)) continue;
    cost += GROUNDWORK_COST[terrain];
    tiles++;
  }
  if (tiles === 0) return 'nothing-to-clear';

  return afford(state, cost);
}

export function applyClearRun(
  state: GameState,
  quote: BuildQuote,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const { airport } = state;
  spend(state, quote);

  const stepX = Math.sign(x1 - x0);
  const stepY = Math.sign(y1 - y0);
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));

  for (let i = 0; i <= steps; i++) {
    const x = x0 + stepX * i;
    const y = y0 + stepY * i;
    if (terrainAt(airport.map, x, y) === 'grass') continue;
    addGroundwork(airport, x, y);
  }
}

export function checkStand(state: GameState, x: number, y: number, size: StandSize): BuildCheck {
  const problem = tileIsFree(state.airport, x, y, 'structure');
  if (problem) return problem;
  return afford(state, STAND_COST[size]);
}

/**
 * A helipad. One tile, no drag, no size — it is a runway and a stand at once.
 *
 * Given its own check/apply pair rather than folded into `checkFacility` because it is not a
 * `Facility`: it carries no level, and it needs the per-day reservation state a runway and a
 * stand have. What it shares with facilities is only that it occupies a tile.
 */
export function checkHelipad(state: GameState, x: number, y: number): BuildCheck {
  const problem = tileIsFree(state.airport, x, y, 'structure');
  if (problem) return problem;
  return afford(state, HELIPAD_COST);
}

// --- Facilities ------------------------------------------------------------------------

export function facilityCost(type: FacilityType, level: number): number {
  if (type === 'tower') return TOWER_LEVELS[level]?.cost ?? Number.POSITIVE_INFINITY;
  return FACILITY_COST[type];
}

/** Facilities of one type, wherever they are. Modules and terminals are not unique. */
function facilitiesOfType(airport: Airport, type: FacilityType): Facility[] {
  return airport.facilities.filter((f) => f.type === type);
}

/**
 * Places a facility. Only the tower arrives with a level.
 *
 * Terminal modules are the interesting case: they must **touch the terminal**, which on a
 * tile grid means orthogonally adjacent to a core or to another module. Refused outright
 * rather than allowed to sit in a field earning nothing — a gate hall is £1,100 and that is
 * too much to lose to a placement the game could simply have declined.
 *
 * Gated on what is *built*, not on what is working. You are allowed to build things that do
 * not work yet — the road may not be laid — and `airportAdvice()` is what tells you they are
 * dead weight. Gating on the working set instead would make the order you build in matter for
 * no reason anyone could deduce.
 */
export function checkFacility(
  state: GameState,
  type: FacilityType,
  x: number,
  y: number,
): BuildCheck {
  const { airport } = state;

  if (TERMINAL_MODULES.has(type)) {
    const attachable = airport.facilities.filter(
      (f) => f.type === 'terminal' || TERMINAL_MODULES.has(f.type),
    );
    if (!attachable.some((f) => Math.abs(f.x - x) + Math.abs(f.y - y) === 1)) {
      return 'needs-terminal';
    }

    /*
     * Retail is rationed against the gate halls — see `retailAllowance`.
     *
     * Land alone is too weak a cap. Retail earns per passenger of every flight, so without a
     * limit the winning move is a field of shops beside a single core and the terminal stops
     * being about capacity at all. Tying it to gate halls keeps the two pulling together:
     * shops are worth building because there are people to walk past them.
     */
    if (type === 'shop') {
      const allowed = retailAllowance(facilitiesOfType(airport, 'gate-hall').length);
      if (facilitiesOfType(airport, 'shop').length >= allowed) return 'no-shop-slot';
    }
  } else if (type !== 'terminal' && facilityOf(airport, type)) {
    // Terminals are not unique: a second core is how an airport spreads across the field when
    // the ground beside the first one runs out. Everything else is one per airport.
    return 'already-built';
  }

  const problem = tileIsFree(airport, x, y, 'structure');
  if (problem) return problem;

  return afford(state, facilityCost(type, LEVELLED_FACILITIES.has(type) ? 1 : 0));
}

/**
 * Upgrades one facility, named by id rather than by type.
 *
 * Keying on type only ever worked because there was exactly one of each. With several
 * terminals on the airport, "upgrade the terminal" is not a question with an answer.
 */
export function checkUpgradeFacility(state: GameState, facilityId: string): BuildCheck {
  const facility = state.airport.facilities.find((f) => f.id === facilityId);
  if (!facility) return 'nothing-there';
  if (!LEVELLED_FACILITIES.has(facility.type)) return 'max-level';

  const levels = TOWER_LEVELS;
  const next = facility.level + 1;
  if (next >= levels.length) return 'max-level';

  return afford(state, facilityCost(facility.type, next));
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
  while (added < tiles && tileIsFree(state.airport, runway.x, runway.y1 + 1, 'structure') === null) {
    runway.y1 += 1;
    added++;
  }
  while (added < tiles && tileIsFree(state.airport, runway.x, runway.y0 - 1, 'structure') === null) {
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

export function applyHelipad(state: GameState, quote: BuildQuote, x: number, y: number): string {
  spend(state, quote);
  const id = nextId(state.airport, 'pad');
  state.airport.helipads.push({ id, x, y, reservedBy: null });
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
  facilityId: string,
): void {
  const facility = state.airport.facilities.find((f) => f.id === facilityId);
  if (!facility) return;
  spend(state, quote);
  facility.level += 1;
}

// --- Certification -----------------------------------------------------------------------

/**
 * Takes the airport up one certification category.
 *
 * Unlike everything else in this file there is **no purchase price** — a licence costs a
 * standing daily fee instead, so the check is only ever "is there a category above this one".
 * The decision it creates is not "can I afford it today" but "will this pay for itself every
 * day from now on", which is the first question of that shape the game asks.
 */
export function checkCertify(state: GameState): BuildCheck {
  const next = state.airport.certification + 1;
  if (next >= CERTIFICATION_LEVELS.length) return 'max-level';
  return { cost: 0 };
}

export function applyCertify(state: GameState, quote: BuildQuote): void {
  spend(state, quote);
  if (state.airport.certification + 1 < CERTIFICATION_LEVELS.length) {
    state.airport.certification += 1;
  }
}

/**
 * Surrenders a category, stopping the fee.
 *
 * The escape hatch, and the reason a standing charge cannot spiral the way reputation did: an
 * airport that has overreached can always stop paying for a licence it is not filling. There
 * is nothing to refund — you were renting it.
 */
export function checkSurrenderCertification(state: GameState): BuildCheck {
  if (state.airport.certification <= 0) return 'nothing-there';
  return { cost: 0 };
}

export function applySurrenderCertification(state: GameState, quote: BuildQuote): void {
  spend(state, quote);
  if (state.airport.certification > 0) state.airport.certification -= 1;
}

// --- Demolition --------------------------------------------------------------------------

/**
 * What removing whatever is on this tile would return, or why it cannot be removed.
 *
 * Groundworks are deliberately absent from every branch below. Nothing un-fells a wood or
 * un-builds a bridge, so bare worked ground reports `nothing-there` and demolishing the road
 * that crosses a tunnel refunds the road alone. Undo still covers a slip of the thumb,
 * because it restores whole snapshots rather than inverting operations.
 */
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

  if (airport.helipads.some((p) => p.x === x && p.y === y)) {
    return { cost: -Math.round(HELIPAD_COST * DEMOLITION_REFUND) };
  }

  const facility = airport.facilities.find((f) => f.x === x && f.y === y);
  if (facility) {
    // The tower refunds every level bought so far; everything else was a single purchase.
    const paid = LEVELLED_FACILITIES.has(facility.type)
      ? Array.from({ length: facility.level }, (_, i) =>
          facilityCost(facility.type, i + 1),
        ).reduce((sum, value) => sum + value, 0)
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

  const padIndex = airport.helipads.findIndex((p) => p.x === x && p.y === y);
  if (padIndex >= 0) {
    airport.helipads.splice(padIndex, 1);
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
    case 'nothing-to-clear':
      return 'There is nothing to clear there.';
    case 'use-mismatch':
      return 'Military and civil runways cannot be merged';
  }
}
