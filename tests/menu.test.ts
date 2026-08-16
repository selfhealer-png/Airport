import { describe, expect, it } from 'vitest';
import { LEVELS } from '@/content/levels';
import { menuRows } from '@/ui/menu';

/**
 * The menu's rules, without a browser. What a row offers, and whether tapping it would throw
 * away an airport, is the sort of thing that has to be right rather than roughly right.
 */
const meadow = LEVELS[0]!.id;
const bracken = LEVELS[1]!.id;

describe('menuRows', () => {
  it('offers the first level and locks the second on a fresh install', () => {
    const rows = menuRows(LEVELS, [], null);

    expect(rows[0]).toMatchObject({ levelId: meadow, state: 'start', confirms: false });
    expect(rows[1]).toMatchObject({ levelId: bracken, state: 'locked' });
  });

  it('names the level that would unlock a locked one', () => {
    const rows = menuRows(LEVELS, [], null);
    expect(rows[1]!.unlockedBy).toBe(LEVELS[0]!.name);
  });

  it('offers to continue the level holding the game, and says which day', () => {
    const rows = menuRows(LEVELS, [], { levelId: meadow, day: 12 });

    expect(rows[0]).toMatchObject({ state: 'continue', day: 12, confirms: false });
  });

  it('opens the next level once the one before it is finished', () => {
    const rows = menuRows(LEVELS, [meadow], null);
    expect(rows[1]!.state).toBe('start');
  });

  it('offers a finished level again', () => {
    const rows = menuRows(LEVELS, [meadow], null);
    expect(rows[0]).toMatchObject({ state: 'replay', completed: true });
  });

  /**
   * In-progress beats completed. Replaying a level you have finished puts a game on it, and
   * the row has to say "continue" from then on or it would offer to throw that game away.
   */
  it('prefers continue over replay for the level holding the game', () => {
    const rows = menuRows(LEVELS, [meadow], { levelId: meadow, day: 3 });
    expect(rows[0]!.state).toBe('continue');
    expect(rows[0]!.completed).toBe(true);
  });

  /**
   * The confirmation rule: one game at a time, so anything that is not "carry on with the
   * game you have" is about to destroy it.
   */
  it('asks twice before replacing an existing game', () => {
    const rows = menuRows(LEVELS, [meadow], { levelId: meadow, day: 12 });

    expect(rows[0]!.confirms).toBe(false); // continue — nothing is lost
    expect(rows[1]!.confirms).toBe(true); // start bracken — the meadow game goes
  });

  it('does not ask when there is no game to lose', () => {
    const rows = menuRows(LEVELS, [meadow], null);
    expect(rows.every((row) => !row.confirms)).toBe(true);
  });

  it('never asks about a locked row, which cannot be played anyway', () => {
    const rows = menuRows(LEVELS, [], { levelId: meadow, day: 5 });
    expect(rows[1]!.state).toBe('locked');
    expect(rows[1]!.confirms).toBe(false);
  });
});
