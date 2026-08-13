import { bakeAtlas } from '@/sprites/atlas';
import { SPRITES, type SpriteName } from '@/sprites/data';
import { TILE_PX } from '@/sprites/palette';
import { toPixelGrid } from '@/sprites/pixels';

/**
 * A contact sheet of every sprite, for eyeballing the art without playing a day.
 *
 * Not part of the game bundle — `art-preview.html` is a dev-only entry point.
 */

const SCALE = 4;
const COLUMNS = 6;
const CELL = TILE_PX * SCALE + 24;
const ROW_LABEL = 16;

const canvas = document.querySelector<HTMLCanvasElement>('#sheet')!;
const atlas = bakeAtlas();
const names = Object.keys(SPRITES) as SpriteName[];

const tallest = Math.max(...names.map((n) => toPixelGrid(SPRITES[n]).height));
const rowHeight = tallest * SCALE + ROW_LABEL + 16;
const rows = Math.ceil(names.length / COLUMNS);

canvas.width = COLUMNS * CELL;
canvas.height = rows * rowHeight + 120;
canvas.style.width = `${canvas.width}px`;

const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;
ctx.fillStyle = '#1b2a33';
ctx.fillRect(0, 0, canvas.width, canvas.height);

names.forEach((name, index) => {
  const col = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const grid = toPixelGrid(SPRITES[name]);
  const x = col * CELL + 12;
  const y = row * rowHeight + 12;

  ctx.fillStyle = '#12202a';
  ctx.fillRect(x - 4, y - 4, TILE_PX * SCALE + 8, grid.height * SCALE + 8);
  ctx.drawImage(atlas.get(name), x, y, grid.width * SCALE, grid.height * SCALE);

  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = '#9fb3c0';
  ctx.font = '11px system-ui';
  ctx.fillText(name, x - 4, y + grid.height * SCALE + 16);
  ctx.imageSmoothingEnabled = false;
});

// Every quarter turn of one aircraft, to prove rotation stays on the pixel grid.
const baseY = rows * rowHeight + 24;
ctx.imageSmoothingEnabled = true;
ctx.fillStyle = '#9fb3c0';
ctx.fillText('plane.narrowbody at each quarter turn', 12, baseY - 6);
ctx.imageSmoothingEnabled = false;

for (let quarter = 0; quarter < 4; quarter++) {
  const image = atlas.get('plane.narrowbody');
  const w = TILE_PX * SCALE;
  const h = TILE_PX * 2 * SCALE;
  const cx = 12 + quarter * (h + 20) + h / 2;
  const cy = baseY + h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((quarter * Math.PI) / 2);
  ctx.drawImage(image, -w / 2, -h / 2, w, h);
  ctx.restore();
}
