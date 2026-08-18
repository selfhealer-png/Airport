import { describe, expect, it } from 'vitest';
import { LEVEL_MEADOW } from '@/content/levels';
import { addRunway, addStand, addTaxiwayRun, createGame } from '@/sim/airport';
import { airportAdvice, needsAttention, tomorrowsTraffic } from '@/sim/advice';
import { generateSchedule } from '@/content/schedule';
import { runDay } from '@/sim/step';
import { summariseDay } from '@/ui/debrief';
import { fullyServiced } from './helpers';
import type { GameState } from '@/sim/types';

/**
 * Planning advice exists to explain money that is quietly doing nothing. The debrief covers
 * aeroplanes that were lost; this covers the runway that never gets used and never says why.
 */

const texts = (state: GameState): string => airportAdvice(state).map((a) => a.text).join(' | ');

function working(): GameState {
  const state = createGame(LEVEL_MEADOW, 1);
  addRunway(state.airport, 8, 10, 15, 'grass');
  addTaxiwayRun(state.airport, 9, 12, 11, 12);
  addStand(state.airport, 12, 12, 'small');
  fullyServiced(state.airport);
  return state;
}

/**
 * What auto-play watches.
 *
 * It runs day after day while this returns null and hands control back the moment it returns
 * a reason, so a false null means the game sails past something the player needed to see, and
 * a false reason means the feature stops constantly and is worthless. Both are worth pinning.
 */
describe('needsAttention', () => {
  it('is quiet about a small airport that is coping', () => {
    // Day 1 on a working strip: nothing lost, nothing booked it cannot take, nothing to warn
    // about. This is the case the whole feature exists to skip through.
    expect(needsAttention(working(), null)).toBeNull();
  });

  it('speaks up when a class booked in today cannot be taken', () => {
    const state = working();
    state.day = 20; // well past the point a six-tile grass strip can serve the schedule
    expect(needsAttention(state, null)).toMatch(/booked in/i);
  });

  it('speaks up when the airport has nowhere to park', () => {
    const state = createGame(LEVEL_MEADOW, 1);
    addRunway(state.airport, 8, 10, 15, 'grass');
    fullyServiced(state.airport);
    expect(needsAttention(state, null)).toMatch(/stand/i);
  });

  it('speaks up when the day just played lost an aeroplane', () => {
    // A loss outranks everything else: whatever the cause, an aeroplane that did not get down
    // is the thing worth looking at, and it is reported with the reason the debrief would use.
    const state = working();
    const day = runDay(state, [{ atSeconds: 0, classId: 'commuter' }]);

    expect(summariseDay(day).landed).toBe(0);
    expect(needsAttention(state, day)).toMatch(/lost/i);
  });

  it('stays quiet after a day where everything got down', () => {
    const state = working();
    const day = runDay(state, [{ atSeconds: 0, classId: 'light' }]);

    expect(summariseDay(day).landed).toBe(1);
    expect(needsAttention(state, day)).toBeNull();
  });

  it('counts the losses rather than naming just the one', () => {
    const state = working();
    const day = runDay(state, [
      { atSeconds: 0, classId: 'commuter' },
      { atSeconds: 1, classId: 'commuter' },
    ]);
    expect(needsAttention(state, day)).toMatch(/2 aeroplanes were lost/i);
  });
});

describe('the aerodrome licence', () => {
  /**
   * Certification is the only cost in the game charged every day whether it earns anything or
   * not, and neither of its failure modes is visible from the map: traffic turned away for a
   * licence you do not hold, and a licence held against traffic that is not coming.
   */
  it('warns when booked traffic needs a category you do not hold', () => {
    const state = working();
    // Day 20 books regionals and feeders, all of which are graded above the free category.
    state.day = 20;
    expect(state.airport.certification).toBe(0);
    expect(texts(state)).toMatch(/licence you do not hold/i);
  });

  it('says the licence is only worth holding once you can use it', () => {
    const state = working();
    state.day = 20;
    // The warning has to carry the recurring cost, or a player reads it as a one-off price.
    expect(texts(state)).toMatch(/a day, every day/i);
  });

  it('points out a category nothing booked today needs', () => {
    const state = working();
    // Day 1 is trainers and light singles: the free category covers everything.
    state.day = 1;
    state.airport.certification = 3;
    expect(texts(state)).toMatch(/nothing booked today needs/i);
    expect(texts(state)).toMatch(/give it up/i);
  });

  it('stays quiet about the free category, which costs nothing to hold', () => {
    const state = working();
    state.day = 1;
    expect(texts(state)).not.toMatch(/nothing booked today needs/i);
  });
});

describe('planning advice', () => {
  it('tells a brand new player to build a runway', () => {
    expect(texts(createGame(LEVEL_MEADOW, 1))).toMatch(/drag out a runway/i);
  });

  it('warns when there is nowhere to park', () => {
    const state = createGame(LEVEL_MEADOW, 1);
    addRunway(state.airport, 8, 10, 15, 'grass');
    expect(texts(state)).toMatch(/no stands/i);
  });

  it('warns about a runway with no taxiway to a stand', () => {
    const state = working();
    addRunway(state.airport, 2, 20, 25, 'grass'); // nowhere near the apron
    fullyServiced(state.airport);
    expect(texts(state)).toMatch(/no taxiway to a stand/i);
  });

  /**
   * The one that actually bit in play: a second runway is useless until the tower can
   * sequence more than one aeroplane, and nothing on screen said so.
   */
  it('explains that a second runway is idle without a tower', () => {
    const state = working();
    addRunway(state.airport, 14, 10, 15, 'grass');
    addTaxiwayRun(state.airport, 13, 12, 13, 12);
    addStand(state.airport, 13, 13, 'small');
    fullyServiced(state.airport);

    expect(texts(state)).toMatch(/only one aeroplane can move at a time/i);
  });

  it('stops nagging about the tower once it can keep up', () => {
    const state = working();
    addRunway(state.airport, 14, 10, 15, 'grass');
    addTaxiwayRun(state.airport, 13, 12, 13, 12);
    addStand(state.airport, 13, 13, 'small');
    state.airport.facilities.push({ id: 'fac1', type: 'tower', x: 4, y: 4, level: 1 });
    fullyServiced(state.airport);

    expect(texts(state)).not.toMatch(/aeroplane can move at a time/i);
  });

  it('warns about a stand nothing can taxi to', () => {
    const state = working();
    addStand(state.airport, 18, 30, 'large');
    fullyServiced(state.airport);
    expect(texts(state)).toMatch(/no taxiway back to a runway/i);
  });

  it('says nothing alarming about a small but correct airport', () => {
    const advice = airportAdvice(working());
    expect(advice.filter((a) => a.tone === 'warn')).toEqual([]);
  });
});

describe('pacing', () => {
  it('resolves a full day of traffic quickly enough to stay watchable', () => {
    // An airport built for the traffic. One that is under-built *should* run long and
    // divert aeroplanes; that is the puzzle, not a pacing bug.
    const state = working();
    addTaxiwayRun(state.airport, 11, 12, 11, 14);
    addStand(state.airport, 12, 14, 'small');
    fullyServiced(state.airport);
    const schedule = Array.from({ length: 6 }, (_, i) => ({
      atSeconds: i * 4,
      classId: 'light' as const,
    }));

    const day = runDay(state, schedule);

    // A day must finish soon after its last arrival, not run on for minutes afterwards.
    expect(day.elapsed).toBeLessThan(90);
    expect(day.events.filter((e) => e.outcome === 'landed').length).toBeGreaterThan(0);
  });
});

/**
 * The forecast is the answer to "how was I supposed to know gravel was coming?". It shares
 * `structuralBlock` with the assignment pass, and these tests exist to keep the two honest:
 * a forecast that promised traffic the simulation then turned away would be worse than none.
 */
describe('traffic forecast', () => {
  function grassStrip(): GameState {
    const state = working();
    // Well past the point where the ladder has left a six-tile *grass* strip behind, so the
    // forecast has something real to complain about.
    state.day = 20;
    return state;
  }

  it('counts every class booked in for the day', () => {
    const state = grassStrip();
    const forecast = tomorrowsTraffic(state);
    const scheduled = generateSchedule(state.day, state.seed);

    expect(forecast.reduce((sum, e) => sum + e.count, 0)).toBe(scheduled.length);
    // Most numerous first, so the pill the player reads first is the one that matters most.
    const counts = forecast.map((e) => e.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it('flags a class this airport cannot take, and says why', () => {
    const state = grassStrip();
    const forecast = tomorrowsTraffic(state);

    // A short grass strip takes light aircraft and nothing heavier, and the forecast has to
    // say which — naming the constraint, not just that something is wrong.
    const blocked = forecast.filter((e) => e.problem);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((e) => /runway|stand|fuel|road/i.test(e.problem ?? ''))).toBe(true);
    expect(forecast.find((e) => e.classId === 'light')?.problem ?? null).toBeNull();
  });

  it('agrees with what the day actually does', () => {
    // Whatever the forecast calls unservable must be exactly what the day diverts, or the
    // planning screen is lying to the player.
    const state = grassStrip();
    const blocked = new Set(
      tomorrowsTraffic(state).filter((e) => e.problem).map((e) => e.classId),
    );

    const day = runDay(state, generateSchedule(state.day, state.seed));
    for (const event of day.events) {
      if (blocked.has(event.classId)) expect(event.outcome).not.toBe('landed');
    }
  });
});

/** The warnings only, which is what a player is meant to act on. */
const warnings = (state: GameState): string[] =>
  airportAdvice(state).filter((a) => a.tone === 'warn').map((a) => a.text);

describe('terminal modules', () => {
  it('warns about a module that reaches no terminal', () => {
    /*
     * The one mistake modules make possible that the build system cannot refuse: a placement
     * that was legal when it was made and was orphaned later, by demolishing the middle of a
     * chain or by never laying the road. The building is still standing, so nothing looks
     * wrong — which is exactly when advice earns its place.
     */
    const state = working();
    state.airport.facilities.push(
      { id: 'f-term', type: 'terminal', x: 4, y: 2, level: 0 },
      { id: 'orphan', type: 'gate-hall', x: 20, y: 30, level: 0 },
    );
    fullyServiced(state.airport);

    expect(warnings(state).join(' ')).toMatch(/module/i);
  });

  it('says nothing about modules that are all attached', () => {
    const state = working();
    state.airport.facilities.push(
      { id: 'f-term', type: 'terminal', x: 4, y: 2, level: 0 },
      { id: 'm0', type: 'gate-hall', x: 5, y: 2, level: 0 },
    );
    fullyServiced(state.airport);

    expect(warnings(state).join(' ')).not.toMatch(/module/i);
  });
});
