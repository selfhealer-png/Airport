import { describe, expect, it } from 'vitest';
import {
  BUILD_TILE_PX,
  buildZoom,
  clampCamera,
  centreOnTile,
  createCamera,
  fieldOverflows,
  fitScale,
  screenToTile,
  snapScale,
  zoomAt,
  MAX_SCALE,
} from '@/render/camera';
import { LEVEL_MEADOW } from '@/content/levels';
import { TILE_PX } from '@/sprites/palette';

const VIEW_W = 390;
const VIEW_H = 700;

describe('camera clamping', () => {
  it('keeps the map edge from sliding into view when panned past the corner', () => {
    const camera = { ...createCamera(), x: -500, y: -500 };
    clampCamera(camera, LEVEL_MEADOW, VIEW_W, VIEW_H);
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
  });

  it('stops at the far edge rather than showing empty space beyond the map', () => {
    const camera = { ...createCamera(), x: 99_999, y: 99_999 };
    clampCamera(camera, LEVEL_MEADOW, VIEW_W, VIEW_H);
    expect(camera.x).toBe(LEVEL_MEADOW.width * TILE_PX - VIEW_W / camera.scale);
    expect(camera.y).toBe(LEVEL_MEADOW.height * TILE_PX - VIEW_H / camera.scale);
  });

  it('centres an axis that is narrower than the viewport', () => {
    // Derived from the field rather than hardcoded, so resizing the map cannot quietly turn
    // this into a test of the opposite case. This is the state the game sits in whenever the
    // whole field fits, which since the field grew is most of the time.
    const wide = LEVEL_MEADOW.width * TILE_PX + 100;
    const tall = LEVEL_MEADOW.height * TILE_PX + 100;
    const camera = { ...createCamera(), scale: 1, x: 0, y: 0 };
    clampCamera(camera, LEVEL_MEADOW, wide, tall);

    expect(camera.x).toBe((LEVEL_MEADOW.width * TILE_PX - wide) / 2);
    expect(camera.y).toBe((LEVEL_MEADOW.height * TILE_PX - tall) / 2);
  });
});

describe('zoom', () => {
  it('holds the pinch focus point still', () => {
    const camera = { ...createCamera(), x: 100, y: 100, scale: 2 };
    const focusX = 195;
    const focusY = 350;
    const worldBefore = {
      x: camera.x + focusX / camera.scale,
      y: camera.y + focusY / camera.scale,
    };

    zoomAt(camera, focusX, focusY, 4, 1);

    expect(camera.scale).toBe(4);
    expect(camera.x + focusX / camera.scale).toBeCloseTo(worldBefore.x, 6);
    expect(camera.y + focusY / camera.scale).toBeCloseTo(worldBefore.y, 6);
  });

  /**
   * The rule is a whole number of *device* pixels per sprite pixel, not a whole number of CSS
   * pixels. On a 1x display those are the same thing; on a phone they are not, and treating
   * them as the same is what made the map permanently too wide to fit.
   */
  it('snaps to whole device pixels per sprite pixel', () => {
    const camera = { ...createCamera(), scale: 2 };
    zoomAt(camera, 0, 0, 2.6, 1);
    expect(camera.scale).toBe(3);

    // On a 3x screen, a third of a CSS pixel is still exactly one device pixel.
    expect(snapScale(0.4, 3)).toBeCloseTo(1 / 3, 9);
    expect(snapScale(0.6, 3)).toBeCloseTo(2 / 3, 9);
    expect(snapScale(1.1, 3)).toBeCloseTo(1, 9);
  });

  it('never zooms below one device pixel per sprite pixel', () => {
    for (const dpr of [1, 2, 3]) {
      expect(snapScale(0.0001, dpr)).toBeCloseTo(1 / dpr, 9);
    }
  });

  it('clamps to the allowed zoom range', () => {
    const camera = createCamera();
    zoomAt(camera, 0, 0, 99, 1);
    expect(camera.scale).toBe(MAX_SCALE);
    zoomAt(camera, 0, 0, -5, 1);
    expect(camera.scale).toBe(1);
  });
});

/**
 * The whole field has to be visible on the narrowest phone anyone is likely to use. The map
 * is 24 tiles wide — 384 world pixels — so at a minimum of one CSS pixel per sprite pixel it
 * was wider than a 360 px screen and the player could never see their own airport.
 */
describe('fitting the field on a phone', () => {
  const widths = [320, 360, 375, 390, 412, 430];

  for (const width of widths) {
    it(`fits the whole map across a ${width}px screen at 3x`, () => {
      const scale = fitScale(LEVEL_MEADOW, width, 700, 3);
      expect(LEVEL_MEADOW.width * TILE_PX * scale).toBeLessThanOrEqual(width);
      // ...and is still a whole number of device pixels, so it stays crisp.
      expect(Math.abs(scale * 3 - Math.round(scale * 3))).toBeLessThan(1e-9);
    });
  }

  it('picks the largest zoom that still fits rather than the smallest', () => {
    // Pinned as a property, not a number: the chosen step fits and the next one up does not.
    // The old version asserted a literal 1, which silently became wrong the moment the field
    // was resized — the behaviour was fine, the test was just describing a different map.
    const width = 390;
    const height = 700;
    const dpr = 3;
    const fits = (s: number): boolean =>
      LEVEL_MEADOW.width * TILE_PX * s <= width && LEVEL_MEADOW.height * TILE_PX * s <= height;

    const scale = fitScale(LEVEL_MEADOW, width, height, dpr);
    expect(fits(scale)).toBe(true);
    expect(fits(scale + 1 / dpr)).toBe(false);
  });
});

describe('screenToTile', () => {
  it('maps a screen point to the tile under it', () => {
    const camera = { x: 0, y: 0, scale: 2 };
    // One tile is 16 world px, so 32 screen px at scale 2.
    expect(screenToTile(camera, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(screenToTile(camera, 33, 65)).toEqual({ x: 1, y: 2 });
  });

  it('accounts for the camera offset', () => {
    const camera = { x: 160, y: 320, scale: 2 };
    expect(screenToTile(camera, 0, 0)).toEqual({ x: 10, y: 20 });
  });
});

/**
 * Whether a drag may pan.
 *
 * The map now fits a phone screen at the default zoom, so panning could only nudge it off
 * centre — and any pan marks the camera player-controlled, after which it never re-fits
 * itself again. These pin the rule that decides it, headlessly: the browser cannot be
 * trusted for this, because a backgrounded tab throttles `requestAnimationFrame` and the
 * canvas simply stops redrawing.
 */
describe('fieldOverflows', () => {
  const map = LEVEL_MEADOW;
  const world = { w: map.width * 16, h: map.height * 16 };

  it('is false when the whole field fits, so a drag cannot move it', () => {
    expect(fieldOverflows(map, 1, world.w + 10, world.h + 10)).toBe(false);
  });

  it('is true when the field is taller than the screen', () => {
    expect(fieldOverflows(map, 1, world.w + 10, world.h - 10)).toBe(true);
  });

  it('is true when the field is wider than the screen', () => {
    expect(fieldOverflows(map, 1, world.w - 10, world.h + 10)).toBe(true);
  });

  it('turns panning back on once the player zooms in', () => {
    // The pair that matters: locked at the fitted zoom, unlocked after a pinch. If zoom did
    // not unlock panning, zooming in would strand the player looking at a corner.
    expect(fieldOverflows(map, 1, world.w, world.h)).toBe(false);
    expect(fieldOverflows(map, 4 / 3, world.w, world.h)).toBe(true);
  });

  it('tolerates a sub-pixel overhang rather than unlocking a drag for it', () => {
    // A snapped scale over a whole-tile world rarely lands exactly on the viewport, and a
    // fraction of a pixel is not something a thumb can chase.
    expect(fieldOverflows(map, 1, world.w - 0.4, world.h - 0.4)).toBe(false);
    expect(fieldOverflows(map, 1, world.w - 2, world.h - 2)).toBe(true);
  });
});

/**
 * The zoom used while a tool is armed.
 *
 * At the fitted zoom a tile is about 11 CSS px, which is smaller than the part of a thumb
 * that touches the glass — you cannot aim at what you cannot see past. These pin that arming
 * a tool always makes the tile bigger, on every device ratio, without leaving the crisp
 * lattice.
 */
describe('buildZoom', () => {
  const RATIOS = [1, 2, 2.625, 3];

  it('always gives a tile at least as big as the target', () => {
    for (const dpr of RATIOS) {
      expect(TILE_PX * buildZoom(dpr)).toBeGreaterThanOrEqual(BUILD_TILE_PX);
    }
  });

  it('stays on the crisp lattice', () => {
    // Build mode gets no exception from the whole-device-pixel rule that keeps the art sharp.
    for (const dpr of RATIOS) {
      const steps = buildZoom(dpr) * dpr;
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9);
    }
  });

  it('picks the smallest step that will do, not the biggest', () => {
    // Zooming further than needed would show less of the field for no gain in aim.
    for (const dpr of RATIOS) {
      expect(TILE_PX * (buildZoom(dpr) - 1 / dpr)).toBeLessThan(BUILD_TILE_PX);
    }
  });

  it('is always a zoom in from the fitted view on a phone', () => {
    // The property that matters: arming a tool must never zoom *out*, on any device.
    for (const dpr of RATIOS) {
      expect(buildZoom(dpr)).toBeGreaterThan(fitScale(LEVEL_MEADOW, 390, 606, dpr));
    }
  });

  it('leaves the field bigger than the screen, so panning is available', () => {
    // Zooming in for precision is only usable because two fingers can pan; this pins that the
    // build zoom actually reaches the state where panning unlocks.
    expect(fieldOverflows(LEVEL_MEADOW, buildZoom(3), 390, 606)).toBe(true);
  });
});

describe('centring on a tile', () => {
  const map = LEVEL_MEADOW;

  it('puts the tile in the middle of the view', () => {
    const camera = createCamera();
    camera.scale = 1;
    centreOnTile(camera, map, { x: 15, y: 20 }, 360, 600);

    // The tile's centre in world pixels, less half a screen, is where the camera should sit.
    expect(camera.x).toBeCloseTo((15 + 0.5) * TILE_PX - 180, 5);
    expect(camera.y).toBeCloseTo((20 + 0.5) * TILE_PX - 300, 5);
  });

  it('refuses to run off the edge of the field', () => {
    // Centring on a corner tile would show ground that does not exist, so it clamps — the
    // caller gets the closest legal view rather than a view with nothing in half of it.
    const camera = createCamera();
    camera.scale = 1;
    centreOnTile(camera, map, { x: 0, y: 0 }, 360, 600);

    expect(camera.x).toBeGreaterThanOrEqual(0);
    expect(camera.y).toBeGreaterThanOrEqual(0);
  });
});
