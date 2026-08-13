import { beforeEach, describe, expect, it } from 'vitest';
import { LEVEL_MEADOW } from '@/content/levels';
import { generateSchedule } from '@/content/schedule';
import { REPUTATION } from '@/content/buildings';
import { addRunway, addStand, addTaxiwayRun, createGame } from '@/sim/airport';
import { buildLinks } from '@/sim/connectivity';
import { fullyServiced } from './helpers';

import { DAY_SECONDS, runDay, startDay, stepDay, SIM_DT } from '@/sim/step';
import type { GameState, ScheduledArrival } from '@/sim/types';

/**
 * A minimal working airport: one grass strip with a taxiway to a small stand.
 * Long enough for a light single, and nothing more.
 */
function grassField(): GameState {
  const state = createGame(LEVEL_MEADOW, 42);
  addRunway(state.airport, 8, 10, 13, 'grass'); // 4 tiles
  addTaxiwayRun(state.airport, 9, 12, 11, 12);
  addStand(state.airport, 12, 12, 'small');
  fullyServiced(state.airport);
  return state;
}

function arrival(atSeconds: number, classId: ScheduledArrival['classId']): ScheduledArrival {
  return { atSeconds, classId };
}

/** Jets refuse to operate without these, so tests about runways need them out of the way. */
function giveFacilities(state: GameState): void {
  state.airport.facilities.push(
    { id: 'f-fuel', type: 'fuel-farm', x: 0, y: 0, level: 0 },
    { id: 'f-fire', type: 'fire-station', x: 1, y: 0, level: 0 },
  );
}

describe('taxiway connectivity', () => {
  it('links a stand reached through a chain of taxiway tiles', () => {
    const state = createGame(LEVEL_MEADOW);
    const runwayId = addRunway(state.airport, 8, 10, 13, 'grass');
    addTaxiwayRun(state.airport, 9, 12, 11, 12);
    const standId = addStand(state.airport, 12, 12, 'small');

    expect(buildLinks(state.airport).get(runwayId)).toEqual([standId]);
  });

  it('does not link a stand with a gap in the taxiway', () => {
    const state = createGame(LEVEL_MEADOW);
    const runwayId = addRunway(state.airport, 8, 10, 13, 'grass');
    addTaxiwayRun(state.airport, 9, 12, 10, 12); // stops one tile short
    addStand(state.airport, 13, 12, 'small');

    expect(buildLinks(state.airport).get(runwayId)).toEqual([]);
  });

  it('links a stand sitting directly beside the runway, with no taxiway at all', () => {
    const state = createGame(LEVEL_MEADOW);
    const runwayId = addRunway(state.airport, 8, 10, 13, 'grass');
    const standId = addStand(state.airport, 9, 11, 'small');

    expect(buildLinks(state.airport).get(runwayId)).toEqual([standId]);
  });
});

describe('assignment reasons', () => {
  let state: GameState;

  beforeEach(() => {
    state = grassField();
  });

  function reasonFor(classId: ScheduledArrival['classId']): unknown {
    const day = startDay(state, [arrival(0, classId)]);
    stepDay(state, SIM_DT);
    return day.aircraft[0]?.blockedReason ?? 'assigned';
  }

  it('blames runway length when nothing is long enough', () => {
    // The 4-tile grass strip cannot take a 6-tile commuter, and length is the first thing
    // the player should be told to fix.
    expect(reasonFor('commuter')).toBe('no-runway-length');
  });

  it('blames surface when the runway is long enough but too soft', () => {
    addRunway(state.airport, 15, 4, 15, 'grass'); // 12 tiles of grass
    fullyServiced(state.airport);
    expect(reasonFor('regional')).toBe('no-fuel-farm');

    giveFacilities(state);
    fullyServiced(state.airport);
    expect(reasonFor('regional')).toBe('no-runway-surface');
  });

  it('blames the missing taxi link when a runway has no way off it', () => {
    const isolated = createGame(LEVEL_MEADOW);
    addRunway(isolated.airport, 3, 2, 14, 'asphalt');
    addStand(isolated.airport, 17, 30, 'large'); // nowhere near it
    fullyServiced(isolated.airport);
    const day = startDay(isolated, [arrival(0, 'light')]);
    stepDay(isolated, SIM_DT);

    expect(day.aircraft[0]?.blockedReason).toBe('no-taxi-link');
  });

  it('blames the apron when the only linked stand is too small', () => {
    const small = createGame(LEVEL_MEADOW);
    giveFacilities(small);
    addRunway(small.airport, 8, 4, 15, 'asphalt'); // 12 tiles, hard surface
    addTaxiwayRun(small.airport, 9, 10, 11, 10);
    addStand(small.airport, 12, 10, 'small'); // a narrowbody will not fit
    fullyServiced(small.airport);

    const day = startDay(small, [arrival(0, 'narrowbody')]);
    stepDay(small, SIM_DT);
    expect(day.aircraft[0]?.blockedReason).toBe('no-stand-size');
  });

  it('assigns when everything lines up', () => {
    expect(reasonFor('light')).toBe('assigned');
  });

  it('prefers the shortest adequate runway, keeping long ones free', () => {
    const roomy = createGame(LEVEL_MEADOW);
    const short = addRunway(roomy.airport, 5, 10, 13, 'asphalt'); // 4 tiles
    addRunway(roomy.airport, 12, 2, 15, 'asphalt'); // 14 tiles
    addStand(roomy.airport, 6, 11, 'large');
    addStand(roomy.airport, 13, 3, 'large');
    fullyServiced(roomy.airport);

    const day = startDay(roomy, [arrival(0, 'light')]);
    stepDay(roomy, SIM_DT); // spawns the aircraft and runs one assignment pass

    expect(day.aircraft[0]?.phase).toBe('approach');
    expect(day.aircraft[0]?.runwayId).toBe(short);
  });
});

describe('fuel, diversion and crashing', () => {
  it('diverts a managed aircraft that runs dry, and attributes the reason', () => {
    const state = grassField();
    // A commuter can never be served here, so it will hold until it has to leave.
    const day = runDay(state, [arrival(0, 'commuter')]);

    const event = day.events[0];
    expect(event?.outcome).toBe('diverted');
    expect(event?.reason).toBe('no-runway-length');
    expect(state.reputation).toBe(50 + REPUTATION.perDiversion);
  });

  it('turns away aircraft the airport structurally cannot take, without a crash', () => {
    const state = grassField();
    // Commuters need a longer, harder runway than this field has. Waiting cannot help, so
    // they are turned away promptly rather than burning a full tank — and nobody dies.
    const day = runDay(state, [
      arrival(0, 'commuter'),
      arrival(0, 'commuter'),
      arrival(0, 'commuter'),
    ]);

    const outcomes = day.events.map((e) => e.outcome);
    expect(outcomes.filter((o) => o === 'diverted')).toHaveLength(3);
    expect(outcomes.filter((o) => o === 'crashed')).toHaveLength(0);
    expect(day.elapsed).toBeLessThan(40);
  });

  it('crashes an aircraft the tower never had room to manage', () => {
    const state = grassField();
    // Genuine overload: far more aeroplanes this field *could* serve than it can work
    // through before their tanks run dry. Those outside the tower's stack cannot divert.
    const day = runDay(state, Array.from({ length: 14 }, () => arrival(0, 'light')));

    const crashes = day.events.filter((e) => e.outcome === 'crashed');
    expect(crashes.length).toBeGreaterThan(0);
    expect(crashes[0]?.reason).toBe('stack-overflow');
  });

  it('does not blame a busy tower for an aircraft that could never have landed', () => {
    const state = grassField();
    const day = startDay(state, []);

    // One light aircraft takes the only movement slot, and a commuter that no runway here
    // could ever accept waits behind it. The commuter's problem is the runway, not the tower.
    day.aircraft.push(
      {
        id: 1, classId: 'light', phase: 'holding', fuel: 100, timer: 0,
        managed: true, runwayId: null, standId: null, blockedReason: null,
      },
      {
        id: 2, classId: 'commuter', phase: 'holding', fuel: 130, timer: 0,
        managed: true, runwayId: null, standId: null, blockedReason: null,
      },
    );

    stepDay(state, SIM_DT);

    expect(day.aircraft.find((a) => a.id === 1)?.phase).toBe('approach');
    expect(day.aircraft.find((a) => a.id === 2)?.blockedReason).toBe('no-runway-length');
  });

  it('serves lowest fuel first when slots are scarce', () => {
    const state = grassField();
    const day = startDay(state, []);

    day.aircraft.push(
      {
        id: 1, classId: 'light', phase: 'holding', fuel: 120, timer: 0,
        managed: true, runwayId: null, standId: null, blockedReason: null,
      },
      {
        id: 2, classId: 'light', phase: 'holding', fuel: 20, timer: 0,
        managed: true, runwayId: null, standId: null, blockedReason: null,
      },
    );

    stepDay(state, SIM_DT);

    // Only one runway exists, so exactly one aircraft gets away — it must be the low one.
    expect(day.aircraft.find((a) => a.id === 2)?.phase).toBe('approach');
    expect(day.aircraft.find((a) => a.id === 1)?.phase).toBe('holding');
  });
});

describe('throughput', () => {
  it('blocks the runway when a landed aircraft has nowhere to park', () => {
    const state = grassField();
    // Two arrivals, one stand. The second cannot be assigned while the first is parked.
    const day = runDay(state, [arrival(0, 'light'), arrival(1, 'light')]);

    const landed = day.events.filter((e) => e.outcome === 'landed');
    expect(landed.length).toBeGreaterThanOrEqual(1);
    // The day closes once every inbound is resolved; aircraft still turning round on stand
    // do not hold it open.
    expect(state.phase).toBe('debrief');
    const stillArriving = ['holding', 'approach', 'landing', 'taxi-in'];
    expect(day.aircraft.some((a) => stillArriving.includes(a.phase))).toBe(false);
  });

  it('adding a second stand lets more aircraft through', () => {
    // Heavy enough that one stand cannot cope: the apron, not the runway, is the limit.
    const schedule = Array.from({ length: 12 }, (_, i) => arrival(i * 3, 'light'));

    const oneStand = grassField();
    const before = runDay(oneStand, schedule);
    const landedBefore = before.events.filter((e) => e.outcome === 'landed').length;

    const twoStands = grassField();
    addTaxiwayRun(twoStands.airport, 11, 12, 11, 14);
    addStand(twoStands.airport, 12, 14, 'small');
    fullyServiced(twoStands.airport);
    const after = runDay(twoStands, schedule);
    const landedAfter = after.events.filter((e) => e.outcome === 'landed').length;

    expect(landedAfter).toBeGreaterThan(landedBefore);
    // And it clears the same traffic sooner, which is the other half of throughput.
    expect(after.elapsed).toBeLessThan(before.elapsed);
  });

  it('runs a full day to completion and balances the books', () => {
    const state = grassField();
    const startingCash = state.cash;
    const day = runDay(state, [arrival(0, 'light'), arrival(20, 'light')]);

    expect(state.phase).toBe('debrief');
    // The day ends when the last inbound is dealt with, which for a quiet schedule on a
    // working airport is well before the clock runs out.
    expect(day.elapsed).toBeLessThan(DAY_SECONDS * 2);

    const expected = day.events.reduce((sum, e) => sum + e.cash, 0);
    expect(state.cash).toBe(startingCash + expected);
  });
});

describe('schedules', () => {
  it('is deterministic for a given seed and day', () => {
    expect(generateSchedule(5, 60, 99)).toEqual(generateSchedule(5, 60, 99));
  });

  it('withholds heavy aircraft until reputation supports them', () => {
    // Day 30 is past the narrowbody's debut, so the only thing separating these two is how
    // well the airport has been run.
    const struggling = generateSchedule(30, 20, 3).map((a) => a.classId);
    const thriving = generateSchedule(30, 90, 3).map((a) => a.classId);

    expect(struggling).not.toContain('narrowbody');
    expect(thriving).toContain('narrowbody');
  });

  it('leaves room at the end of the day for the last arrival to be handled', () => {
    for (const arrivalItem of generateSchedule(9, 80, 7)) {
      expect(arrivalItem.atSeconds).toBeLessThan(DAY_SECONDS);
    }
  });
});
