import { restoreInto, toSnapshot, type Snapshot } from './snapshot';
import type { GameState } from '@/sim/types';

/**
 * Undo for the planning phase.
 *
 * A stray tap on a phone builds something, and until now the only way back was to demolish
 * it at a 40% loss — a punishment for a slip of the thumb rather than for a decision. Undo
 * restores the money as well as the tile, because the refund was never the point.
 *
 * Implemented as whole-state snapshots rather than as inverse operations. A build is not
 * always one tile — a runway drag, a resurface, a demolition that removes an entire strip —
 * and every one of those would need its own hand-written inverse to get right. Snapshots are
 * already built, already validated and already tested for the save system, so undo reuses
 * them and cannot disagree with what a reload would restore.
 */
export interface History {
  readonly canUndo: boolean;
  /** Remembers a state to come back to. Take this *before* the change is applied. */
  push(snapshot: Snapshot): void;
  /** Restores the most recent snapshot into `state`. False if there was nothing to undo. */
  undo(state: GameState): boolean;
  clear(): void;
}

/** Convenience for callers: capture now, push only if the change actually happened. */
export const capture = toSnapshot;

export function createHistory(limit = 40): History {
  const stack: Snapshot[] = [];

  return {
    get canUndo() {
      return stack.length > 0;
    },
    push(snapshot) {
      stack.push(snapshot);
      // Bounded so a long planning session cannot grow without limit on a phone.
      if (stack.length > limit) stack.shift();
    },
    undo(state) {
      const previous = stack.pop();
      if (!previous) return false;
      return restoreInto(state, previous);
    },
    clear() {
      stack.length = 0;
    },
  };
}
