import { bakeAtlas } from '@/sprites/atlas';
import { TILE_PX } from '@/sprites/palette';
import { Renderer } from '@/render/renderer';
import { createCamera, centreOn, fitScale } from '@/render/camera';
import { addHelipad, addRoadRun, addRunway, addStand, addTaxiwayRun, createGame } from '@/sim/airport';
import { LEVELS } from '@/content/levels';
import type { GameState, LevelMap } from '@/sim/types';

/**
 * Every level, drawn at the zoom a phone would actually pick, with a full airport on it.
 *
 * A dev-only entry point like `art-preview.html`, for the two questions a number cannot
 * answer: does this map still leave room to build once its terrain has taken a share, and are
 * the sprites legible at the zoom it lands on? Frames are 390x606 — the map area on an
 * iPhone 14 with the current chrome — and the caption reports the chosen zoom and tile size.
 *
 * Open it after adding a level or changing the field size. Vite only builds `index.html`, so
 * this never ships.
 */

const FRAME_W = 390;
const FRAME_H = 606;
const DPR = 3;

/**
 * The same airport on both fields: two runways either side of an apron, the roads that make
 * them legal, and the buildings. Sized from the auto-player's own layout, which is roughly
 * what a real airport occupies by day 50.
 */
function buildAirport(state: GameState): void {
  const a = state.airport;
  addRoadRun(a, 0, 0, 17, 0);

  addRunway(a, 5, 8, 23, 'asphalt');
  addRoadRun(a, 4, 0, 4, 24);
  addRunway(a, 13, 8, 23, 'asphalt');
  addRoadRun(a, 14, 0, 14, 24);
  addRunway(a, 1, 8, 22, 'asphalt', 'military');
  addRoadRun(a, 0, 0, 0, 23);
  addStand(a, 3, 14, 'large');
  addTaxiwayRun(a, 2, 14, 2, 14);

  addRoadRun(a, 9, 0, 9, 28);
  for (const row of [10, 13, 16, 19, 22, 25, 28]) {
    addStand(a, 8, row, 'large');
    addStand(a, 10, row, 'large');
    addTaxiwayRun(a, 6, 8, 6, row);
    addTaxiwayRun(a, 6, row, 7, row);
    addTaxiwayRun(a, 12, 8, 12, row);
    addTaxiwayRun(a, 11, row, 12, row);
  }

  addRoadRun(a, 17, 0, 17, 26);
  a.facilities.push(
    { id: 'f1', type: 'tower', x: 16, y: 4, level: 3 },
    { id: 'f2', type: 'terminal', x: 16, y: 8, level: 4 },
    { id: 'f3', type: 'shop', x: 16, y: 7, level: 0 },
    { id: 'f4', type: 'fuel-farm', x: 16, y: 20, level: 0 },
    { id: 'f5', type: 'fire-station', x: 16, y: 24, level: 0 },
  );
  for (const row of [6, 8, 10, 12]) addHelipad(a, 18, row);
}

function frame(parent: HTMLElement, label: string, note: string, map: LevelMap): void {
  const figure = document.createElement('figure');
  const holder = document.createElement('div');
  holder.className = 'frame';
  const canvas = document.createElement('canvas');
  canvas.style.width = `${FRAME_W}px`;
  canvas.style.height = `${FRAME_H}px`;
  holder.append(canvas);
  figure.append(holder);
  // Appended before rendering: `Renderer.resize()` measures the element, and refuses a
  // zero-size measurement — which is exactly what an unattached canvas reports.
  parent.append(figure);

  const state = createGame(map, 42);
  buildAirport(state);

  const renderer = new Renderer(canvas, bakeAtlas());
  renderer.resize();
  const camera = createCamera();
  // The zoom a 3x phone would choose, so the apparent size is what you would actually see.
  camera.scale = fitScale(map, FRAME_W, FRAME_H, DPR);
  centreOn(camera, map, FRAME_W, FRAME_H);
  renderer.draw(state, camera);

  const caption = document.createElement('figcaption');
  const strong = document.createElement('strong');
  strong.textContent = label;
  const span = document.createElement('span');
  span.className = 'muted';
  span.textContent =
    `${note}  ·  zoom ${camera.scale.toFixed(3)}  ·  ${(TILE_PX * camera.scale).toFixed(1)}px per tile`;
  caption.append(strong, span);

  figure.append(caption);
}

const sheet = document.querySelector<HTMLElement>('#sheet')!;
for (const level of LEVELS) {
  const buildable = level.terrain.filter((t) => t === 'grass').length;
  const total = level.width * level.height;
  frame(
    sheet,
    `${level.name} — ${level.width} x ${level.height}`,
    `${buildable} of ${total} tiles buildable (${Math.round((buildable / total) * 100)}%).`,
    level,
  );
}
