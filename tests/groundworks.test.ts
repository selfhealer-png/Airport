import { describe, expect, it } from 'vitest';
import { terrainAllows } from '@/sim/types';

/**
 * What paying to work the ground actually buys.
 *
 * The rule these pin is the whole reason terrain is a puzzle rather than a tax: an obstacle
 * does not become grass, it becomes a specific thing that carries specific traffic.
 */

describe('what worked ground will carry', () => {
  it('lets anything onto grass', () => {
    expect(terrainAllows('grass', false, 'structure')).toBe(true);
    expect(terrainAllows('grass', false, 'taxiway')).toBe(true);
    expect(terrainAllows('grass', false, 'road')).toBe(true);
  });

  it('refuses every obstacle until the work is paid for', () => {
    for (const terrain of ['woods', 'water', 'rock'] as const) {
      expect(terrainAllows(terrain, false, 'road')).toBe(false);
      expect(terrainAllows(terrain, false, 'taxiway')).toBe(false);
      expect(terrainAllows(terrain, false, 'structure')).toBe(false);
    }
  });

  it('makes felled woods ordinary ground', () => {
    // The pressure valve. Woods are the obstacle you buy your way past outright, which is
    // what stops an obstacle map being unwinnable.
    expect(terrainAllows('woods', true, 'structure')).toBe(true);
    expect(terrainAllows('woods', true, 'taxiway')).toBe(true);
    expect(terrainAllows('woods', true, 'road')).toBe(true);
  });

  it('lets both networks cross a bridge but nothing stand on it', () => {
    // Water splits the ground you can build on, not the routes across it.
    expect(terrainAllows('water', true, 'road')).toBe(true);
    expect(terrainAllows('water', true, 'taxiway')).toBe(true);
    expect(terrainAllows('water', true, 'structure')).toBe(false);
  });

  it('lets only a road through a tunnel', () => {
    // Rock splits the airside absolutely, which is what makes it a different obstacle from
    // water rather than a dearer one: a runway and its apron can never sit on opposite sides
    // of a ridge.
    expect(terrainAllows('rock', true, 'road')).toBe(true);
    expect(terrainAllows('rock', true, 'taxiway')).toBe(false);
    expect(terrainAllows('rock', true, 'structure')).toBe(false);
  });
});
