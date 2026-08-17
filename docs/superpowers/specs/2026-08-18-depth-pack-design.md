# Depth pack: groundworks, modular terminals, scenarios, tutorial

Four subsystems, built together because they share three seams — the build system's
`check…`/`apply…` pairs, the save format, and the menu — and splitting them across four
save-format bumps would throw the player's progress away four times.

They are independent in play. The build order below is a dependency order, not a priority
order: groundworks first because scenarios and the new levels both lean on it, tutorial last
because it teaches rules the other three might still move.

---

## 1. Groundworks — clearing the ground

Water, rock and woods already exist in `Terrain` and are already refused by `isBuildable()`,
which has exactly one call site (`tileIsFree()` in `build.ts`). Today they are walls. They
become decisions.

### The rule that makes terrain a puzzle rather than a tax

The obvious design — pay per tile, obstacle becomes grass — is wrong, and it is worth saying
why, because it is the version that will keep suggesting itself. If clearing converts
everything to buildable ground, then terrain is a **money tax**: it slows a rich player down
and stops nobody. Every obstacle level eventually plays as the meadow with a bill attached,
and the whole point of authoring a map with a river through it evaporates the moment the
player can afford the river.

So what an obstacle becomes depends on what it was, and the difference is **what may cross
it**, not what it costs:

| Terrain | Groundwork | Carries |
| --- | --- | --- |
| `woods` | Felling | Anything. It becomes ordinary ground. |
| `water` | Bridge | Roads and taxiways. No runway, stand, helipad or building. |
| `rock` | Tunnel | Roads only. |

That gives the three obstacles genuinely different characters. Woods are a delay you buy your
way past — the pressure valve that stops a map being unwinnable. Water splits the **ground**
you can build on but lets both networks cross it, so an airport can straddle a river. Rock
splits the **airside** absolutely: a road can tunnel through, an aeroplane cannot, so a runway
and its apron can never sit on opposite sides of a ridge. That is exactly the constraint that
makes `roadNetwork()`'s single-connected-component rule interesting instead of a formality —
the landside can span what the airside cannot.

It also means `structuralBlock()` needs no new reason. A runway cut off from every stand by a
ridge already reports `no-taxi-link`, which is precisely what has happened.

### State

`Airport` gains `groundworks: Uint8Array`, a row-major mask alongside `taxiways` and `roads`,
1 where the ground has been paid for. What it means is read from the terrain underneath, so
one mask covers all three cases and no tile can be a bridge over grass.

`isBuildable(terrain)` is replaced by:

```ts
export type BuildKind = 'structure' | 'taxiway' | 'road';
export function terrainAllows(terrain: Terrain, worked: boolean, kind: BuildKind): boolean;
```

Pure, in `sim/types.ts`, taking no airport — the caller looks the mask up. `tileIsFree()` in
`build.ts` gains a `kind` parameter and every existing `check…` passes a literal. That is the
whole ripple.

### Cost

Per tile, in `content/costs.ts`:

```ts
export const GROUNDWORK_COST: Readonly<Record<Terrain, number>> = {
  grass: 0,       // nothing to do
  woods: 180,
  water: 900,
  rock: 1_400,
};
```

Felling is priced against a runway tile (grass £110, gravel £240) — a nuisance, not a project.
A bridge or a tunnel is priced against a *stand*, because that is the scale of decision it is:
a five-tile causeway is £4,500, roughly a large stand, and you will think about the route.

Groundworks are **permanent and non-refundable**. There is no un-felling a wood and no
demolishing a tunnel, so `checkDemolish` ignores the mask entirely. Undo still restores it,
because undo restores whole snapshots.

### The tool

One chip, "Groundworks", dragged as a line like a road, priced per tile by whatever is
underneath — so a single drag across a wooded slope onto rock is quoted correctly. Dragging
over grass is not an error; those tiles cost nothing and are skipped, exactly as dragging a
grass runway chip along a paved strip means "make it longer".

`checkClearRun` refuses only when the whole run is already worked or already grass
(`nothing-to-clear`).

### Rendering

Three appearances, because a player who cannot see what they bought will buy it twice: felled
ground reads as grass with stumps, a bridge as decking over water, a tunnel as a cut mouth in
the rock. Drawn procedurally in the renderer from the mask and the terrain, joining
tile-to-tile like the taxiway guide lines.

---

## 2. Modular terminals

The terminal stops being a building with a level and becomes a **footprint you extend**. This
is the largest change of the four and the only one that needs a balance pass afterwards.

### Shape

A terminal is a **core** (one tile) plus **modules** (one tile each), orthogonally connected
into a blob. A module works if it is road-served *and* reachable from a working core through a
chain of working modules — one flood fill in `buildServices()`, sitting beside the road
network and the taxi links it already computes.

Four module types, one per axis:

| Module | Cost | Effect |
| --- | --- | --- |
| Gate hall | £1,100 | +260 passengers a day |
| Baggage hall | £2,200 | +£4 a head, and shortens every turnaround |
| Retail unit | £3,500 | +£3 a head |
| Border control | £14,000 | Widebody and superheavy refuse to come without one |

`TERMINAL_LEVELS` and `ADDITIONAL_TERMINAL_COST_MULTIPLIER` are deleted. So is the terminal's
fare multiplier: revenue per head becomes `PASSENGER_FARE + 4·baggage + 3·retail`, which says
the same thing additively and removes the capacity-weighted-average blend that only existed to
stop two cheap sheds beating one good building. Under a modular terminal there is no
build-versus-upgrade choice left to break, so the asymmetry that comment defends is gone.

`facilityCost`, `newTerminalCost` and the terminal's branch of `checkUpgradeFacility` go with
them. The tower keeps its level ladder untouched.

### The limiter

Modules are one tile each and land is finite, but land alone is too weak a cap on retail —
shops earn per passenger of every flight, which is what made them a runaway once before. So:

> **Retail units may not exceed gate halls.**

Each concourse has its own shops. It is the same cap `shopSlots` provided, expressed as
something the player can see on the map rather than a number in a menu, and it keeps retail and
capacity pulling in the same direction instead of competing. `no-shop-slot` survives as the
error.

### Capacity floor

The level-0 floor — 60 passengers with no terminal at all, the windsock and the gate in a hedge
— **stays**. It is what makes day one pay, and dropping it to zero quietly breaks the opening
of every campaign. A core with no modules processes 120.

### Border control, and why class gating earns its place

`AircraftClass` gains `requiresBorderControl: boolean`, true for `widebody` and `superheavy`.
`BlockReason` gains `no-border-control`, listed in `STRUCTURAL_REASONS` so an aircraft that
cannot be taken diverts promptly rather than burning a full tank.

Because it goes through `structuralBlock()`, the forecast and the debrief both pick it up for
free — `tomorrowsTraffic()` will warn that tomorrow's widebody has nowhere to clear, and the
debrief will say why one was lost. That is the test of whether a gate belongs in this game: a
constraint the player cannot be warned about is a punishment, not a mechanic.

### Turnaround

Baggage halls free stands sooner, which is what ties the terminal to apron throughput instead
of only to money:

```ts
export function baggageTurnaroundFactor(halls: number): number {
  return 1 - 0.1 * Math.min(halls, 3);   // 1.0, 0.9, 0.8, 0.7
}
```

Multiplied with `FUEL_FARM_TURNAROUND_FACTOR`, so a fully-equipped airport turns an aeroplane
round in roughly half the time a field does.

---

## 3. Scenarios

A scenario is a **pre-built airport with a brief**, started from the menu, sharing the campaign
it drops you into the middle of.

### Format

Authored as code, not JSON, so it typechecks and reads:

```ts
export interface Scenario {
  readonly id: string;
  readonly name: string;
  /** Two or three sentences: what you have inherited, and what is wrong with it. */
  readonly brief: string;
  readonly levelId: string;
  /** Which campaign day you take over on. Traffic escalates on a fixed schedule, so this
   *  sets both the difficulty and how many days are left. */
  readonly startDay: number;
  readonly cash: number;
  /** Lays the inherited airport out with the same `add…` helpers the game uses. */
  readonly build: (airport: Airport) => void;
}
```

`startDay` does two jobs and is why scenarios need no win condition of their own: the campaign
already ends at day 50, so taking over on day 30 *is* a twenty-day scenario. Nothing new to
build, nothing new to explain, and the ending the player reaches is the one they already know.

### The two

- **Grass Roots** (Hensley Meadow, day 24, £9,000) — a flying club that never modernised:
  three grass strips, small stands, roads, no tower and no terminal beyond the hut. The
  traffic arriving on day 24 wants gravel, stands and sequencing. Everything you own is the
  wrong thing, and the strips are in the way of where the runway needs to go.

- **Overspill** (Bracken Rise, day 30, £26,000) — the opposite problem: a proper asphalt
  runway, a tower, a terminal, and eleven small stands packed into the only flat ground on the
  map. The regionals and narrowbodies booked in need medium and large stands, and there is
  nowhere to put them that is not already yours. You have to demolish your own airport at 40%
  back, or tunnel.

### Menu and progress

Scenarios replace the "Coming soon" row. They are **always unlocked** — side content, not a
chain — and completion is tracked separately in `save/progress.ts` so finishing one never
unlocks a level. One game at a time still holds: starting a scenario warns before replacing a
save, exactly as starting a level does.

---

## 4. Tutorial

Six steps on a fresh Hensley Meadow, teaching the two rules the game cannot otherwise explain:
an aeroplane needs a runway *and a way off it*, and everything except a taxiway needs a road.

### Shape

`content/tutorial.ts` holds the steps as data with **pure predicates**:

```ts
export interface TutorialStep {
  readonly id: string;
  readonly text: string;
  /** Satisfied — advance. Reads the game state and nothing else. */
  readonly done: (state: GameState) => boolean;
  /** Tiles to outline on the map. Empty for steps that are not about a place. */
  readonly where: (state: GameState) => readonly TileIndex[];
}
```

Pure and DOM-free, for the same reason `ui/placement.ts` is: `tests/tutorial.test.ts` can drive
a real `GameState` through all six steps headlessly, which is the only way to know the sequence
is completable at all.

The steps:

1. **Runway.** "Aeroplanes need somewhere to land. Drag out a runway here." Outlines a
   suggested column. Done when a runway of at least 4 tiles exists.
2. **Road to the runway.** "A runway with no road cannot open — the fire crew has to reach
   it." Done when `runwayHasRoad()`.
3. **Stand.** "Somewhere to park." Done when a stand exists.
4. **Taxiway.** "Now join them. An aeroplane that lands with nowhere to taxi blocks the
   runway." Done when `buildLinks()` connects the runway to the stand.
5. **Road to the stand.** "The stand needs a road too, or nobody can get the passengers off."
   Done when `standHasRoad()`.
6. **Open.** "That is an airport. Open it." Done when the phase becomes `day`.

Each step's predicate reuses the **same** connectivity functions the simulation uses, so the
tutorial cannot congratulate the player on something that will not work.

### Presentation

The text sits **in layout** in the planning bar, never floating over the map. That is a bug
this project has already shipped once: an overlay that covered the field with advice about the
field. The outline reuses the stroked-tile drawing added for the build crosshair.

It never blocks a control. A player who ignores it and builds something else simply finds the
step already satisfied, or not — nothing is gated, because a tutorial that traps you is worse
than no tutorial. A "Skip" control dismisses it permanently.

Shown once, on a fresh meadow game, tracked in `save/progress.ts` beside the completed levels.

---

## 5. Levels

`LEVEL_TIDEWATER` — a third map built around water, which nothing in the game currently uses.
A tidal inlet cuts the field roughly in half, with the only flat runway ground on the far side
from the natural apron. Bridging is not optional, and where you bridge decides the whole shape
of the airport.

Buildable-ground and connectivity invariants are checked in `tests/levels.test.ts` as the
existing maps already are — with the connectivity check extended to account for what
groundworks can reach, or the map will fail a test it should pass.

---

## Save format

One bump, to **version 8**, covering all of it: `groundworks` (sparse indices, like taxiways
and roads) and terminal modules as ordinary facilities with new `FacilityType` values. Old
saves are rejected and a fresh game starts, which is the documented migration story.

## What is deliberately not here

- **Explicit scenario goals** ("reach £50,000 by day 40"). `startDay` plus the existing ending
  covers the fantasy for a fraction of the machinery. Worth adding once there are six
  scenarios and the shape of a good one is known — not before.
- **Tunnels and bridges for runways.** The restriction is the mechanic; lifting it is how this
  becomes a money tax.
- **More depth beyond border control.** Upkeep on modules, staffing, night flights and weather
  all suggest themselves. The campaign needs re-measuring after modular terminals before
  anything else is loaded on top.
