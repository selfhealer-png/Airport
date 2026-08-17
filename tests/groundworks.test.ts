import { describe, expect, it } from 'vitest';
import { terrainFrom } from '@/content/levels';
import { createGame, hasGroundwork } from '@/sim/airport';
import {
  applyClearRun,
  applyDemolish,
  applyRoadRun,
  checkClearRun,
  checkDemolish,
  checkRoadRun,
  checkRunway,
  checkStand,
  checkTaxiwayRun,
  isAffordableQuote,
} from '@/sim/build';
import { terrainAllows, type GameState, type LevelMap } from '@/sim/types';

/**
 * What paying to work the ground actually buys.
 *
 * The rule these pin is the whole reason terrain is a puzzle rather than a tax: an obstacle
 * does not become grass, it becomes a specific thing that carries specific traffic.
 */

describe('what worked ground will carry', () => {
  it('lets anything onto grass', () => {
    expect(terrainAllows('grass', false, 'structure')).toBe(true);
    expect(terrainAllows('grass', false, 'taxiway')).toBe(true);
    expect(terrainAllows('grass', false, 'road')).toBe(true);
  });

  it('refuses every obstacle until the work is paid for', () => {
    for (const terrain of ['woods', 'water', 'rock'] as const) {
      expect(terrainAllows(terrain, false, 'road')).toBe(false);
      expect(terrainAllows(terrain, false, 'taxiway')).toBe(false);
      expect(terrainAllows(terrain, false, 'structure')).toBe(false);
    }
  });

  it('makes felled woods ordinary ground', () => {
    // The pressure valve. Woods are the obstacle you buy your way past outright, which is
    // what stops an obstacle map being unwinnable.
    expect(terrainAllows('woods', true, 'structure')).toBe(true);
    expect(terrainAllows('woods', true, 'taxiway')).toBe(true);
    expect(terrainAllows('woods', true, 'road')).toBe(true);
  });

  it('lets both networks cross a bridge but nothing stand on it', () => {
    // Water splits the ground you can build on, not the routes across it.
    expect(terrainAllows('water', true, 'road')).toBe(true);
    expect(terrainAllows('water', true, 'taxiway')).toBe(true);
    expect(terrainAllows('water', true, 'structure')).toBe(false);
  });

  it('lets only a road through a tunnel', () => {
    // Rock splits the airside absolutely, which is what makes it a different obstacle from
    // water rather than a dearer one: a runway and its apron can never sit on opposite sides
    // of a ridge.
    expect(terrainAllows('rock', true, 'road')).toBe(true);
    expect(terrainAllows('rock', true, 'taxiway')).toBe(false);
    expect(terrainAllows('rock', true, 'structure')).toBe(false);
  });
});

/**
 * A test field with one column of obstacles: woods, water then rock, with grass either side.
 * Small enough that the arithmetic in an expectation can be read at a glance.
 */
const OBSTACLES: LevelMap = {
  id: 'test-obstacles',
  name: 'Obstacles',
  ...terrainFrom([
    'gggfgg',
    'gfgfgg',
    'gwgfgg',
    'grgggg',
    'gggggg',
    'gggggg',
  ]),
};

function game(): GameState {
  const state = createGame(OBSTACLES, 1);
  state.cash = 500_000;
  return state;
}

/** Works a run, asserting it was affordable — the arrange step of most of these. */
function clear(state: GameState, x0: number, y0: number, x1: number, y1: number): void {
  const quote = checkClearRun(state, x0, y0, x1, y1);
  if (!isAffordableQuote(quote)) throw new Error(`expected a quote, got ${quote}`);
  applyClearRun(state, quote, x0, y0, x1, y1);
}

describe('pricing groundworks', () => {
  it('prices a run by what is under each tile', () => {
    // A drag across mixed ground is quoted correctly rather than at one blended rate, which
    // is the whole reason there is a single chip rather than three.
    const quote = checkClearRun(game(), 1, 0, 1, 3);
    expect(isAffordableQuote(quote) && quote.cost).toBe(0 + 180 + 900 + 1_400);
  });

  it('charges nothing twice for ground already worked', () => {
    const state = game();
    clear(state, 1, 1, 1, 1);
    expect(checkClearRun(state, 1, 1, 1, 1)).toBe('nothing-to-clear');
  });

  it('refuses a run that is all grass', () => {
    // Dragging over open ground is a slip of the thumb, not a purchase.
    expect(checkClearRun(game(), 0, 0, 0, 5)).toBe('nothing-to-clear');
  });

  it('skips the grass in a mixed run rather than refusing it', () => {
    // Same forgiveness as dragging a grass runway chip along a paved strip: the tiles that
    // have nothing to do cost nothing and do not spoil the drag.
    const state = game();
    clear(state, 1, 0, 1, 3);
    expect(hasGroundwork(state.airport, 1, 1)).toBe(true);
    expect(hasGroundwork(state.airport, 1, 3)).toBe(true);
    expect(hasGroundwork(state.airport, 1, 0)).toBe(false);
  });

  it('refuses a diagonal', () => {
    expect(checkClearRun(game(), 0, 0, 3, 3)).toBe('not-straight');
  });
});

describe('what may then be built on it', () => {
  it('builds a runway across felled woods', () => {
    // Woods are the obstacle you buy your way past outright: once felled the ground is
    // ordinary and takes anything.
    const state = game();
    expect(checkRunway(state, 3, 0, 2, 'grass')).toBe('terrain-blocked');
    clear(state, 3, 0, 3, 2);
    expect(isAffordableQuote(checkRunway(state, 3, 0, 2, 'grass'))).toBe(true);
  });

  it('will not put a runway on a bridge', () => {
    const state = game();
    clear(state, 1, 1, 1, 3);
    expect(checkRunway(state, 1, 1, 3, 'grass')).toBe('terrain-blocked');
  });

  it('will not put a stand on a bridge', () => {
    const state = game();
    clear(state, 1, 2, 1, 2);
    expect(checkStand(state, 1, 2, 'small')).toBe('terrain-blocked');
  });

  it('runs a taxiway over a bridge', () => {
    const state = game();
    clear(state, 1, 2, 1, 2);
    expect(isAffordableQuote(checkTaxiwayRun(state, 1, 2, 1, 2))).toBe(true);
  });

  it('will not run a taxiway through a tunnel', () => {
    // The rule that gives rock its own character: the landside crosses, the airside does not.
    const state = game();
    clear(state, 1, 3, 1, 3);
    expect(checkTaxiwayRun(state, 1, 3, 1, 3)).toBe('terrain-blocked');
  });

  it('runs a road through a tunnel', () => {
    const state = game();
    clear(state, 1, 3, 1, 3);
    expect(isAffordableQuote(checkRoadRun(state, 1, 3, 1, 3))).toBe(true);
  });
});

describe('groundworks are permanent', () => {
  it('leaves the work behind when what sits on it is demolished', () => {
    // Nothing un-fells a wood, and demolishing the road on a bridge must not refund the
    // bridge. Undo still covers a slip, because undo restores whole snapshots.
    const state = game();
    clear(state, 1, 3, 1, 3);
    const road = checkRoadRun(state, 1, 3, 1, 3);
    if (!isAffordableQuote(road)) throw new Error('expected a quote');
    applyRoadRun(state, road, 1, 3, 1, 3);

    const removal = checkDemolish(state, 1, 3);
    if (!isAffordableQuote(removal)) throw new Error('expected a quote');
    applyDemolish(state, removal, 1, 3);

    expect(hasGroundwork(state.airport, 1, 3)).toBe(true);
  });

  it('offers nothing to demolish on bare worked ground', () => {
    const state = game();
    clear(state, 1, 1, 1, 1);
    expect(checkDemolish(state, 1, 1)).toBe('nothing-there');
  });
});
