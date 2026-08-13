import {
  applyDemolish,
  applyFacility,
  applyGrowRunway,
  applyHelipad,
  applyRoadRun,
  applyRunway,
  applyStand,
  applyTaxiwayRun,
  checkDemolish,
  checkFacility,
  checkGrowRunway,
  checkHelipad,
  checkRoadRun,
  checkRunway,
  checkStand,
  checkTaxiwayRun,
  isAffordableQuote,
  touchedRunways,
  type BuildCheck,
} from '@/sim/build';
import {
  SURFACE_RANK as SURFACE_ORDER,
  type FacilityType,
  type GameState,
  type RunwaySurface,
  type RunwayUse,
  type StandSize,
  type TileIndex,
} from '@/sim/types';

/**
 * Turns a drag on the map into a concrete build.
 *
 * Preview and commit go through the same function, so what the player sees highlighted is
 * exactly what they get — there is no second code path that could disagree.
 */

export type Tool =
  | { readonly kind: 'runway'; readonly surface: RunwaySurface; readonly use: RunwayUse }
  | { readonly kind: 'taxiway' }
  | { readonly kind: 'road' }
  | { readonly kind: 'stand'; readonly size: StandSize }
  /** One tile, no size: a pad is a runway and a stand at once. */
  | { readonly kind: 'helipad' }
  | { readonly kind: 'facility'; readonly type: FacilityType }
  | { readonly kind: 'demolish' };

export interface Placement {
  readonly tiles: readonly TileIndex[];
  readonly check: BuildCheck;
  /**
   * What this drag would actually do, when that is not obvious from the highlight alone.
   *
   * Extending a runway and building a new one look identical on the map — a column of tiles
   * lighting up — but they cost very different amounts, so the drawer says which it is.
   */
  readonly summary?: string;
  /** Set when the drag would modify an existing runway rather than lay a new one. */
  readonly growing?: string;
}

function line(from: TileIndex, to: TileIndex): TileIndex[] {
  const stepX = Math.sign(to.x - from.x);
  const stepY = Math.sign(to.y - from.y);
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  return Array.from({ length: steps + 1 }, (_, i) => ({
    x: from.x + stepX * i,
    y: from.y + stepY * i,
  }));
}

/** Resolves the drag into the tiles it covers, then asks the sim whether that is legal. */
export function resolvePlacement(
  state: GameState,
  tool: Tool,
  from: TileIndex,
  to: TileIndex,
): Placement {
  switch (tool.kind) {
    case 'runway': {
      // Runways are vertical, so the column is fixed by where the drag started and only the
      // length follows the finger.
      const end: TileIndex = { x: from.x, y: to.y };

      // Dragging along a runway that is already there grows it instead of refusing as
      // "occupied". Demolishing and rebuilding to add a tile cost 40% of the strip, which is
      // a penalty for planning ahead badly on day one — when planning ahead is impossible.
      const touched = touchedRunways(state.airport, from.x, from.y, to.y);
      const existing = touched.length === 1 ? touched[0] : undefined;
      if (existing) {
        const top = Math.min(Math.min(from.y, to.y), existing.y0);
        const bottom = Math.max(Math.max(from.y, to.y), existing.y1);
        const check = checkGrowRunway(state, existing.id, from.y, to.y, tool.surface, tool.use);
        const longer = bottom - top + 1 > existing.y1 - existing.y0 + 1;
        const paving = SURFACE_ORDER[tool.surface] > SURFACE_ORDER[existing.surface];
        return {
          tiles: line({ x: from.x, y: top }, { x: from.x, y: bottom }),
          check,
          growing: existing.id,
          summary:
            longer && paving
              ? `Extend to ${bottom - top + 1} tiles and repave`
              : longer
                ? `Extend to ${bottom - top + 1} tiles`
                : paving
                  ? `Resurface ${existing.y1 - existing.y0 + 1} tiles`
                  : 'Runway',
        };
      }

      return {
        tiles: line(from, end),
        check: checkRunway(state, from.x, from.y, to.y, tool.surface, tool.use),
      };
    }

    case 'taxiway':
    case 'road': {
      // Snap to whichever axis the player has moved further along. Roads drag exactly like
      // taxiways on purpose: same gesture, so the thumb does not have to learn twice.
      const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
      const end: TileIndex = horizontal ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
      const check =
        tool.kind === 'taxiway'
          ? checkTaxiwayRun(state, from.x, from.y, end.x, end.y)
          : checkRoadRun(state, from.x, from.y, end.x, end.y);
      return { tiles: line(from, end), check };
    }

    case 'stand':
      return { tiles: [to], check: checkStand(state, to.x, to.y, tool.size) };

    case 'helipad':
      return { tiles: [to], check: checkHelipad(state, to.x, to.y) };

    case 'facility':
      return { tiles: [to], check: checkFacility(state, tool.type, to.x, to.y) };

    case 'demolish':
      return { tiles: [to], check: checkDemolish(state, to.x, to.y) };
  }
}

/**
 * Commits a placement. Returns whether anything happened, so the caller can play a sound or
 * shake the drawer without re-deriving validity.
 */
export function commitPlacement(state: GameState, tool: Tool, placement: Placement): boolean {
  const { check, tiles } = placement;
  if (!isAffordableQuote(check)) return false;

  const first = tiles[0];
  const last = tiles[tiles.length - 1];
  if (!first || !last) return false;

  switch (tool.kind) {
    case 'runway':
      if (placement.growing) {
        applyGrowRunway(state, check, placement.growing, first.y, last.y, tool.surface);
      } else {
        applyRunway(state, check, first.x, first.y, last.y, tool.surface, tool.use);
      }
      return true;
    case 'taxiway':
      applyTaxiwayRun(state, check, first.x, first.y, last.x, last.y);
      return true;
    case 'road':
      applyRoadRun(state, check, first.x, first.y, last.x, last.y);
      return true;
    case 'stand':
      applyStand(state, check, last.x, last.y, tool.size);
      return true;
    case 'helipad':
      applyHelipad(state, check, last.x, last.y);
      return true;
    case 'facility':
      applyFacility(state, check, tool.type, last.x, last.y);
      return true;
    case 'demolish':
      applyDemolish(state, check, last.x, last.y);
      return true;
  }
}
