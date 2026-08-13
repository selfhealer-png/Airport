import { SPRITES, type SpriteName } from './data';
import { toPixelGrid } from './pixels';

/**
 * Bakes the authored sprite data into canvases once at startup.
 *
 * Everything that draws goes through this interface, so swapping code-defined pixel art
 * for real PNG sprite sheets later means replacing this file and nothing else.
 */
export interface SpriteAtlas {
  get(name: SpriteName): CanvasImageSource;
}

export function bakeAtlas(): SpriteAtlas {
  const baked = new Map<SpriteName, CanvasImageSource>();

  for (const name of Object.keys(SPRITES) as SpriteName[]) {
    const grid = toPixelGrid(SPRITES[name]);
    const canvas = document.createElement('canvas');
    canvas.width = grid.width;
    canvas.height = grid.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get a 2D context to bake sprites into.');
    ctx.putImageData(new ImageData(grid.rgba, grid.width, grid.height), 0, 0);
    baked.set(name, canvas);
  }

  return {
    get(name) {
      const image = baked.get(name);
      if (!image) throw new Error(`No sprite named '${name}'.`);
      return image;
    },
  };
}
