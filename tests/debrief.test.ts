import { describe, expect, it } from 'vitest';
import { LEVEL_MEADOW } from '@/content/levels';
import { addRunway, addStand, addTaxiwayRun, createGame } from '@/sim/airport';
import { runDay } from '@/sim/step';
import { groupLosses, serviceLevel, summariseDay } from '@/ui/debrief';
import type { GameState, ScheduledArrival } from '@/sim/types';
import { fullyServiced } from './helpers';

/**
 * The debrief is the only feedback a player gets, so what it says is game logic, not
 * presentation. These tests pin the words.
 */

function grassField(): GameState {
  const state = createGame(LEVEL_MEADOW, 42);
  addRunway(state.airport, 8, 10, 13, 'grass'); // 4 tiles: light aircraft only
  addTaxiwayRun(state.airport, 9, 12, 11, 12);
  addStand(state.airport, 12, 12, 'small');
  fullyServiced(state.airport);
  return state;
}

const arrival = (atSeconds: number, classId: ScheduledArrival['classId']): ScheduledArrival => ({
  atSeconds,
  classId,
});

describe('debrief', () => {
  it('counts the day and totals the money', () => {
    const state = grassField();
    const day = runDay(state, [arrival(0, 'light'), arrival(30, 'light')]);
    const result = summariseDay(day);

    expect(result.landed).toBe(2);
    expect(result.diverted).toBe(0);
    expect(result.crashed).toBe(0);
    expect(result.cash).toBeGreaterThan(0);
  });

  it('groups losses by reason rather than listing aeroplanes', () => {
    const state = grassField();
    // Three commuters that this field can never take: one line, not three.
    const day = runDay(state, [
      arrival(0, 'commuter'),
      arrival(1, 'commuter'),
      arrival(2, 'commuter'),
    ]);

    const groups = groupLosses(day);
    const lengths = groups.find((g) => g.reason === 'no runway long enough');
    expect(lengths?.count).toBe(3);
    expect(lengths?.classes).toBe('Commuter turboprop');
  });

  it('names the aircraft types caught by each reason', () => {
    const state = grassField();
    const day = runDay(state, [arrival(0, 'commuter'), arrival(0, 'narrowbody')]);

    const reasons = groupLosses(day).map((g) => g.reason);
    // A narrowbody is stopped by the missing fire station before runway length is relevant,
    // so the two aircraft must be reported under different headings.
    expect(new Set(reasons).size).toBe(reasons.length);
    expect(reasons.length).toBeGreaterThan(1);
  });

  it('says so plainly when nothing was lost', () => {
    const state = grassField();
    const day = runDay(state, [arrival(0, 'light')]);
    expect(groupLosses(day)).toEqual([]);
  });

  it('orders reasons by how many aeroplanes each cost', () => {
    const state = grassField();
    const day = runDay(state, [
      arrival(0, 'commuter'),
      arrival(1, 'commuter'),
      arrival(2, 'narrowbody'),
    ]);

    const counts = groupLosses(day).map((g) => g.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });
});

/**
 * The service level replaced reputation. It is the only running measure of how the airport is
 * doing — cash cannot do the job, because cash only ever goes up — so its wording is pinned
 * the same way the loss reasons are.
 */
describe('service level', () => {
  it('reports the day against what was booked in', () => {
    const state = grassField();
    // Two light aircraft it can take, one commuter it never could.
    const day = runDay(state, [arrival(0, 'light'), arrival(20, 'light'), arrival(1, 'commuter')]);

    expect(serviceLevel(day)).toEqual(['landed 2 of 3  ·  67%']);
  });

  it('adds the campaign running total when there is one', () => {
    const state = grassField();
    const day = runDay(state, [arrival(0, 'light')]);

    expect(serviceLevel(day, { landedTotal: 402, scheduledTotal: 511 })).toEqual([
      'landed 1 of 1  ·  100%',
      'campaign 402 of 511  ·  79%',
    ]);
  });

  it('counts the campaign total as days are played, without feeding it back', () => {
    const state = grassField();
    runDay(state, [arrival(0, 'light'), arrival(1, 'commuter')]);
    runDay(state, [arrival(0, 'light')]);

    expect(state.landedTotal).toBe(2);
    expect(state.scheduledTotal).toBe(3);
  });
});
