import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { blankGrid, fillRect, scaleGrid, type PixelGrid } from '@/sprites/pixels';
import { encodePng } from './png';

/**
 * Generates the PWA icons from the game's own palette, so the home-screen icon can never
 * drift away from how the game actually looks. Run via `npm run icons`.
 */

/** A grass field with a marked runway down the middle, drawn at `size` px square. */
function airfieldIcon(size: number, inset: number): PixelGrid {
  const grid = blankGrid(size, size);
  fillRect(grid, 0, 0, size, size, 'g');

  // Scattered tufts, deterministic so regenerating produces byte-identical icons.
  for (let i = 0; i < size * 2; i++) {
    const x = (i * 7 + 3) % size;
    const y = (i * 11 + 5) % size;
    fillRect(grid, x, y, 1, 1, i % 2 === 0 ? 'h' : 'G');
  }

  const runwayWidth = Math.max(4, Math.round(size / 4));
  const runwayX = Math.round((size - runwayWidth) / 2);
  const runwayY = inset;
  const runwayHeight = size - inset * 2;
  fillRect(grid, runwayX, runwayY, runwayWidth, runwayHeight, 'a');
  fillRect(grid, runwayX, runwayY, 1, runwayHeight, 'A');
  fillRect(grid, runwayX + runwayWidth - 1, runwayY, 1, runwayHeight, 'A');

  // Threshold bars at each end.
  const barLength = Math.max(2, Math.round(size / 12));
  for (let bx = runwayX + 1; bx < runwayX + runwayWidth - 1; bx += 2) {
    fillRect(grid, bx, runwayY + 1, 1, barLength, 'm');
    fillRect(grid, bx, runwayY + runwayHeight - 1 - barLength, 1, barLength, 'm');
  }

  // Dashed centreline between the thresholds.
  const centreX = runwayX + Math.floor(runwayWidth / 2);
  const dash = Math.max(2, Math.round(size / 16));
  for (let y = runwayY + barLength + 3; y < runwayY + runwayHeight - barLength - 3; y += dash * 2) {
    fillRect(grid, centreX, y, 1, dash, 'm');
  }

  return grid;
}

const outDir = resolve(import.meta.dirname, '../public');
mkdirSync(outDir, { recursive: true });

const targets: ReadonlyArray<{ file: string; source: PixelGrid; scale: number }> = [
  { file: 'favicon.png', source: airfieldIcon(32, 1), scale: 1 },
  { file: 'icon-192.png', source: airfieldIcon(32, 1), scale: 6 },
  { file: 'icon-512.png', source: airfieldIcon(64, 2), scale: 8 },
  // Maskable icons get cropped to a circle by some launchers, so keep content well inside.
  { file: 'icon-maskable-512.png', source: airfieldIcon(64, 12), scale: 8 },
];

for (const { file, source, scale } of targets) {
  const grid = scale === 1 ? source : scaleGrid(source, scale);
  writeFileSync(resolve(outDir, file), encodePng(grid));
  console.log(`wrote public/${file} (${grid.width}x${grid.height})`);
}
