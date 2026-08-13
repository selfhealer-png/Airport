import { describe, expect, it } from 'vitest';
import { LEVEL_MEADOW } from '@/content/levels';
import { HELIPAD_COST } from '@/content/costs';
import { addHelipad, addRoadRun, addRunway, addStand, addTaxiwayRun, createGame } from '@/sim/airport';
import { structuralBlock } from '@/sim/assignment';
import { applyHelipad, checkDemolish, checkHelipad, isAffordableQuote, occupantAt } from '@/sim/build';
import { buildServices } from '@/sim/connectivity';
import { runDay, SIM_DT, startDay, stepDay } from '@/sim/step';
import { summariseDay } from '@/ui/debrief';
import type { GameState, ScheduledArrival } from '@/sim/types';
import { fullyServiced } from './helpers';

/**
 * Helipads are the second progression axis: a runway and a stand in one tile, for traffic
 * that never touches either. What these tests hold in place is that the rotor path is
 * genuinely separate — it must not accidentally acquire a runway requirement, and it must not
 * escape the rules that apply to everything else (a road, and the tower's attention).
 */

const arrival = (atSeconds: number, classId: ScheduledArrival['classId']): ScheduledArrival => ({
  atSeconds,
  classId,
});

/** A field with one pad and a road to it, and deliberately no runway whatsoever. */
function padOnly(pads = 1): GameState {
  const state = createGame(LEVEL_MEADOW, 1);
  for (let i = 0; i < pads; i++) addHelipad(state.airport, 8, 10 + i * 2);
  fullyServiced(state.airport);
  return state;
}

/** A conventional airport with runway, taxiway and stand, but no pad. */
function runwayOnly(): GameState {
  const state = createGame(LEVEL_MEADOW, 1);
  addRunway(state.airport, 8, 10, 19, 'asphalt');
  addTaxiwayRun(state.airport, 9, 12, 11, 12);
  addStand(state.airport, 12, 12, 'large');
  fullyServiced(state.airport);
  return state;
}

const blockFor = (state: GameState, classId: 'helicopter' | 'heli-heavy' = 'helicopter') =>
  structuralBlock(state.airport, buildServices(state.airport), classId);

describe('helipad structural requirements', () => {
  it('needs no runway at all', () => {
    // The whole point: a field with one pad and not a metre of tarmac takes helicopters.
    expect(padOnly().airport.runways).toHaveLength(0);
    expect(blockFor(padOnly())).toBeNull();
  });

  it('says "no helipad" rather than blaming the runway', () => {
    // A fully paved airport with no pad must not tell the player to build a longer runway —
    // that would send them to spend thousands on the wrong thing entirely.
    expect(blockFor(runwayOnly())).toBe('no-helipad');
  });

  it('will not use a helipad with no road to it', () => {
    const state = createGame(LEVEL_MEADOW, 1);
    addHelipad(state.airport, 8, 10);
    expect(blockFor(state)).toBe('no-road-helipad');
  });

  it('gates the offshore type behind a working fuel farm', () => {
    const state = padOnly();
    expect(blockFor(state, 'heli-heavy')).toBe('no-fuel-farm');
    // The light type is not gated, so a first pad is worth something immediately.
    expect(blockFor(state, 'helicopter')).toBeNull();
  });

  it('does not let a helipad serve fixed-wing traffic', () => {
    // The exclusivity runs both ways, as it does for military strips: a pad is not a very
    // short runway, and an aeroplane cannot be sent to one.
    expect(structuralBlock(padOnly().airport, buildServices(padOnly().airport), 'light')).toBe(
      'no-runway-length',
    );
  });
});

describe('helipad assignment', () => {
  it('lands a helicopter on a field with nothing but a pad', () => {
    const state = padOnly();
    const day = runDay(state, [arrival(0, 'helicopter')]);
    const result = summariseDay(day);

    expect(result.landed).toBe(1);
    expect(result.diverted).toBe(0);
  });

  it('reports a full apron of pads as busy, not as missing', () => {
    const state = padOnly(1);
    // Three at once against one pad: the two that cannot be placed are queued behind a
    // transient constraint, so they hold rather than being turned away structurally.
    const day = runDay(state, [arrival(0, 'helicopter'), arrival(0, 'helicopter'), arrival(0, 'helicopter')]);

    const reasons = day.events.filter((e) => e.outcome !== 'landed').map((e) => e.reason);
    expect(reasons.every((r) => r === 'helipad-busy')).toBe(true);
  });

  it('clears more traffic with more pads', () => {
    // A pad is held from approach right through the turnaround — there is no pushback that
    // frees it early — so pad count, not runway length, is what a busy rotary day needs.
    // Six at once is past what one pad can clear inside the endurance; three pads is not.
    const schedule = Array.from({ length: 6 }, () => arrival(0, 'helicopter'));
    const one = summariseDay(runDay(padOnly(1), schedule));
    const three = summariseDay(runDay(padOnly(3), schedule));

    expect(one.diverted).toBeGreaterThan(0);
    expect(three.landed).toBeGreaterThan(one.landed);
  });

  it('still costs the tower a movement', () => {
    // A helipad-only airport must not bypass the tower. With no tower at all the airport
    // sequences one movement at a time, so two free pads cannot both be used at once —
    // if rotorcraft were exempt, both would go straight to `approach` on the first tick.
    const state = padOnly(2);
    const day = startDay(state, [arrival(0, 'helicopter'), arrival(0, 'helicopter')]);
    stepDay(state, SIM_DT);

    expect(day.aircraft.filter((a) => a.phase === 'approach')).toHaveLength(1);
    expect(day.aircraft.filter((a) => a.blockedReason === 'tower-capacity')).toHaveLength(1);
  });
});

describe('rotorcraft phases', () => {
  it('never enters a taxi phase', () => {
    // There is nothing to taxi between — the pad is the stand. A dead one-tick phase here
    // would be a trap for every other piece of code that switches on `AircraftPhase`.
    const state = padOnly();
    const day = runDay(state, [arrival(0, 'helicopter')]);
    expect(day.aircraft.every((a) => a.phase !== 'taxi-in' && a.phase !== 'taxi-out')).toBe(true);
  });

  it('holds the pad through the turnaround, and hands it back for the next day', () => {
    const state = padOnly(1);
    runDay(state, [arrival(0, 'helicopter')]);

    // A day ends when the last inbound is resolved, not when the apron empties, so the
    // helicopter is still sitting on its pad here — exactly as an aeroplane would still be
    // on its stand. What matters is that opening the airport again hands the pad back.
    expect(state.airport.helipads[0]!.reservedBy).not.toBeNull();
    startDay(state, []);
    expect(state.airport.helipads[0]!.reservedBy).toBeNull();
  });

  it('takes a pad rather than a runway or a stand', () => {
    const state = createGame(LEVEL_MEADOW, 1);
    addRunway(state.airport, 8, 10, 19, 'asphalt');
    addTaxiwayRun(state.airport, 9, 12, 11, 12);
    addStand(state.airport, 12, 12, 'large');
    addHelipad(state.airport, 15, 12);
    fullyServiced(state.airport);

    const day = runDay(state, [arrival(0, 'helicopter')]);
    const flown = day.aircraft[0]!;
    expect(flown.runwayId).toBeNull();
    expect(flown.standId).toBeNull();
    // Released by the end of the day, so what is pinned is that it never held the others.
    expect(state.airport.runways[0]!.reservedBy).toBeNull();
    expect(state.airport.stands[0]!.reservedBy).toBeNull();
  });
});

describe('building and removing a helipad', () => {
  it('prices a pad and places it on a free tile', () => {
    const state = createGame(LEVEL_MEADOW, 1);
    state.cash = 10_000;
    const quote = checkHelipad(state, 6, 6);
    expect(isAffordableQuote(quote) && quote.cost).toBe(HELIPAD_COST);

    applyHelipad(state, quote as { cost: number }, 6, 6);
    expect(state.airport.helipads).toHaveLength(1);
    expect(state.cash).toBe(10_000 - HELIPAD_COST);
  });

  it('refuses a tile that already has something on it', () => {
    const state = createGame(LEVEL_MEADOW, 1);
    state.cash = 10_000;
    addStand(state.airport, 6, 6, 'small');
    expect(checkHelipad(state, 6, 6)).toBe('occupied');
  });

  it('is what a tile reports as its occupant, so nothing else can be built over it', () => {
    const state = createGame(LEVEL_MEADOW, 1);
    addHelipad(state.airport, 6, 6);
    expect(occupantAt(state.airport, 6, 6)).toBe('helipad');
    expect(checkHelipad(state, 6, 6)).toBe('occupied');
  });

  it('refunds part of the cost when demolished', () => {
    const state = createGame(LEVEL_MEADOW, 1);
    addHelipad(state.airport, 6, 6);
    const quote = checkDemolish(state, 6, 6);
    expect(isAffordableQuote(quote) && quote.cost).toBeLessThan(0);
  });

  it('counts a helipad when deciding which run of road is the airport road', () => {
    // A pad is one of the things the network is measured against, so a road serving three
    // pads beats an unrelated stub serving nothing.
    const state = createGame(LEVEL_MEADOW, 1);
    addHelipad(state.airport, 8, 10);
    addHelipad(state.airport, 8, 12);
    addRoadRun(state.airport, 9, 10, 9, 12);
    addRoadRun(state.airport, 2, 2, 2, 20);

    const services = buildServices(state.airport);
    expect(state.airport.helipads.every((p) => services.roadServed.has(p.id))).toBe(true);
  });
});
