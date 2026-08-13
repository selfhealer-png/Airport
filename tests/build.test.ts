import { describe, expect, it } from 'vitest';
import { LEVEL_MEADOW } from '@/content/levels';
import { MIN_RUNWAY_TILES, RUNWAY_COST_PER_TILE, STAND_COST } from '@/content/costs';
import { TOWER_LEVELS } from '@/content/buildings';
import { createGame, towerLevelOf } from '@/sim/airport';
import {
  applyDemolish,
  applyFacility,
  applyExtendRunway,
  applyResurface,
  applyRunway,
  applyStand,
  applyTaxiwayRun,
  applyUpgradeFacility,
  checkDemolish,
  checkExtendRunway,
  checkFacility,
  checkResurface,
  checkRunway,
  checkStand,
  checkTaxiwayRun,
  checkUpgradeFacility,
  isAffordableQuote,
  occupantAt,
  type BuildCheck,
} from '@/sim/build';
import { runwayLength, type GameState, type LevelMap, type Terrain } from '@/sim/types';

function game(cash = 100_000): GameState {
  const state = createGame(LEVEL_MEADOW, 1);
  state.cash = cash;
  return state;
}

/** Asserts the check passed and hands back the quote, so tests read as intent not plumbing. */
function quote(result: BuildCheck) {
  if (!isAffordableQuote(result)) {
    throw new Error(`Expected a quote, got build error '${result}'.`);
  }
  return result;
}

/** A map with a lake, for testing that terrain actually blocks building. */
function lakeMap(): LevelMap {
  const terrain: Terrain[] = Array.from(
    { length: LEVEL_MEADOW.width * LEVEL_MEADOW.height },
    () => 'grass' as Terrain,
  );
  terrain[5 * LEVEL_MEADOW.width + 5] = 'water';
  return { ...LEVEL_MEADOW, id: 'lake', terrain };
}

describe('runway placement', () => {
  it('refuses a strip shorter than the minimum', () => {
    const state = game();
    expect(checkRunway(state, 8, 10, 10 + MIN_RUNWAY_TILES - 2, 'grass')).toBe('too-short');
  });

  it('prices a runway per tile by surface', () => {
    const state = game();
    const result = quote(checkRunway(state, 8, 10, 15, 'gravel'));
    expect(result.cost).toBe(6 * RUNWAY_COST_PER_TILE.gravel);
  });

  it('normalises a drag made upwards', () => {
    const state = game();
    const id = applyRunway(state, quote(checkRunway(state, 8, 15, 10, 'grass')), 8, 15, 10, 'grass');
    const runway = state.airport.runways.find((r) => r.id === id)!;

    expect({ y0: runway.y0, y1: runway.y1 }).toEqual({ y0: 10, y1: 15 });
    expect(runwayLength(runway)).toBe(6);
  });

  it('will not build over water', () => {
    const state = createGame(lakeMap(), 1);
    state.cash = 100_000;
    expect(checkRunway(state, 5, 3, 8, 'grass')).toBe('terrain-blocked');
  });

  it('will not build over something already there', () => {
    const state = game();
    applyRunway(state, quote(checkRunway(state, 8, 10, 15, 'grass')), 8, 10, 15, 'grass');
    expect(checkRunway(state, 8, 12, 18, 'grass')).toBe('occupied');
  });

  it('refuses what the player cannot afford', () => {
    const state = game(100);
    expect(checkRunway(state, 8, 10, 15, 'asphalt')).toBe('cannot-afford');
  });

  it('deducts the cost when built', () => {
    const state = game(10_000);
    const price = quote(checkRunway(state, 8, 10, 15, 'grass'));
    applyRunway(state, price, 8, 10, 15, 'grass');
    expect(state.cash).toBe(10_000 - price.cost);
  });
});

describe('extending and resurfacing', () => {
  it('extends a runway in place and charges only for the new tiles', () => {
    const state = game();
    const id = applyRunway(state, quote(checkRunway(state, 8, 10, 15, 'grass')), 8, 10, 15, 'grass');
    const before = state.cash;

    const price = quote(checkExtendRunway(state, id, 3));
    applyExtendRunway(state, price, id, 3);

    const runway = state.airport.runways.find((r) => r.id === id)!;
    expect(runwayLength(runway)).toBe(9);
    expect(before - state.cash).toBe(3 * RUNWAY_COST_PER_TILE.grass);
  });

  it('charges only the difference to resurface', () => {
    const state = game();
    const id = applyRunway(state, quote(checkRunway(state, 8, 10, 15, 'grass')), 8, 10, 15, 'grass');
    const price = quote(checkResurface(state, id, 'asphalt'));

    expect(price.cost).toBe(6 * (RUNWAY_COST_PER_TILE.asphalt - RUNWAY_COST_PER_TILE.grass));
    applyResurface(state, price, id, 'asphalt');
    expect(state.airport.runways.find((r) => r.id === id)?.surface).toBe('asphalt');
  });

  it('refuses to downgrade a surface', () => {
    const state = game();
    const id = applyRunway(
      state,
      quote(checkRunway(state, 8, 10, 15, 'asphalt')),
      8, 10, 15, 'asphalt',
    );
    expect(checkResurface(state, id, 'grass')).toBe('no-downgrade');
  });
});

describe('taxiways', () => {
  it('refuses a diagonal run', () => {
    expect(checkTaxiwayRun(game(), 5, 5, 8, 8)).toBe('not-straight');
  });

  it('charges per new tile and skips tiles already laid', () => {
    const state = game();
    applyTaxiwayRun(state, quote(checkTaxiwayRun(state, 5, 5, 7, 5)), 5, 5, 7, 5);
    const before = state.cash;

    // Overlaps the first two tiles, so only three are new.
    const price = quote(checkTaxiwayRun(state, 6, 5, 10, 5));
    applyTaxiwayRun(state, price, 6, 5, 10, 5);

    expect(before - state.cash).toBe(price.cost);
    expect(occupantAt(state.airport, 10, 5)).toBe('taxiway');
  });
});

describe('facilities', () => {
  it('places a tower at level 1 and raises the movement cap', () => {
    const state = game();
    expect(towerLevelOf(state.airport)).toBe(0);

    applyFacility(state, quote(checkFacility(state, 'tower', 4, 4)), 'tower', 4, 4);

    expect(towerLevelOf(state.airport)).toBe(1);
    expect(occupantAt(state.airport, 4, 4)).toBe('facility');
  });

  it('refuses a second tower', () => {
    const state = game();
    applyFacility(state, quote(checkFacility(state, 'tower', 4, 4)), 'tower', 4, 4);
    expect(checkFacility(state, 'tower', 9, 9)).toBe('already-built');
  });

  it('upgrades a tower up to its ceiling, then stops', () => {
    const state = game(1_000_000);
    applyFacility(state, quote(checkFacility(state, 'tower', 4, 4)), 'tower', 4, 4);

    for (let level = 2; level < TOWER_LEVELS.length; level++) {
      applyUpgradeFacility(state, quote(checkUpgradeFacility(state, 'tower')), 'tower');
    }

    expect(towerLevelOf(state.airport)).toBe(TOWER_LEVELS.length - 1);
    expect(checkUpgradeFacility(state, 'tower')).toBe('max-level');
  });

  it('will not upgrade a facility that has no levels', () => {
    const state = game();
    applyFacility(state, quote(checkFacility(state, 'fuel-farm', 4, 4)), 'fuel-farm', 4, 4);
    expect(checkUpgradeFacility(state, 'fuel-farm')).toBe('max-level');
  });
});

describe('demolition', () => {
  it('refunds part of a stand and clears the tile', () => {
    const state = game();
    applyStand(state, quote(checkStand(state, 6, 6, 'medium')), 6, 6, 'medium');
    const before = state.cash;

    const refund = quote(checkDemolish(state, 6, 6));
    applyDemolish(state, refund, 6, 6);

    expect(refund.cost).toBeLessThan(0);
    expect(state.cash).toBe(before - refund.cost);
    expect(Math.abs(refund.cost)).toBeLessThan(STAND_COST.medium);
    expect(occupantAt(state.airport, 6, 6)).toBe(null);
  });

  it('removes a whole runway when any of its tiles is tapped', () => {
    const state = game();
    applyRunway(state, quote(checkRunway(state, 8, 10, 15, 'grass')), 8, 10, 15, 'grass');

    applyDemolish(state, quote(checkDemolish(state, 8, 13)), 8, 13);

    expect(state.airport.runways).toHaveLength(0);
    expect(occupantAt(state.airport, 8, 10)).toBe(null);
  });

  it('reports an empty tile rather than charging for nothing', () => {
    expect(checkDemolish(game(), 2, 2)).toBe('nothing-there');
  });
});
