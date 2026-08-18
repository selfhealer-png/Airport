import { levelById } from '@/content/levels';
import { scenarioById } from '@/content/scenarios';
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

export const SNAPSHOT_VERSION = 8;

export interface Snapshot {
  readonly version: number;
  readonly levelId: string;
  /**
   * The scenario this game came from, if any. Absent for an ordinary campaign, so an old save
   * reads as one without needing a version of its own.
   */
  readonly scenarioId?: string;
  readonly day: number;
  readonly cash: number;
  readonly seed: number;
  /** The campaign service record. Descriptive only; nothing reads it back into the game. */
  readonly landedTotal: number;
  readonly scheduledTotal: number;
  readonly nextEntityId: number;
  /** Index into `CERTIFICATION_LEVELS`. Progress, so it has to survive a reload. */
  readonly certification: number;
  readonly runways: ReadonlyArray<{
    id: string;
    x: number;
    y0: number;
    y1: number;
    surface: RunwaySurface;
    use: RunwayUse;
  }>;
  readonly stands: ReadonlyArray<{ id: string; x: number; y: number; size: StandSize }>;
  /** `reservedBy` is day state, rebuilt by `startDay`, so it is deliberately not stored. */
  readonly helipads: ReadonlyArray<{ id: string; x: number; y: number }>;
  /** Row-major tile indices that carry taxiway. Sparse, so a mostly-empty field is tiny. */
  readonly taxiways: readonly number[];
  /** Row-major tile indices that carry road, stored the same way. */
  readonly roads: readonly number[];
  /**
   * Row-major tile indices where the ground has been worked, stored the same way.
   *
   * What the work bought is not stored: it is read from the level's terrain, so a save
   * cannot disagree with the map about whether a tile is a bridge or a felled wood.
   */
  readonly groundworks: readonly number[];
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

  const groundworks: number[] = [];
  for (let i = 0; i < airport.groundworks.length; i++) {
    if (airport.groundworks[i] === 1) groundworks.push(i);
  }

  return {
    version: SNAPSHOT_VERSION,
    levelId: airport.map.id,
    ...(state.scenarioId ? { scenarioId: state.scenarioId } : {}),
    day: state.day,
    cash: state.cash,
    seed: state.seed,
    landedTotal: state.landedTotal,
    scheduledTotal: state.scheduledTotal,
    nextEntityId: airport.nextEntityId,
    certification: airport.certification,
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
    helipads: airport.helipads.map((h) => ({ id: h.id, x: h.x, y: h.y })),
    taxiways,
    roads,
    groundworks,
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
  if (!isFiniteNumber(data.seed)) return null;

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

  for (const pad of data.helipads ?? []) {
    if (!inBounds(pad.x, pad.y)) continue;
    airport.helipads.push({ id: pad.id, x: pad.x, y: pad.y, reservedBy: null });
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

  for (const index of data.groundworks ?? []) {
    if (Number.isInteger(index) && index >= 0 && index < airport.groundworks.length) {
      airport.groundworks[index] = 1;
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

  // Clamped rather than rejected: a category outside the table is a balance change, not a
  // corrupt save, and dropping to the free one is the safe direction to be wrong in.
  airport.certification = isFiniteNumber(data.certification)
    ? Math.max(0, Math.floor(data.certification))
    : 0;

  // Ids must never collide with anything already placed, even if the saved counter was wrong.
  const highest = [...airport.runways, ...airport.stands, ...airport.helipads, ...airport.facilities]
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
    day: Math.max(1, Math.floor(data.day)),
    phase: 'planning',
    current: null,
    // Rejected rather than trusted if it names a scenario that no longer exists: the layout
    // is still perfectly playable, it just stops claiming to be somebody's scenario.
    scenarioId:
      typeof data.scenarioId === 'string' && scenarioById(data.scenarioId)
        ? data.scenarioId
        : null,
    seed: data.seed,
    // Tolerated rather than required: the service record is a scoreboard, so a save missing
    // it should start counting from zero, not be thrown away.
    landedTotal: isFiniteNumber(data.landedTotal) ? data.landedTotal : 0,
    scheduledTotal: isFiniteNumber(data.scheduledTotal) ? data.scheduledTotal : 0,
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
  target.day = restored.day;
  target.landedTotal = restored.landedTotal;
  target.scheduledTotal = restored.scheduledTotal;
  target.scenarioId = restored.scenarioId;
  // `target.seed` is deliberately left untouched. This was safe by construction while undo
  // was the only caller — a snapshot could only ever be the same game's own history, so its
  // seed always matched. `enterLevel()` in `main.ts` now also calls this, restoring a
  // *different* game's snapshot on top of `target`, and every level currently shares one seed
  // (see `SEED` in `main.ts`), so the mismatch this would otherwise cause never arises. If
  // per-level seeds stop being "a one-line change", this needs revisiting — otherwise the
  // previous level's seed silently carries over into the new one.
  // A day in progress is never snapshotted, so undo always lands back in planning.
  target.phase = 'planning';
  target.current = null;
  return true;
}
