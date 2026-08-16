import { isUnlocked } from '@/save/progress';
import type { LevelMap } from '@/sim/types';

/**
 * The level menu.
 *
 * What each row offers is a pure function of the levels, what has been finished and what game
 * exists — kept out of the DOM so the campaign's rules can be tested headlessly, the same way
 * `ui/placement.ts` keeps drag behaviour testable.
 */

export type MenuRowState = 'locked' | 'start' | 'continue' | 'replay';

export interface CurrentGame {
  readonly levelId: string;
  readonly day: number;
}

export interface MenuRow {
  readonly levelId: string;
  readonly name: string;
  readonly state: MenuRowState;
  /** Whether this level has ever been finished. Independent of `state`. */
  readonly completed: boolean;
  /**
   * Whether tapping this row would destroy the game in progress, and must therefore ask
   * twice. There is one game at a time, so anything but carrying on the current one does.
   */
  readonly confirms: boolean;
  /** The day the in-progress game is on. Present only when `state` is `'continue'`. */
  readonly day?: number;
  /** The level that would unlock this one. Present only when `state` is `'locked'`. */
  readonly unlockedBy?: string;
}

export function menuRows(
  levels: readonly LevelMap[],
  completed: readonly string[],
  current: CurrentGame | null,
): MenuRow[] {
  return levels.map((level, index) => {
    const isCompleted = completed.includes(level.id);
    const holdsGame = current?.levelId === level.id;

    if (!isUnlocked(level.id, completed)) {
      // `exactOptionalPropertyTypes` is on, so an absent field is omitted, never undefined.
      const previous = levels[index - 1];
      return {
        levelId: level.id,
        name: level.name,
        state: 'locked' as const,
        completed: isCompleted,
        confirms: false,
        ...(previous ? { unlockedBy: previous.name } : {}),
      };
    }

    if (holdsGame && current) {
      // In-progress beats completed: offering "play again" here would discard the game.
      return {
        levelId: level.id,
        name: level.name,
        state: 'continue' as const,
        completed: isCompleted,
        confirms: false,
        day: current.day,
      };
    }

    return {
      levelId: level.id,
      name: level.name,
      state: isCompleted ? ('replay' as const) : ('start' as const),
      completed: isCompleted,
      confirms: current !== null,
    };
  });
}
