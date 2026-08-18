import { describe, expect, it } from 'vitest';
import { LEVEL_MEADOW } from '@/content/levels';
import {
  GATE_HALL_CAPACITY,
  NO_TERMINAL_CAPACITY,
  TERMINAL_CORE_CAPACITY,
} from '@/content/buildings';
import { towerLevel } from '@/content/buildings';
import {
  addRoadRun,
  addRunway,
  addStand,
  addTaxiwayRun,
  createGame,
  hasWorkingFireStation,
  hasWorkingFuelFarm,
  workingTerminalCapacity,
  workingTowerLevel,
} from '@/sim/airport';
import { buildServices } from '@/sim/connectivity';
import { structuralBlock } from '@/sim/assignment';
import { checkFacility } from '@/sim/build';
import { airportAdvice } from '@/sim/advice';
import type { GameState } from '@/sim/types';
import { licensed } from './helpers';

/**
 * Roads are the landside network: taxiways carry aeroplanes, roads carry everything else.
 * The rule is one sentence — anything built has to touch the airport's road network, and the
 * network is the single connected run of road that serves the most things — and these tests
 * hold every consequence of it in place.
 */

/** A working airport with taxiways but deliberately no roads at all. */
function unroaded(): GameState {
  const state = createGame(LEVEL_MEADOW, 1);
  addRunway(state.airport, 8, 10, 15, 'grass');
  addTaxiwayRun(state.airport, 9, 12, 11, 12);
  addStand(state.airport, 12, 12, 'small');
  return state;
}

const blockFor = (state: GameState, classId: 'light' | 'trainer' = 'light'): string | null =>
  structuralBlock(state.airport, buildServices(state.airport), classId);

describe('road access', () => {
  it('will not open a runway that no road reaches', () => {
    expect(blockFor(unroaded())).toBe('no-road-runway');
  });

  it('opens the runway once a road runs alongside it', () => {
    const state = unroaded();
    addRoadRun(state.airport, 7, 9, 7, 16); // beside the strip
    // The runway is served, but the stand still is not.
    expect(blockFor(state)).toBe('no-road-stand');

    // Joined round to the apron, on the same network, and the airport works.
    addRoadRun(state.airport, 7, 16, 13, 16);
    addRoadRun(state.airport, 13, 12, 13, 16);
    expect(blockFor(state)).toBeNull();
  });

  /**
   * Everything has to be on the *same* network. Two private stubs of road serve two halves of
   * an airport that cannot talk to each other, which is the mistake worth catching.
   */
  it('counts only one network, so disconnected stubs do not add up', () => {
    const state = unroaded();
    addRoadRun(state.airport, 7, 9, 7, 16); // serves the runway
    addRoadRun(state.airport, 13, 11, 13, 13); // serves the stand, joined to nothing

    // The runway's road wins — it is the larger network — and the stand is left out.
    expect(blockFor(state)).toBe('no-road-stand');

    // Joining the two stubs is all it takes.
    addRoadRun(state.airport, 7, 16, 13, 16);
    addRoadRun(state.airport, 13, 13, 13, 16);
    expect(blockFor(state)).toBeNull();
  });

  /**
   * The failure whose symptom looks nothing like its cause: a road beside the runway and a
   * road beside the stand, never joined, and the game reporting that the runway has no road.
   */
  it('says so when the roads are in separate pieces', () => {
    const state = unroaded();
    addRoadRun(state.airport, 7, 12, 7, 12); // a stub by the runway
    addRoadRun(state.airport, 12, 11, 12, 11); // a stub by the stand

    const services = buildServices(state.airport);
    expect(services.roadIslands).toBe(2);
    expect(airportAdvice(state).map((a) => a.text).join(' ')).toMatch(/2 separate pieces/i);

    // Joined into one run, and the complaint goes away.
    addRoadRun(state.airport, 7, 12, 7, 14);
    addRoadRun(state.airport, 7, 14, 12, 14);
    addRoadRun(state.airport, 12, 11, 12, 14);
    expect(buildServices(state.airport).roadIslands).toBe(1);
    expect(airportAdvice(state).map((a) => a.text).join(' ')).not.toMatch(/separate pieces/i);
  });

  it('leaves a building with no road doing nothing at all', () => {
    const state = unroaded();
    addRoadRun(state.airport, 7, 9, 7, 16);
    addRoadRun(state.airport, 7, 16, 13, 16);
    addRoadRun(state.airport, 13, 12, 13, 16);
    state.airport.facilities.push(
      { id: 'f-tower', type: 'tower', x: 2, y: 30, level: 2 },
      { id: 'f-fuel', type: 'fuel-farm', x: 3, y: 30, level: 0 },
      { id: 'f-fire', type: 'fire-station', x: 4, y: 30, level: 0 },
    );

    const stranded = buildServices(state.airport);
    expect(workingTowerLevel(state.airport, stranded)).toBe(0);
    expect(hasWorkingFuelFarm(state.airport, stranded)).toBe(false);
    expect(hasWorkingFireStation(state.airport, stranded)).toBe(false);
    // And with the tower inert, the airport is back to one movement at a time.
    expect(towerLevel(workingTowerLevel(state.airport, stranded)).movements).toBe(1);

    // A spur down the field from the existing network, then along the front of all three
    // buildings — it has to *join* what is already there, not sit beside it.
    addRoadRun(state.airport, 7, 16, 7, 29);
    addRoadRun(state.airport, 2, 29, 7, 29);
    const served = buildServices(state.airport);
    expect(workingTowerLevel(state.airport, served)).toBe(2);
    expect(hasWorkingFuelFarm(state.airport, served)).toBe(true);
    expect(hasWorkingFireStation(state.airport, served)).toBe(true);
  });
});

describe('shops', () => {
  function withTerminal(): GameState {
    const state = unroaded();
    addRoadRun(state.airport, 7, 9, 7, 16);
    addRoadRun(state.airport, 7, 16, 14, 16);
    addRoadRun(state.airport, 13, 12, 13, 16);
    state.airport.facilities.push({ id: 'f-term', type: 'terminal', x: 14, y: 5, level: 0 });
    addRoadRun(state.airport, 14, 4, 14, 16);
    return state;
  }

  it('refuses a module with no terminal to attach to', () => {
    const state = unroaded();
    state.cash = 50_000;
    expect(checkFacility(state, 'gate-hall', 5, 5)).toBe('needs-terminal');
  });

  it('refuses a module that is not touching the terminal', () => {
    const state = withTerminal();
    state.cash = 50_000;
    expect(checkFacility(state, 'gate-hall', 17, 5)).toBe('needs-terminal');
    expect(checkFacility(state, 'gate-hall', 15, 5)).not.toBe('needs-terminal');
  });

  it('lets a module attach to another module rather than only to the core', () => {
    // A concourse is a chain. Requiring every module to touch the core itself would cap a
    // terminal at four buildings, which is not a layout, it is a shape.
    const state = withTerminal();
    state.cash = 50_000;
    state.airport.facilities.push({ id: 'm1', type: 'gate-hall', x: 15, y: 5, level: 0 });
    expect(checkFacility(state, 'gate-hall', 16, 5)).not.toBe('needs-terminal');
  });

  it('rations retail against the gate halls', () => {
    /*
     * Land alone is too weak a cap on retail: it earns per passenger of every flight, so
     * without this the winning move is a field of shops beside a single core and the terminal
     * stops being about capacity at all.
     *
     * One shop per hall was the first rule and read beautifully, but nine halls then licensed
     * nine shops and retail became the whole economy — hence `RETAIL_PER_GATE_HALLS`.
     */
    const state = withTerminal();
    state.cash = 50_000;
    expect(checkFacility(state, 'shop', 15, 5)).toBe('no-shop-slot');

    state.airport.facilities.push({ id: 'm1', type: 'gate-hall', x: 15, y: 5, level: 0 });
    expect(checkFacility(state, 'shop', 16, 5)).toBe('no-shop-slot');

    state.airport.facilities.push({ id: 'm2', type: 'gate-hall', x: 16, y: 5, level: 0 });
    expect(checkFacility(state, 'shop', 17, 5)).not.toBe('no-shop-slot');
  });

  it('counts only modules that reach the terminal and have a road', () => {
    const state = withTerminal();
    state.airport.facilities.push(
      { id: 'm1', type: 'gate-hall', x: 14, y: 4, level: 0 }, // touching, on the road
      { id: 'm2', type: 'gate-hall', x: 20, y: 30, level: 0 }, // out in the field
    );
    const capacity = workingTerminalCapacity(state.airport, buildServices(state.airport));
    expect(capacity.passengerCapacity).toBe(TERMINAL_CORE_CAPACITY + GATE_HALL_CAPACITY);
  });

  it('closes every module when the terminal itself loses its road', () => {
    const state = unroaded();
    addRoadRun(state.airport, 7, 9, 7, 16);
    state.airport.facilities.push(
      { id: 'f-term', type: 'terminal', x: 20, y: 30, level: 0 },
      { id: 'm1', type: 'gate-hall', x: 20, y: 31, level: 0 },
    );
    const capacity = workingTerminalCapacity(state.airport, buildServices(state.airport));
    expect(capacity.passengerCapacity).toBe(NO_TERMINAL_CAPACITY);
  });
});

/**
 * Military runways are exclusive in both directions. That is the entire mechanic: a strip you
 * cannot share is a real commitment, and one that doubled as a civil runway would just be a
 * better runway.
 */
describe('military runways', () => {
  function airfield(use: 'civil' | 'military'): GameState {
    const state = createGame(LEVEL_MEADOW, 1);
    addRunway(state.airport, 8, 6, 20, 'asphalt', use); // 15 tiles, takes anything
    addTaxiwayRun(state.airport, 9, 12, 11, 12);
    addStand(state.airport, 12, 12, 'large');
    addRoadRun(state.airport, 7, 5, 7, 21);
    addRoadRun(state.airport, 7, 21, 13, 21);
    addRoadRun(state.airport, 13, 12, 13, 21);
    state.airport.facilities.push(
      { id: 'f-fuel', type: 'fuel-farm', x: 6, y: 21, level: 0 },
      { id: 'f-fire', type: 'fire-station', x: 5, y: 21, level: 0 },
    );
    addRoadRun(state.airport, 5, 22, 7, 22);
    licensed(state.airport);
    return state;
  }

  const block = (state: GameState, classId: Parameters<typeof structuralBlock>[2]): string | null =>
    structuralBlock(state.airport, buildServices(state.airport), classId);

  it('turns away military traffic when every strip is civil', () => {
    const state = airfield('civil');
    expect(block(state, 'heavylift')).toBe('no-military-runway');
    // ...while the airliner it was built for is perfectly happy.
    expect(block(state, 'narrowbody')).toBeNull();
  });

  it('turns away airliners when every strip is military', () => {
    const state = airfield('military');
    expect(block(state, 'narrowbody')).toBe('no-civil-runway');
    expect(block(state, 'heavylift')).toBeNull();
  });

  it('still says "no runway" rather than "wrong runway" on an empty field', () => {
    // The use check must not hijack the day-one message. A player with nothing built needs to
    // be told to build a runway, not told which sort they are missing.
    const empty = createGame(LEVEL_MEADOW, 1);
    expect(structuralBlock(empty.airport, buildServices(empty.airport), 'light')).toBe(
      'no-runway-length',
    );
  });

  it('serves both once each has its own strip', () => {
    const state = airfield('civil');
    addRunway(state.airport, 3, 6, 20, 'asphalt', 'military');
    addTaxiwayRun(state.airport, 4, 12, 5, 12);
    addStand(state.airport, 6, 12, 'large');
    addRoadRun(state.airport, 2, 5, 2, 21);
    addRoadRun(state.airport, 2, 21, 7, 21);
    addRoadRun(state.airport, 6, 13, 6, 21);

    expect(block(state, 'heavylift')).toBeNull();
    expect(block(state, 'narrowbody')).toBeNull();
  });
});
