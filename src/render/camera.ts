import { TILE_PX } from '@/sprites/palette';
import type { LevelMap } from '@/sim/types';

/**
 * Maps between world space (sprite pixels) and screen space (CSS pixels).
 *
 * `scale` is CSS pixels per sprite pixel. What keeps pixel art crisp is not that this is a
 * whole number — it is that a sprite pixel covers a whole number of *device* pixels, and the
 * canvas backing store is sized by the device pixel ratio. So the allowed zooms are
 * `steps / dpr` for whole `steps`, and on a 3x phone that legitimately includes 1/3 and 2/3.
 *
 * That distinction matters on a small screen. The field is 24 tiles wide, which is 384 world
 * pixels; insisting on whole CSS pixels put the minimum zoom at 384 CSS px and made the map
 * permanently wider than a 360 px phone, so the player could never see their own airport.
 */
export interface Camera {
  /** Top-left of the viewport, in world pixels. */
  x: number;
  y: number;
  scale: number;
}

/** Never smaller than one device pixel per sprite pixel — below that, detail is destroyed. */
export const MIN_DEVICE_STEPS = 1;

/** CSS pixels per sprite pixel at maximum zoom. */
export const MAX_SCALE = 5;

/**
 * The device pixel ratio the zoom lattice and the canvas backing store are both built on.
 *
 * The *true* ratio, not a floored one. Flooring used to be necessary because zoom had to be a
 * whole number of CSS pixels, but it cost real quality: on a 1.5x or 2.625x screen — which is
 * most of them — flooring to 1 or 2 meant the backing store no longer matched the display and
 * the browser rescaled every sprite. Now that a zoom level is a whole number of *device*
 * pixels, a fractional ratio works out exactly, and the picture is sharper for it.
 *
 * Defined here rather than read separately by each caller: if the renderer and the pinch
 * handler disagreed about the ratio, zoom would snap to a lattice the renderer was not
 * drawing on. Capped because past 3x the backing store costs more than it returns.
 */
export function deviceRatio(): number {
  return Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
}

/** Rounds `steps` into the allowed range for this device. */
function clampSteps(steps: number, dpr: number): number {
  const most = Math.max(MIN_DEVICE_STEPS, Math.round(MAX_SCALE * dpr));
  return Math.min(Math.max(steps, MIN_DEVICE_STEPS), most);
}

/** The nearest zoom that puts sprite pixels on whole device pixels. */
export function snapScale(scale: number, dpr: number): number {
  return clampSteps(Math.round(scale * dpr), dpr) / dpr;
}

export function createCamera(): Camera {
  return { x: 0, y: 0, scale: 2 };
}

export function worldSize(map: LevelMap): { width: number; height: number } {
  return { width: map.width * TILE_PX, height: map.height * TILE_PX };
}

/**
 * Keeps the map inside the viewport: centred on whichever axis is smaller than the screen,
 * otherwise clamped so the player can never pan off into empty space.
 */
export function clampCamera(camera: Camera, map: LevelMap, viewW: number, viewH: number): void {
  const world = worldSize(map);
  const visibleW = viewW / camera.scale;
  const visibleH = viewH / camera.scale;

  camera.x = world.width <= visibleW
    ? (world.width - visibleW) / 2
    : Math.min(Math.max(camera.x, 0), world.width - visibleW);

  camera.y = world.height <= visibleH
    ? (world.height - visibleH) / 2
    : Math.min(Math.max(camera.y, 0), world.height - visibleH);
}

/**
 * The largest allowed zoom at which the whole field still fits across the screen.
 *
 * Starting zoomed in on a corner makes the game look broken, so the opening view shows the
 * whole airfield and lets the player zoom in from there.
 */
export function fitScale(map: LevelMap, viewW: number, viewH: number, dpr: number): number {
  const world = worldSize(map);
  const fit = Math.min(viewW / world.width, viewH / world.height);
  // Floored, not rounded: rounding up would leave part of the field off screen, which is the
  // exact problem this is here to avoid.
  return clampSteps(Math.floor(fit * dpr), dpr) / dpr;
}

/**
 * Whether any part of the field is off screen at this zoom.
 *
 * This is what decides whether a one-finger drag may pan. When the whole field already fits,
 * a pan can only shove it away from centre and leave it there — there is nothing beyond the
 * edge to uncover — and on a phone that reads as the map drifting for no reason. It also
 * matters beyond the gesture: any pan marks the camera as player-controlled, after which the
 * map stops re-fitting itself for the rest of the session.
 *
 * A hair of tolerance because a snapped scale times a whole-tile world rarely lands exactly
 * on the viewport size, and a sub-pixel overhang is not something a thumb can chase.
 */
export function fieldOverflows(
  map: LevelMap,
  scale: number,
  viewW: number,
  viewH: number,
): boolean {
  const world = worldSize(map);
  return world.width * scale > viewW + 0.5 || world.height * scale > viewH + 0.5;
}

/** Puts the middle of the map in the middle of the screen. */
export function centreOn(camera: Camera, map: LevelMap, viewW: number, viewH: number): void {
  const world = worldSize(map);
  camera.x = world.width / 2 - viewW / camera.scale / 2;
  camera.y = world.height / 2 - viewH / camera.scale / 2;
  clampCamera(camera, map, viewW, viewH);
}

/** Zooms about a fixed screen point, so pinching keeps the pixel under your fingers put. */
export function zoomAt(
  camera: Camera,
  screenX: number,
  screenY: number,
  nextScale: number,
  dpr: number,
): void {
  const clamped = snapScale(nextScale, dpr);
  if (clamped === camera.scale) return;

  const worldX = camera.x + screenX / camera.scale;
  const worldY = camera.y + screenY / camera.scale;
  camera.scale = clamped;
  camera.x = worldX - screenX / clamped;
  camera.y = worldY - screenY / clamped;
}

/** Screen (CSS px, canvas-relative) to tile coordinates. May be outside the map. */
export function screenToTile(camera: Camera, screenX: number, screenY: number): { x: number; y: number } {
  return {
    x: Math.floor((camera.x + screenX / camera.scale) / TILE_PX),
    y: Math.floor((camera.y + screenY / camera.scale) / TILE_PX),
  };
}
