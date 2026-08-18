import { describe, expect, it } from 'vitest';
import { aircraftClass } from '@/content/aircraft';
import {
  BAGGAGE_REVENUE_PER_PASSENGER,
  GATE_HALL_CAPACITY,
  NO_TERMINAL_CAPACITY,
  PASSENGER_FARE,
  passengerRevenue,
  RETAIL_REVENUE_PER_PASSENGER,
  TERMINAL_CORE_CAPACITY,
} from '@/content/buildings';
import { LEVEL_MEADOW } from '@/content/levels';
import {
  addRunway,
  addStand,
  addTaxiwayRun,
  createGame,
  workingTerminalCapacity,
} from '@/sim/airport';
import { buildServices } from '@/sim/connectivity';
import { runDay } from '@/sim/step';
import { summariseDay } from '@/ui/debrief';
import type { FacilityType, GameState, ScheduledArrival } from '@/sim/types';
import { fullyServiced, licensed } from './helpers';

/**
 * Passengers are the second axis of the economy. A longer runway lets a bigger aeroplane in;
 * only the terminal turns the people on board into money. These tests hold that split in
 * place, because collapsing it would make the terminal decorative.
 *
 * Since the terminal became a footprint rather than a level, they also hold the rule that
 * makes it a *layout* — a module counts only as part of a chain reaching a road-served core.
 */

const arrival = (atSeconds: number, classId: ScheduledArrival['classId']): ScheduledArrival => ({
  atSeconds,
  classId,
});

interface Terminal {
  /** Separate cores, each 120 a day before any module. */
  readonly cores?: number;
  readonly gateHalls?: number;
  readonly baggageHalls?: number;
  readonly shops?: number;
  readonly borderControl?: boolean;
}

/**
 * A jet-capable airport with a terminal of the given shape.
 *
 * Modules are laid in a row from the core along y=2, so each touches the one before it —
 * which is what makes them a terminal rather than a row of sheds. The row is clear of the
 * runway (x=8, rows 4–21) and of the apron.
 */
function airport(terminal: Terminal = {}): GameState {
  const state = createGame(LEVEL_MEADOW, 42);
  addRunway(state.airport, 8, 4, 21, 'asphalt'); // 18 tiles: takes anything
  addTaxiwayRun(state.airport, 9, 10, 11, 10);
  addStand(state.airport, 12, 10, 'large');
  addTaxiwayRun(state.airport, 9, 14, 11, 14);
  addStand(state.airport, 12, 14, 'large');

  state.airport.facilities.push(
    { id: 'f-fuel', type: 'fuel-farm', x: 2, y: 0, level: 0 },
    { id: 'f-fire', type: 'fire-station', x: 3, y: 0, level: 0 },
    { id: 'f-tower', type: 'tower', x: 4, y: 0, level: 3 },
  );

  const cores = terminal.cores ?? 1;
  // Extra cores go on their own row, far from the chain, so "two cores" means two terminals
  // rather than one long one.
  for (let i = 0; i < cores; i++) {
    state.airport.facilities.push({
      id: `f-term${i}`,
      type: 'terminal',
      x: i === 0 ? 2 : 2 + i * 3,
      y: i === 0 ? 2 : 6,
      level: 0,
    });
  }

  const chain: FacilityType[] = [
    ...Array<FacilityType>(terminal.gateHalls ?? 0).fill('gate-hall'),
    ...Array<FacilityType>(terminal.baggageHalls ?? 0).fill('baggage-hall'),
    ...Array<FacilityType>(terminal.shops ?? 0).fill('shop'),
    ...(terminal.borderControl ? (['border-control'] as FacilityType[]) : []),
  ];
  chain.forEach((type, i) => {
    state.airport.facilities.push({ id: `m${i}`, type, x: 3 + i, y: 2, level: 0 });
  });

  fullyServiced(state.airport);
  licensed(state.airport);
  return state;
}

const capacityOf = (state: GameState) =>
  workingTerminalCapacity(state.airport, buildServices(state.airport));

describe('what a terminal can process', () => {
  it('is a windsock and a gate in a hedge with no terminal at all', () => {
    // The floor that makes the opening days of a campaign pay for the first runway.
    expect(capacityOf(airport({ cores: 0 })).passengerCapacity).toBe(NO_TERMINAL_CAPACITY);
  });

  it('adds a gate hall to the core rather than replacing it', () => {
    expect(capacityOf(airport({ gateHalls: 2 })).passengerCapacity).toBe(
      TERMINAL_CORE_CAPACITY + 2 * GATE_HALL_CAPACITY,
    );
  });

  it('adds a second core to the first', () => {
    // Two terminals are two terminals. There is no penalty and no bonus — modules already
    // cost a tile of land each, so "more" is paid for in the only currency that is scarce.
    expect(capacityOf(airport({ cores: 2 })).passengerCapacity).toBe(2 * TERMINAL_CORE_CAPACITY);
  });

  it('processes everyone when there is room', () => {
    const state = airport({ gateHalls: 3 });
    const result = summariseDay(runDay(state, [arrival(0, 'regional')]));

    expect(result.landed).toBe(1);
    expect(result.passengers).toBe(aircraftClass('regional').passengers);
    expect(result.passengersTurnedAway).toBe(0);
  });

  /**
   * The failure the terminal exists to prevent: the aeroplane lands perfectly and most of the
   * money still walks away, because there was nowhere to put the people.
   */
  it('turns away what a bare core cannot process', () => {
    const state = airport({ borderControl: true });
    const result = summariseDay(runDay(state, [arrival(0, 'widebody')]));

    expect(result.landed).toBe(1);
    expect(result.passengers).toBe(TERMINAL_CORE_CAPACITY);
    expect(result.passengersTurnedAway).toBe(
      aircraftClass('widebody').passengers - TERMINAL_CORE_CAPACITY,
    );
  });

  it('charges the overflow against the takings', () => {
    const roomy = airport({ gateHalls: 6 });
    const cramped = airport({});
    const schedule = [arrival(0, 'narrowbody')];

    runDay(roomy, schedule);
    runDay(cramped, schedule);

    // Both aeroplanes landed, so both banked the same landing fee. The difference is entirely
    // the people the small terminal could not get through the door.
    expect(cramped.cash).toBeLessThan(roomy.cash);
  });

  it('spends the day capacity across flights, not per flight', () => {
    const state = airport({});
    // Six regionals carry 300 between them; a bare core takes 120.
    const day = runDay(state, Array.from({ length: 6 }, (_, i) => arrival(i * 4, 'regional')));
    const result = summariseDay(day);

    expect(result.passengers).toBe(TERMINAL_CORE_CAPACITY);
    expect(result.passengersTurnedAway).toBeGreaterThan(0);
  });

  /**
   * The freighter's whole reason for existing: it earns from a long runway on a day the
   * terminal is the bottleneck, so there is something worth building towards other than a
   * bigger shed.
   */
  it('pays a freighter in full however small the terminal is', () => {
    const cramped = summariseDay(runDay(airport({}), [arrival(0, 'freighter')]));
    const roomy = summariseDay(runDay(airport({ gateHalls: 6 }), [arrival(0, 'freighter')]));

    expect(cramped.passengersTurnedAway).toBe(0);
    // Identical, and that is the point: the landing fee is what the *runway* earns, so the
    // terminal cannot change it. Measured on takings rather than cash because these fixtures
    // hold the top licence, whose standing fee would swamp a one-flight day.
    expect(cramped.takings).toBe(roomy.takings);
  });
});

describe('what a passenger is worth', () => {
  it('is the bare gate fare with no modules', () => {
    expect(passengerRevenue(0, 0)).toBe(PASSENGER_FARE);
  });

  it('adds baggage and retail additively', () => {
    // Additive rather than multiplied. They stack across every passenger of every flight, and
    // the last time retail compounded with a terminal multiplier the late campaign earned
    // more in a day than everything on the map had cost to build.
    expect(passengerRevenue(1, 2)).toBe(
      PASSENGER_FARE + BAGGAGE_REVENUE_PER_PASSENGER + 2 * RETAIL_REVENUE_PER_PASSENGER,
    );
  });

  it('earns more per passenger with retail than without', () => {
    const plain = airport({ gateHalls: 2 });
    const retail = airport({ gateHalls: 2, shops: 2 });
    const schedule = [arrival(0, 'regional')];

    const plainBefore = plain.cash;
    const retailBefore = retail.cash;
    runDay(plain, schedule);
    runDay(retail, schedule);

    expect(retail.cash - retailBefore).toBeGreaterThan(plain.cash - plainBefore);
  });

  it('is worth nothing on a day nobody walks through', () => {
    // A retail unit's take is per passenger passing it. On a freighter day nobody passes.
    const plain = airport({ gateHalls: 2 });
    const retail = airport({ gateHalls: 2, shops: 2 });
    const schedule = [arrival(0, 'freighter')];

    const plainBefore = plain.cash;
    const retailBefore = retail.cash;
    runDay(plain, schedule);
    runDay(retail, schedule);

    expect(retail.cash - retailBefore).toBe(plain.cash - plainBefore);
  });
});

describe('a module only counts as part of a terminal', () => {
  it('ignores a gate hall with no road of its own', () => {
    // Built is not working. The road has to be taken away deliberately: `fullyServiced` puts
    // road on every free tile, so an unroaded building cannot simply be dropped somewhere.
    const state = airport({ gateHalls: 1 });
    const { width } = state.airport.map;
    const hall = state.airport.facilities.find((f) => f.type === 'gate-hall')!;
    for (const [dx, dy] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      state.airport.roads[(hall.y + dy) * width + (hall.x + dx)] = 0;
    }

    expect(capacityOf(state).passengerCapacity).toBe(TERMINAL_CORE_CAPACITY);
  });

  it('ignores a gate hall that touches no terminal', () => {
    const state = airport({});
    state.airport.facilities.push({ id: 'orphan', type: 'gate-hall', x: 20, y: 30, level: 0 });
    fullyServiced(state.airport);

    expect(capacityOf(state).passengerCapacity).toBe(TERMINAL_CORE_CAPACITY);
  });

  it('strands everything past a hole cut in the chain', () => {
    /*
     * The rule that makes a terminal a layout rather than a count. Three halls in a row from
     * the core; demolish the middle one and the far one is a shed, even though it still has
     * its road and has not moved.
     */
    const state = airport({ gateHalls: 3 });
    expect(capacityOf(state).passengerCapacity).toBe(
      TERMINAL_CORE_CAPACITY + 3 * GATE_HALL_CAPACITY,
    );

    state.airport.facilities = state.airport.facilities.filter((f) => f.id !== 'm1');

    expect(capacityOf(state).passengerCapacity).toBe(
      TERMINAL_CORE_CAPACITY + 1 * GATE_HALL_CAPACITY,
    );
  });

  it('closes every module when the core itself loses its road', () => {
    // The core is what makes the rest a terminal, so losing its road is not one building's
    // problem — it is the whole concourse going dark.
    const state = airport({ gateHalls: 2 });
    const { width } = state.airport.map;
    const core = state.airport.facilities.find((f) => f.type === 'terminal')!;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      state.airport.roads[(core.y + dy) * width + (core.x + dx)] = 0;
    }

    expect(capacityOf(state).passengerCapacity).toBe(NO_TERMINAL_CAPACITY);
  });
});

describe('baggage halls buy apron throughput', () => {
  it('frees the stand sooner than the same airport without one', () => {
    /*
     * The reason baggage is a module and not just another revenue line: it is the one that
     * argues with the apron rather than with the bank. Measured as day length, because a
     * shorter turnaround shows up as the day finishing sooner when stands are the constraint.
     */
    const schedule = Array.from({ length: 6 }, (_, i) => arrival(i * 6, 'narrowbody'));
    const plain = runDay(airport({ gateHalls: 4 }), schedule);
    const bags = runDay(airport({ gateHalls: 4, baggageHalls: 3 }), schedule);

    expect(bags.elapsed).toBeLessThan(plain.elapsed);
  });
});

describe('border control', () => {
  it('turns a widebody away when there is nowhere to clear', () => {
    const day = runDay(airport({ gateHalls: 4 }), [arrival(0, 'widebody')]);
    const result = summariseDay(day);

    expect(result.landed).toBe(0);
    expect(day.events[0]?.reason).toBe('no-border-control');
  });

  it('takes the same widebody once border control is working', () => {
    const day = runDay(airport({ gateHalls: 4, borderControl: true }), [arrival(0, 'widebody')]);
    expect(summariseDay(day).landed).toBe(1);
  });

  it('never asks a domestic class for it', () => {
    // The gate is about who is on board, not about size — a narrowbody is a big aeroplane and
    // needs nothing of the sort.
    const day = runDay(airport({ gateHalls: 4 }), [arrival(0, 'narrowbody')]);
    expect(summariseDay(day).landed).toBe(1);
  });
});
