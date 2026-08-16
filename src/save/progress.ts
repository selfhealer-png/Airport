import { LEVELS } from '@/content/levels';

/**
 * Which levels the player has finished.
 *
 * Deliberately not part of the game snapshot. There is one game at a time, so choosing
 * another level replaces the airport you had — and that must never take a level you have
 * already earned with it. Separate key, separate lifetime.
 *
 * Split the way `save/` already splits: everything above `storage()` is pure and tested, and
 * the three wrappers below it are as thin as `save/storage.ts` and swallow every error.
 * Blocked storage or a full quota must degrade to "the game forgets", never to a crash.
 */

const KEY = 'airfield.progress.v1';
const PROGRESS_VERSION = 1;

/** Validates a stored record. Anything it does not trust reads as "nothing finished yet". */
export function parseProgress(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const data = raw as { version?: unknown; completed?: unknown };
  if (data.version !== PROGRESS_VERSION) return [];
  if (!Array.isArray(data.completed)) return [];
  return data.completed.filter((id): id is string => typeof id === 'string');
}

/**
 * Adds a finished level, once.
 *
 * The campaign carries on as a sandbox past day 50, so this is called again on every day
 * after it — de-duplicating here rather than at the call site keeps that harmless.
 */
export function addCompleted(completed: readonly string[], levelId: string): string[] {
  return completed.includes(levelId) ? [...completed] : [...completed, levelId];
}

/**
 * Whether a level can be played, given what has been finished.
 *
 * A linear chain over `LEVELS` order: the first is always open, and each later one opens when
 * the level immediately before it has been completed. Pure, so the campaign's shape is tested
 * without a browser.
 */
export function isUnlocked(levelId: string, completed: readonly string[]): boolean {
  const index = LEVELS.findIndex((level) => level.id === levelId);
  if (index < 0) return false;
  if (index === 0) return true;
  return completed.includes(LEVELS[index - 1]!.id);
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Access itself throws when storage is blocked by policy.
    return null;
  }
}

export function loadProgress(): string[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    return raw ? parseProgress(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function markCompleted(levelId: string): void {
  const store = storage();
  if (!store) return;
  try {
    const completed = addCompleted(loadProgress(), levelId);
    store.setItem(KEY, JSON.stringify({ version: PROGRESS_VERSION, completed }));
  } catch {
    // Losing the record is survivable; crashing is not.
  }
}

export function clearProgress(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEY);
  } catch {
    // Nothing useful to do.
  }
}
