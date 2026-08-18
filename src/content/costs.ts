import type { FacilityType, RunwaySurface, StandSize, Terrain } from '@/sim/types';

/**
 * What everything costs. Balance data — `sim/build.ts` reads these and never names a price
 * of its own.
 *
 * The shape of the economy: tarmac is priced per tile, so a long runway is a real commitment
 * and resurfacing an existing strip is cheaper than laying a new one. Stands are cheap
 * relative to runways, because the interesting decision is *where* to put them, not whether
 * you can afford them.
 */

export const RUNWAY_COST_PER_TILE: Readonly<Record<RunwaySurface, number>> = {
  grass: 110,
  gravel: 240,
  asphalt: 640,
};

/**
 * A military strip costs more than the same length of civil asphalt: blast pads, arrestor
 * gear, lighting to a different standard. The premium is what makes dedicating a runway a
 * real decision rather than something you do with spare change.
 */
export const MILITARY_RUNWAY_PREMIUM = 1.6;

export const TAXIWAY_COST_PER_TILE = 70;

/**
 * Roads are deliberately the cheapest thing in the game. What a road costs is land and
 * planning — a route from the map edge to everything that needs one — not money. Pricing
 * them highly would turn a spatial puzzle into a tax.
 */
export const ROAD_COST_PER_TILE = 25;

export const STAND_COST: Readonly<Record<StandSize, number>> = {
  small: 260,
  medium: 900,
  large: 3_400,
};

/**
 * A helipad does the job of a runway and a stand in a single tile, so it is priced above the
 * largest stand and well below any runway. What the player is buying is not tarmac — it is
 * the right to skip the whole runway ladder for one kind of traffic.
 */
export const HELIPAD_COST = 4_200;

/**
 * Everything except the tower, which is the only thing left with a level ladder.
 *
 * The four modules are priced against what they do rather than against each other: a gate
 * hall is the cheapest because you will want ten of them, and border control is dearer than
 * a large stand because it is a decision about what kind of airport this is rather than an
 * increment.
 */
export const FACILITY_COST: Readonly<Record<Exclude<FacilityType, 'tower'>, number>> = {
  terminal: 900,
  'fuel-farm': 2_400,
  'fire-station': 3_600,
  'gate-hall': 1_100,
  'baggage-hall': 2_200,
  shop: 3_500,
  'border-control': 14_000,
};

/**
 * Facility types that upgrade in place rather than being simply present or absent.
 *
 * Only the tower. A terminal used to be here; it grows by gaining modules now, which is the
 * whole point — an upgrade you tap is not a decision, and a concourse you have to find room
 * for is.
 */
export const LEVELLED_FACILITIES: ReadonlySet<FacilityType> = new Set(['tower']);

/** Demolition returns a fraction of what was paid. Mistakes should sting, not ruin. */
export const DEMOLITION_REFUND = 0.4;

/**
 * Groundworks, per tile, by what is underneath.
 *
 * Felling is priced against a runway tile (grass £110, gravel £240) — a nuisance, not a
 * project. A bridge or a tunnel is priced against a *stand*, because that is the scale of
 * decision it is: a five-tile causeway is £4,500, roughly a large stand, and the player will
 * think about the route rather than reaching for the chip.
 *
 * Grass is in the table at zero so a drag across mixed ground prices without a special case.
 */
export const GROUNDWORK_COST: Readonly<Record<Terrain, number>> = {
  grass: 0,
  woods: 180,
  water: 900,
  rock: 1_400,
};

/** Shorter than this is not a runway, it is a field with markings on it. */
export const MIN_RUNWAY_TILES = 3;
