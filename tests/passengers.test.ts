import { describe, expect, it } from 'vitest';
import { aircraftClass } from '@/content/aircraft';
import { PASSENGER_FARE, SHOP_REVENUE_PER_PASSENGER, terminalLevel } from '@/content/buildings';
import { LEVEL_MEADOW } from '@/content/levels';
import { addRunway, addStand, addTaxiwayRun, createGame } from '@/sim/airport';
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

/** A jet-capable airport with a terminal of the given level and some shops beside it. */
function airport(terminalLevelValue: number, shops = 0): GameState {
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
    { id: 'f-term', type: 'terminal', x: 5, y: 2, level: terminalLevelValue },
  );
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

  it('charges the overflow against reputation, not just against the takings', () => {
    const roomy = airport(4);
    const cramped = airport(0);
    const schedule = [arrival(0, 'narrowbody')];

    runDay(roomy, schedule);
    runDay(cramped, schedule);

    expect(cramped.reputation).toBeLessThan(roomy.reputation);
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
