import { describe, expect, it } from 'vitest';
import { LEVELS } from '@/content/levels';
import { addCompleted, everyLevelId, isUnlocked, parseProgress } from '@/save/progress';

/**
 * Which levels are open.
 *
 * Kept apart from the game snapshot on purpose: there is one game at a time, so starting
 * another level replaces the airport you had, and that must never cost a level already
 * earned. Only the pure half is tested here — the `localStorage` wrappers are as thin as
 * `save/storage.ts`, and untested for the same reason.
 */
describe('the unlock chain', () => {
  it('always opens the first level', () => {
    expect(isUnlocked(LEVELS[0]!.id, [])).toBe(true);
  });

  it('keeps the second shut until the first is finished', () => {
    expect(isUnlocked(LEVELS[1]!.id, [])).toBe(false);
    expect(isUnlocked(LEVELS[1]!.id, [LEVELS[0]!.id])).toBe(true);
  });

  it('opens a level only on the one immediately before it', () => {
    // Finishing a level cannot open one further down the chain than the next.
    expect(isUnlocked(LEVELS[1]!.id, [LEVELS[1]!.id])).toBe(false);
  });

  it('treats an unknown level as shut rather than throwing', () => {
    expect(isUnlocked('no-such-level', [])).toBe(false);
  });
});

describe('recording a finished level', () => {
  it('adds a level that is not there', () => {
    expect(addCompleted([], 'meadow')).toEqual(['meadow']);
  });

  /**
   * The campaign carries on as a sandbox past day 50, so completion is recorded again on
   * every day after it. Recording has to be idempotent or the list grows without bound.
   */
  it('records a level once however often it is finished', () => {
    expect(addCompleted(['meadow'], 'meadow')).toEqual(['meadow']);
  });

  it('leaves the original alone', () => {
    const before = ['meadow'];
    addCompleted(before, 'bracken-rise');
    expect(before).toEqual(['meadow']);
  });
});

describe('reading a stored record', () => {
  it('reads a record it wrote', () => {
    expect(parseProgress({ version: 1, completed: ['meadow'] })).toEqual(['meadow']);
  });

  it('ignores a record from a version it does not know', () => {
    expect(parseProgress({ version: 99, completed: ['meadow'] })).toEqual([]);
  });

  it('ignores rubbish rather than throwing', () => {
    for (const value of [null, undefined, 42, 'nope', [], {}, { version: 1 }]) {
      expect(parseProgress(value)).toEqual([]);
    }
  });

  it('drops entries that are not level ids', () => {
    expect(parseProgress({ version: 1, completed: ['meadow', 7, null] })).toEqual(['meadow']);
  });
});

/**
 * Reaching a later level means finishing the one before it, which is right for a player and
 * useless for testing the map you just drew.
 */
describe('unlocking everything for testing', () => {
  it('names every level, so nothing is left locked', () => {
    expect(everyLevelId()).toEqual(LEVELS.map((level) => level.id));
  });

  it('satisfies the unlock chain for every level', () => {
    const all = everyLevelId();
    for (const level of LEVELS) {
      expect(isUnlocked(level.id, all)).toBe(true);
    }
  });
});
