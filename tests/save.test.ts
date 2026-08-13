import { describe, expect, it } from 'vitest';
import { LEVEL_MEADOW } from '@/content/levels';
import {
  addHelipad,
  addRunway,
  addStand,
  addTaxiwayRun,
  createGame,
  towerLevelOf,
} from '@/sim/airport';
import { occupantAt } from '@/sim/build';
import { runDay } from '@/sim/step';
import { fromSnapshot, toSnapshot, SNAPSHOT_VERSION, type Snapshot } from '@/save/snapshot';
import { runwayLength, type GameState } from '@/sim/types';

/**
 * A save is the player's progress. These tests care about two things: that a round trip
 * loses nothing, and that a bad save starts a new game rather than breaking one.
 */

function builtGame(): GameState {
  const state = createGame(LEVEL_MEADOW, 7);
  state.cash = 4_321;
  state.day = 9;
  state.landedTotal = 71;
  state.scheduledTotal = 88;
  addRunway(state.airport, 8, 10, 17, 'gravel');
  addTaxiwayRun(state.airport, 9, 14, 11, 14);
  addStand(state.airport, 12, 14, 'medium');
  addHelipad(state.airport, 15, 20);
  state.airport.facilities.push({ id: 'fac9', type: 'tower', x: 4, y: 4, level: 2 });
  return state;
}

/** Simulates going through storage, which is where non-JSON values would be lost. */
const roundTrip = (state: GameState): GameState | null =>
  fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(state))));

describe('save round trip', () => {
  it('restores progress', () => {
    const restored = roundTrip(builtGame());
    expect(restored).not.toBeNull();
    expect({
      cash: restored!.cash,
      day: restored!.day,
      seed: restored!.seed,
      landedTotal: restored!.landedTotal,
      scheduledTotal: restored!.scheduledTotal,
    }).toEqual({ cash: 4_321, day: 9, seed: 7, landedTotal: 71, scheduledTotal: 88 });
  });

  it('restores the layout, including the taxiway mask', () => {
    const original = builtGame();
    const restored = roundTrip(original)!;

    expect(restored.airport.runways).toHaveLength(1);
    expect(runwayLength(restored.airport.runways[0]!)).toBe(8);
    expect(restored.airport.runways[0]!.surface).toBe('gravel');
    expect(restored.airport.stands[0]!.size).toBe('medium');
    expect(towerLevelOf(restored.airport)).toBe(2);

    // The taxiway mask is a Uint8Array, which JSON cannot carry directly.
    for (let x = 9; x <= 11; x++) {
      expect(occupantAt(restored.airport, x, 14)).toBe('taxiway');
    }
    expect(occupantAt(restored.airport, 12, 14)).toBe('stand');
  });

  it('produces an airport that still simulates identically', () => {
    const original = builtGame();
    const restored = roundTrip(original)!;

    const scheduleFor = () => [
      { atSeconds: 0, classId: 'light' as const },
      { atSeconds: 5, classId: 'commuter' as const },
    ];

    const before = runDay(original, scheduleFor());
    const after = runDay(restored, scheduleFor());

    expect(after.events.map((e) => [e.outcome, e.reason])).toEqual(
      before.events.map((e) => [e.outcome, e.reason]),
    );
  });

  it('always lands back in planning, never mid-day', () => {
    const state = builtGame();
    runDay(state, [{ atSeconds: 0, classId: 'light' }]);
    const restored = roundTrip(state)!;

    expect(restored.phase).toBe('planning');
    expect(restored.current).toBeNull();
  });

  it('restores helipads', () => {
    const restored = roundTrip(builtGame())!;

    expect(restored.airport.helipads).toHaveLength(1);
    expect(restored.airport.helipads[0]).toMatchObject({ x: 15, y: 20, reservedBy: null });
  });

  it('keeps new entity ids clear of restored ones', () => {
    const restored = roundTrip(builtGame())!;
    const existing = new Set(
      [
        ...restored.airport.runways,
        ...restored.airport.stands,
        // Helipads must be in this scan too. Leaving them out is a bug that surfaces two
        // sessions later as a pad and a stand sharing an id — the exact failure the
        // "ids come from `Airport.nextEntityId`" rule exists to prevent.
        ...restored.airport.helipads,
        ...restored.airport.facilities,
      ].map((e) => e.id),
    );

    const fresh = addStand(restored.airport, 2, 2, 'small');
    expect(existing.has(fresh)).toBe(false);
  });

  it('will not reissue a helipad id after a load, even with a wrong saved counter', () => {
    // The counter in the save is not trusted: `fromSnapshot` scans what actually came back.
    // A pad with the highest id is the case that only passes if helipads are in that scan.
    const state = builtGame();
    const raw = JSON.parse(JSON.stringify(toSnapshot(state))) as Snapshot;
    const restored = fromSnapshot({ ...raw, nextEntityId: 1 })!;

    const padIds = new Set(restored.airport.helipads.map((p) => p.id));
    expect(padIds.has(addStand(restored.airport, 2, 2, 'small'))).toBe(false);
    expect(padIds.has(addHelipad(restored.airport, 3, 3))).toBe(false);
  });
});

describe('bad saves', () => {
  const snapshot = (overrides: Partial<Snapshot>): unknown => ({
    ...toSnapshot(builtGame()),
    ...overrides,
  });

  it('rejects a save from a different version', () => {
    expect(fromSnapshot(snapshot({ version: SNAPSHOT_VERSION + 1 }))).toBeNull();
  });

  it('rejects a save for a level that no longer exists', () => {
    expect(fromSnapshot(snapshot({ levelId: 'deleted-level' }))).toBeNull();
  });

  it('rejects rubbish rather than throwing', () => {
    for (const value of [null, undefined, 42, 'nope', [], {}]) {
      expect(fromSnapshot(value)).toBeNull();
    }
  });

  it('rejects non-finite numbers', () => {
    expect(fromSnapshot(snapshot({ cash: Number.NaN }))).toBeNull();
  });

  it('drops entities that fall outside the map instead of failing the load', () => {
    const restored = fromSnapshot(
      snapshot({
        stands: [
          { id: 'std1', x: 999, y: 999, size: 'small' },
          { id: 'std2', x: 3, y: 3, size: 'small' },
        ],
      }),
    );

    expect(restored).not.toBeNull();
    expect(restored!.airport.stands).toHaveLength(1);
    expect(restored!.airport.stands[0]!.id).toBe('std2');
  });
});
