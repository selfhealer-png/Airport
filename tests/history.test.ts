import { describe, expect, it } from 'vitest';
import { LEVEL_MEADOW } from '@/content/levels';
import { addRoadRun, addRunway, addStand, addTaxiwayRun, createGame } from '@/sim/airport';
import { applyRunway, applyStand, checkRunway, checkStand, isAffordableQuote } from '@/sim/build';
import { capture, createHistory } from '@/save/history';
import type { GameState } from '@/sim/types';

/**
 * Undo exists because a stray tap on a phone builds something, and the only way back was to
 * demolish it at a 40% loss — a punishment for a slip of the thumb rather than for a
 * decision. So the money matters as much as the tile.
 */

function field(): GameState {
  const state = createGame(LEVEL_MEADOW, 1);
  addRunway(state.airport, 8, 10, 15, 'grass');
  addTaxiwayRun(state.airport, 9, 12, 11, 12);
  addStand(state.airport, 12, 12, 'small');
  addRoadRun(state.airport, 7, 10, 7, 16);
  return state;
}

describe('undo', () => {
  it('puts back both the tile and the money', () => {
    const state = field();
    const cash = state.cash;
    const stands = state.airport.stands.length;
    const history = createHistory();

    const before = capture(state);
    const quote = checkStand(state, 14, 20, 'medium');
    if (!isAffordableQuote(quote)) throw new Error('should have been affordable');
    applyStand(state, quote, 14, 20, 'medium');
    history.push(before);

    expect(state.airport.stands.length).toBe(stands + 1);
    expect(state.cash).toBeLessThan(cash);

    expect(history.undo(state)).toBe(true);
    expect(state.airport.stands.length).toBe(stands);
    expect(state.cash).toBe(cash);
  });

  it('keeps the same state object, so everything holding a reference still works', () => {
    const state = field();
    const identity = state;
    const history = createHistory();

    history.push(capture(state));
    const quote = checkStand(state, 14, 20, 'small');
    if (isAffordableQuote(quote)) applyStand(state, quote, 14, 20, 'small');
    history.undo(state);

    expect(state).toBe(identity);
  });

  it('walks back through several builds in order', () => {
    const state = field();
    const history = createHistory();
    const cash = state.cash;

    for (const y of [20, 22, 24]) {
      history.push(capture(state));
      const quote = checkStand(state, 14, y, 'small');
      if (isAffordableQuote(quote)) applyStand(state, quote, 14, y, 'small');
    }
    expect(state.airport.stands.length).toBe(4);

    history.undo(state);
    expect(state.airport.stands.length).toBe(3);
    history.undo(state);
    history.undo(state);
    expect(state.airport.stands.length).toBe(1);
    expect(state.cash).toBe(cash);
  });

  it('undoes a whole runway drag as one action, not tile by tile', () => {
    // A runway is one build however many tiles it covers, and undo has to agree.
    const state = field();
    const history = createHistory();
    const runways = state.airport.runways.length;

    history.push(capture(state));
    const quote = checkRunway(state, 18, 4, 12, 'grass');
    if (!isAffordableQuote(quote)) throw new Error('should have been affordable');
    applyRunway(state, quote, 18, 4, 12, 'grass');
    expect(state.airport.runways.length).toBe(runways + 1);

    history.undo(state);
    expect(state.airport.runways.length).toBe(runways);
  });

  it('reports when there is nothing left to undo', () => {
    const state = field();
    const history = createHistory();
    expect(history.canUndo).toBe(false);
    expect(history.undo(state)).toBe(false);

    history.push(capture(state));
    expect(history.canUndo).toBe(true);
    history.undo(state);
    expect(history.canUndo).toBe(false);
  });

  it('forgets everything when a day begins', () => {
    const state = field();
    const history = createHistory();
    history.push(capture(state));
    history.clear();
    expect(history.canUndo).toBe(false);
  });
});
