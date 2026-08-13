import { describe, expect, it } from 'vitest';
import { LEVEL_MEADOW } from '@/content/levels';
import { RUNWAY_COST_PER_TILE } from '@/content/costs';
import { createGame, towerLevelOf } from '@/sim/airport';
import { isAffordableQuote, occupantAt } from '@/sim/build';
import { commitPlacement, resolvePlacement, type Tool } from '@/ui/placement';
import { runwayLength, type GameState } from '@/sim/types';

/**
 * The drag-to-build layer. It has no DOM in it — a drag is just two tiles — so the behaviour
 * the player actually feels can be tested without a browser.
 */

function game(cash = 100_000): GameState {
  const state = createGame(LEVEL_MEADOW, 1);
  state.cash = cash;
  return state;
}

function drag(state: GameState, tool: Tool, from: [number, number], to: [number, number]) {
  return resolvePlacement(state, tool, { x: from[0], y: from[1] }, { x: to[0], y: to[1] });
}

describe('runway drags', () => {
  const tool: Tool = { kind: 'runway', surface: 'grass', use: 'civil' };

  it('keeps the runway in the column the drag started in', () => {
    // The finger wanders sideways; the strip must not follow it. Runways are vertical.
    const placement = drag(game(), tool, [8, 10], [14, 16]);

    expect(placement.tiles.every((t) => t.x === 8)).toBe(true);
    expect(placement.tiles).toHaveLength(7);
  });

  it('grows upwards when dragged upwards', () => {
    const placement = drag(game(), tool, [8, 16], [8, 10]);
    expect(placement.tiles.map((t) => t.y)).toEqual([16, 15, 14, 13, 12, 11, 10]);
  });

  it('prices the drag as the player extends it', () => {
    const state = game();
    const short = drag(state, tool, [8, 10], [8, 12]);
    const long = drag(state, tool, [8, 10], [8, 17]);

    expect(isAffordableQuote(short.check) && short.check.cost).toBe(
      3 * RUNWAY_COST_PER_TILE.grass,
    );
    expect(isAffordableQuote(long.check) && long.check.cost).toBe(
      8 * RUNWAY_COST_PER_TILE.grass,
    );
  });

  it('builds exactly the tiles that were previewed', () => {
    const state = game();
    const placement = drag(state, tool, [8, 10], [8, 15]);
    expect(commitPlacement(state, tool, placement)).toBe(true);

    const runway = state.airport.runways[0]!;
    expect(runwayLength(runway)).toBe(placement.tiles.length);
    for (const tile of placement.tiles) {
      expect(occupantAt(state.airport, tile.x, tile.y)).toBe('runway');
    }
  });

  it('refuses to commit an invalid drag', () => {
    const state = game();
    const tooShort = drag(state, tool, [8, 10], [8, 11]);

    expect(commitPlacement(state, tool, tooShort)).toBe(false);
    expect(state.airport.runways).toHaveLength(0);
    expect(state.cash).toBe(100_000);
  });
});

describe('taxiway drags', () => {
  const tool: Tool = { kind: 'taxiway' };

  it('snaps to the axis the player moved furthest along', () => {
    const mostlyHorizontal = drag(game(), tool, [5, 5], [10, 6]);
    expect(mostlyHorizontal.tiles.every((t) => t.y === 5)).toBe(true);

    const mostlyVertical = drag(game(), tool, [5, 5], [6, 10]);
    expect(mostlyVertical.tiles.every((t) => t.x === 5)).toBe(true);
  });

  it('lays the run it previewed', () => {
    const state = game();
    const placement = drag(state, tool, [5, 5], [9, 5]);
    commitPlacement(state, tool, placement);

    for (const tile of placement.tiles) {
      expect(occupantAt(state.airport, tile.x, tile.y)).toBe('taxiway');
    }
  });
});

describe('single-tile tools', () => {
  it('places a stand under the finger, not where the drag began', () => {
    const state = game();
    const tool: Tool = { kind: 'stand', size: 'small' };
    const placement = drag(state, tool, [4, 4], [7, 9]);

    expect(placement.tiles).toEqual([{ x: 7, y: 9 }]);
    commitPlacement(state, tool, placement);
    expect(occupantAt(state.airport, 7, 9)).toBe('stand');
    expect(occupantAt(state.airport, 4, 4)).toBe(null);
  });

  it('places a facility and the simulation sees it immediately', () => {
    const state = game();
    const tool: Tool = { kind: 'facility', type: 'tower' };
    const placement = drag(state, tool, [3, 3], [3, 3]);

    commitPlacement(state, tool, placement);
    expect(towerLevelOf(state.airport)).toBe(1);
  });

  it('demolishes what is under the finger and refunds', () => {
    const state = game();
    const stand: Tool = { kind: 'stand', size: 'medium' };
    commitPlacement(state, stand, drag(state, stand, [6, 6], [6, 6]));
    const afterBuild = state.cash;

    const demolish: Tool = { kind: 'demolish' };
    const placement = drag(state, demolish, [6, 6], [6, 6]);
    expect(commitPlacement(state, demolish, placement)).toBe(true);

    expect(state.cash).toBeGreaterThan(afterBuild);
    expect(occupantAt(state.airport, 6, 6)).toBe(null);
  });

  it('reports an empty tile rather than committing a demolition', () => {
    const state = game();
    const demolish: Tool = { kind: 'demolish' };
    const placement = drag(state, demolish, [2, 2], [2, 2]);

    expect(placement.check).toBe('nothing-there');
    expect(commitPlacement(state, demolish, placement)).toBe(false);
  });
});
