import type { GameState } from '@/sim/types';
import { fromSnapshot, toSnapshot } from './snapshot';

/**
 * The localStorage side of saving. Everything here is best-effort: a phone in private
 * browsing, a full quota or a user who has blocked storage must degrade to "the game still
 * plays, it just does not remember", never to a crash.
 */

const KEY = 'airfield.save.v1';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Access itself throws when storage is blocked by policy.
    return null;
  }
}

export function saveGame(state: GameState): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(toSnapshot(state)));
  } catch {
    // Quota exceeded or storage disabled — losing the save is survivable, crashing is not.
  }
}

export function loadGame(): GameState | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    return fromSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearGame(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEY);
  } catch {
    // Nothing useful to do.
  }
}

export function hasSave(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    return store.getItem(KEY) !== null;
  } catch {
    return false;
  }
}
