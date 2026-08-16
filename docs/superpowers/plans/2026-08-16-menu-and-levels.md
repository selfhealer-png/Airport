# Menu System and Multiple Levels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app opens to a menu of levels rather than straight into one game, levels unlock in a chain, and a second map — woods and rock — ships with it.

**Architecture:** The game shell is built once at boot and sits behind a `#menu` overlay. Switching level restores a different snapshot *into* the existing `GameState` via `restoreInto()`, which already exists because the render loop, pointer handlers and drawer all closed over that object. There is one game at a time; the unlock record lives on its own storage key so replacing a game never costs a level already earned.

**Tech Stack:** TypeScript 7 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vite, Vitest, plain DOM. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-16-menu-and-levels-design.md`

## Global Constraints

- **`sim/` must not import from `render/`, `ui/`, `input/` or `sprites/`.** The menu is `ui/`.
- **Balance and content data live in `src/content/`**, never inlined into `sim/` logic.
- **`@/` maps to `src/`**, configured in both `tsconfig.json` and `vite.config.ts`.
- **TypeScript is strict**, plus `noUncheckedIndexedAccess` (indexed access yields `T | undefined` — handle it, do not assert) and `exactOptionalPropertyTypes` (an optional property must be *omitted*, never set to `undefined`).
- **Do NOT bump `SNAPSHOT_VERSION`.** It is 7 and stays 7. The snapshot already stores a level id; progress goes in a new key. This change must leave existing saves working.
- **Node 24 lives at `C:\Program Files\nodejs`.** Git Bash does not pick it up: prefix commands with `export PATH="$PATH:/c/Program Files/nodejs";` or use PowerShell.
- **Do not write files with Python's `pathlib.write_text()`** — it defaults to cp1252 here and truncates on non-ASCII. Use the editor tools.
- Commands: `npm test`, `npm run typecheck`, `npm run build`, `npm test -- tests/x.test.ts`, `npm test -- -t "name"`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/content/levels.ts` | *Modified.* `terrainFrom()` parser; `LEVEL_BRACKEN_RISE`; `LEVELS` |
| `src/save/progress.ts` | *New.* Pure unlock chain and record parsing, plus thin storage wrappers |
| `src/ui/menu.ts` | *New.* Pure `menuRows()`, plus `createMenu()` which renders it |
| `src/main.ts` | *Modified.* Boot to menu; enter/leave a level; completion; Start over |
| `index.html` | *Modified.* `#menu` overlay; HUD title becomes a button |
| `src/ui/styles.css` | *Modified.* Menu styles, including the `[hidden]` rule |
| `tests/levels.test.ts` | *New.* Parser, plus invariants across every level |
| `tests/progress.test.ts` | *New.* Unlock chain, de-duplication and record parsing |
| `tests/menu.test.ts` | *New.* `menuRows()` row states |

Task 9 is a late addition — a testing affordance for reaching later levels without playing fifty days first. It runs after Task 7 and before Task 8.

---

### Task 1: Terrain authoring parser

Levels are currently `filled(24, 36, 'grass')`. A map with obstacles needs to be authored tile by tile, and the codebase already has a pattern for exactly this: sprites are arrays of strings, one character per pixel, validated by `toPixelGrid()` so a typo fails a test rather than reaching the canvas. Terrain gets the same contract.

**Files:**
- Modify: `src/content/levels.ts`
- Test: `tests/levels.test.ts` (create)

**Interfaces:**
- Consumes: `Terrain` and `LevelMap` from `@/sim/types`
- Produces: `terrainFrom(rows: readonly string[]): { width: number; height: number; terrain: Terrain[] }`

- [ ] **Step 1: Write the failing test**

Create `tests/levels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { terrainFrom } from '@/content/levels';

/**
 * Level maps are authored as characters, the way sprites are, so that a typo fails a test
 * rather than producing a map with a hole in it.
 */
describe('terrainFrom', () => {
  it('reads a grid of characters into terrain', () => {
    const map = terrainFrom(['gw', 'rf']);

    expect(map.width).toBe(2);
    expect(map.height).toBe(2);
    expect(map.terrain).toEqual(['grass', 'water', 'rock', 'woods']);
  });

  it('refuses a ragged block rather than guessing the width', () => {
    expect(() => terrainFrom(['ggg', 'gg'])).toThrow(/row 1/i);
  });

  it('refuses a character that is not terrain', () => {
    expect(() => terrainFrom(['gg', 'gx'])).toThrow(/'x'/);
  });

  it('refuses an empty map', () => {
    expect(() => terrainFrom([])).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="$PATH:/c/Program Files/nodejs"; npm test -- tests/levels.test.ts`
Expected: FAIL — `terrainFrom` is not exported from `@/content/levels`.

- [ ] **Step 3: Implement the parser**

In `src/content/levels.ts`, add below the existing `filled()` helper:

```ts
/**
 * The characters a level map is authored in.
 *
 * Terrain is written as a block of strings, one character per tile, for the same reason
 * sprites are: a map is far easier to read, diff and edit as a picture than as an array of
 * enum values, and a mistake shows up as a shape that looks wrong.
 */
const TERRAIN_KEYS: Readonly<Record<string, Terrain>> = {
  g: 'grass',
  w: 'water',
  r: 'rock',
  f: 'woods',
};

/**
 * Parses an authored map. Throws on anything malformed rather than producing a map with a
 * hole in it — `tests/levels.test.ts` parses every level, so a bad block fails the suite.
 */
export function terrainFrom(rows: readonly string[]): {
  width: number;
  height: number;
  terrain: Terrain[];
} {
  const first = rows[0];
  if (first === undefined) throw new Error('A level map needs at least one row.');

  const width = first.length;
  const terrain: Terrain[] = [];

  for (const [y, row] of rows.entries()) {
    if (row.length !== width) {
      throw new Error(`Level map row ${y} is ${row.length} tiles wide, expected ${width}.`);
    }
    for (const [x, key] of [...row].entries()) {
      const tile = TERRAIN_KEYS[key];
      if (tile === undefined) {
        throw new Error(`Unknown terrain character '${key}' at ${x},${y}.`);
      }
      terrain.push(tile);
    }
  }

  return { width, height: rows.length, terrain };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs"; npm test -- tests/levels.test.ts && npm run typecheck`
Expected: 4 tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/content/levels.ts tests/levels.test.ts
git commit -m "Author level terrain as characters, like sprite data"
```

---

### Task 2: Level invariants, and the Bracken Rise map

The invariants matter more than the map. `roadNetwork()` counts only the single largest connected run of road, so a map whose obstacles cut the buildable area in two would silently make one half permanently useless — a runway there could never be opened and nothing on screen would say why. Asserting these across `LEVELS` means every future map inherits the check.

**Files:**
- Modify: `src/content/levels.ts`
- Test: `tests/levels.test.ts`

**Interfaces:**
- Consumes: `terrainFrom()` from Task 1
- Produces: `LEVEL_BRACKEN_RISE: LevelMap`; `LEVELS` now has two entries, meadow first

- [ ] **Step 1: Write the failing tests**

Append to `tests/levels.test.ts`:

```ts
import { LEVELS } from '@/content/levels';
import { MIN_RUNWAY_TILES } from '@/content/costs';
import { AIRCRAFT_CLASSES } from '@/content/aircraft';

/** The longest runway any class asks for. A map with no room for it is unwinnable. */
const LONGEST_RUNWAY = Math.max(
  ...Object.values(AIRCRAFT_CLASSES).map((spec) => spec.runwayLength),
);

/** Row-major index helper, matching `terrainAt`. */
const at = (level: (typeof LEVELS)[number], x: number, y: number) =>
  level.terrain[y * level.width + x];

describe.each(LEVELS.map((level) => [level.name, level] as const))(
  'level invariants: %s',
  (_name, level) => {
    it('has terrain matching its declared size', () => {
      expect(level.terrain).toHaveLength(level.width * level.height);
      expect(level.width).toBeGreaterThan(MIN_RUNWAY_TILES);
    });

    it('has room somewhere for the longest runway in the game', () => {
      let best = 0;
      for (let x = 0; x < level.width; x++) {
        let run = 0;
        for (let y = 0; y < level.height; y++) {
          run = at(level, x, y) === 'grass' ? run + 1 : 0;
          best = Math.max(best, run);
        }
      }
      expect(best).toBeGreaterThanOrEqual(LONGEST_RUNWAY);
    });

    /**
     * The one that matters most. Roads count only as a single connected network, so grass
     * split into two regions means one of them can never be served — a runway built there
     * would be paid for and never open, with nothing on screen to explain it.
     */
    it('has all its buildable ground in one connected region', () => {
      const total = level.terrain.filter((t) => t === 'grass').length;
      const start = level.terrain.indexOf('grass');
      expect(start).toBeGreaterThanOrEqual(0);

      const seen = new Set<number>([start]);
      const stack = [start];
      while (stack.length > 0) {
        const key = stack.pop()!;
        const x = key % level.width;
        const y = Math.floor(key / level.width);
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= level.width || ny >= level.height) continue;
          const next = ny * level.width + nx;
          if (seen.has(next) || level.terrain[next] !== 'grass') continue;
          seen.add(next);
          stack.push(next);
        }
      }

      expect(seen.size).toBe(total);
    });
  },
);

describe('the level ladder', () => {
  it('starts on the meadow, which has nothing in the way', () => {
    expect(LEVELS[0]?.id).toBe('meadow');
    expect(new Set(LEVELS[0]!.terrain)).toEqual(new Set(['grass']));
  });

  it('offers a second level with obstacles to build around', () => {
    const second = LEVELS[1];
    expect(second).toBeDefined();
    expect(second!.terrain).toContain('woods');
    expect(second!.terrain).toContain('rock');
  });

  it('gives every level a distinct id, since a save stores the id', () => {
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH="$PATH:/c/Program Files/nodejs"; npm test -- tests/levels.test.ts`
Expected: FAIL — `LEVELS[1]` is undefined, so "offers a second level" fails.

- [ ] **Step 3: Add the map**

In `src/content/levels.ts`, after `LEVEL_MEADOW`, add. The block below is verified against all three invariants above — one connected grass region, and 21 of its 24 columns can take a 16-tile runway. If you edit it, the tests will tell you what you broke.

```ts
/**
 * The second field: rock across the north-west, woods through the south-centre.
 *
 * Placed so the map does not play as the meadow with holes in it. The rock pushes the
 * obvious long-runway column east, and the woods stop the apron sprawling south the way it
 * can on an empty field — so the player has to choose a shape rather than repeat the one
 * they already know.
 *
 * Obstacles are permanent for now: `isBuildable()` refuses anything that is not grass, and
 * paying to clear ground is a later piece of work.
 */
export const LEVEL_BRACKEN_RISE: LevelMap = {
  id: 'bracken-rise',
  name: 'Bracken Rise',
  ...terrainFrom([
    'gggggggggggggggggggggggg',
    'gggggggggggggggggggggggg',
    'gggrggggrggggggggggggggg',
    'grrrrrgrrrgggggggggggggg',
    'grrrrrrrrrrggggggggggggg',
    'rrrrrrrrrrgggggggggggggg',
    'grrrrrrrrggggggggggggggg',
    'grrrrrrrrggggggggggggggg',
    'gggrrrrrrrgggggggggggggg',
    'ggggrrrrrggggggggggggggg',
    'gggrrrrggggggggggggggggg',
    'ggrrrrrggggggggggggggggg',
    'gggrrrgggggggggggggggggg',
    'ggggrggggggggggggggggggg',
    'gggggggggggggggggggggggg',
    'gggggggggggggggggggggggg',
    'gggggggggggggggggggggggg',
    'gggggggggggggggggggggggg',
    'gggggggggggggggggggggggg',
    'gggggggggggggggggggggggg',
    'gggggggggggggggggggggggg',
    'gggggggggggggggggfgggggg',
    'ggggggggggfgggggfffggggg',
    'ggggggggfffffggfffffgggg',
    'gggggggffffffffffffggggg',
    'ggggggggffffffffffgggggg',
    'ggggggggggfffffffggggggg',
    'ggggggggfggfffffffgggggg',
    'gggggggfffggfffffggggggg',
    'ggggggfffffgfffffggggggg',
    'gggggggfffggggfggggggggg',
    'ggggggggfggggfgggggggggg',
    'ggggggggggfffffffggggggg',
    'gggggggggggggfgggggggggg',
    'gggggggggggggggggggggggg',
    'gggggggggggggggggggggggg',
  ]),
};
```

Then replace the `LEVELS` line. Order is load-bearing: it is the unlock chain.

```ts
/** Order is the campaign order — `isUnlocked()` reads it as a chain. */
export const LEVELS: readonly LevelMap[] = [LEVEL_MEADOW, LEVEL_BRACKEN_RISE];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `export PATH="$PATH:/c/Program Files/nodejs"; npm test -- tests/levels.test.ts && npm run typecheck`
Expected: all PASS (invariants run twice, once per level), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/content/levels.ts tests/levels.test.ts
git commit -m "Add Bracken Rise, and invariants every level must satisfy"
```

---

### Task 3: The progress record

Unlocks must survive a game being replaced, so they live on their own storage key rather than
inside the snapshot.

The file splits the way `save/` already splits: `snapshot.ts` is pure and thoroughly tested,
`storage.ts` is the thin `localStorage` wrapper and is deliberately not — the test environment
is `node`, there is no DOM, and adding one for four lines of `try`/`catch` would be a poor
trade. So the parsing, the de-duplication and the unlock chain are pure functions with tests,
and the three browser wrappers are kept thin enough to read.

**Files:**
- Create: `src/save/progress.ts`
- Test: `tests/progress.test.ts` (create)

**Interfaces:**
- Consumes: `LEVELS` from `@/content/levels`
- Produces, pure: `parseProgress(raw: unknown): string[]`; `addCompleted(completed: readonly string[], levelId: string): string[]`; `isUnlocked(levelId: string, completed: readonly string[]): boolean`
- Produces, browser: `loadProgress(): string[]`; `markCompleted(levelId: string): void`; `clearProgress(): void`

- [ ] **Step 1: Write the failing test**

Create `tests/progress.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LEVELS } from '@/content/levels';
import { addCompleted, isUnlocked, parseProgress } from '@/save/progress';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="$PATH:/c/Program Files/nodejs"; npm test -- tests/progress.test.ts`
Expected: FAIL — `@/save/progress` does not exist.

- [ ] **Step 3: Implement it**

Create `src/save/progress.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs"; npm test -- tests/progress.test.ts && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/save/progress.ts tests/progress.test.ts
git commit -m "Record which levels are finished, apart from the game itself"
```

---

### Task 4: What the menu says

The row states are game logic — what the player is allowed to do and what they are warned about — so they are a pure function tested headlessly, the way `ui/placement.ts` keeps drag behaviour out of the browser. The DOM comes next task.

**Files:**
- Create: `src/ui/menu.ts`
- Test: `tests/menu.test.ts` (create)

**Interfaces:**
- Consumes: `isUnlocked()` from `@/save/progress`; `LevelMap` from `@/sim/types`
- Produces: `MenuRow`, `MenuRowState`, and
  `menuRows(levels: readonly LevelMap[], completed: readonly string[], current: CurrentGame | null): MenuRow[]`
  where `CurrentGame = { levelId: string; day: number }`

- [ ] **Step 1: Write the failing test**

Create `tests/menu.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="$PATH:/c/Program Files/nodejs"; npm test -- tests/menu.test.ts`
Expected: FAIL — `@/ui/menu` does not exist.

- [ ] **Step 3: Implement the pure part**

Create `src/ui/menu.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs"; npm test -- tests/menu.test.ts && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/menu.ts tests/menu.test.ts
git commit -m "Work out what each menu row offers, without a browser"
```

---

### Task 5: The menu screen

**Files:**
- Modify: `src/ui/menu.ts`
- Modify: `index.html:39` (add `#menu` beside `#modal`)
- Modify: `src/ui/styles.css`

**Interfaces:**
- Consumes: `menuRows()` from Task 4
- Produces: `createMenu(root: HTMLElement, handlers: MenuHandlers): Menu`, where
  `Menu = { refresh(completed: readonly string[], current: CurrentGame | null): void }` and
  `MenuHandlers = { onPlay(levelId: string): void; onResetEverything(): void }`

- [ ] **Step 1: Add the overlay element**

In `index.html`, add a line immediately before `<div id="modal" hidden></div>`:

```html
    <div id="menu" hidden></div>
```

- [ ] **Step 2: Add the styles**

In `src/ui/styles.css`, find the rule at roughly line 433:

```css
#modal[hidden],
#crash[hidden] {
  display: none;
}
```

Replace it with the following. **This is load-bearing:** a `display` declaration beats the user agent's `[hidden] { display: none }`, so an explicitly hidden overlay must opt back out or it scrims the whole game permanently.

```css
#menu[hidden],
#modal[hidden],
#crash[hidden] {
  display: none;
}
```

Then append at the end of the file:

```css
/* --- Menu ------------------------------------------------------------------------------ */

#menu {
  position: fixed;
  inset: 0;
  z-index: 10;
  overflow-y: auto;
  padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
  background: var(--bg);
}

.menu-panel {
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
}

.menu-title {
  margin: 0 0 4px;
  font-size: 24px;
}

.menu-sub {
  margin: 0 0 20px;
  font-size: 13px;
  opacity: 0.6;
}

.menu-heading {
  margin: 20px 0 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.5;
}

.menu-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  /* 44px is the smallest comfortable touch target. */
  min-height: 44px;
  margin-bottom: 8px;
  padding: 12px 14px;
  border: 1px solid var(--chip-edge);
  border-radius: 12px;
  background: var(--chip);
  color: var(--fg);
  font: inherit;
  text-align: left;
}

.menu-row:disabled {
  opacity: 0.45;
}

.menu-row.is-armed {
  border-color: var(--bad);
  box-shadow: inset 0 0 0 1px var(--bad);
}

.menu-row-name {
  font-size: 15px;
  font-weight: 600;
}

.menu-row-state {
  font-size: 12px;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Implement the screen**

Append to `src/ui/menu.ts`:

```ts
export interface MenuHandlers {
  onPlay(levelId: string): void;
  onResetEverything(): void;
}

export interface Menu {
  refresh(completed: readonly string[], current: CurrentGame | null): void;
}

/** What a row's second line says, given its state. */
function describeRow(row: MenuRow): string {
  switch (row.state) {
    case 'locked':
      return row.unlockedBy ? `Locked — finish ${row.unlockedBy} first` : 'Locked';
    case 'continue':
      return `Continue — day ${row.day ?? 1}`;
    case 'replay':
      return '✓ Completed · Play again';
    case 'start':
      return 'Start';
  }
}

/**
 * Renders the menu into `root`.
 *
 * Rebuilt wholesale on every `refresh` rather than patched. It is a handful of buttons shown
 * between games, so the simplicity is worth more than the churn — and it means the arming
 * state below cannot survive a refresh by accident.
 */
export function createMenu(root: HTMLElement, handlers: MenuHandlers): Menu {
  /*
   * Replacing an airport asks twice, the way "Start over" does.
   *
   * On a phone a single stray tap must not destroy an hour of building, and the confirmation
   * lapses on its own so it can never be left armed.
   */
  let armed: string | null = null;
  let armedTimer: ReturnType<typeof setTimeout> | null = null;

  const disarm = (): void => {
    if (armedTimer) clearTimeout(armedTimer);
    armedTimer = null;
    armed = null;
  };

  const api: Menu = {
    refresh(completed, current) {
      const panel = document.createElement('div');
      panel.className = 'menu-panel';

      const title = document.createElement('h1');
      title.className = 'menu-title';
      title.textContent = 'Airfield';

      const sub = document.createElement('p');
      sub.className = 'menu-sub';
      sub.textContent = 'Build the airport so the aeroplanes can land.';

      const levelsHeading = document.createElement('p');
      levelsHeading.className = 'menu-heading';
      levelsHeading.textContent = 'Levels';

      panel.append(title, sub, levelsHeading);

      for (const row of menuRows(LEVELS, completed, current)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu-row';
        button.disabled = row.state === 'locked';
        button.classList.toggle('is-armed', armed === row.levelId);

        const name = document.createElement('span');
        name.className = 'menu-row-name';
        name.textContent = row.name;

        const state = document.createElement('span');
        state.className = 'menu-row-state';
        state.textContent =
          armed === row.levelId ? 'Tap again — this replaces your airport' : describeRow(row);

        button.append(name, state);
        button.addEventListener('click', () => {
          if (!row.confirms) {
            disarm();
            handlers.onPlay(row.levelId);
            return;
          }
          if (armed === row.levelId) {
            disarm();
            handlers.onPlay(row.levelId);
            return;
          }
          disarm();
          armed = row.levelId;
          armedTimer = setTimeout(() => {
            disarm();
            api.refresh(completed, current);
          }, 4000);
          api.refresh(completed, current);
        });

        panel.append(button);
      }

      // Visible rather than absent, so it reads as a promise instead of a gap.
      const scenarios = document.createElement('p');
      scenarios.className = 'menu-heading';
      scenarios.textContent = 'Scenarios';

      const soon = document.createElement('button');
      soon.type = 'button';
      soon.className = 'menu-row';
      soon.disabled = true;
      const soonName = document.createElement('span');
      soonName.className = 'menu-row-name';
      soonName.textContent = 'Scenarios';
      const soonState = document.createElement('span');
      soonState.className = 'menu-row-state';
      soonState.textContent = 'Coming later';
      soon.append(soonName, soonState);

      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'text-button';
      reset.textContent = 'Reset everything';
      let resetArmed: ReturnType<typeof setTimeout> | null = null;
      reset.addEventListener('click', () => {
        if (!resetArmed) {
          reset.textContent = 'Tap again to wipe every level';
          reset.classList.add('is-armed');
          resetArmed = setTimeout(() => {
            resetArmed = null;
            reset.textContent = 'Reset everything';
            reset.classList.remove('is-armed');
          }, 4000);
          return;
        }
        clearTimeout(resetArmed);
        handlers.onResetEverything();
      });

      panel.append(scenarios, soon, reset);
      root.replaceChildren(panel);
    },
  };

  return api;
}
```

Add `LEVELS` to the imports at the top of the file:

```ts
import { LEVELS } from '@/content/levels';
```

- [ ] **Step 4: Verify it compiles and nothing regressed**

Run: `export PATH="$PATH:/c/Program Files/nodejs"; npm run typecheck && npm test && npm run build`
Expected: typecheck clean, all tests PASS, build succeeds. The menu is not wired up yet, so nothing changes on screen.

- [ ] **Step 5: Commit**

```bash
git add src/ui/menu.ts index.html src/ui/styles.css
git commit -m "Render the level menu"
```

---

### Task 6: Boot into the menu and enter a level

**Files:**
- Modify: `src/main.ts`
- Modify: `index.html:28` (HUD title becomes a button)

**Interfaces:**
- Consumes: `createMenu()`, `CurrentGame` from `@/ui/menu`; `loadProgress()`, `clearProgress()` from `@/save/progress`
- Produces: nothing further tasks depend on

- [ ] **Step 1: Make the HUD title a button**

In `index.html`, replace line 28:

```html
        <span class="hud-title">Hensley Meadow</span>
```

with:

```html
        <button type="button" id="hud-title" class="hud-title">Airfield</button>
```

The old text was hardcoded — every level would otherwise claim to be the meadow. Add to `src/ui/styles.css`, at the end:

```css
/* The level name doubles as the way back to the menu: already on screen, already says where
   you are, and costs no space on a phone. */
button.hud-title {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
}
```

- [ ] **Step 2: Wire the menu into `main.ts`**

Add to the imports at the top:

```ts
import { createMenu, type CurrentGame } from '@/ui/menu';
import { clearProgress, loadProgress } from '@/save/progress';
import { toSnapshot, restoreInto } from '@/save/snapshot';
import { LEVELS } from '@/content/levels';
```

Change the element lookup block (`main.ts:59-72`) so the menu root and title are found and checked with the rest:

```ts
  const canvas = document.querySelector<HTMLCanvasElement>('#map');
  const wrap = document.querySelector<HTMLElement>('#map-wrap');
  const drawerRoot = document.querySelector<HTMLElement>('#drawer');
  const modalRoot = document.querySelector<HTMLElement>('#modal');
  const menuRoot = document.querySelector<HTMLElement>('#menu');
  const titleButton = document.querySelector<HTMLElement>('#hud-title');
  const cashLabel = document.querySelector<HTMLElement>('#hud-cash');
  const dayLabel = document.querySelector<HTMLElement>('#hud-day');
  if (
    !canvas || !wrap || !drawerRoot || !modalRoot || !menuRoot ||
    !titleButton || !cashLabel || !dayLabel
  ) {
    throw new Error('App shell is missing an expected element.');
  }

  const drawerHost = drawerRoot;
  const modalHost = modalRoot;
  const menuHost = menuRoot;
  const title = titleButton;
  const cash = cashLabel;
  const dayText = dayLabel;
```

Leave the `const state = loadGame() ?? createGame(LEVEL_MEADOW, 42);` line alone — the shell still needs a state object to be built around, and the menu replaces its contents before anything is shown.

- [ ] **Step 3: Add the menu wiring**

Insert immediately **after** the `showPlanning()` function (around `main.ts:270`):

```ts
  /**
   * Every level plays the same fifty days.
   *
   * Identical traffic across maps makes the terrain the only variable, which suits a game
   * whose whole claim is that you are tested on your airport and not on your luck. A per-level
   * seed is a one-line change if that stops being true.
   */
  const SEED = 42;

  /** True while the menu is up, so the autosave does not write a game nobody is playing. */
  let inMenu = false;

  const currentGame = (): CurrentGame | null => {
    const saved = loadGame();
    return saved ? { levelId: saved.airport.map.id, day: saved.day } : null;
  };

  const menu = createMenu(menuHost, {
    onPlay: (levelId) => enterLevel(levelId),
    onResetEverything: () => {
      wiping = true;
      clearGame();
      clearProgress();
      window.location.reload();
    },
  });

  function showMenu(): void {
    inMenu = true;
    menu.refresh(loadProgress(), currentGame());
    menuHost.hidden = false;
  }

  /**
   * Starts or resumes a level.
   *
   * Restores *into* the existing state rather than swapping in a new object: the render loop,
   * the pointer handlers and the drawer all closed over this one when they were wired up, so
   * replacing it would leave them driving a game nobody can see. That is the same reason undo
   * works this way.
   */
  function enterLevel(levelId: string): void {
    const map = LEVELS.find((level) => level.id === levelId);
    if (!map) return;

    const saved = loadGame();
    const resuming = saved?.airport.map.id === levelId;
    // Built through `toSnapshot` even for a fresh game, so entering a level goes down exactly
    // the same path as loading one — `restoreInto` validates it either way.
    const snapshot = resuming ? toSnapshot(saved) : toSnapshot(createGame(map, SEED));
    if (!restoreInto(state, snapshot)) return;

    history.clear();
    drawer.clearSelection();
    placement = null;
    dragFrom = null;
    // Levels may differ in size, so the map has to re-fit itself; without this the new field
    // is drawn at the previous one's zoom and offset, with nothing to explain why.
    framed = false;
    relayout();

    inMenu = false;
    menuHost.hidden = true;
    saveGame(state);
    showPlanning();
  }
```

- [ ] **Step 4: Show the menu at boot instead of the game**

At the bottom of `start()`, replace:

```ts
  showPlanning();
  requestAnimationFrame(frame);
```

with:

```ts
  showPlanning();
  showMenu();
  requestAnimationFrame(frame);
```

`showPlanning()` still runs first so the shell behind the menu is in a coherent state the moment the menu closes.

- [ ] **Step 5: Verify by hand**

Run: `export PATH="$PATH:/c/Program Files/nodejs"; npm run typecheck && npm test && npm run dev`

Open `http://localhost:5173/` and confirm:
- The menu appears at boot, not a game.
- Bracken Rise is locked and names Hensley Meadow as what unlocks it.
- Tapping Hensley Meadow opens the game and the HUD title reads `Airfield` (it becomes the level name in Task 7).
- Reloading shows the menu again, with `Continue — day 1` on the meadow.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts index.html src/ui/styles.css
git commit -m "Open on the level menu instead of straight into a game"
```

---

### Task 7: Leaving a level, completion, and Start over

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: everything from Task 6
- Produces: nothing further tasks depend on

- [ ] **Step 1: Put the level's name in the HUD and wire the way back**

In `updateHud()` (around `main.ts:349`), add the title line:

```ts
    cash.textContent = `£${state.cash.toLocaleString()}`;
    title.textContent = state.airport.map.name;
    dayText.textContent = `Day ${state.day}`;
```

Then, immediately after the `menu` is created in Task 6, add:

```ts
  /*
   * The level name is the way back. Leaving mid-day loses that day — but so does a reload,
   * because a day in progress is deliberately never saved, so this is the existing rule
   * rather than a new one.
   */
  title.addEventListener('click', () => {
    if (state.phase === 'planning') saveGame(state);
    showMenu();
  });
```

- [ ] **Step 2: Record completion**

Add `markCompleted` to the progress import at the top of `main.ts`:

```ts
import { clearProgress, loadProgress, markCompleted } from '@/save/progress';
```

In `finishDay()` (around `main.ts:292`), change the continue callback so the level is marked when the last day's debrief is dismissed:

```ts
  function finishDay(): void {
    const day = state.current;
    if (!day) return;
    const finalDay = state.day >= CAMPAIGN_DAYS;
    showDebrief(
      modalHost,
      day,
      () => {
        // Recorded on dismissal of day 50, and idempotent: the campaign carries on as a
        // sandbox afterwards, so every later day satisfies this too.
        if (finalDay) markCompleted(state.airport.map.id);
        state.day += 1;
        state.phase = 'planning';
        state.current = null;
        saveGame(state);
        showPlanning();
      },
      finalDay,
      { landedTotal: state.landedTotal, scheduledTotal: state.scheduledTotal },
    );
  }
```

- [ ] **Step 3: Make Start over return to the menu**

Replace the body of the `resetButton` click handler (around `main.ts:201-212`) so it abandons the game without reloading and without touching unlocks:

```ts
  resetButton.addEventListener('click', () => {
    if (!resetArmed) {
      resetButton.textContent = 'Tap again to wipe this airport';
      resetButton.classList.add('is-armed');
      resetArmed = setTimeout(disarmReset, 4000);
      return;
    }
    disarmReset();
    // Only this level's game goes. Unlocks live on their own key precisely so that finishing
    // a level is never undone by starting again.
    clearGame();
    showMenu();
  });
```

- [ ] **Step 4: Stop the autosave writing while the menu is up**

Replace `persist()` (around `main.ts:406`):

```ts
  const persist = (): void => {
    if (wiping) return;
    // Nothing to save from the menu, and writing here would resurrect a game the player has
    // just abandoned with Start over — the same hazard the `wiping` latch exists for.
    if (inMenu) return;
    if (state.phase === 'planning') saveGame(state);
  };
```

- [ ] **Step 5: Verify by hand**

Run: `export PATH="$PATH:/c/Program Files/nodejs"; npm run typecheck && npm test && npm run dev`

At a 360px-wide viewport, confirm:
- The HUD title shows the level's name and returns to the menu when tapped.
- The meadow row now reads `Continue — day N`.
- Tapping Bracken Rise asks twice, and the row says it will replace your airport.
- Waiting four seconds disarms it.
- After confirming, Bracken Rise loads with rock in the north-west and woods to the south, fitted to the screen rather than at the meadow's zoom.
- Start over returns to the menu and leaves any unlock in place.
- **Then reload the page**: the game that was in progress is still offered.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "Leave a level, finish one, and start over without losing unlocks"
```

---

### Task 8: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Document the menu and levels in CLAUDE.md**

Add a section immediately before `### Saving`:

```markdown
### Levels, and the menu

The app opens on a menu, not a game. Levels unlock in a chain — `isUnlocked()` in
`save/progress.ts` reads `LEVELS` order, first always open, each later one needing the one
before it finished — and there is **one game at a time**, so choosing another level replaces
the airport you had.

That is why the unlock record lives on **its own storage key** (`airfield.progress.v1`) rather
than inside the snapshot. Replacing a game, or tapping Start over, must never cost a level
already earned. Anything that would discard a game asks twice, reusing the pattern Start over
established.

Switching level calls `restoreInto()` — the same mechanism undo uses, and for the same reason:
the render loop, the pointer handlers and the drawer all closed over the original `GameState`,
so swapping the object would leave them driving a game nobody can see. Two things go with it:
`framed` must be reset so the new map re-fits, and `persist()` must not run while the menu is
up or the autosave will resurrect a game the player has just abandoned.

**Level terrain is authored as characters**, like sprite data — `g` grass, `w` water, `r` rock,
`f` woods — and parsed by `terrainFrom()`, so a typo fails a test rather than producing a map
with a hole in it. `tests/levels.test.ts` then asserts three invariants across *every* level:

- terrain length matches the declared size;
- at least one column has room for the longest runway in the game, or the campaign is
  unwinnable on that map;
- **all grass is one connected region.** This is the one that matters. `roadNetwork()` counts
  only the single largest connected run of road, so a map whose obstacles split the buildable
  ground in two would silently make one half useless — a runway there could be paid for and
  never open, with nothing on screen to explain it. The check caught exactly this while
  Bracken Rise was being drawn.

Obstacles are permanent: `isBuildable()` refuses anything that is not grass. Paying to clear
ground is a separate piece of work.

**The day harness is meadow-only.** `scripts/run-day.ts` hardcodes column positions
(`RUNWAY_X = 5`, `WEST_STAND_X = 8`, `STAND_ROWS`) that a map with obstacles in them would
turn into nonsense, so Bracken Rise is **not** balance-checked by anything. Treat a new map as
a new balance target rather than assuming it inherits the meadow's tuning — the campaign is
already tuned against seed 42 on one map, and seeds 99 and 3 clear only 42% and 24% of their
traffic even on the meadow.
```

- [ ] **Step 2: Update the build-order note in CLAUDE.md**

Find the line beginning `Remaining: **levels 2+** actually using water, rock and woods` and replace that bullet with:

```markdown
Remaining: **water levels** (Bracken Rise uses rock and woods; nothing uses water yet, and it
is the strongest constraint because roads cannot cross it), **terrain clearing costs**, and
**scenarios**, which the menu already advertises as coming later. Two known rough edges:
```

- [ ] **Step 3: Update the README**

In the `## Playing` section, after the paragraph about seeds, add:

```markdown
The game opens on a menu. Levels unlock in order — finish one to reach the next — and you have
one airport on the go at a time, so starting another level replaces it. Finishing a level is
remembered separately, so that never costs you a map you have already earned.
```

- [ ] **Step 4: Verify**

Run: `export PATH="$PATH:/c/Program Files/nodejs"; npm test && npm run typecheck && npm run build`
Expected: all PASS, typecheck clean, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "Document the menu, the unlock chain and the level invariants"
```

---

### Task 9: Unlock-all, for testing

Reaching Bracken Rise means finishing fifty days on the meadow. That is right for a player and
useless for testing the level you just built, so the menu gets a way to open everything.

A **tap gesture on the menu title**, not a URL parameter or a console function: the game is an
installed PWA on a phone, where there is no address bar to type into and no console to call
into. Five taps is far past anything a real player does by accident, and the menu says plainly
when it has fired so it can never be triggered without the tester noticing.

Order: run this task **after Task 7** — the menu has to be reachable before a cheat into it is
worth anything — and before Task 8, so the documentation pass covers it.

**Files:**
- Modify: `src/save/progress.ts`
- Modify: `src/ui/menu.ts`
- Modify: `src/main.ts`
- Test: `tests/progress.test.ts`

**Interfaces:**
- Consumes: `LEVELS` from `@/content/levels`; `MenuHandlers` from `@/ui/menu`
- Produces: `everyLevelId(): string[]` and `unlockAll(): void` in `@/save/progress`;
  `MenuHandlers.onUnlockAll(): void`

- [ ] **Step 1: Write the failing test**

Append to `tests/progress.test.ts`:

```ts
import { everyLevelId } from '@/save/progress';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="$PATH:/c/Program Files/nodejs"; npm test -- tests/progress.test.ts`
Expected: FAIL — `everyLevelId` is not exported from `@/save/progress`.

- [ ] **Step 3: Add the two functions**

In `src/save/progress.ts`, add `everyLevelId` beside the other pure functions (above
`storage()`):

```ts
/** Every level's id — what "unlocked" looks like when nothing is locked. */
export function everyLevelId(): string[] {
  return LEVELS.map((level) => level.id);
}
```

and `unlockAll` beside the other wrappers (below `storage()`):

```ts
/**
 * Opens every level at once.
 *
 * A testing affordance, not a game mechanic: reaching Bracken Rise legitimately means fifty
 * days on the meadow, which is a poor way to check the map you have just drawn. Writes the
 * same record `markCompleted` does, so "Reset everything" undoes it like anything else.
 */
export function unlockAll(): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify({ version: PROGRESS_VERSION, completed: everyLevelId() }));
  } catch {
    // Losing the record is survivable; crashing is not.
  }
}
```

- [ ] **Step 4: Add the gesture to the menu**

In `src/ui/menu.ts`, add to the `MenuHandlers` interface:

```ts
export interface MenuHandlers {
  onPlay(levelId: string): void;
  onResetEverything(): void;
  /** Fired by the hidden tap gesture on the title. See `createMenu`. */
  onUnlockAll(): void;
}
```

Inside `createMenu`, above the `api` declaration, add the counter:

```ts
  /*
   * Five taps on the title unlocks every level.
   *
   * A gesture rather than a URL parameter or a console call, because the game is an installed
   * PWA on a phone: there is no address bar to type into and no console to call from. Five is
   * far past anything a player reaches by accident, and the title says so once it fires, so it
   * can never trigger silently.
   */
  let titleTaps = 0;
  let unlocked = false;
```

Then, inside `refresh`, replace the two lines that create and set the title:

```ts
      const title = document.createElement('h1');
      title.className = 'menu-title';
      title.textContent = 'Airfield';
```

with:

```ts
      const title = document.createElement('h1');
      title.className = 'menu-title';
      title.textContent = unlocked ? 'Airfield — all levels unlocked' : 'Airfield';
      title.addEventListener('click', () => {
        titleTaps += 1;
        if (titleTaps < 5) return;
        titleTaps = 0;
        unlocked = true;
        handlers.onUnlockAll();
      });
```

- [ ] **Step 5: Wire it up**

In `src/main.ts`, add `unlockAll` to the progress import:

```ts
import { clearProgress, loadProgress, markCompleted, unlockAll } from '@/save/progress';
```

and add the handler to the `createMenu` call, beside `onResetEverything`:

```ts
    onUnlockAll: () => {
      unlockAll();
      showMenu();
    },
```

- [ ] **Step 6: Verify**

Run: `export PATH="$PATH:/c/Program Files/nodejs"; npm test && npm run typecheck && npm run build`
Expected: all PASS, typecheck clean, build succeeds.

Then `npm run dev`, open `http://localhost:5173/`, and confirm: tapping the title four times does
nothing visible; the fifth changes it to `Airfield — all levels unlocked` and Bracken Rise
becomes playable. Then tap **Reset everything** twice and confirm Bracken Rise locks again.

- [ ] **Step 7: Commit**

```bash
git add src/save/progress.ts src/ui/menu.ts src/main.ts tests/progress.test.ts
git commit -m "Add a tap gesture that unlocks every level, for testing"
```

---

## Done when

- `npm test`, `npm run typecheck` and `npm run build` all pass.
- The app opens on a menu listing Hensley Meadow and a locked Bracken Rise, plus a Scenarios placeholder.
- Finishing day 50 on the meadow unlocks Bracken Rise.
- Starting Bracken Rise asks twice, then loads a map with rock and woods, fitted to the screen.
- The HUD title names the level and returns to the menu.
- Start over returns to the menu and keeps unlocks; Reset everything wipes both.
- An existing save from before this change still loads and is offered as `Continue`.
