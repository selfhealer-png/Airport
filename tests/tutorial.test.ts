import { describe, expect, it } from 'vitest';
import { currentStep, TUTORIAL_STEPS, tutorialApplies } from '@/content/tutorial';
import { LEVEL_MEADOW } from '@/content/levels';
import { createGame } from '@/sim/airport';
import {
  applyRoadRun,
  applyRunway,
  applyStand,
  applyTaxiwayRun,
  checkRoadRun,
  checkRunway,
  checkStand,
  checkTaxiwayRun,
  isAffordableQuote,
  type BuildCheck,
} from '@/sim/build';
import { terrainAt, type GameState } from '@/sim/types';

/**
 * The tutorial is prose plus predicates, and prose that has never been followed end to end is
 * just prose. The test that matters is the long one: drive a real game through all six steps
 * with the same `check…`/`apply…` pairs a player's thumb drives, and assert each step reports
 * done only once the build that satisfies it has actually happened.
 */

function game(): GameState {
  const state = createGame(LEVEL_MEADOW, 42);
  state.cash = 50_000;
  return state;
}

/** Builds, insisting the check passed — a refused build would silently skip a step. */
function build(check: BuildCheck, apply: (quote: { cost: number }) => void): void {
  if (!isAffordableQuote(check)) throw new Error(`expected a quote, got ${check}`);
  apply(check);
}

describe('walking a real game through the tutorial', () => {
  it('reaches the end, one step at a time', () => {
    const state = game();

    expect(currentStep(state)?.id).toBe('runway');
    build(checkRunway(state, 15, 10, 13, 'grass'), (q) =>
      applyRunway(state, q, 15, 10, 13, 'grass'),
    );

    expect(currentStep(state)?.id).toBe('runway-road');
    // The spine along the top first: every spur hangs off it, and without it the two service
    // roads below are two networks serving two halves of an airport.
    build(checkRoadRun(state, 14, 0, 19, 0), (q) => applyRoadRun(state, q, 14, 0, 19, 0));
    build(checkRoadRun(state, 14, 1, 14, 13), (q) => applyRoadRun(state, q, 14, 1, 14, 13));

    expect(currentStep(state)?.id).toBe('stand');
    build(checkStand(state, 18, 11, 'small'), (q) => applyStand(state, q, 18, 11, 'small'));

    expect(currentStep(state)?.id).toBe('taxiway');
    build(checkTaxiwayRun(state, 16, 11, 17, 11), (q) =>
      applyTaxiwayRun(state, q, 16, 11, 17, 11),
    );

    expect(currentStep(state)?.id).toBe('stand-road');
    build(checkRoadRun(state, 19, 1, 19, 11), (q) => applyRoadRun(state, q, 19, 1, 19, 11));

    // The last step is the one thing the player cannot build their way to.
    expect(currentStep(state)?.id).toBe('open');
    state.phase = 'day';
    expect(currentStep(state)).toBeNull();
  });

  it('skips ahead when a player builds out of order', () => {
    /*
     * Nothing is gated, and that is deliberate: a tutorial that traps you is worse than none.
     * Steps ask for a *state* rather than for an action, so laying the stand first simply
     * means the game never asks for it.
     */
    const state = game();
    build(checkRoadRun(state, 14, 0, 19, 0), (q) => applyRoadRun(state, q, 14, 0, 19, 0));
    build(checkStand(state, 18, 11, 'small'), (q) => applyStand(state, q, 18, 11, 'small'));
    build(checkRoadRun(state, 19, 1, 19, 11), (q) => applyRoadRun(state, q, 19, 1, 19, 11));

    expect(currentStep(state)?.id).toBe('runway');
    build(checkRunway(state, 15, 10, 13, 'grass'), (q) =>
      applyRunway(state, q, 15, 10, 13, 'grass'),
    );
    build(checkRoadRun(state, 14, 1, 14, 13), (q) => applyRoadRun(state, q, 14, 1, 14, 13));

    // Straight past 'stand' and 'stand-road', which were satisfied before they were asked.
    expect(currentStep(state)?.id).toBe('taxiway');
  });

  it('does not apply to a campaign already under way', () => {
    // Whether to be here at all is a different question from what is left to do, which is why
    // it lives outside the steps. A player on day nine learned this weeks ago.
    const state = game();
    expect(tutorialApplies(state)).toBe(true);
    state.day = 9;
    expect(tutorialApplies(state)).toBe(false);
  });

  it('does not apply to a scenario', () => {
    // A scenario hands over a finished airport, so every step would already be satisfied and
    // the panel would flash past saying nothing.
    const state = game();
    state.scenarioId = 'grass-roots';
    expect(tutorialApplies(state)).toBe(false);
  });
});

describe('the steps themselves', () => {
  it('asks for a runway before it asks for anything to do with one', () => {
    // Order is the only thing a linear tutorial has. Advice about roads to a runway that does
    // not exist is not advice.
    expect(TUTORIAL_STEPS[0]!.id).toBe('runway');
  });

  it('never points at a tile that is off the map', () => {
    const state = game();
    for (const step of TUTORIAL_STEPS) {
      for (const tile of step.where(state)) {
        expect(terrainAt(state.airport.map, tile.x, tile.y), `${step.id} @ ${tile.x},${tile.y}`)
          .toBeDefined();
      }
    }
  });

  it('points somewhere for every step that is about a place', () => {
    // A step whose outline is empty on a fresh field is a step that says "here" and shows
    // nothing, which is worse than saying nothing at all.
    const state = game();
    expect(TUTORIAL_STEPS[0]!.where(state).length).toBeGreaterThan(0);
  });

  it('leaves the suggested runway room for an airport around it', () => {
    /*
     * The suggestion is load-bearing: a player who follows it and then finds there is no room
     * for the apron has been walked into a corner by the game itself.
     */
    const state = game();
    const suggested = TUTORIAL_STEPS[0]!.where(state);
    const { map } = state.airport;

    for (const tile of suggested) {
      expect(tile.x).toBeGreaterThan(2);
      expect(tile.x).toBeLessThan(map.width - 5);
      expect(tile.y).toBeGreaterThan(2);
      expect(tile.y).toBeLessThan(map.height - 5);
    }
  });

  it('gives every step a distinct id', () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
