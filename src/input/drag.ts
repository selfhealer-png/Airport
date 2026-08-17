import type { TileIndex } from '@/sim/types';

/**
 * The shape of a build drag, with no DOM in it.
 *
 * Kept apart from `pointer.ts` for the same reason `ui/placement.ts` is DOM-free: the offset
 * arithmetic and the anchor lock are the parts most likely to be subtly wrong, and they are
 * the parts a `node` test environment can actually reach. `pointer.ts` supplies the tile
 * lookup and becomes a thin event pump over this.
 */

/**
 * How far above the contact point the game actually aims, in CSS pixels.
 *
 * A tile is about 27 CSS px at build zoom and a thumb's contact patch is bigger than that, so
 * aiming at the tile under the finger means aiming at a tile you cannot see. Lifting the
 * target clear of the fingertip is the whole reason a build is placeable at all on a phone.
 *
 * In CSS pixels rather than tiles because it is a property of the finger, not of the map — it
 * must not change when the player zooms.
 */
export const AIM_OFFSET_PX = 40;

/**
 * How far the finger may travel before the anchor stops following it.
 *
 * The first tile of a line used to be fixed the instant the finger landed, with no preview
 * and no way to adjust — the highest-precision moment in the game, and the only one with no
 * feedback at all. Now the anchor follows until the drag is clearly under way, so the gesture
 * is press, nudge onto the right start tile, then pull out the line.
 *
 * Under one tile of travel at build zoom: invisible when you drag decisively, forgiving when
 * you do not.
 */
export const ANCHOR_LOCK_PX = 20;

/** Where the crosshair is drawn, in CSS pixels relative to the canvas. */
export interface AimPoint {
  readonly x: number;
  readonly y: number;
}

/** A build being dragged out. */
export interface BuildAim {
  /** The anchor tile. Follows the finger until `locked`. */
  readonly from: TileIndex;
  /** The tile being aimed at now. Equals `from` until `locked`. */
  readonly to: TileIndex;
  /** True once the finger has travelled far enough that `from` has stopped moving. */
  readonly locked: boolean;
  /** The crosshair: the contact point lifted clear of the fingertip. */
  readonly aim: AimPoint;
}

export interface DragState {
  /** Where the finger first landed, for measuring travel. Not the anchor. */
  readonly startX: number;
  readonly startY: number;
  readonly aim: BuildAim;
}

/** Which tile a screen point falls on. Injected so this file needs no camera and no DOM. */
export type TileAt = (x: number, y: number) => TileIndex;

/**
 * Lifts a contact point to where the game aims.
 *
 * Clamped so the crosshair can never leave the canvas. That leaves a band at the very top of
 * the map where it stops moving vertically — the honest cost of a fixed offset, and
 * survivable, because a contact anywhere in that band still targets the topmost visible row.
 * Deliberately not eased near the edge: an offset that varies is an offset a thumb cannot
 * learn.
 */
export function aimFrom(x: number, y: number): AimPoint {
  return { x, y: Math.max(4, y - AIM_OFFSET_PX) };
}

export function beginDrag(x: number, y: number, tileAt: TileAt): DragState {
  const aim = aimFrom(x, y);
  const tile = tileAt(aim.x, aim.y);
  return { startX: x, startY: y, aim: { from: tile, to: tile, locked: false, aim } };
}

export function moveDrag(state: DragState, x: number, y: number, tileAt: TileAt): DragState {
  const aim = aimFrom(x, y);
  const tile = tileAt(aim.x, aim.y);
  const travelled = Math.hypot(x - state.startX, y - state.startY);

  // Still settling: the anchor rides along with the finger, so the start of a line is as
  // correctable as its end.
  if (!state.aim.locked && travelled <= ANCHOR_LOCK_PX) {
    return { ...state, aim: { from: tile, to: tile, locked: false, aim } };
  }

  // Committed: the anchor stays wherever it had reached, and the line extends from it.
  return { ...state, aim: { from: state.aim.from, to: tile, locked: true, aim } };
}
