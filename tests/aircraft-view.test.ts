import { describe, expect, it } from 'vitest';
import { aircraftClass } from '@/content/aircraft';
import { LEVEL_MEADOW } from '@/content/levels';
import { addRunway, addStand, addTaxiwayRun, createGame } from '@/sim/airport';
import { startDay } from '@/sim/step';
import { aircraftViews } from '@/render/aircraft';
import { TILE_PX } from '@/sprites/palette';
import type { Aircraft, DayState, GameState } from '@/sim/types';
import { fullyServiced, licensed } from './helpers';

/**
 * Where each aeroplane is drawn.
 *
 * The simulation stores no coordinates — an aircraft is a phase and a timer — so every
 * position is derived here. That makes the derivation testable without a browser, which
 * matters because the failure this file exists for is invisible in a screenshot and obvious
 * in motion: an aeroplane cutting from its holding orbit to a point already lined up on the
 * runway, with nothing in between.
 */

function field(): GameState {
  const state = createGame(LEVEL_MEADOW, 42);
  addRunway(state.airport, 8, 10, 25, 'asphalt');
  addTaxiwayRun(state.airport, 9, 14, 11, 14);
  addStand(state.airport, 12, 14, 'large');
  fullyServiced(state.airport);
  licensed(state.airport);
  return state;
}

const plane = (over: Partial<Aircraft> & { id: number }): Aircraft => ({
  classId: 'light',
  phase: 'holding',
  fuel: 100,
  timer: 0,
  managed: true,
  runwayId: null,
  standId: null,
  padId: null,
  blockedReason: null,
  ...over,
});

function viewsOf(state: GameState, day: DayState) {
  return aircraftViews(state.airport, day);
}

describe('holding orbit', () => {
  it('gives an aeroplane the same place whoever else is holding', () => {
    /*
     * The orbit used to be keyed on an aircraft's index in the holding list. That looks fine
     * in a still and is wrong in motion: the moment one aeroplane leaves the stack, every
     * later one inherits a new index and jumps to a different ring and angle.
     */
    const state = field();
    const crowded = startDay(state, []);
    crowded.elapsed = 12;
    crowded.aircraft.push(plane({ id: 1 }), plane({ id: 2 }), plane({ id: 3 }));
    const before = viewsOf(state, crowded)[2]!;

    // Aircraft 1 is taken by the tower and leaves the stack; 3 must not move because of it.
    crowded.aircraft = crowded.aircraft.filter((a) => a.id !== 1);
    const after = viewsOf(state, crowded)[1]!;

    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('keeps different aeroplanes apart', () => {
    const state = field();
    const day = startDay(state, []);
    day.elapsed = 5;
    day.aircraft.push(plane({ id: 1 }), plane({ id: 2 }));
    const [a, b] = viewsOf(state, day);

    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeGreaterThan(TILE_PX);
  });
});

describe('turning onto final', () => {
  const approachSeconds = aircraftClass('light').approachSeconds;

  /** One aircraft, mid-approach, having been released `spent` seconds ago. */
  function approaching(spent: number) {
    const state = field();
    const day = startDay(state, []);
    day.elapsed = 20;
    day.aircraft.push(
      plane({
        id: 7,
        phase: 'approach',
        timer: approachSeconds - spent,
        runwayId: state.airport.runways[0]!.id,
      }),
    );
    return { state, day, view: viewsOf(state, day)[0]! };
  }

  it('starts exactly where the aeroplane was still circling', () => {
    // The whole point. At the instant of release the approach must begin at the orbit
    // position, not at some fixed spot above the threshold — otherwise it cuts.
    const state = field();
    const day = startDay(state, []);
    day.elapsed = 20;

    day.aircraft.push(plane({ id: 7 }));
    const held = viewsOf(state, day)[0]!;

    day.aircraft[0]!.phase = 'approach';
    day.aircraft[0]!.timer = approachSeconds;
    day.aircraft[0]!.runwayId = state.airport.runways[0]!.id;
    const released = viewsOf(state, day)[0]!;

    expect(released.x).toBeCloseTo(held.x, 6);
    expect(released.y).toBeCloseTo(held.y, 6);
  });

  it('arrives on the runway threshold', () => {
    const { state, view } = approaching(approachSeconds);
    const runway = state.airport.runways[0]!;

    expect(view.x).toBeCloseTo(runway.x * TILE_PX + TILE_PX / 2, 6);
    expect(view.y).toBeCloseTo(runway.y0 * TILE_PX + TILE_PX / 2, 6);
  });

  it('moves without jumping, all the way in', () => {
    // Sampled along the whole approach: no step may be wildly larger than its neighbours,
    // which is what a cut looks like numerically.
    const steps = 40;
    const points = Array.from({ length: steps + 1 }, (_, i) => approaching((i / steps) * approachSeconds).view);
    const hops = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
    const longest = Math.max(...hops);
    const typical = hops.reduce((sum, h) => sum + h, 0) / hops.length;

    expect(longest).toBeLessThan(typical * 3);
  });

  it('descends as it comes in', () => {
    expect(approaching(0).view.altitude).toBeGreaterThan(approaching(approachSeconds).view.altitude);
  });
});
