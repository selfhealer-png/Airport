import { describe, expect, it } from 'vitest';
import {
  certificationLevel,
  CERTIFICATION_LEVELS,
  handlingCost,
  HANDLING_FEE_FRACTION,
  PASSENGER_FARE,
  requiredCertification,
} from '@/content/buildings';
import { aircraftClass, AIRCRAFT_CLASSES } from '@/content/aircraft';
import { LEVEL_MEADOW } from '@/content/levels';
import { addRunway, addStand, addTaxiwayRun, createGame } from '@/sim/airport';
import { structuralBlock } from '@/sim/assignment';
import {
  applyCertify,
  applySurrenderCertification,
  checkCertify,
  checkSurrenderCertification,
  isAffordableQuote,
} from '@/sim/build';
import { buildServices } from '@/sim/connectivity';
import { runDay } from '@/sim/step';
import { summariseDay } from '@/ui/debrief';
import type { GameState, ScheduledArrival } from '@/sim/types';
import { fullyServiced, licensed } from './helpers';

/**
 * The two costs that recur.
 *
 * Everything else in the game is capital: you pay once and own it, which is why the campaign
 * used to end with 78% of everything ever earned sitting in the bank. What these tests hold in
 * place is not the numbers — those are balance and will move — but the two properties that
 * stop a running cost from becoming the death spiral reputation used to be: it is charged on
 * what you actually earned, and the standing part can always be given up.
 */

const arrival = (atSeconds: number, classId: ScheduledArrival['classId']): ScheduledArrival => ({
  atSeconds,
  classId,
});

/** A jet-capable airport, licensed for anything, so only the costs are in play. */
function airport(): GameState {
  const state = createGame(LEVEL_MEADOW, 42);
  addRunway(state.airport, 8, 4, 21, 'asphalt');
  addTaxiwayRun(state.airport, 9, 10, 11, 10);
  addStand(state.airport, 12, 10, 'large');
  state.airport.facilities.push(
    { id: 'f-fuel', type: 'fuel-farm', x: 2, y: 2, level: 0 },
    { id: 'f-fire', type: 'fire-station', x: 3, y: 2, level: 0 },
    { id: 'f-tower', type: 'tower', x: 4, y: 2, level: 3 },
    { id: 'f-term', type: 'terminal', x: 5, y: 2, level: 3 },
  );
  fullyServiced(state.airport);
  licensed(state.airport);
  state.cash = 500_000;
  return state;
}

describe('ground handling', () => {
  it('is a proportion of what the flight earned', () => {
    expect(handlingCost(1_000)).toBe(Math.round(1_000 * HANDLING_FEE_FRACTION));
  });

  /**
   * The property that matters more than the rate. A charge priced per passenger or per
   * movement is savagely regressive here: daily profit grows about 150x across the campaign
   * while headcount grows far less, so a flat per-head fee was a third of passenger revenue on
   * day 8 and a twelfth of it on day 50. It stalled the early economy outright.
   */
  it('takes the same share of a small day as of a large one', () => {
    const small = handlingCost(500) / 500;
    const large = handlingCost(500_000) / 500_000;
    expect(small).toBeCloseTo(large, 4);
  });

  it('is charged on aeroplanes that land', () => {
    const state = airport();
    const day = runDay(state, [arrival(0, 'narrowbody')]);
    expect(day.handlingCost).toBeGreaterThan(0);
  });

  /**
   * Nobody handled an aeroplane that went elsewhere. This is what stops a bad day compounding:
   * the worse the day, the less it costs, so a struggling airport is never charged for
   * traffic it could not take.
   */
  it('is not charged on aeroplanes that divert', () => {
    const state = createGame(LEVEL_MEADOW, 42);
    licensed(state.airport);
    // No runway at all, so nothing can land.
    const day = runDay(state, [arrival(0, 'narrowbody'), arrival(1, 'narrowbody')]);

    expect(summariseDay(day).landed).toBe(0);
    expect(day.handlingCost).toBe(0);
  });

  it('leaves every flight profitable', () => {
    // A handling charge that could exceed the takings would make landing an aeroplane worse
    // than turning it away, which would invert the entire game.
    for (const spec of Object.values(AIRCRAFT_CLASSES)) {
      const takings = spec.fare + spec.passengers * PASSENGER_FARE;
      expect(handlingCost(takings)).toBeLessThan(takings);
    }
  });
});

describe('aerodrome certification', () => {
  it('grades a class by the runway it needs', () => {
    expect(requiredCertification(3)).toBe(0);
    expect(requiredCertification(aircraftClass('narrowbody').runwayLength)).toBeGreaterThan(0);
    // Rotorcraft need no runway, so the free category covers them.
    expect(requiredCertification(aircraftClass('helicopter').runwayLength)).toBe(0);
  });

  it('starts a new airport on the free category', () => {
    const fresh = createGame(LEVEL_MEADOW, 1);
    expect(fresh.airport.certification).toBe(0);
    expect(certificationLevel(0).dailyCost).toBe(0);
  });

  it('turns away traffic above the category held', () => {
    const state = airport();
    state.airport.certification = 0;
    const block = structuralBlock(state.airport, buildServices(state.airport), 'narrowbody');
    expect(block).toBe('not-certified');
  });

  /**
   * Ordering. The licence is a standing daily charge, so a player must be told to build the
   * runway first and buy the licence last — when they can actually use it. Reporting
   * "not licensed" while the strip is still too short would have them paying rent on a
   * category they have nowhere to put.
   */
  it('reports the runway first when the strip is also too short', () => {
    // A commuter needs six tiles and Category B, and no facilities at all — so this isolates
    // the runway/licence ordering with nothing else able to answer first.
    const short = createGame(LEVEL_MEADOW, 1);
    addRunway(short.airport, 8, 10, 13, 'asphalt'); // 4 tiles
    addTaxiwayRun(short.airport, 9, 12, 11, 12);
    addStand(short.airport, 12, 12, 'large');
    fullyServiced(short.airport);
    expect(requiredCertification(aircraftClass('commuter').runwayLength)).toBeGreaterThan(0);

    const services = buildServices(short.airport);
    expect(structuralBlock(short.airport, services, 'commuter')).toBe('no-runway-length');

    // Lengthen the strip and the licence becomes the thing in the way — in that order.
    short.airport.runways[0]!.y1 = 17; // 8 tiles
    expect(structuralBlock(short.airport, buildServices(short.airport), 'commuter')).toBe(
      'not-certified',
    );
  });

  it('charges the daily fee whether anything flew or not', () => {
    const state = airport();
    state.airport.certification = CERTIFICATION_LEVELS.length - 1;
    const before = state.cash;
    const day = runDay(state, []);

    const fee = certificationLevel(state.airport.certification).dailyCost;
    expect(day.certificationCost).toBe(fee);
    expect(state.cash).toBe(before - fee);
  });

  it('costs nothing to hold the free category', () => {
    const state = airport();
    state.airport.certification = 0;
    const before = state.cash;
    runDay(state, []);
    expect(state.cash).toBe(before);
  });

  it('steps up one category at a time, and stops at the top', () => {
    const state = airport();
    state.airport.certification = 0;

    for (let i = 1; i < CERTIFICATION_LEVELS.length; i++) {
      const check = checkCertify(state);
      expect(isAffordableQuote(check)).toBe(true);
      applyCertify(state, check as { cost: number });
      expect(state.airport.certification).toBe(i);
    }
    expect(checkCertify(state)).toBe('max-level');
  });

  /**
   * The escape hatch, and the reason a standing charge cannot spiral. An airport that has
   * overreached must always be able to stop paying for a licence it is not filling.
   */
  it('can be given up again, and stops costing anything', () => {
    const state = airport();
    state.airport.certification = CERTIFICATION_LEVELS.length - 1;

    const check = checkSurrenderCertification(state);
    expect(isAffordableQuote(check)).toBe(true);
    applySurrenderCertification(state, check as { cost: number });
    expect(state.airport.certification).toBe(CERTIFICATION_LEVELS.length - 2);

    // And all the way back down to free, which then cannot be surrendered further.
    while (state.airport.certification > 0) {
      applySurrenderCertification(state, { cost: 0 });
    }
    expect(checkSurrenderCertification(state)).toBe('nothing-there');
  });

  it('is free to take — the price is the standing fee, not a purchase', () => {
    const state = airport();
    state.airport.certification = 0;
    state.cash = 0;
    const check = checkCertify(state);

    // Affordable on an empty balance: the decision is whether it pays for itself every day
    // from now on, which is a different question from whether you can afford it today.
    expect(isAffordableQuote(check)).toBe(true);
  });
});

describe('the day ledger', () => {
  it('reports takings and running costs separately', () => {
    const state = airport();
    state.airport.certification = CERTIFICATION_LEVELS.length - 1;
    const day = runDay(state, [arrival(0, 'narrowbody')]);
    const result = summariseDay(day);

    expect(result.takings).toBeGreaterThan(0);
    expect(result.operating).toBe(day.handlingCost + day.certificationCost);
    expect(result.cash).toBe(result.takings - result.operating);
  });

  it('balances against the cash the airport actually holds', () => {
    const state = airport();
    const before = state.cash;
    const day = runDay(state, [arrival(0, 'regional'), arrival(10, 'regional')]);
    const result = summariseDay(day);

    expect(state.cash).toBe(before + result.takings - result.operating);
  });
});
