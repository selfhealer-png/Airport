import { levelById } from '@/content/levels';
import { createAirport } from '@/sim/airport';
import type {
  FacilityType,
  GameState,
  RunwaySurface,
  RunwayUse,
  StandSize,
} from '@/sim/types';

/**
 * Turning a game into plain JSON and back.
 *
 * Kept free of `localStorage` so the round trip can be tested headlessly, and free of the
 * level *data* — a save stores the level's id and rehydrates the terrain from `content/`,
 * so editing a map never invalidates existing saves.
 *
 * A day in progress is deliberately not saved. Reloading mid-day returns the player to that
 * day's planning phase with the day unplayed, which is honest and avoids persisting the
 * whole aircraft state machine.
 */

export const SNAPSHOT_VERSION = 4;

export interface Snapshot {
  readonly version: number;
  readonly levelId: string;
  readonly day: number;
  readonly cash: number;
  readonly reputation: number;
  readonly seed: number;
  readonly nextEntityId: number;
  readonly runways: ReadonlyArray<{
    id: string;
    x: number;
    y0: number;
    y1: number;
    surface: RunwaySurface;
    use: RunwayUse;
  }>;
  readonly stands: ReadonlyArray<{ id: string; x: number; y: number; size: StandSize }>;
  /** Row-major tile indices that carry taxiway. Sparse, so a mostly-empty field is tiny. */
  readonly taxiways: readonly number[];
  /** Row-major tile indices that carry road, stored the same way. */
  readonly roads: readonly number[];
  readonly facilities: ReadonlyArray<{
    id: string;
    type: FacilityType;
    x: number;
    y: number;
    level: number;
  }>;
}

export function toSnapshot(state: GameState): Snapshot {
  const { airport } = state;

  const taxiways: number[] = [];
  for (let i = 0; i < airport.taxiways.length; i++) {
    if (airport.taxiways[i] === 1) taxiways.push(i);
  }

  const roads: number[] = [];
  for (let i = 0; i < airport.roads.length; i++) {
    if (airport.roads[i] === 1) roads.push(i);
  }

  return {
    version: SNAPSHOT_VERSION,
    levelId: airport.map.id,
    day: state.day,
    cash: state.cash,
    reputation: state.reputation,
    seed: state.seed,
    nextEntityId: airport.nextEntityId,
    // Reservations and crash closures are per-day and rebuilt by `startDay`, so they are
    // not part of a save.
    runways: airport.runways.map((r) => ({
      id: r.id,
      x: r.x,
      y0: r.y0,
      y1: r.y1,
      surface: r.surface,
      use: r.use,
    })),
    stands: airport.stands.map((s) => ({ id: s.id, x: s.x, y: s.y, size: s.size })),
    taxiways,
    roads,
    facilities: airport.facilities.map((f) => ({
      id: f.id,
      type: f.type,
      x: f.x,
      y: f.y,
      level: f.level,
    })),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Rebuilds a game from a snapshot, or returns null if the data cannot be trusted.
 *
 * Saves come from a previous version of the game that the player may not have run in months,
 * so every field is checked. A corrupt save must start a fresh game, never crash into a
 * blank screen.
 */
export function fromSnapshot(raw: unknown): GameState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Partial<Snapshot>;

  if (data.version !== SNAPSHOT_VERSION) return null;
  if (typeof data.levelId !== 'string') return null;

  const map = levelById(data.levelId);
  if (!map) return null;

  if (!isFiniteNumber(data.day) || !isFiniteNumber(data.cash)) return null;
  if (!isFiniteNumber(data.reputation) || !isFiniteNumber(data.seed)) return null;

  const airport = createAirport(map);
  const inBounds = (x: number, y: number): boolean =>
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height;

  for (const runway of data.runways ?? []) {
    if (!inBounds(runway.x, runway.y0) || !inBounds(runway.x, runway.y1)) continue;
    airport.runways.push({
      id: runway.id,
      x: runway.x,
      y0: Math.min(runway.y0, runway.y1),
      y1: Math.max(runway.y0, runway.y1),
      surface: runway.surface,
      // Defaulted rather than rejected: a runway with no recorded use is a civil one, which
      // is what every strip was before military traffic existed.
      use: runway.use === 'military' ? 'military' : 'civil',
      reservedBy: null,
      closed: false,
    });
  }

  for (const stand of data.stands ?? []) {
    if (!inBounds(stand.x, stand.y)) continue;
    airport.stands.push({
      id: stand.id,
      x: stand.x,
      y: stand.y,
      size: stand.size,
      reservedBy: null,
    });
  }

  for (const index of data.taxiways ?? []) {
    if (Number.isInteger(index) && index >= 0 && index < airport.taxiways.length) {
      airport.taxiways[index] = 1;
    }
  }

  for (const index of data.roads ?? []) {
    if (Number.isInteger(index) && index >= 0 && index < airport.roads.length) {
      airport.roads[index] = 1;
    }
  }

  for (const facility of data.facilities ?? []) {
    if (!inBounds(facility.x, facility.y)) continue;
    airport.facilities.push({
      id: facility.id,
      type: facility.type,
      x: facility.x,
      y: facility.y,
      level: facility.level,
    });
  }

  // Ids must never collide with anything already placed, even if the saved counter was wrong.
  const highest = [...airport.runways, ...airport.stands, ...airport.facilities]
    .map((entity) => Number.parseInt(entity.id.replace(/^\D+/, ''), 10))
    .filter((value) => Number.isFinite(value));
  airport.nextEntityId = Math.max(
    isFiniteNumber(data.nextEntityId) ? data.nextEntityId : 1,
    ...highest.map((value) => value + 1),
    1,
  );

  return {
    airport,
    cash: data.cash,
    reputation: data.reputation,
    day: Math.max(1, Math.floor(data.day)),
    phase: 'planning',
    current: null,
    seed: data.seed,
  };
}

/**
 * Overwrites `target` with a snapshot's contents, keeping the same object identity.
 *
 * Undo cannot simply swap in a fresh `GameState`: the app shell, the pointer handlers and the
 * render loop all closed over the original object when they were wired up, so replacing it
 * would leave them driving a game nobody can see. Restoring *into* the existing object keeps
 * every one of those references pointing at the right thing.
 *
 * Returns false and changes nothing if the snapshot cannot be trusted.
 */
export function restoreInto(target: GameState, raw: unknown): boolean {
  const restored = fromSnapshot(raw);
  if (!restored) return false;

  target.airport = restored.airport;
  target.cash = restored.cash;
  target.reputation = restored.reputation;
  target.day = restored.day;
  // A day in progress is never snapshotted, so undo always lands back in planning.
  target.phase = 'planning';
  target.current = null;
  return true;
}
