import { describe, expect, it } from 'vitest';
import { aircraftClass } from '@/content/aircraft';
import { PASSENGER_FARE, SHOP_REVENUE_PER_PASSENGER, terminalLevel } from '@/content/buildings';
import { LEVEL_MEADOW } from '@/content/levels';
import {
  addRunway,
  addStand,
  addTaxiwayRun,
  createGame,
  workingShops,
  workingTerminalCapacity,
} from '@/sim/airport';
import { buildServices } from '@/sim/connectivity';
import { runDay } from '@/sim/step';
import { summariseDay } from '@/ui/debrief';
import type { GameState, ScheduledArrival } from '@/sim/types';
import { fullyServiced } from './helpers';

/**
 * Passengers are the second axis of the economy. A longer runway lets a bigger aeroplane in;
 * only terminal capacity turns the people on board into money. These tests hold that split
 * in place, because collapsing it would make the terminal decorative.
 */

const arrival = (atSeconds: number, classId: ScheduledArrival['classId']): ScheduledArrival => ({
  atSeconds,
  classId,
});

/**
 * A jet-capable airport with terminals of the given levels and some shops beside the first.
 *
 * Takes a list rather than one level, because terminal capacity pools across every building:
 * most of these tests want one terminal, but the ones that matter most want two.
 */
function airport(levels: number | number[], shops = 0): GameState {
  const wanted = Array.isArray(levels) ? levels : [levels];
  const state = createGame(LEVEL_MEADOW, 42);
  addRunway(state.airport, 8, 4, 21, 'asphalt'); // 18 tiles: takes anything
  addTaxiwayRun(state.airport, 9, 10, 11, 10);
  addStand(state.airport, 12, 10, 'large');
  addTaxiwayRun(state.airport, 9, 14, 11, 14);
  addStand(state.airport, 12, 14, 'large');

  state.airport.facilities.push(
    { id: 'f-fuel', type: 'fuel-farm', x: 2, y: 2, level: 0 },
    { id: 'f-fire', type: 'fire-station', x: 3, y: 2, level: 0 },
    { id: 'f-tower', type: 'tower', x: 4, y: 2, level: 3 },
  );
  wanted.forEach((level, i) => {
    state.airport.facilities.push({ id: `f-term${i}`, type: 'terminal', x: 5 + i * 2, y: 2, level });
  });
  for (let i = 0; i < shops; i++) {
    state.airport.facilities.push({ id: `s${i}`, type: 'shop', x: 5, y: 1, level: 0 });
  }

  fullyServiced(state.airport);
  return state;
}

describe('passengers', () => {
  it('processes everyone when the terminal has room', () => {
    const state = airport(3);
    const day = runDay(state, [arrival(0, 'regional')]);
    const result = summariseDay(day);

    expect(result.landed).toBe(1);
    expect(result.passengers).toBe(aircraftClass('regional').passengers);
    expect(result.passengersTurnedAway).toBe(0);
  });

  /**
   * The failure the terminal exists to prevent: the aeroplane lands perfectly and most of
   * the money still walks away, because there was nowhere to put the people.
   */
  it('turns away the passengers a small terminal cannot process', () => {
    const state = airport(0); // a gate in a hedge
    const capacity = terminalLevel(0).passengerCapacity;
    const day = runDay(state, [arrival(0, 'widebody')]);
    const result = summariseDay(day);

    expect(result.landed).toBe(1);
    expect(result.passengers).toBe(capacity);
    expect(result.passengersTurnedAway).toBe(aircraftClass('widebody').passengers - capacity);
  });

  it('charges the overflow against the takings', () => {
    const roomy = airport(4);
    const cramped = airport(0);
    const schedule = [arrival(0, 'narrowbody')];

    runDay(roomy, schedule);
    runDay(cramped, schedule);

    // Both aeroplanes landed, so both banked a landing fee. The difference is entirely the
    // people the small terminal could not get through the door.
    expect(cramped.cash).toBeLessThan(roomy.cash);
  });

  it('spends the day capacity across flights, not per flight', () => {
    const state = airport(1);
    const capacity = terminalLevel(1).passengerCapacity;
    // Four regionals carry 200 between them, comfortably inside a level 1 terminal; six
    // carry 300, which is not.
    const day = runDay(state, Array.from({ length: 6 }, (_, i) => arrival(i * 4, 'regional')));
    const result = summariseDay(day);

    expect(result.passengers).toBe(capacity);
    expect(result.passengersTurnedAway).toBeGreaterThan(0);
  });

  /**
   * The freighter's whole reason for existing: it earns from a long runway on a day the
   * terminal is the bottleneck, so there is something worth building towards other than a
   * bigger shed.
   */
  it('pays a freighter in full however small the terminal is', () => {
    const cramped = airport(0);
    const roomy = airport(4);
    const schedule = [arrival(0, 'freighter')];

    const before = cramped.cash;
    const crampedDay = runDay(cramped, schedule);
    const roomyBefore = roomy.cash;
    runDay(roomy, schedule);

    expect(summariseDay(crampedDay).passengersTurnedAway).toBe(0);
    // The terminal's fare multiplier still applies to the landing fee, so the two are not
    // identical — but the cramped airport loses nothing to overflow.
    expect(cramped.cash - before).toBeGreaterThan(0);
    expect(roomy.cash - roomyBefore).toBeGreaterThan(0);
  });
});

describe('retail', () => {
  it('earns more per passenger with shops than without', () => {
    const plain = airport(2, 0);
    const retail = airport(2, 2);
    const schedule = [arrival(0, 'regional')];

    const plainBefore = plain.cash;
    const retailBefore = retail.cash;
    runDay(plain, schedule);
    runDay(retail, schedule);

    expect(retail.cash - retailBefore).toBeGreaterThan(plain.cash - plainBefore);
  });

  it('scales retail with passengers, so it is worth nothing on an empty terminal', () => {
    // A shop's take is per passenger walking past. On a freighter day nobody walks past.
    const plain = airport(2, 0);
    const retail = airport(2, 2);
    const schedule = [arrival(0, 'freighter')];

    const plainBefore = plain.cash;
    const retailBefore = retail.cash;
    runDay(plain, schedule);
    runDay(retail, schedule);

    expect(retail.cash - retailBefore).toBe(plain.cash - plainBefore);
  });

  it('prices a passenger as gate revenue plus every shop they pass', () => {
    const level = terminalLevel(2);
    const withoutShops = (PASSENGER_FARE + 0 * SHOP_REVENUE_PER_PASSENGER) * level.fareMultiplier;
    const withTwo = (PASSENGER_FARE + 2 * SHOP_REVENUE_PER_PASSENGER) * level.fareMultiplier;

    expect(withTwo).toBeGreaterThan(withoutShops);
  });
});

/**
 * Terminal capacity pools across buildings, because level 4 caps at 2,600 passengers a day
 * and the late campaign books over three thousand — without a second terminal the airport
 * simply stops growing.
 *
 * The fare multiplier is the part that must *not* pool, and these are the tests that say so.
 */
describe('several terminals', () => {
  const capacityOf = (state: GameState) =>
    workingTerminalCapacity(state.airport, buildServices(state.airport));

  it('adds their passenger capacity together', () => {
    expect(capacityOf(airport([2, 2])).passengerCapacity).toBe(
      terminalLevel(2).passengerCapacity * 2,
    );
  });

  it('adds their shop slots together', () => {
    expect(capacityOf(airport([1, 2])).shopSlots).toBe(
      terminalLevel(1).shopSlots + terminalLevel(2).shopSlots,
    );
  });

  it('blends the fare rate rather than summing it', () => {
    // Summing would make two level-1 terminals worth 2.3x — with doubled capacity, roughly
    // four times the revenue for two of the cheapest buildings in the game.
    const two = capacityOf(airport([1, 1])).fareMultiplier;
    expect(two).toBeCloseTo(terminalLevel(1).fareMultiplier, 5);
  });

  /**
   * The ordering that is the entire reason for weighting instead of summing: at the same
   * total capacity, two cheap terminals must earn *less* per passenger than one good one.
   * If this ever inverts, upgrading becomes pointless and the ladder collapses.
   */
  it('earns less per passenger than one better terminal of the same capacity', () => {
    // Level 1 is 220 passengers at 1.15x; level 2 is 560 at 1.30x. Three level-1 terminals
    // come to 660 — slightly more capacity than one level 2 — and must still earn a lower
    // rate on every head that walks through.
    const spread = capacityOf(airport([1, 1, 1]));
    const single = capacityOf(airport(2));

    expect(spread.passengerCapacity).toBeGreaterThan(single.passengerCapacity);
    expect(spread.fareMultiplier).toBeLessThan(single.fareMultiplier);
  });

  it('weights the blend by capacity, so the bigger terminal moves the rate more', () => {
    // A level-4 terminal (2,600) beside a level-1 one (220) should sit close to level 4's
    // rate, not halfway between the two.
    const mixed = capacityOf(airport([4, 1])).fareMultiplier;
    const midpoint = (terminalLevel(4).fareMultiplier + terminalLevel(1).fareMultiplier) / 2;

    expect(mixed).toBeGreaterThan(midpoint);
    expect(mixed).toBeLessThan(terminalLevel(4).fareMultiplier);
  });

  it('processes more of one aeroplane than a single terminal could', () => {
    // The wiring, measured through the simulation rather than the accessor: `land()` has to
    // spend the *pooled* budget. One aeroplane, so nothing else can be the constraint — a
    // busier schedule ends up measuring the runway or the apron instead.
    const carried = aircraftClass('widebody').passengers;
    const capacity = terminalLevel(1).passengerCapacity;
    expect(carried).toBeGreaterThan(capacity);
    expect(carried).toBeLessThan(capacity * 2);

    const one = summariseDay(runDay(airport(1), [arrival(0, 'widebody')]));
    const two = summariseDay(runDay(airport([1, 1]), [arrival(0, 'widebody')]));

    // One terminal turns the overflow away at the door; two get the whole aeroplane through.
    expect(one.passengers).toBe(capacity);
    expect(one.passengersTurnedAway).toBe(carried - capacity);
    expect(two.passengers).toBe(carried);
    expect(two.passengersTurnedAway).toBe(0);
  });

  it('ignores a terminal with no road to it', () => {
    // Built is not working. A second terminal nothing can drive to adds no capacity, exactly
    // as an unroaded tower staffs nobody.
    const state = airport([2]);
    state.airport.facilities.push({ id: 'f-orphan', type: 'terminal', x: 20, y: 38, level: 4 });
    // No `fullyServiced` re-run, so the new one sits on bare grass.

    expect(capacityOf(state).passengerCapacity).toBe(terminalLevel(2).passengerCapacity);
  });

  it('counts a shop touching any working terminal', () => {
    // "Inside the terminal" has to mean any of them once there is more than one, or a shop
    // beside the second building would quietly trade nothing.
    const state = airport([1, 1]);
    state.airport.facilities.push({ id: 's-far', type: 'shop', x: 8, y: 2, level: 0 });
    fullyServiced(state.airport);

    // The second terminal is at x=7, so the shop at x=8 touches it and nothing else.
    expect(workingShops(state.airport, buildServices(state.airport))).toBeGreaterThan(0);
  });
});
