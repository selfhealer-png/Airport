# Depth Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add paid groundworks over woods/water/rock, replace the terminal level ladder with placeable modules, ship two scenarios and a six-step tutorial, and add a water level that needs bridging.

**Architecture:** Four subsystems sharing three seams — the `check…`/`apply…` pairs in `src/sim/build.ts`, the snapshot format, and the menu. Built in dependency order: groundworks (Tasks 1–4) unblock the water level and one scenario; modular terminals (5–11) are self-contained but need a balance pass; scenarios (12–13) reuse the snapshot's job of describing a whole airport; the tutorial (14–15) goes last so it teaches settled rules.

**Tech Stack:** TypeScript 7 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vite, Vitest, canvas 2D. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-18-depth-pack-design.md`

## Global Constraints

- **`src/sim/` must not import from `render/`, `ui/`, `input/` or `sprites/`.** The simulation is plain state plus reducers.
- **Balance numbers live in `src/content/`**, never inlined into `sim/` logic.
- TypeScript is strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Indexed access yields `T | undefined` — handle it, do not assert with `!` unless the surrounding code already establishes the invariant.
- `@/` maps to `./src/`. Node 24 lives at `C:\Program Files\nodejs`; Bash needs `export PATH="$PATH:/c/Program Files/nodejs";` first, or use PowerShell.
- **Do not write files with Python's `pathlib.write_text()`** — it defaults to cp1252 here and truncates on non-ASCII. Use the editor tools, or pass `encoding='utf-8'`.
- **Large TypeScript files written through Bash heredocs have failed to parse.** Use the Write/Edit tools for anything substantial.
- `SNAPSHOT_VERSION` becomes **8** exactly once, in Task 3. No later task bumps it again.
- Every task ends green: `npm test`, `npm run typecheck`, `npm run build`.
- Commit at the end of every task.
- Comments explain **why**, matching the density and voice of the surrounding code. This codebase documents the reasoning behind load-bearing decisions; match that.

---

### Task 1: Groundworks — the tile rule and the mask

**Files:**
- Modify: `src/sim/types.ts` (replace `isBuildable`)
- Modify: `src/sim/airport.ts` (`createAirport`, new accessors)
- Modify: `src/content/costs.ts` (add `GROUNDWORK_COST`)
- Test: `tests/groundworks.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `type BuildKind = 'structure' | 'taxiway' | 'road'`; `terrainAllows(terrain: Terrain, worked: boolean, kind: BuildKind): boolean`; `Airport.groundworks: Uint8Array`; `hasGroundwork(airport: Airport, x: number, y: number): boolean`; `addGroundwork(airport: Airport, x: number, y: number): void`; `GROUNDWORK_COST: Readonly<Record<Terrain, number>>`.

- [ ] **Step 1: Write the failing test**

Create `tests/groundworks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { terrainAllows } from '@/sim/types';

describe('what worked ground will carry', () => {
  it('lets anything onto grass', () => {
    expect(terrainAllows('grass', false, 'structure')).toBe(true);
    expect(terrainAllows('grass', false, 'road')).toBe(true);
  });

  it('refuses every obstacle until the work is paid for', () => {
    for (const terrain of ['woods', 'water', 'rock'] as const) {
      expect(terrainAllows(terrain, false, 'road')).toBe(false);
      expect(terrainAllows(terrain, false, 'structure')).toBe(false);
    }
  });

  it('makes felled woods ordinary ground', () => {
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
    // Rock splits the airside absolutely: that is what makes it a different obstacle from
    // water rather than a dearer one.
    expect(terrainAllows('rock', true, 'road')).toBe(true);
    expect(terrainAllows('rock', true, 'taxiway')).toBe(false);
    expect(terrainAllows('rock', true, 'structure')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/groundworks.test.ts`
Expected: FAIL — `terrainAllows` is not exported.

- [ ] **Step 3: Implement the rule**

In `src/sim/types.ts`, **delete** `isBuildable` and add:

```ts
/** What is being put on a tile. Terrain that has been worked carries different things. */
export type BuildKind = 'structure' | 'taxiway' | 'road';

/**
 * Whether a tile will take something.
 *
 * The obvious design — pay per tile, obstacle becomes grass — makes terrain a money tax: it
 * slows a rich player down and stops nobody, and every obstacle level eventually plays as the
 * meadow with a bill attached. So what an obstacle becomes depends on what it was, and the
 * difference is what may *cross* it rather than what it costs. Woods become ordinary ground.
 * A bridge carries both networks but holds no building. A tunnel carries a road alone, which
 * is what stops a runway and its apron ever sitting on opposite sides of a ridge.
 *
 * Pure, and takes no `Airport`: the caller looks the mask up. That keeps the rule readable
 * beside the terrain it is about.
 */
export function terrainAllows(terrain: Terrain, worked: boolean, kind: BuildKind): boolean {
  if (terrain === 'grass') return true;
  if (!worked) return false;
  if (terrain === 'woods') return true;
  if (terrain === 'water') return kind !== 'structure';
  return kind === 'road';
}
```

In `src/content/costs.ts`:

```ts
/**
 * Groundworks, per tile, by what is underneath.
 *
 * Felling is priced against a runway tile — a nuisance, not a project. A bridge or a tunnel
 * is priced against a stand, because that is the scale of decision it is: a five-tile
 * causeway is £4,500 and you will think about the route.
 */
export const GROUNDWORK_COST: Readonly<Record<Terrain, number>> = {
  grass: 0,
  woods: 180,
  water: 900,
  rock: 1_400,
};
```

(Import `Terrain` from `@/sim/types` there.)

In `src/sim/airport.ts`, add `groundworks: new Uint8Array(map.width * map.height)` to `createAirport`, add the field to the `Airport` interface in `types.ts` beside `roads` with a comment saying it means "this ground has been paid for; what that bought is read from the terrain underneath", and add:

```ts
export function hasGroundwork(airport: Airport, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= airport.map.width || y >= airport.map.height) return false;
  return airport.groundworks[y * airport.map.width + x] === 1;
}

export function addGroundwork(airport: Airport, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= airport.map.width || y >= airport.map.height) return;
  airport.groundworks[y * airport.map.width + x] = 1;
}
```

- [ ] **Step 4: Fix the one existing call site so the suite compiles**

`src/sim/build.ts:90` currently reads `if (!isBuildable(terrain)) return 'terrain-blocked';`. Change it to `if (!terrainAllows(terrain, hasGroundwork(airport, x, y), 'structure'))` for now — Task 2 threads the real `kind` through. Update the import.

- [ ] **Step 5: Run the suite**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Add the groundworks mask and the rule for what worked ground carries"
```

---

### Task 2: Groundworks — check and apply

**Files:**
- Modify: `src/sim/build.ts`
- Test: `tests/groundworks.test.ts` (extend)

**Interfaces:**
- Consumes: `terrainAllows`, `hasGroundwork`, `addGroundwork`, `GROUNDWORK_COST` from Task 1.
- Produces: `checkClearRun(state, x0, y0, x1, y1): BuildCheck`; `applyClearRun(state, quote, x0, y0, x1, y1): void`; `BuildError` gains `'nothing-to-clear'`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/groundworks.test.ts`. Build a small level with `terrainFrom` and a game with `createGame`, give it plenty of cash, then:

```ts
it('prices a run by what is under each tile', () => {
  // A drag across mixed ground is quoted correctly rather than at one blended rate.
  const quote = checkClearRun(state, 2, 0, 2, 3); // grass, woods, water, rock
  expect(isAffordableQuote(quote) && quote.cost).toBe(0 + 180 + 900 + 1_400);
});

it('charges nothing twice for ground already worked', () => {
  applyClearRun(state, checkClearRun(state, 2, 1, 2, 1) as BuildQuote, 2, 1, 2, 1);
  expect(checkClearRun(state, 2, 1, 2, 1)).toBe('nothing-to-clear');
});

it('refuses a run that is all grass', () => {
  expect(checkClearRun(state, 0, 0, 0, 3)).toBe('nothing-to-clear');
});

it('will not put a runway on a bridge', () => {
  clear(state, waterTiles);
  expect(checkRunway(state, waterX, 0, 4, 'grass', 'civil')).toBe('terrain-blocked');
});

it('will not run a taxiway through a tunnel', () => {
  clear(state, rockTiles);
  expect(checkTaxiwayRun(state, rockX, 0, rockX, 2)).toBe('terrain-blocked');
});

it('runs a road through a tunnel', () => {
  clear(state, rockTiles);
  expect(isAffordableQuote(checkRoadRun(state, rockX, 0, rockX, 2))).toBe(true);
});

it('leaves groundworks alone when demolishing what sits on them', () => {
  // Nothing un-fells a wood. Demolishing the road on a bridge must not refund the bridge.
  ...
  expect(hasGroundwork(state.airport, x, y)).toBe(true);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -- tests/groundworks.test.ts`
Expected: FAIL — `checkClearRun` not exported.

- [ ] **Step 3: Thread the kind through `tileIsFree`**

```ts
function tileIsFree(airport: Airport, x: number, y: number, kind: BuildKind): BuildError | null {
  const terrain = terrainAt(airport.map, x, y);
  if (terrain === undefined) return 'off-map';
  if (!terrainAllows(terrain, hasGroundwork(airport, x, y), kind)) return 'terrain-blocked';
  if (occupantAt(airport, x, y) !== null) return 'occupied';
  return null;
}
```

Pass the literal at each call site: `'road'` from `checkRoadRun`; `'taxiway'` from `checkTaxiway` and `checkTaxiwayRun`; `'structure'` everywhere else (runway, extend, grow, stand, helipad, facility).

- [ ] **Step 4: Add the clear run**

`checkClearRun` walks the line (it is straight — reuse whatever `checkRoadRun` uses to validate and iterate), sums `GROUNDWORK_COST[terrain]` for each tile that is an obstacle and not already worked, and returns `'nothing-to-clear'` when that total covers no tiles. It does **not** care what occupies the tile — there is nothing on an unworked obstacle to be occupied by. Return `afford(state, cost)`.

`applyClearRun` spends the quote and calls `addGroundwork` for every obstacle tile in the run.

Add `'nothing-to-clear'` to `BuildError` and a line to `explainBuildError`: `'There is nothing to clear there.'`

Confirm `checkDemolish`/`applyDemolish` never touch `groundworks` — add a one-line comment there saying groundworks are permanent, so the next reader does not "fix" it.

- [ ] **Step 5: Run the suite**

Run: `npm test && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Price and apply groundworks, and let each build say what it needs the ground to carry"
```

---

### Task 3: Groundworks — save, tool, drawer chip

**Files:**
- Modify: `src/save/snapshot.ts` (version 8, `groundworks`)
- Modify: `src/ui/placement.ts` (`{ kind: 'clear' }`)
- Modify: `src/ui/drawer.ts` (the chip)
- Test: `tests/save.test.ts`, `tests/placement.test.ts` (extend)

**Interfaces:**
- Consumes: `checkClearRun`/`applyClearRun` from Task 2.
- Produces: `Tool` gains `{ readonly kind: 'clear' }`; `SNAPSHOT_VERSION = 8`; `Snapshot.groundworks: readonly number[]`.

- [ ] **Step 1: Write the failing tests**

In `tests/save.test.ts`, a test that groundworks survive a round trip, and that a version-7 snapshot is rejected. In `tests/placement.test.ts`, that a `clear` drag over a wooded column resolves to that column's tiles with a quote, and that `isLineTool({ kind: 'clear' })` is true.

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -- tests/save.test.ts tests/placement.test.ts`

- [ ] **Step 3: Implement**

`snapshot.ts`: bump `SNAPSHOT_VERSION` to 8; add `groundworks` as sparse row-major indices exactly as `taxiways` and `roads` are done, in `toSnapshot` and `fromSnapshot`, with the same "drop entries outside the map rather than failing the whole load" validation.

`placement.ts`: add `{ readonly kind: 'clear' }` to `Tool`; add it to `isLineTool`; in `resolvePlacement` and `commitPlacement` route it to `checkClearRun`/`applyClearRun`. It snaps to an axis like a taxiway.

`drawer.ts`: add a "Groundworks" chip in the same group as roads, with a subtitle naming the three prices (`Fell £180 · Bridge £900 · Tunnel £1,400`). Follow the existing chip construction exactly.

- [ ] **Step 4: Run the suite**

Run: `npm test && npm run typecheck && npm run build`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Save groundworks, and give the player a chip to drag them out"
```

---

### Task 4: Groundworks — drawing what was bought

**Files:**
- Modify: `src/render/renderer.ts`
- Modify: `src/sprites/palette.ts` if new colours are needed

**Interfaces:**
- Consumes: `hasGroundwork` from Task 1.
- Produces: nothing other tasks read.

- [ ] **Step 1: Draw the three appearances**

A player who cannot see what they bought will buy it twice. In the terrain pass, when `hasGroundwork` is set, draw instead of the raw terrain:

- **woods** — the grass tile, with two or three stump marks, so felled ground reads as *worked* grass rather than as ground that was always clear.
- **water** — the water tile with decking across it: planks perpendicular to the run, drawn from the tile's own snapped edge to its neighbour's snapped edge like every other tile in this renderer, so no seams appear at fractional zoom.
- **rock** — the rock tile with a cut mouth: a darker arch, joined tile-to-tile along the run the way `drawGuideLines()` joins taxiways.

Bridges and tunnels should read as continuous where they run in a line. Follow `drawGuideLines()` for the neighbour-checking pattern.

- [ ] **Step 2: Verify by eye**

Run `npm run dev`, place each of the three on Bracken Rise, screenshot, and confirm each is distinguishable from unworked terrain at the fitted zoom on a 390×560 viewport. A measurement is not enough here — the whole point is whether it is legible.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "Draw stumps, decking and tunnel mouths so worked ground reads as worked"
```

---

### Task 5: Modular terminals — the content

**Files:**
- Modify: `src/content/buildings.ts` (delete the terminal ladder, add modules)
- Modify: `src/content/costs.ts` (`FACILITY_COST`, `LEVELLED_FACILITIES`)
- Modify: `src/sim/types.ts` (`FacilityType`)
- Test: `tests/terminal-modules.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type FacilityType =
    | 'tower' | 'terminal' | 'fuel-farm' | 'fire-station'
    | 'shop' | 'gate-hall' | 'baggage-hall' | 'border-control';

  export const TERMINAL_MODULES: ReadonlySet<FacilityType>;   // shop, gate-hall, baggage-hall, border-control
  export const TERMINAL_CORE_CAPACITY = 120;
  export const NO_TERMINAL_CAPACITY = 60;
  export const GATE_HALL_CAPACITY = 260;
  export function passengerRevenue(baggageHalls: number, retailUnits: number): number;
  export function baggageTurnaroundFactor(halls: number): number;
  ```

- [ ] **Step 1: Write the failing test**

```ts
describe('what a terminal earns per head', () => {
  it('pays the bare gate fare with no modules', () => {
    expect(passengerRevenue(0, 0)).toBe(PASSENGER_FARE);
  });

  it('adds baggage and retail additively', () => {
    // Additive rather than multiplied: modules are already gated by land and by the
    // retail-per-gate-hall cap, so a second multiplier would compound past what the
    // campaign can absorb — which is exactly how shops ran away once before.
    expect(passengerRevenue(1, 2)).toBe(PASSENGER_FARE + 4 + 6);
  });
});

describe('baggage and turnaround', () => {
  it('does nothing without a baggage hall', () => {
    expect(baggageTurnaroundFactor(0)).toBe(1);
  });

  it('stops improving after three halls', () => {
    expect(baggageTurnaroundFactor(3)).toBeCloseTo(0.7);
    expect(baggageTurnaroundFactor(9)).toBeCloseTo(0.7);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Implement**

Delete `TerminalLevel`, `TERMINAL_LEVELS`, `terminalLevel`, `ADDITIONAL_TERMINAL_COST_MULTIPLIER` and `SHOP_REVENUE_PER_PASSENGER`'s old shape. Add:

```ts
/** A terminal with no modules: enough for a commuter's worth of people. */
export const TERMINAL_CORE_CAPACITY = 120;

/**
 * No terminal at all — a windsock and a gate in a hedge.
 *
 * Kept as a floor rather than dropped to zero: it is what makes day one pay, and without it
 * the opening of every campaign quietly breaks.
 */
export const NO_TERMINAL_CAPACITY = 60;

export const GATE_HALL_CAPACITY = 260;
export const BAGGAGE_REVENUE_PER_PASSENGER = 4;
export const RETAIL_REVENUE_PER_PASSENGER = 3;

export function passengerRevenue(baggageHalls: number, retailUnits: number): number {
  return (
    PASSENGER_FARE +
    baggageHalls * BAGGAGE_REVENUE_PER_PASSENGER +
    retailUnits * RETAIL_REVENUE_PER_PASSENGER
  );
}

/**
 * Baggage halls free stands sooner, which is what ties the terminal to apron throughput
 * rather than only to money. Capped at three: past that the constraint is the apron.
 */
export function baggageTurnaroundFactor(halls: number): number {
  return 1 - 0.1 * Math.min(halls, 3);
}
```

`FACILITY_COST` becomes `Record<Exclude<FacilityType, 'tower'>, number>` with `terminal: 900`, `shop: 3_500`, `'gate-hall': 1_100`, `'baggage-hall': 2_200`, `'border-control': 14_000`, keeping fuel farm and fire station as they are. `LEVELLED_FACILITIES` becomes `new Set(['tower'])`.

Leave the rest of the codebase broken at this point if it must be — Tasks 6–8 repair it. Do **not** commit a broken tree: if `npm run typecheck` cannot pass at the end of this task, fold Tasks 5 and 6 into one commit.

- [ ] **Step 4: Commit (see the caveat above)**

---

### Task 6: Modular terminals — which modules are working

**Files:**
- Modify: `src/sim/connectivity.ts` (`Services` gains terminal membership)
- Modify: `src/sim/airport.ts` (`workingTerminalCapacity`, `workingShops` → module counts)
- Test: `tests/terminal-modules.test.ts` (extend)

**Interfaces:**
- Consumes: Task 5's content.
- Produces:
  ```ts
  /** Facility ids of modules attached to a working core through working modules. */
  interface Services { readonly terminalModules: ReadonlySet<string>; /* …existing… */ }

  export function workingTerminalCapacity(airport, services): {
    passengerCapacity: number;
    revenuePerPassenger: number;
    baggageHalls: number;
    borderControl: boolean;
  };
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it('counts nothing without a core', () => {
  // A gate hall in a field is a shed.
  expect(capacity.passengerCapacity).toBe(NO_TERMINAL_CAPACITY);
});

it('counts a module touching the core', () => { … });

it('counts a module touching another module', () => {
  // A concourse is a chain: core–gate–gate. The far gate must count.
});

it('drops a module the chain no longer reaches', () => {
  // Demolish the middle of the chain and the far module stops working, even though it is
  // still on a road.
});

it('drops a module with no road of its own', () => { … });

it('drops every module when the core loses its road', () => {
  // The core is what makes the rest a terminal.
});
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement**

In `buildServices()`, after the road network is known: flood-fill from every road-served `terminal` core over orthogonally-adjacent, road-served facilities whose type is in `TERMINAL_MODULES`. Collect their ids into `terminalModules`.

Rewrite `workingTerminalCapacity` to sum over `terminalModules`: capacity is `TERMINAL_CORE_CAPACITY` per working core plus `GATE_HALL_CAPACITY` per gate hall, or `NO_TERMINAL_CAPACITY` when no core works. `revenuePerPassenger` is `passengerRevenue(baggageHalls, retailUnits)`. Delete `workingShops` and `workingTerminalLevel`'s shop role; keep `workingTerminalLevel` only if something still needs "is there a terminal at all" — otherwise delete it and fix callers.

- [ ] **Step 4: Run the suite**

Run: `npm test && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Make a terminal a chain of modules rather than a building with a level"
```

---

### Task 7: Modular terminals — placing them

**Files:**
- Modify: `src/sim/build.ts` (`checkFacility`, `checkUpgradeFacility`, `facilityCost`, `newTerminalCost`)
- Test: `tests/build.test.ts` (extend)

**Interfaces:**
- Consumes: Tasks 5 and 6.
- Produces: `BuildError` gains `'needs-terminal-core'`. `newTerminalCost` is deleted.

- [ ] **Step 1: Write the failing tests**

```ts
it('refuses a module that touches no terminal', () => {
  expect(checkFacility(state, x, y, 'gate-hall')).toBe('needs-terminal-core');
});

it('accepts a module touching a core', () => { … });

it('accepts a module touching another module', () => { … });

it('refuses a retail unit past the gate-hall count', () => {
  // Each concourse has its own shops. Land alone is too weak a cap on retail, which earns
  // per passenger of every flight.
  expect(checkFacility(state, x, y, 'shop')).toBe('no-shop-slot');
});

it('refuses to upgrade a terminal', () => {
  expect(checkUpgradeFacility(state, terminalId)).toBe('max-level');
});

it('lets a second core be built at the plain price', () => {
  // Capacity is additive now, so there is no cheap-shed exploit left to price against.
});
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement**

In `checkFacility`, when `type` is in `TERMINAL_MODULES`: require an orthogonally adjacent facility that is a `terminal` core or another module (`'needs-terminal-core'` otherwise). This is a **build-time** adjacency check against what is placed — not the road-served working set, because refusing to build next to a core whose road is not laid yet would make the order of building matter for no reason. For `'shop'`, additionally require `shopsOf(airport).length < gateHalls(airport)`, returning `'no-shop-slot'`.

Delete `newTerminalCost` and the terminal branch of `checkUpgradeFacility` (a terminal now returns `'max-level'` like a fuel farm). `facilityCost(type, level)` keeps its signature but reads `FACILITY_COST` for everything except the tower.

Check `applyDemolish` handles modules — they are ordinary facilities, so it should already, but confirm a demolished core leaves its modules standing-but-dead rather than crashing.

- [ ] **Step 4: Run the suite**

Run: `npm test && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Place terminal modules against the terminal, and cap retail at the gate halls"
```

---

### Task 8: Modular terminals — revenue and turnaround

**Files:**
- Modify: `src/sim/step.ts`
- Test: `tests/passengers.test.ts` (rewrite the terminal-level parts)

**Interfaces:**
- Consumes: Tasks 5–7.
- Produces: nothing new.

- [ ] **Step 1: Rewrite the failing tests**

`tests/passengers.test.ts` currently asserts against `terminalLevel(n)` and `fareMultiplier`. Rewrite those cases against module counts. Add:

```ts
it('turns an aeroplane round faster with baggage halls', () => {
  // Two identical airports, one with three baggage halls: the stand frees measurably sooner.
});

it('still pays the landing fee when the terminal is swamped', () => {
  // Unchanged behaviour, pinned because the revenue path moved.
});
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement**

Replace the `fareMultiplier` use with `revenuePerPassenger` from `workingTerminalCapacity`. Multiply the turnaround by `baggageTurnaroundFactor(baggageHalls)` alongside `FUEL_FARM_TURNAROUND_FACTOR`.

- [ ] **Step 4: Run the suite**

Run: `npm test && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Pay per head from the modules, and let baggage halls free the stands sooner"
```

---

### Task 9: Border control

**Files:**
- Modify: `src/content/aircraft.ts` (`requiresBorderControl`)
- Modify: `src/sim/types.ts` (`AircraftClass`, `BlockReason`)
- Modify: `src/sim/assignment.ts` (`structuralBlock`)
- Modify: `src/sim/step.ts` (`STRUCTURAL_REASONS`)
- Modify: `src/ui/debrief.ts` (wording)
- Test: `tests/sim.test.ts`, `tests/debrief.test.ts` (extend)

**Interfaces:**
- Consumes: Task 6's `borderControl` flag.
- Produces: `BlockReason` gains `'no-border-control'`.

- [ ] **Step 1: Write the failing tests**

```ts
it('turns a widebody away with no border control', () => {
  expect(reasonFor('widebody')).toBe('no-border-control');
});

it('takes a widebody once border control is working', () => { … });

it('never asks a domestic class for border control', () => {
  expect(reasonFor('narrowbody')).not.toBe('no-border-control');
});

it('diverts rather than holding, because waiting cannot help', () => {
  expect(STRUCTURAL_REASONS.has('no-border-control')).toBe(true);
});

// tests/debrief.test.ts
it('explains a border-control loss', () => {
  expect(text).toContain('border control');
});
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement**

Add `requiresBorderControl: boolean` to `AircraftClass` and set it `true` for `widebody` and `superheavy`, `false` for the other seventeen. In `structuralBlock`, check it **after** the runway use and length checks and before the transient ones — a class that cannot use this runway at all is not a border-control problem. Add the reason to `STRUCTURAL_REASONS`. Add debrief wording: something like `'no border control — international arrivals need somewhere to clear'`.

`sim/advice.ts` picks this up through `tomorrowsTraffic()` automatically because that calls `structuralBlock()`; verify with a test rather than assuming.

- [ ] **Step 4: Run the suite**

Run: `npm test && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Gate the widebodies behind border control, warned in the forecast like everything else"
```

---

### Task 10: Modular terminals — drawer and advice

**Files:**
- Modify: `src/ui/drawer.ts`
- Modify: `src/sim/advice.ts`
- Modify: `src/sprites/data.ts` and `src/render/renderer.ts` if modules need their own sprites
- Test: `tests/advice.test.ts` (extend)

- [ ] **Step 1: Write the failing advice tests**

```ts
it('warns about a gate hall that reaches no terminal', () => { … });
it('warns when retail is capped by gate halls', () => { … });
it('warns when the terminal is swamped and no gate hall is planned', () => { … });
```

- [ ] **Step 2: Implement**

Drawer: replace the terminal upgrade chip with a "Terminal" core chip plus four module chips, grouped together and priced. `advice.ts`: replace every `TERMINAL_LEVELS`/`shopSlots` reference with module counts, and add the three warnings above.

Modules need to be distinguishable on the map. Give each a sprite in `src/sprites/data.ts` following the existing authoring rules (rectangular, palette keys only, `.` for transparent) — `tests/sprites.test.ts` will parse them. Check `art-preview.html` after.

- [ ] **Step 3: Run the suite, then verify in the browser**

Run: `npm test && npm run typecheck && npm run build`, then place a core and each module on a dev server and confirm they read distinctly.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Give the modules chips, sprites and advice of their own"
```

---

### Task 11: Balance the campaign against modular terminals

**Files:**
- Modify: `scripts/run-day.ts` (the auto-player must build modules)
- Modify: `src/content/buildings.ts` / `src/content/costs.ts` (numbers only)

- [ ] **Step 1: Teach the auto-player about modules**

It currently upgrades a terminal by level. It must now place a core and extend it: gate halls when passengers are being turned away, a baggage hall when stands are the constraint, retail up to the gate-hall cap, border control when a widebody is forecast. Respect the layout rules the harness already depends on — a road cannot be crossed by a taxiway, and a stand past the end of a runway needs a vertical spine.

- [ ] **Step 2: Run the campaign**

Run: `npm run day -- 50` on seed 42, and again on two other seeds.

- [ ] **Step 3: Read the output against the intended shape**

The known-good shape from before this change: days 1–3 of light traffic pay for the day-4 commuter upgrade from a £1,500-ish opening balance. What to check now:

- No wall — no run of diversions the player never spends its way out of.
- No `Licence revoked`.
- The late campaign should run away **less** than before, not more: modules are a genuine sink. If it runs away more, gate halls are too cheap for what they earn.
- Passengers turned away should be a real pressure in the middle campaign and largely solved by day 45.

Adjust `GATE_HALL_CAPACITY`, the module costs and `BAGGAGE_REVENUE_PER_PASSENGER` — **numbers in `content/` only**. Do not change mechanics here.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Balance the campaign against a terminal you extend rather than upgrade"
```

---

### Task 12: Scenarios — the content

**Files:**
- Create: `src/content/scenarios.ts`
- Test: `tests/scenarios.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export interface Scenario {
    readonly id: string;
    readonly name: string;
    readonly brief: string;
    readonly levelId: string;
    readonly startDay: number;
    readonly cash: number;
    readonly build: (airport: Airport) => void;
  }
  export const SCENARIOS: readonly Scenario[];
  export function scenarioById(id: string): Scenario | undefined;
  export function startScenario(scenario: Scenario): GameState;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it('starts every scenario on a level that exists', () => { … });

it('builds every scenario without an illegal placement', () => {
  // The `add…` helpers do not validate, so a scenario can describe an airport the build
  // system would have refused. Assert every runway, stand and facility sits on ground that
  // `terrainAllows`, and that nothing overlaps.
});

it('gives Grass Roots an airport that cannot take its own traffic', () => {
  // The premise of the scenario, pinned: run `tomorrowsTraffic()` on day 24 and assert at
  // least one structural block. A scenario that is already solved is not a scenario.
});

it('leaves Overspill with no room for a large stand', () => {
  // Its premise: every free tile adjacent to the apron fails `checkStand(…, 'large')`.
});

it('round-trips a scenario through the snapshot', () => {
  // Scenarios save like any other game.
});
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Author the two scenarios**

**Grass Roots** — Hensley Meadow, day 24, £9,000. Three grass strips of 5–6 tiles, four small stands, roads to all of them, a bare terminal core, no tower, no fuel farm. The strips sit where the long runway wants to go.

**Overspill** — Bracken Rise, day 30, £26,000. One 12-tile asphalt runway, a level-2 tower, a terminal core with two gate halls and a retail unit, eleven small stands filling the flat ground, roads and taxiways throughout. No room for a medium or large stand without demolishing.

`startScenario` creates the airport, runs `build`, and returns a `GameState` with the scenario's day and cash. Getting `nextEntityId` right matters — set it past the highest id the builder used, or a later build will collide.

- [ ] **Step 4: Run the suite**

Run: `npm test && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Author two scenarios: a club that never modernised, and an apron with no room left"
```

---

### Task 13: Scenarios — menu and progress

**Files:**
- Modify: `src/ui/menu.ts` (replace the "Coming soon" row)
- Modify: `src/save/progress.ts` (completed scenarios)
- Modify: `src/main.ts` (start a scenario)
- Test: `tests/menu.test.ts`, `tests/progress.test.ts` (extend)

**Interfaces:**
- Consumes: Task 12.
- Produces: `MenuHandlers` gains `onStartScenario(id: string): void`; `progress.ts` gains `completedScenarios` / `addCompletedScenario`.

- [ ] **Step 1: Write the failing tests**

```ts
it('lists every scenario as startable, locked by nothing', () => {
  // Scenarios are side content: finishing one never unlocks a level, and no level gates one.
});

it('marks a finished scenario as replayable', () => { … });

it('keeps scenario progress apart from level progress', () => { … });
```

- [ ] **Step 2: Implement**

`menuRows` gains a scenario section built from `SCENARIOS`, each row showing the brief and always `'start'` or `'replay'` — never `'locked'`. Wire `onStartScenario` in `main.ts` to `startScenario` + the existing "this replaces your save" confirmation, then straight into planning. Record completion where level completion is recorded.

- [ ] **Step 3: Run the suite, then check the menu on a phone viewport**

Run: `npm test && npm run typecheck && npm run build`. Then load the menu at 390×560 and confirm the scenario briefs do not push the panel past the viewport — `minmax(0, …)` on grid tracks.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Put the scenarios in the menu, unlocked and tracked apart from the campaign"
```

---

### Task 14: Tutorial — the steps

**Files:**
- Create: `src/content/tutorial.ts`
- Test: `tests/tutorial.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export interface TutorialStep {
    readonly id: string;
    readonly text: string;
    readonly done: (state: GameState) => boolean;
    readonly where: (state: GameState) => readonly TileIndex[];
  }
  export const TUTORIAL_STEPS: readonly TutorialStep[];
  export function currentStep(state: GameState): TutorialStep | null;
  ```

- [ ] **Step 1: Write the failing test**

The important one is that the sequence is completable at all:

```ts
it('walks a real game from an empty meadow to an open airport', () => {
  // Drive a GameState through every step with the same check…/apply… pairs the player uses,
  // asserting each step reports done only after the build that satisfies it. This is the
  // only way to know the sequence can be finished — the steps are prose otherwise.
  const state = createGame(LEVEL_MEADOW, 42);
  expect(currentStep(state)?.id).toBe('runway');
  // …build a runway…
  expect(currentStep(state)?.id).toBe('runway-road');
  // …and so on through all six.
});

it('never points at a tile that is off the map', () => {
  for (const step of TUTORIAL_STEPS) {
    for (const tile of step.where(state)) {
      expect(terrainAt(state.airport.map, tile.x, tile.y)).toBeDefined();
    }
  }
});

it('skips ahead when a player builds out of order', () => {
  // Nothing is gated. A player who lays the stand first must not be told to lay it again.
});
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Implement the six steps**

Exactly as the spec lists them, with `done` reusing `runwayHasRoad`, `standHasRoad` and `buildLinks` from `sim/connectivity.ts` — the same functions the simulation uses, so the tutorial cannot congratulate the player on something that will not work. `currentStep` returns the first step whose `done` is false, or `null`.

The suggested runway column in step 1 should be somewhere with room for the rest of the airport around it — not the map edge.

- [ ] **Step 4: Run the suite**

Run: `npm test && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Write the six tutorial steps as predicates over a real game state"
```

---

### Task 15: Tutorial — showing it

**Files:**
- Create: `src/ui/tutorial.ts`
- Modify: `src/main.ts`, `src/render/renderer.ts`, `index.html`, the stylesheet
- Modify: `src/save/progress.ts` (`tutorialDone`)

- [ ] **Step 1: Build the panel**

`ui/tutorial.ts` owns a DOM panel showing `currentStep().text` and a "Skip" button. It lives **in layout** in the planning bar — never floating over the map. This project has already shipped an overlay that covered the field with advice about the field; do not ship the second one. When there is no step, the panel takes no vertical space but stays in the flow (`visibility: hidden` or removal, not `position: fixed`).

- [ ] **Step 2: Outline the target tiles**

Extend `BuildPreview`, or add a sibling field on whatever the renderer already takes, to carry `highlight?: readonly TileIndex[]`. Stroke them with the same tile-edge-to-neighbour-edge rule the rest of the renderer uses. Reuse the preview outline added for the build crosshair.

- [ ] **Step 3: Wire it up**

Refresh the panel wherever `drawer.refresh(state)` is already called. Show the tutorial only when: the level is Hensley Meadow, `state.day === 1`, nothing is built, and `tutorialDone` is not set in progress. "Skip" sets `tutorialDone` permanently. Finishing step 6 sets it too.

- [ ] **Step 4: Verify on a phone viewport**

Run `npm run dev`, load at 390×560 with a wiped save, and walk all six steps with real drags. Confirm: the panel never covers the map, the outline is visible at the fitted zoom, and the steps advance. Screenshot each step — a layout measurement is not enough, as this project has learned twice.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Show the tutorial in the planning bar, with the target outlined on the map"
```

---

### Task 16: Tidewater — the water level

**Files:**
- Modify: `src/content/levels.ts`
- Test: `tests/levels.test.ts` (extend)

- [ ] **Step 1: Extend the level invariant tests**

The existing connectivity invariant assumes obstacles are permanent. It must now account for groundworks: assert that the **grass** regions are reachable from one another *given* that water can be bridged and rock tunnelled, and that no grass region is sealed off by water alone in a way that makes the level unplayable. Add:

```ts
it('gives Tidewater buildable ground on both banks', () => { … });
it('forces a bridge: no single bank holds a runway and an apron', () => {
  // The premise of the map. If one bank can hold the whole airport, the water is scenery.
});
```

- [ ] **Step 2: Author `LEVEL_TIDEWATER`**

35×45, authored as a string block with `terrainFrom`. A tidal inlet cutting roughly across the middle, the flattest long runway ground on the far side from the natural apron. Some woods for the pressure valve. Add it to `LEVELS` after Bracken Rise.

- [ ] **Step 3: Run the suite and look at it**

Run: `npm test`. Then load it in the dev server and confirm it reads as a place rather than as noise.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Add Tidewater, a map you cannot build without bridging"
```

---

### Task 17: Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the four sections**

Following the existing voice — each section says what the rule is and **why it is that way**, including the version that was tried and rejected:

- **Groundworks**: the mask, the three terrains, and why clearing does not simply produce grass (a money tax that makes every obstacle level play as the meadow with a bill).
- **Modular terminals**: core plus chain-of-modules, why the fare multiplier and the capacity-weighted blend are gone, and why retail is capped at gate halls rather than at land.
- **Scenarios**: `startDay` doing the job of a win condition, and why explicit goals were left out.
- **Tutorial**: pure predicates reusing the simulation's own connectivity functions, and the in-layout panel rule.

Update the **Build order** section: what is now done, and what remains.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "Document the depth pack and what each rule is defending against"
```

---

## Self-review notes

- `SNAPSHOT_VERSION` is bumped in Task 3 only. Tasks 5–7 change the *contents* of `facilities` (new `FacilityType` values) but not the snapshot's shape — old saves are already rejected by the Task 3 bump, so no second bump is needed.
- Task 5 may leave the tree un-typecheckable on its own; the plan says to fold it into Task 6's commit rather than commit red.
- `workingTerminalLevel` and `workingShops` are deleted in Task 6. Anything still calling them (`advice.ts`, `drawer.ts`, `step.ts`, `tests/passengers.test.ts`) is repaired in Tasks 6, 8 and 10.
- `isBuildable` is deleted in Task 1 and has exactly one call site.
- `newTerminalCost` and `ADDITIONAL_TERMINAL_COST_MULTIPLIER` are deleted in Tasks 7 and 5.
