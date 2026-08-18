import { describe, expect, it } from 'vitest';
import { SCENARIOS, scenarioById, startScenario } from '@/content/scenarios';
import { levelById } from '@/content/levels';
import { tomorrowsTraffic } from '@/sim/advice';
import { checkStand, occupantAt } from '@/sim/build';
import { fromSnapshot, toSnapshot } from '@/save/snapshot';
import { hasGroundwork } from '@/sim/airport';
import { terrainAllows, terrainAt, type GameState } from '@/sim/types';

/**
 * A scenario is an airport somebody else built, so nothing about it went through the build
 * system's checks. These tests are the checks: that every scenario describes an airport the
 * game could legally have produced, and that each one is still *unsolved* on the day it hands
 * you the keys — an inherited airport that already copes is not a scenario, it is a save.
 */

const started = (id: string): GameState => {
  const state = startScenario(scenarioById(id)!);
  if (!state) throw new Error(`scenario ${id} would not start`);
  return state;
};

describe('every scenario', () => {
  it('names a level that exists', () => {
    for (const scenario of SCENARIOS) {
      expect(levelById(scenario.levelId), scenario.id).toBeDefined();
    }
  });

  it('starts inside the campaign it borrows', () => {
    // `startDay` is the whole of a scenario's difficulty and its length: the campaign ends at
    // day 50 either way. A scenario starting past it would have nothing left to play.
    for (const scenario of SCENARIOS) {
      expect(scenario.startDay, scenario.id).toBeGreaterThan(0);
      expect(scenario.startDay, scenario.id).toBeLessThan(45);
    }
  });

  it('builds nothing on ground that would refuse it', () => {
    /*
     * The `add…` helpers do not validate — they are what `apply…` calls once a check has
     * already passed — so a scenario can describe an airport the build system would have
     * turned down. On an obstacle map that is easy to do by accident.
     */
    for (const scenario of SCENARIOS) {
      const state = started(scenario.id);
      const { airport } = state;

      const structures = [
        ...airport.runways.flatMap((r) =>
          Array.from({ length: r.y1 - r.y0 + 1 }, (_, i) => ({ x: r.x, y: r.y0 + i })),
        ),
        ...airport.stands,
        ...airport.helipads,
        ...airport.facilities,
      ];

      for (const at of structures) {
        const terrain = terrainAt(airport.map, at.x, at.y);
        expect(terrain, `${scenario.id} @ ${at.x},${at.y}`).toBeDefined();
        expect(
          terrainAllows(terrain!, hasGroundwork(airport, at.x, at.y), 'structure'),
          `${scenario.id} @ ${at.x},${at.y}`,
        ).toBe(true);
      }
    }
  });

  it('never stacks two things on one tile', () => {
    for (const scenario of SCENARIOS) {
      const { airport } = started(scenario.id);
      const seen = new Set<number>();
      for (const thing of [...airport.stands, ...airport.helipads, ...airport.facilities]) {
        const key = thing.y * airport.map.width + thing.x;
        expect(seen.has(key), `${scenario.id} @ ${thing.x},${thing.y}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('never paints a taxiway or a road over a runway', () => {
    /*
     * The first draft of Grass Roots did exactly this: a taxiway run from the apron to a
     * stand crossed a strip that happened to lie between them, because `addTaxiwayRun` paints
     * and does not ask. The result was a tile that was two things at once, which no amount of
     * playing would have revealed and which `occupantAt` would have quietly resolved one way.
     */
    for (const scenario of SCENARIOS) {
      const { airport } = started(scenario.id);
      for (const runway of airport.runways) {
        for (let y = runway.y0; y <= runway.y1; y++) {
          const at = y * airport.map.width + runway.x;
          expect(airport.taxiways[at], `${scenario.id} @ ${runway.x},${y}`).not.toBe(1);
          expect(airport.roads[at], `${scenario.id} @ ${runway.x},${y}`).not.toBe(1);
        }
      }
    }
  });

  it('never paints a road over a stand or a building', () => {
    for (const scenario of SCENARIOS) {
      const { airport } = started(scenario.id);
      for (const thing of [...airport.stands, ...airport.helipads, ...airport.facilities]) {
        const at = thing.y * airport.map.width + thing.x;
        expect(airport.roads[at], `${scenario.id} @ ${thing.x},${thing.y}`).not.toBe(1);
        expect(airport.taxiways[at], `${scenario.id} @ ${thing.x},${thing.y}`).not.toBe(1);
      }
    }
  });

  it('gives every entity a distinct id', () => {
    // Ids come from `nextEntityId` normally. A scenario writes them by hand, so a duplicate is
    // one copy-paste away — and it would break demolition, links and the save all at once.
    for (const scenario of SCENARIOS) {
      const { airport } = started(scenario.id);
      const ids = [
        ...airport.runways.map((r) => r.id),
        ...airport.stands.map((s) => s.id),
        ...airport.helipads.map((h) => h.id),
        ...airport.facilities.map((f) => f.id),
      ];
      expect(new Set(ids).size, scenario.id).toBe(ids.length);
    }
  });

  it('leaves room for the ids the player will make', () => {
    // `nextEntityId` has to clear everything the scenario authored, or the first thing built
    // collides with something inherited.
    for (const scenario of SCENARIOS) {
      const { airport } = started(scenario.id);
      expect(airport.nextEntityId, scenario.id).toBeGreaterThan(0);
    }
  });

  it('survives a save and a reload', () => {
    for (const scenario of SCENARIOS) {
      const state = started(scenario.id);
      const restored = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(state))));
      expect(restored, scenario.id).not.toBeNull();
      expect(restored!.airport.stands.length, scenario.id).toBe(state.airport.stands.length);
      expect(restored!.day, scenario.id).toBe(state.day);
    }
  });

  it('hands over an airport that cannot yet take its own traffic', () => {
    /*
     * The premise, pinned. A scenario whose inherited airport already copes with the day it
     * starts on has no problem in it — the player would open the airport, watch, and win.
     */
    for (const scenario of SCENARIOS) {
      const state = started(scenario.id);
      const traffic = tomorrowsTraffic(state);
      expect(traffic.some((entry) => entry.problem !== null), scenario.id).toBe(true);
    }
  });
});

describe('Grass Roots', () => {
  it('leaves the club flying, so the problem is size rather than ruin', () => {
    const { airport } = started('grass-roots');
    expect(airport.runways.length).toBe(3);
    expect(airport.runways.every((r) => r.surface === 'grass')).toBe(true);
    expect(airport.stands.every((s) => s.size === 'small')).toBe(true);
  });

  it('hands over no tower at all', () => {
    // Which is why it plays as a sequencing problem before it plays as a building one.
    const { airport } = started('grass-roots');
    expect(airport.facilities.some((f) => f.type === 'tower')).toBe(false);
  });
});

describe('Overspill', () => {
  it('fills the apron with stands of the wrong size', () => {
    const { airport } = started('overspill');
    expect(airport.stands.length).toBe(11);
    expect(airport.stands.every((s) => s.size === 'small')).toBe(true);
  });

  it('leaves no room beside the apron for a bigger one', () => {
    /*
     * Its whole premise: the way to a medium stand is through something you already own, or
     * through the hill. If a free tile ever opens up next to the apron this stops being a
     * scenario about demolition and becomes one about spare change.
     */
    const state = started('overspill');
    state.cash = 1_000_000;
    const { airport } = state;

    const free = airport.stands.filter((stand) =>
      [
        { x: stand.x + 1, y: stand.y },
        { x: stand.x - 1, y: stand.y },
        { x: stand.x, y: stand.y + 1 },
        { x: stand.x, y: stand.y - 1 },
      ].some(
        (at) =>
          occupantAt(airport, at.x, at.y) === null &&
          typeof checkStand(state, at.x, at.y, 'large') !== 'string',
      ),
    );

    expect(free).toHaveLength(0);
  });
});
