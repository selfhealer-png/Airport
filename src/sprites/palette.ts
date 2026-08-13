/**
 * The whole game draws from this one palette.
 *
 * Sprites are stored as strings of palette keys (see `sprites/atlas.ts`), so a colour is
 * changed in exactly one place and every sprite follows. Key `.` is reserved for
 * transparency and must never appear here.
 */
export const PALETTE = {
  // Ground
  g: '#4a7a3c', // grass
  G: '#3d6631', // grass, shaded
  h: '#5d8f4a', // grass, highlight
  M: '#86a355', // mown grass strip
  N: '#74904a', // mown grass strip, stripe
  d: '#8a7350', // dirt / gravel
  D: '#6f5c40', // dirt, shaded
  a: '#4a4f55', // asphalt
  A: '#3a3e43', // asphalt, shaded
  m: '#d8d4c8', // runway markings
  w: '#2f5f7a', // water
  W: '#24485d', // water, deep
  r: '#6b6b6b', // rock
  R: '#525252', // rock, shaded
  f: '#2f5a2a', // foliage, shaded
  F: '#3f7434', // foliage
  T: '#5a4530', // tree trunk
  z: '#6f9448', // wildflower clump in the grass

  // Structures
  c: '#c2c7cc', // concrete / building light
  C: '#8f979e', // concrete shaded
  s: '#2b3940', // structure dark
  y: '#e8b44a', // hazard yellow / lights
  o: '#e07a3c', // orange accent
  q: '#7ec8e3', // glass
  Q: '#4a8ba6', // glass, shaded
  L: '#fff3c4', // lit window / landing light

  // Aircraft
  p: '#f2f2f0', // fuselage white
  P: '#c9c9c6', // fuselage shaded
  b: '#2d5f8f', // livery blue
  B: '#1e4569', // livery blue dark
  e: '#3a3a3a', // engine / tyre
  E: '#57595c', // engine highlight
  i: '#b9bec4', // propeller blur
  j: '#b8402f', // livery red
  x: '#6e7a5c', // military drab
  X: '#525c44', // military drab, shaded
  k: '#1a1a1a', // outline

  // UI / effects
  n: '#e8503a', // warning red
  t: '#4ec97a', // ok green
  u: '#1b2a33', // UI background
  v: '#eef2f5', // UI foreground
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Reserved in sprite strings to mean "leave this pixel transparent". */
export const TRANSPARENT = '.';

/** Sprite pixel grid size. One tile of the world map is exactly this many pixels. */
export const TILE_PX = 16;
