import { TILE_PX, PALETTE } from '@/sprites/palette';
import type { SpriteAtlas } from '@/sprites/atlas';
import type { SpriteName } from '@/sprites/data';
import type { Airport, GameState, Runway, Terrain, TileIndex } from '@/sim/types';
import { aircraftViews } from './aircraft';
import { clampCamera, deviceRatio, type Camera } from './camera';

/** Deterministic per-tile variation, so the grass has texture without storing a variant map. */
function tileHash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

const GRASS_VARIANTS = ['terrain.grass.a', 'terrain.grass.b', 'terrain.grass.c'] as const;

function terrainSprite(terrain: Terrain, x: number, y: number): SpriteName {
  switch (terrain) {
    case 'water':
      return 'terrain.water';
    case 'rock':
      return 'terrain.rock';
    case 'woods':
      return 'terrain.woods';
    case 'grass': {
      // Wildflowers are rare on purpose. At one tile in five they tile into a speckle that
      // reads as screen noise rather than as a field; at one in seventeen they read as the
      // occasional patch the eye was meant to find.
      const h = tileHash(x, y);
      return GRASS_VARIANTS[h % 17 === 0 ? 2 : h % 3 === 0 ? 1 : 0]!;
    }
  }
}

function surfaceSprite(runway: Runway): SpriteName {
  switch (runway.surface) {
    case 'grass':
      return 'surface.grass';
    case 'gravel':
      return 'surface.gravel';
    case 'asphalt':
      return 'surface.asphalt';
  }
}

/** A build being dragged out but not yet committed. */
export interface BuildPreview {
  readonly tiles: readonly TileIndex[];
  readonly valid: boolean;
  /**
   * The crosshair, in CSS pixels relative to the canvas. Absent when no finger is down.
   *
   * Drawn where the game is *aiming*, which is above the fingertip rather than under it. Two
   * cues together: the tiles snap, so you can count them, and the crosshair moves
   * continuously, so you can steer. Neither alone is enough on a phone — snapped-only feels
   * unresponsive, continuous-only leaves you guessing which tile you are on.
   */
  readonly aim?: { readonly x: number; readonly y: number };
}

export interface Viewport {
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  dpr: number;
}

/** Where a vehicle can drive: roads, and whatever a road is meant to serve. */
function isDrivableAt(airport: Airport, x: number, y: number): boolean {
  const { map } = airport;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  if (airport.roads[y * map.width + x] === 1) return true;
  if (airport.facilities.some((f) => f.x === x && f.y === y)) return true;
  if (airport.stands.some((s) => s.x === x && s.y === y)) return true;
  // A pad is landside as well as airside: the passengers and the fire cover arrive by road.
  if (airport.helipads.some((p) => p.x === x && p.y === y)) return true;
  return false;
}

/** Where an aircraft can taxi, for deciding which way a guide line should run. */
function isPavedAt(airport: Airport, x: number, y: number): boolean {
  const { map } = airport;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  if (airport.taxiways[y * map.width + x] === 1) return true;
  if (airport.stands.some((s) => s.x === x && s.y === y)) return true;
  return airport.runways.some((r) => r.x === x && y >= r.y0 && y <= r.y1);
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  readonly viewport: Viewport = { width: 0, height: 0, dpr: 1 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly atlas: SpriteAtlas,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not get a 2D context for the map canvas.');
    this.ctx = ctx;
  }

  /**
   * Sizes the backing store to the device pixel ratio so sprites land on whole device
   * pixels. Called on load, on resize and on orientation change.
   */
  resize(): boolean {
    const rect = this.canvas.getBoundingClientRect();
    // Styles arrive asynchronously in dev, so the first measurement can land before layout.
    // Refusing a zero-size measurement keeps a bogus viewport out of the camera maths.
    if (rect.width < 1 || rect.height < 1) return false;

    const dpr = deviceRatio();
    this.viewport.width = rect.width;
    this.viewport.height = rect.height;
    this.viewport.dpr = dpr;

    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    return true;
  }

  draw(state: GameState, camera: Camera, preview?: BuildPreview): void {
    const { ctx } = this;
    const { width, height, dpr } = this.viewport;
    const airport = state.airport;
    const { map } = airport;

    clampCamera(camera, map, width, height);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = PALETTE.u;
    ctx.fillRect(0, 0, width, height);

    const scale = camera.scale;
    const tileScreen = TILE_PX * scale;

    // Only touch tiles that can actually be seen.
    const firstX = Math.max(0, Math.floor(camera.x / TILE_PX));
    const firstY = Math.max(0, Math.floor(camera.y / TILE_PX));
    const lastX = Math.min(map.width - 1, Math.floor((camera.x + width / scale) / TILE_PX));
    const lastY = Math.min(map.height - 1, Math.floor((camera.y + height / scale) / TILE_PX));

    /*
     * Snapped to whole *device* pixels rather than whole CSS pixels. Zoom can legitimately
     * be a fraction of a CSS pixel per sprite pixel (1/3 on a 3x phone is still exactly one
     * device pixel), and rounding to CSS pixels there would reintroduce the smearing the
     * integer-scale rule existed to prevent.
     */
    const toDevice = (value: number): number => Math.round(value * dpr) / dpr;
    const screenX = (tx: number): number => toDevice((tx * TILE_PX - camera.x) * scale);
    const screenY = (ty: number): number => toDevice((ty * TILE_PX - camera.y) * scale);

    /*
     * A tile is drawn from its own snapped edge to its *neighbour's* snapped edge, rather
     * than at a fixed width.
     *
     * At a fractional zoom a tile is not a whole number of CSS pixels — 10.67 at 2/3 on a 3x
     * screen — so snapping each tile's origin independently while drawing them all the same
     * width leaves sub-pixel gaps wherever the rounding happens to fall. Those gaps show up
     * as seams ruled down the map. Deriving the width from the next edge makes adjacent tiles
     * share an edge exactly, whatever the zoom.
     */
    const put = (sprite: SpriteName, tx: number, ty: number): void => {
      const left = screenX(tx);
      const top = screenY(ty);
      ctx.drawImage(
        this.atlas.get(sprite),
        left,
        top,
        screenX(tx + 1) - left,
        screenY(ty + 1) - top,
      );
    };

    const onScreen = (tx: number, ty: number): boolean =>
      tx >= firstX && tx <= lastX && ty >= firstY && ty <= lastY;

    // 1. Terrain.
    for (let ty = firstY; ty <= lastY; ty++) {
      for (let tx = firstX; tx <= lastX; tx++) {
        const terrain = map.terrain[ty * map.width + tx];
        if (terrain === undefined) continue;
        put(terrainSprite(terrain, tx, ty), tx, ty);
      }
    }

    // 2. Roads, then taxiways over them — a crossing should read as the aeroplane having
    //    priority, which is also how it works on a real airfield.
    for (let ty = firstY; ty <= lastY; ty++) {
      for (let tx = firstX; tx <= lastX; tx++) {
        if (airport.roads[ty * map.width + tx] === 1) put('road', tx, ty);
      }
    }
    this.drawLines(airport, 'roads', PALETTE.m, 1, firstX, firstY, lastX, lastY, scale, screenX, screenY);

    for (let ty = firstY; ty <= lastY; ty++) {
      for (let tx = firstX; tx <= lastX; tx++) {
        if (airport.taxiways[ty * map.width + tx] === 1) put('taxiway', tx, ty);
      }
    }
    this.drawLines(airport, 'taxiways', PALETTE.y, 2, firstX, firstY, lastX, lastY, scale, screenX, screenY);

    // 3. Runways: surface first, then markings over it.
    for (const runway of airport.runways) {
      if (runway.x < firstX || runway.x > lastX) continue;
      const surface = surfaceSprite(runway);
      for (let ty = Math.max(firstY, runway.y0); ty <= Math.min(lastY, runway.y1); ty++) {
        put(surface, runway.x, ty);
        const isThreshold = ty === runway.y0 || ty === runway.y1;
        const military = runway.use === 'military';
        put(
          isThreshold
            ? military
              ? 'runway.threshold.military'
              : 'runway.threshold'
            : military
              ? 'runway.centreline.military'
              : 'runway.centreline',
          runway.x,
          ty,
        );
      }
      if (runway.closed) this.tint(runway, screenX, screenY);
    }

    // 4. Stands and helipads, then facilities on top.
    for (const stand of airport.stands) {
      if (!onScreen(stand.x, stand.y)) continue;
      put(`stand.${stand.size}`, stand.x, stand.y);
    }
    for (const pad of airport.helipads) {
      if (!onScreen(pad.x, pad.y)) continue;
      put('helipad', pad.x, pad.y);
    }
    for (const facility of airport.facilities) {
      if (!onScreen(facility.x, facility.y)) continue;
      put(`facility.${facility.type}`, facility.x, facility.y);
    }

    // 5. Aircraft, above everything on the ground.
    if (state.current) this.drawAircraft(state, camera, tileScreen, dpr);

    // 6. The build being dragged out, tinted by whether it is legal.
    if (preview) {
      const tint = preview.valid ? PALETTE.t : PALETTE.n;

      ctx.globalAlpha = 0.45;
      ctx.fillStyle = tint;
      for (const tile of preview.tiles) {
        const left = screenX(tile.x);
        const top = screenY(tile.y);
        ctx.fillRect(left, top, screenX(tile.x + 1) - left, screenY(tile.y + 1) - top);
      }

      /*
       * Outlined as well as filled. A flat 45%-alpha green over grass is nearly invisible on a
       * phone in daylight, and the outline is also what makes the tile *count* readable —
       * which is the thing you are actually judging when extending a runway to reach a class.
       */
      ctx.globalAlpha = 1;
      ctx.strokeStyle = tint;
      ctx.lineWidth = 2 / dpr;
      for (const tile of preview.tiles) {
        const left = screenX(tile.x);
        const top = screenY(tile.y);
        ctx.strokeRect(
          left + ctx.lineWidth / 2,
          top + ctx.lineWidth / 2,
          screenX(tile.x + 1) - left - ctx.lineWidth,
          screenY(tile.y + 1) - top - ctx.lineWidth,
        );
      }

      /*
       * The crosshair, last and unsnapped, so it tracks the finger smoothly while the tiles
       * beneath it snap. Deliberately in screen space: it marks where you are aiming, not a
       * position on the map.
       */
      if (preview.aim) {
        const { x, y } = preview.aim;
        const arm = 9;
        ctx.strokeStyle = PALETTE.v;
        ctx.lineWidth = 2 / dpr;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.moveTo(x - arm, y);
        ctx.lineTo(x - 3, y);
        ctx.moveTo(x + 3, y);
        ctx.lineTo(x + arm, y);
        ctx.moveTo(x, y - arm);
        ctx.lineTo(x, y - 3);
        ctx.moveTo(x, y + 3);
        ctx.lineTo(x, y + arm);
        ctx.stroke();
      }
    }
  }

  /**
   * Yellow taxi guidance, drawn from each tile's centre towards whichever neighbours an
   * aeroplane could actually roll onto.
   *
   * Deriving it beats authoring a sprite per arrangement: sixteen combinations of straight,
   * corner, tee and crossroads would be sixteen grids to keep in step, and the same routine
   * serves any future surface that has to join up tile to tile.
   */
  private drawLines(
    airport: Airport,
    layer: 'taxiways' | 'roads',
    colour: string,
    weight: number,
    firstX: number,
    firstY: number,
    lastX: number,
    lastY: number,
    scale: number,
    screenX: (tx: number) => number,
    screenY: (ty: number) => number,
  ): void {
    const { ctx } = this;
    const { map } = airport;
    const half = (TILE_PX * scale) / 2;
    const mask = airport[layer];

    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(1, Math.round(weight * scale));
    ctx.lineCap = 'butt';

    for (let ty = firstY; ty <= lastY; ty++) {
      for (let tx = firstX; tx <= lastX; tx++) {
        if (mask[ty * map.width + tx] !== 1) continue;

        const cx = screenX(tx) + half;
        const cy = screenY(ty) + half;
        const sides: ReadonlyArray<readonly [number, number]> = [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ];

        let drew = false;
        for (const [dx, dy] of sides) {
          const connects =
            layer === 'taxiways'
              ? isPavedAt(airport, tx + dx, ty + dy)
              : isDrivableAt(airport, tx + dx, ty + dy);
          if (!connects) continue;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + dx * half, cy + dy * half);
          ctx.stroke();
          drew = true;
        }

        // A stub joined to nothing still gets a mark, so it does not look like plain surface
        // the player forgot to build on.
        if (!drew) {
          ctx.fillStyle = colour;
          ctx.fillRect(cx - ctx.lineWidth, cy - ctx.lineWidth, ctx.lineWidth * 2, ctx.lineWidth * 2);
        }
      }
    }
  }

  /** Aircraft, their shadows and their tyre smoke. */
  private drawAircraft(
    state: GameState,
    camera: Camera,
    tileScreen: number,
    dpr: number,
  ): void {
    const { ctx } = this;
    const day = state.current;
    if (!day) return;

    const scale = camera.scale;
    const toDevice = (value: number): number => Math.round(value * dpr) / dpr;

    for (const view of aircraftViews(state.airport, day)) {
      const sx = toDevice((view.x - camera.x) * scale);
      const sy = toDevice((view.y - camera.y) * scale);
      const w = tileScreen;
      const h = tileScreen * view.lengthTiles;
      const image = this.atlas.get(view.sprite);

      // Tyre smoke sits under the aeroplane, so the puff reads as coming off the wheels.
      if (view.touchdown > 0) {
        ctx.globalAlpha = 0.5 * view.touchdown;
        ctx.fillStyle = PALETTE.c;
        for (let i = 0; i < 3; i++) {
          const spread = (1 - view.touchdown) * tileScreen * 0.8;
          ctx.beginPath();
          ctx.arc(sx + (i - 1) * spread * 0.6, sy + h * 0.3, tileScreen * 0.18, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // The shadow slides further from the aeroplane the higher it is, which is the only
      // thing separating an aircraft on final from one taxiing over the same tile.
      if (view.altitude > 0.02) {
        const offset = view.altitude * tileScreen * 0.9;
        const turned = view.rotation % 2 === 1;
        ctx.globalAlpha = 0.28 * (1 - view.altitude * 0.5);
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.ellipse(
          sx + offset,
          sy + offset,
          (turned ? h : w) * 0.34,
          (turned ? w : h) * 0.34,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (view.fuelFraction !== null && view.fuelFraction < 0.35) {
        // A ring that tightens and reddens as fuel runs down, so the aeroplane about to
        // divert is the one that catches the eye.
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(w, h) / 2 + 3, 0, Math.PI * 2);
        ctx.strokeStyle = view.fuelFraction < 0.15 ? PALETTE.n : PALETTE.y;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (view.rotation === 0) {
        ctx.drawImage(image, sx - w / 2, sy - h / 2, w, h);
      } else {
        // Quarter turns only, so the pixel grid survives the rotation intact.
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate((view.rotation * Math.PI) / 2);
        ctx.drawImage(image, -w / 2, -h / 2, w, h);
        ctx.restore();
      }
    }
  }

  /** Marks a runway closed by a crash. */
  private tint(
    runway: Runway,
    screenX: (tx: number) => number,
    screenY: (ty: number) => number,
  ): void {
    const { ctx } = this;
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = PALETTE.n;
    ctx.fillRect(
      screenX(runway.x),
      screenY(runway.y0),
      screenX(runway.x + 1) - screenX(runway.x),
      screenY(runway.y1 + 1) - screenY(runway.y0),
    );
    ctx.globalAlpha = 1;
  }
}
