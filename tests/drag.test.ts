import { describe, expect, it } from 'vitest';
import { AIM_OFFSET_PX, ANCHOR_LOCK_PX, aimFrom, beginDrag, moveDrag } from '@/input/drag';
import { TILE_PX } from '@/sprites/palette';
import type { TileIndex } from '@/sim/types';

/**
 * The shape of a build drag.
 *
 * This is the part of placing a building that a `node` test can actually reach — the gesture
 * itself needs a thumb — and it is also the part most likely to be quietly wrong, because
 * every number in it is an arithmetic offset that looks plausible either way.
 */

/** A tile lookup at a fixed zoom, standing in for the camera. */
const at =
  (tilePx: number) =>
  (x: number, y: number): TileIndex => ({ x: Math.floor(x / tilePx), y: Math.floor(y / tilePx) });

const BUILD_TILE = 27; // roughly what a tile measures at build zoom on a 3x phone

describe('aiming above the finger', () => {
  it('targets a point clear of the fingertip', () => {
    expect(aimFrom(100, 300)).toEqual({ x: 100, y: 300 - AIM_OFFSET_PX });
  });

  it('does not move sideways', () => {
    // Only the vertical is offset: a thumb hides what is under and below it, not beside it.
    expect(aimFrom(100, 300).x).toBe(100);
  });

  it('keeps the crosshair on the canvas near the top edge', () => {
    // The cost of a fixed offset is a band at the top where the crosshair stops climbing.
    // It must clamp rather than aim off-screen at a tile that cannot be seen.
    expect(aimFrom(50, 10).y).toBeGreaterThanOrEqual(0);
    expect(aimFrom(50, 0).y).toBeGreaterThanOrEqual(0);
  });

  it('aims a whole tile or more clear of the finger at build zoom', () => {
    // If the offset were smaller than a tile the thumb would still cover the target, which is
    // the entire failure this exists to fix.
    expect(AIM_OFFSET_PX).toBeGreaterThan(BUILD_TILE);
  });
});

describe('the floating anchor', () => {
  const tileAt = at(BUILD_TILE);

  it('starts with the anchor on the aimed tile, not the touched one', () => {
    const drag = beginDrag(100, 300, tileAt);
    expect(drag.aim.from).toEqual(tileAt(100, 300 - AIM_OFFSET_PX));
    expect(drag.aim.to).toEqual(drag.aim.from);
    expect(drag.aim.locked).toBe(false);
  });

  it('lets the anchor follow the finger while the drag is still settling', () => {
    /*
     * The point of the whole thing. The anchor used to be fixed the instant the finger landed,
     * so the start tile of a runway was the one tile in the game you had to hit blind.
     */
    const drag = beginDrag(100, 300, tileAt);
    const nudged = moveDrag(drag, 100 + ANCHOR_LOCK_PX - 4, 300, tileAt);

    expect(nudged.aim.locked).toBe(false);
    expect(nudged.aim.from).toEqual(nudged.aim.to);
    expect(nudged.aim.from).not.toEqual(drag.aim.from);
  });

  it('locks the anchor once the finger has clearly set off', () => {
    const drag = beginDrag(100, 300, tileAt);
    const settled = moveDrag(drag, 100 + ANCHOR_LOCK_PX - 4, 300, tileAt);
    const pulled = moveDrag(settled, 100 + ANCHOR_LOCK_PX + 60, 300, tileAt);

    expect(pulled.aim.locked).toBe(true);
    expect(pulled.aim.from).toEqual(settled.aim.from);
    expect(pulled.aim.to).not.toEqual(pulled.aim.from);
  });

  it('never unlocks, even if the finger comes back', () => {
    // Coming back towards the start shortens the line; it must not pick the anchor up again,
    // or a runway would slide around under a returning thumb.
    const drag = beginDrag(100, 300, tileAt);
    const pulled = moveDrag(drag, 100, 300 + 200, tileAt);
    const returned = moveDrag(pulled, 100, 300 + 2, tileAt);

    expect(returned.aim.locked).toBe(true);
    expect(returned.aim.from).toEqual(drag.aim.from);
  });

  it('measures travel from the contact point, not from the aimed point', () => {
    // Both are offset by the same constant, so the distance is the same either way — this
    // pins that the offset is not accidentally counted twice.
    const drag = beginDrag(100, 300, tileAt);
    const justUnder = moveDrag(drag, 100, 300 - (ANCHOR_LOCK_PX - 2), tileAt);
    const justOver = moveDrag(drag, 100, 300 - (ANCHOR_LOCK_PX + 2), tileAt);

    expect(justUnder.aim.locked).toBe(false);
    expect(justOver.aim.locked).toBe(true);
  });

  it('keeps the crosshair tracking the finger after the anchor locks', () => {
    const drag = beginDrag(100, 300, tileAt);
    const pulled = moveDrag(drag, 140, 500, tileAt);

    expect(pulled.aim.aim).toEqual(aimFrom(140, 500));
  });

  it('works at the fitted zoom too, where tiles are much smaller', () => {
    // Nothing in the gesture depends on the zoom; the tile lookup absorbs it.
    const tiny = at(TILE_PX * (2 / 3));
    const drag = beginDrag(100, 300, tiny);
    const pulled = moveDrag(drag, 100, 400, tiny);

    expect(pulled.aim.locked).toBe(true);
    expect(pulled.aim.to.y).toBeGreaterThan(pulled.aim.from.y);
  });
});
