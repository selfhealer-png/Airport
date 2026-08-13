import { describe, expect, it } from 'vitest';
import { LEVEL_MEADOW } from '@/content/levels';
import { RUNWAY_COST_PER_TILE } from '@/content/costs';
import { addRunway, createGame } from '@/sim/airport';
import {
  applyGrowRunway,
  checkGrowRunway,
  checkRunway,
  isAffordableQuote,
  runwayCost,
  touchedRunways,
} from '@/sim/build';
import { resolvePlacement, commitPlacement } from '@/ui/placement';
import { runwayLength, type GameState } from '@/sim/types';

/**
 * Growing a runway — longer, better surfaced, or both — used to be reachable only from the
 * campaign harness. A player could not do it at all: the only way to lengthen a strip was to
 * demolish it at a 40% loss and lay it again, which punished them for the small start the
 * game forces on everyone.
 */

function field(): GameState {
  const state = createGame(LEVEL_MEADOW, 1);
  state.cash = 50_000;
  return state;
}

const quoteFor = (check: ReturnType<typeof checkGrowRunway>): number => {
  if (!isAffordableQuote(check)) throw new Error(`refused: ${check}`);
  return check.cost;
};

describe('growing a runway', () => {
  it('charges the difference, so building small first costs nothing extra', () => {
    // A 4-tile grass strip grown to 8 tiles of gravel must cost exactly what an 8-tile gravel
    // strip would have cost, less what the grass already cost. Anything else penalises the
    // player for starting small, which is the only way the game lets them start.
    const state = field();
    const id = addRunway(state.airport, 8, 10, 13, 'grass');

    const cost = quoteFor(checkGrowRunway(state, id, 10, 17, 'gravel'));
    const built = runwayCost(8, 'gravel') - runwayCost(4, 'grass');
    expect(cost).toBe(built);
  });

  it('extends without repaving when the chip is a worse surface', () => {
    // Dragging the grass chip along a paved strip means "make it longer", not "tear it up".
    const state = field();
    const id = addRunway(state.airport, 8, 10, 13, 'asphalt');

    const cost = quoteFor(checkGrowRunway(state, id, 10, 15, 'grass'));
    expect(cost).toBe(runwayCost(2, 'asphalt'));

    applyGrowRunway(state, { cost }, id, 10, 15, 'grass');
    expect(state.airport.runways[0]!.surface).toBe('asphalt');
    expect(runwayLength(state.airport.runways[0]!)).toBe(6);
  });

  it('grows upwards as readily as downwards', () => {
    const state = field();
    const id = addRunway(state.airport, 8, 20, 23, 'grass');
    const cost = quoteFor(checkGrowRunway(state, id, 16, 23, 'grass'));
    applyGrowRunway(state, { cost }, id, 16, 23, 'grass');

    const runway = state.airport.runways[0]!;
    expect({ y0: runway.y0, y1: runway.y1 }).toEqual({ y0: 16, y1: 23 });
  });

  it('resurfaces in place when the drag adds no length', () => {
    const state = field();
    const id = addRunway(state.airport, 8, 10, 15, 'grass');
    const perTile = RUNWAY_COST_PER_TILE.asphalt - RUNWAY_COST_PER_TILE.grass;

    expect(quoteFor(checkGrowRunway(state, id, 10, 15, 'asphalt'))).toBe(perTile * 6);
  });

  it('refuses a drag that would change nothing', () => {
    const state = field();
    const id = addRunway(state.airport, 8, 10, 15, 'grass');
    expect(checkGrowRunway(state, id, 11, 14, 'grass')).toBe('no-change');
  });

  it('will not merge a military strip into a civil one', () => {
    const state = field();
    const id = addRunway(state.airport, 8, 10, 15, 'asphalt', 'military');
    expect(checkGrowRunway(state, id, 10, 18, 'asphalt', 'civil')).toBe('use-mismatch');
  });

  it('refuses to grow through something already built', () => {
    const state = field();
    const id = addRunway(state.airport, 8, 10, 13, 'grass');
    addRunway(state.airport, 8, 18, 21, 'grass'); // a second strip further down
    expect(checkGrowRunway(state, id, 10, 20, 'grass')).toBe('occupied');
  });
});

describe('the drag that grows it', () => {
  it('grows the runway under the drag instead of refusing as occupied', () => {
    const state = field();
    addRunway(state.airport, 8, 10, 13, 'grass');
    const tool = { kind: 'runway', surface: 'gravel', use: 'civil' } as const;

    const placement = resolvePlacement(state, tool, { x: 8, y: 12 }, { x: 8, y: 17 });
    expect(placement.growing).toBeTruthy();
    expect(placement.summary).toMatch(/extend to 8 tiles and repave/i);
    // The highlight covers the finished runway, not just the tiles being added.
    expect(placement.tiles).toHaveLength(8);

    expect(commitPlacement(state, tool, placement)).toBe(true);
    expect(state.airport.runways).toHaveLength(1);
    expect(runwayLength(state.airport.runways[0]!)).toBe(8);
    expect(state.airport.runways[0]!.surface).toBe('gravel');
  });

  it('still lays a separate runway when the drag is clear of the existing one', () => {
    const state = field();
    addRunway(state.airport, 8, 10, 13, 'grass');
    const tool = { kind: 'runway', surface: 'grass', use: 'civil' } as const;

    const placement = resolvePlacement(state, tool, { x: 8, y: 20 }, { x: 8, y: 24 });
    expect(placement.growing).toBeUndefined();
    expect(commitPlacement(state, tool, placement)).toBe(true);
    expect(state.airport.runways).toHaveLength(2);
  });

  it('treats a drag that stops against the threshold as continuing the runway', () => {
    // One tile of slack: a drag ending exactly where the runway starts is obviously meant to
    // lengthen it, not to butt a new strip up against it.
    const state = field();
    addRunway(state.airport, 8, 10, 13, 'grass');
    expect(touchedRunways(state.airport, 8, 6, 9)).toHaveLength(1);
    expect(touchedRunways(state.airport, 8, 6, 8)).toHaveLength(0);
  });

  it('leaves a fresh column building a brand new runway', () => {
    const state = field();
    addRunway(state.airport, 8, 10, 13, 'grass');
    expect(isAffordableQuote(checkRunway(state, 14, 10, 15, 'grass'))).toBe(true);
  });
});
