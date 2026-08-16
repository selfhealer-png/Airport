# Menu system and multiple levels

Date: 2026-08-16
Status: approved, ready for an implementation plan

## The problem

`main.ts` boots straight into a game: `loadGame() ?? createGame(LEVEL_MEADOW, 42)`. There is
exactly one level, `LEVEL_MEADOW`, and it is `filled(24, 36, 'grass')` — a flat field with
nothing in the way.

Meanwhile `Terrain` already supports `water`, `rock` and `woods`; the renderer has sprites for
all three; `isBuildable()` already refuses anything that is not grass; and a save already
stores the level's id and rehydrates the map from `content/levels.ts`. **The terrain system is
built and unused.** What is missing is a way to reach more than one map.

## Scope

This spec covers the **menu shell, the per-level unlock model, and one obstacle level**. Two
follow-ups are deliberately out of scope and get their own specs:

- **More levels** — water in particular, which is the strongest constraint because roads
  cannot cross it and it can split the landside network in two.
- **Terrain clearing costs** — paying to turn woods or rock into buildable ground. Until then
  obstacles are permanent, which is playable today: `isBuildable()` already makes them walls.

Scenarios appear in the menu as a visible, disabled entry. They are a later project.

## Decisions taken

| Question | Decision |
|---|---|
| How levels unlock | A campaign chain: finish one to unlock the next |
| Games in progress | One at a time; starting another level replaces it, after a confirmation |
| Unlock record | Stored separately from the game, so replacing a game never costs a level |
| First obstacle level | A mix of woods and rock |
| Scenarios | Visible placeholder, not implemented |

## Architecture

The app switches between menu and game by **restoring a different snapshot into the existing
`GameState`**, not by tearing down and rebuilding the game.

This is the option the codebase already argues for. `restoreInto()` exists precisely because
the app shell, the pointer handlers and the render loop all closed over the original state
object when they were wired up, so swapping it "would leave them driving a game nobody can
see". Undo already relies on this. Switching level is the same operation with a different
snapshot.

Two alternatives were considered and rejected:

- **Two screens with real lifecycles**, where `main.ts` becomes a router that constructs and
  destroys the game on entry and exit. Cleaner in principle, but it means unpicking 440 lines
  in which the `ResizeObserver`, the `requestAnimationFrame` loop, the pointer handlers and the
  drawer all capture `state`. Substantial risk for no gameplay gain.
- **A `'menu'` value on `GamePhase`.** Rejected outright: `sim/` must not know what a screen is.

### New and changed files

| File | Change |
|---|---|
| `src/ui/menu.ts` | **New.** Renders the menu; exports a pure `menuRows()` |
| `src/save/progress.ts` | **New.** The unlock record, on its own storage key |
| `src/content/levels.ts` | `terrainFrom()` parser; the new level; `LEVELS` grows |
| `src/main.ts` | Boot into the menu; enter/leave a level; HUD title button |
| `index.html` | `#menu` overlay; the HUD title becomes a button |
| `src/ui/styles.css` | Menu styles, including the `[hidden]` rule (see Risks) |
| `tests/levels.test.ts` | **New.** Parser plus map invariants across every level |
| `tests/progress.test.ts` | **New.** Unlock chain and progress storage |

## Screens and navigation

`index.html` gains a `#menu` overlay beside `#modal`. The game shell is built once at boot and
sits idle behind it.

**Entering a level.** Tapping a row calls `restoreInto(state, snapshot)` where the snapshot is
either the stored save or `toSnapshot(createGame(map, SEED))` for a fresh game. Using the
snapshot round trip rather than assigning a new `GameState` keeps the entry path provably
identical to the load path, and needs no new API. The menu then hides and `framed` is reset to
`false` so `relayout()` re-fits the map — levels may differ in size, and without this the new
map would be drawn at the previous level's zoom and offset.

**Leaving a level.** The level name in the HUD becomes a button that returns to the menu. It is
already on screen, already names the level, and costs no space on a phone. Leaving mid-day
loses that day, which is already true of a reload — "a day in progress is deliberately not
saved" — so it is the existing rule rather than a new one.

**Row states.**

| State | Shows |
|---|---|
| Locked | `Locked — complete Hensley Meadow first` |
| Unlocked, no game | `Start` |
| Unlocked, game in progress | `Continue — day 12` |
| Completed, no game | `✓ Completed · Play again` |

Because only one game exists at a time, at most one row is ever in the `Continue` state.
**In-progress beats completed**: replaying a level you have finished puts a game on it, and
that row then reads `Continue`, not `Play again`.

**A row asks twice whenever tapping it would discard the existing game** — that is, on any
unlocked row other than the one currently holding the game. `Continue` never confirms;
`Start` and `Play again` confirm whenever a game exists anywhere. This reuses the two-tap
pattern `resetButton` already uses in `main.ts`, rather than introducing a modal. That pattern
exists because on a phone the drawer sits under the thumb and a single stray tap must not
destroy an hour of work; replacing an airport is the same hazard.

**Completion** is recorded when the day-50 debrief is dismissed — the callback passed to
`showDebrief` when `state.day >= CAMPAIGN_DAYS`. Recording is idempotent, because the campaign
continues as a sandbox afterwards and every subsequent day also satisfies that condition.

**Scenarios** render as a section with one disabled row marked as coming later, so the absence
reads as a promise rather than a gap.

## Data and storage

Two keys, deliberately separate:

| Key | Holds |
|---|---|
| `airfield.save.v1` | The one in-progress game. Unchanged. |
| `airfield.progress.v1` | `{ version: number; completed: string[] }` |

Keeping the unlock record out of the game snapshot is what makes "one game at a time" safe:
replacing an airport, or tapping *Start over*, can never cost a level already earned.

`save/progress.ts` follows `save/storage.ts` exactly, including swallowing every error —
blocked storage or a full quota must degrade to "the game forgets", never to a crash.

**Unlocking is a pure function** so it is tested headlessly rather than through the DOM, the
way `ui/placement.ts` keeps drag logic out of the browser:

```ts
export function isUnlocked(levelId: string, completed: readonly string[]): boolean;
```

A linear chain over `LEVELS` order: the first level is always open, and level *N* is open when
level *N-1* appears in `completed`.

`menuRows(levels, completed, save)` is likewise pure, returning the row states above, so what
the menu *says* is testable without a browser.

**No `SNAPSHOT_VERSION` bump.** The snapshot already stores a level id and progress lives in a
new key, so this change leaves existing saves working. Worth stating plainly: the previous two
changes each reset the player's game, and this one does not.

### Seeds

Every level uses seed 42, as the meadow does today. The traffic is therefore identical across
maps and the terrain is the only variable, which suits a game whose stated philosophy is that
the player is "tested on their airport, not on their luck". A per-level seed is a one-line
change if that ever stops being the right call.

### Two behaviours that change

- **Start over** abandons the current game and returns to the menu instead of reloading the
  page. Unlocks are untouched. The menu gets its own two-tap **Reset everything** for wiping
  both keys.
- **`persist()` early-returns while the menu is showing.** Without this the `pagehide`
  autosave would write a game the player has just abandoned, which is the same class of bug the
  existing `wiping` latch exists to prevent.

## Level authoring

Terrain is authored as characters and parsed, exactly as sprites are:

```ts
const BRACKEN_RISE = terrainFrom([
  'ggggggrrggggggggggggffgg',
  'gggggrrrggggggggggggffgg',
  // …36 rows of 24
]);
```

`g` grass, `w` water, `r` rock, `f` woods. `terrainFrom()` validates that every row is the same
length and that every character is a real terrain key, so a typo fails a test rather than
producing a map with a hole in it — the contract `toPixelGrid()` already has for sprite data,
for the same reason.

### The new level

Working name **Bracken Rise**, trivially changed.

The design intent is that it must not play as "the meadow with holes in it". Rock across the
north-west so the obvious long-runway column shifts east; woods through the south-centre so the
apron cannot simply sprawl the way it does on the meadow. The player should have to choose a
shape rather than repeat the one they already know.

## Testing

Parser validation and the unlock chain are straightforward. The valuable work is a set of
**invariants asserted across every level in `LEVELS`**, so future maps inherit them:

1. **Dimensions match** the declared `width` and `height`.
2. **At least one column has 16 contiguous grass tiles.** The superheavy needs sixteen; without
   such a column the campaign is unwinnable on that map and nothing would say so.
3. **Every grass tile belongs to one connected region.** This is the one that matters most.
   `roadNetwork()` counts only the single largest connected run of road, so a map whose woods
   cut the buildable area in two would silently make one half permanently useless — a runway
   there could never be opened, and nothing on screen would explain why. Cheap to assert, and it
   rules out an entire class of unplayable map.

`save/progress.ts` gets the round-trip and graceful-degradation tests `save/storage.ts` has.
Menu rendering stays thin: `menuRows()` is tested headlessly and the DOM gets manual QA at
phone width, as the build drawer did.

## Risks and things that will bite

- **`#menu` needs an explicit `[hidden] { display: none }` rule.** A `display` declaration beats
  the user agent's `[hidden]`, which is why `#modal` and `#crash` already carry that rule at
  `styles.css:433`. Miss it and the menu scrims the whole game permanently.
- **The HUD title is currently static HTML** (`index.html:28`, `Hensley Meadow`). It has to
  become dynamic, driven from `state.airport.map.name`, or every level will claim to be the
  meadow.
- **Forgetting to reset `framed`** on entry draws the new map at the previous level's zoom, with
  no obvious cause. It is one line and easy to leave out.
- **Bracken Rise is not balance-checked.** `scripts/run-day.ts` hardcodes the meadow's column
  positions — `RUNWAY_X = 5`, `WEST_STAND_X = 8`, `STAND_ROWS` — and would build nonsense on a
  map with obstacles there. The harness stays meadow-only and CLAUDE.md should say so, rather
  than implying every level is auto-balanced.
- **The campaign is tuned against seed 42 on one map.** Measured with running costs disabled,
  seeds 99 and 3 clear only 42% and 24% of their traffic. New maps are a new balance target and
  should not be assumed to inherit the meadow's tuning.

## Out of scope

- Water levels, and any level beyond Bracken Rise.
- Terrain clearing costs.
- Scenarios beyond a disabled placeholder.
- Per-level seeds, per-level campaign lengths, or per-level economy tuning.
- Extending the day harness to other maps.
