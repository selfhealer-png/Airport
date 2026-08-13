# Plan: reputation removal, helipads, multi-tower/terminal, menu rework

For Claude Code, working in the `Airfield` repo (`selfhealer-png/Airport`). Written after reading
`CLAUDE.md`, `src/sim/*`, `src/content/*`, `src/ui/*`, `src/main.ts` and the existing tests. File
paths and function names below are exact, current names — greps were run against `main` at commit
`a77ae91` to confirm every call site before writing this.

Drop this file into the repo (e.g. as the plan `CLAUDE.md` already points to) and work through the
phases in order. Each is independently shippable and testable, and later phases depend on earlier
ones only where noted — but **Phase 2 is a measurement checkpoint that gates Phases 4, 5 and the
open question about aprons.** Do not skip it. Phase 1 changes the traffic curve substantially
enough that the evidence for everything after it does not exist until Phase 1 has shipped.

## What's being built, in one line each

1. **Remove reputation.** The daily schedule already generates deterministically from `(seed, day)`;
   dropping the `reputation` input makes it a fully fixed path, which deletes both the
   late-campaign oscillation CLAUDE.md documents as a known rough edge *and* a harder cliff
   described below that CLAUDE.md does not.
2. **Measure.** Re-run the harness on the new fixed path and read the loss profile before
   committing to Phases 4 and 5.
3. **Helicopters + helipads.** A second, parallel late-game progression axis that needs no runway
   at all — a spatial problem again, once runway length stops being the only lever.
4. **Multiple terminals,** pooling passenger capacity instead of one terminal topping out at
   level 4. Phase 1 is what makes this necessary; see below.
5. **Multiple control towers,** pooling movement/stack capacity instead of one tower topping out at
   level 3. **Conditional on Phase 2's measurement.**
6. **Build menu rework:** vertical, sectioned buttons instead of one horizontally-scrolling chip
   row, and the drawer auto-collapses to the full field the moment a tool is armed.

**Non-goals, to keep scope honest:** no new level maps (water/rock/woods), no economic sink/upkeep,
no zone-based tower assignment (see Phase 5's rejected-alternatives note). Those are good
follow-ups but are separate plans.

**One non-goal under review:** *apron depth* (remote stands, airbridges, a fine-grained stand
ladder to match the runway one). Currently 66% of all losses in the harness are
`every suitable stand was occupied`, and no phase here touches stands. Phase 2 decides whether
that is a real game constraint or an artefact of the auto-player's fixed apron. See Phase 2.

---

## The evidence this plan is built on

Two harness measurements, both reproducible, both worth re-running after Phase 1.

**Loss profile across a full 50-day auto-played campaign (seed 42):**

```
 64  66.0%  every suitable stand was occupied
 19  19.6%  every suitable runway was occupied
 14  14.4%  no taxiway linking a runway to a stand
```

Zero crashes across all fifty days — the tower's stack capacity was never once exceeded.
Passengers peaked at 1,197 in a day against terminal level 4's 2,600 ceiling.

**Schedule demand, by calling `generateSchedule` directly:**

```
day 50, rep 100:  3,050 pax   superheavy×4 widebody×2 narrowbody-x×2 freighter×2 heavylift×2 …
day 50, rep  50:    900 pax   fighter×5 freighter×4 widebody×3 heavylift×1 transport×2
day 40, rep 100:    976 pax   transport×5 freighter×3 widebody×2 narrowbody×2 …
```

Same day, same seed. Reputation alone swings demand by 3.4×. Everything below follows from those
two blocks.

---

## Phase 1 — Remove reputation, fix the schedule

### Why this is safe to just delete

Grepped every usage. Reputation currently does three things and nothing else:

- Thins (never hides) heavy traffic in `content/schedule.ts` via `availableTiers(day, reputation)`.
- Is displayed on the HUD (`#hud-rep`) and in the debrief's `reputation ±N` line.
- Ends the `npm run day` harness early if it hits zero (`scripts/run-day.ts:432`).

There is no in-game fail state tied to it — no "licence revoked" is implemented anywhere in `src/`
(`grep -rn "revoked" src/` returns nothing; the only hit is `scripts/run-day.ts:433`). The line in
`README.md`/`CLAUDE.md` calling survival "the win" is flavour text over the fact that the campaign
just ends at day 50. So removing reputation deletes a pacing variable, not a game-over mechanic.

### Why it is worth more than that

The docstring in `schedule.ts` claims reputation *thins* heavy traffic rather than hiding it, and
that nothing ever vanishes completely. Both claims are false in practice, and the mechanism is
worth understanding before deleting it, because it is the single largest source of the
"late campaign is boring" complaint.

In `availableTiers()`, the `standing` multiplier pushes weights below the `>= 0.35` floor. When
*every* class falls below that floor, the function returns its fallback:

```ts
return flying.length > 0 ? flying : [{ classId: TIERS[0]!.classId, weight: 1 }];
```

`TIERS[0]` is `trainer`. So a bad-reputation day does not get a thinner version of the schedule —
it gets **club trainers and nothing else**. Those are the days in the harness that read
`landed 15  diverted 0  pax 26`: a full day of flying-club traffic worth about £500, dropped into
the middle of a campaign about widebodies.

That is a cliff, not a slope. Reputation is not gently rebalancing a bad day; it is occasionally
deleting the schedule and replacing it. Removing it is correct, and this is the reason to put in
the commit message.

### Changes

- `src/content/schedule.ts`: delete `minReputation` from `Tier`, delete the `standing` calculation
  in `availableTiers()`, change its signature to `availableTiers(day: number)`. Change
  `generateSchedule(day, reputation, seed)` → `generateSchedule(day, seed)`. **Keep** the "age"
  thinning (`generationsBehind`) — that is day-based pacing, not reputation, and it is what stops a
  day-40 airport still mostly landing trainers.
- `src/sim/types.ts`: remove `reputation: number` from `GameState` (line 295) and
  `readonly reputation: number` from `DayEvent` (line 263).
- `src/sim/airport.ts`: remove `STARTING_REPUTATION` (line 26) and the `reputation:` field from
  `createGame()` (line 120).
- `src/content/buildings.ts`: remove the `REPUTATION` const entirely (line 80) — `perLanding`,
  `perDiversion`, `perCrash`, `perOverflowedFlight`, `crashWithFireStation`, `max`.
- `src/sim/step.ts`: in `record()`, drop the `state.reputation = ...` line (178) and the
  `reputation:` field it reads off `DayEvent`. In `land()` (212), `divert()` (229) and `crash()`
  (255–257), delete the `reputation:` field from each `record(...)` call — including the
  `perOverflowedFlight` branch in `land()`, which only existed to feed reputation. Drop the
  `REPUTATION` import (line 6).
- `src/ui/debrief.ts`: `summariseDay()` drops the `reputation` accumulator (57, 66) and field
  (47, 71); the template string drops the `` · reputation ${signed(result.reputation)}`` segment
  (115). **But add a replacement — see "Replace the scoreboard" below.**
- `src/main.ts`: **two** changes, not one.
  - Line 287: `startDay(state, generateSchedule(state.day, state.reputation, state.seed))` drops
    the reputation arg. (Easy to miss — the typechecker catches it, but it is not a HUD change.)
  - Line 359: remove `#hud-rep` wiring (`rep.textContent = ...`) and the `repLabel` / `rep` locals;
    keep the null-check on the other three HUD elements only.
- `index.html`: remove `<span id="hud-rep" class="hud-stat hud-rep">0</span>`.
- `src/save/snapshot.ts`: remove `reputation` from `Snapshot` (30), from `toSnapshot` (73), from
  the `isFiniteNumber` validation in `fromSnapshot` (121), from the rehydrate (190) and from
  `restoreInto` (214). **Bump `SNAPSHOT_VERSION` 4 → 5.** This is a breaking save-format change,
  and the codebase's own convention (`CLAUDE.md` → Conventions) is that old saves are rejected and
  a fresh game starts rather than migrated.
- `src/sim/advice.ts`: **four** call sites, not three — lines 102, 133, 273 and 296 — each drops
  the reputation arg.
- `scripts/run-day.ts`: `generateSchedule(...)` drops the arg at both call sites (262, 416). Delete
  the `reputation ${state.reputation}` print line (428) and the `if (state.reputation <= 0)`
  early-stop (432). Replace that stop condition with a bankruptcy check instead —
  `if (state.cash < -5_000) { ...stop, print "Bankrupt on day N"... }` — so the harness still has a
  way to notice a genuinely broken run rather than looping to day 50 on a dead airport. (Cash can
  go negative today: crashes charge `CRASH_COST` unconditionally, and nothing clamps at zero.)

### Replace the scoreboard

Removing reputation leaves two holes. Fill them deliberately rather than by omission.

**No cost of failure.** After this phase a diverted aircraft costs only its fare — there is no
penalty, just forgone income. That is defensible (the game's stated philosophy is that the player
is tested on their airport, not punished for luck), but it means opportunity cost is the only
brake, and the harness already ends a campaign on £817,850 with nothing to buy. Note it; the
economic sink is a separate plan, but this phase is what makes it urgent.

**No measure of how you are doing.** Reputation was the only persistent one. Cash is not a
substitute because it only goes up. Add a **descriptive** service level to `ui/debrief.ts` in
place of the deleted line:

```
landed 11 of 15  ·  73%          (this day)
campaign 402 of 511  ·  79%      (running total)
```

Purely reported. It must feed nothing back into `generateSchedule` — that is the whole point of
the phase. The running total needs a small counter pair on `GameState` (`landedTotal`,
`scheduledTotal`), which means they also go in the snapshot; fold that into the same
`SNAPSHOT_VERSION` bump rather than taking a second one.

### Balance consequence to check: military traffic explodes

On the fixed path, reputation is no longer suppressing the military tiers. Measured:

- day 40: `transport×5 fighter×1` out of 14 arrivals — **43% military**
- day 50: `heavylift×2 transport×1` out of 15 — **20% military**

That flatly contradicts the design note in `content/aircraft.ts` that a military strip should be
"a bet on infrastructure that pays in bursts," not "a second airport running alongside the first."
Reputation was masking it. On the fixed path a military strip goes from optional bet to mandatory
infrastructure somewhere around day 38.

Fix in `content/schedule.ts` `TIERS` weights, not in `sim/` — halve `transport` (2 → 1) as a
starting point and re-measure. This is a balance call, so verify with the day-40 and day-50 mix
print rather than by reasoning about the weights.

### Tests to update

`tests/advice.test.ts`, `tests/debrief.test.ts`, `tests/save.test.ts`, `tests/sim.test.ts` — grep
each for `reputation` and delete/adjust assertions. `tests/debrief.test.ts` currently pins the
debrief wording, so it needs the new service-level line pinned instead. `tests/save.test.ts` needs
its round-trip fixture updated for the new snapshot shape and version number.

### Manual QA

`npm run day` for the full 50 days: confirm the printed traffic mix at day 45 still shows
age-thinning intact (nothing has collapsed to trainers, nothing below `regional-x` is dominating),
confirm no crash from the missing field, confirm the harness reaches day 50 without hitting the new
bankruptcy stop.

---

## Phase 2 — Measure before building anything else

Not a code phase. A checkpoint, and the reason the rest of this plan is ordered the way it is.

Phase 1 changes day-50 demand from 900 passengers to 3,050 on the same seed. Every argument for
Phases 4 and 5 — and the open question about aprons — rests on evidence gathered from a game that
no longer exists once Phase 1 ships. Gather it again.

### Do this

1. `npm run day -- 50` on the fixed path. Capture the full output.
2. **Loss profile.** Tally reasons the way the pre-Phase-1 numbers above were tallied. The question
   is whether `every suitable stand was occupied` is still ~66%.
3. **Crashes.** Currently zero across fifty days, meaning the tower's stack capacity of 9 is never
   the binding constraint. If it is *still* zero on the heavier fixed path, **Phase 5 is building a
   ceiling nobody touches** — see Phase 5's gate.
4. **Peak daily passengers.** Currently 1,197 against a 2,600 ceiling. Expect this to rise sharply;
   the schedule now *demands* 3,050 on day 50, so terminal capacity should start binding.
5. **Military share.** Confirm the `TIERS` reweight from Phase 1 actually landed.

### The apron question this decides

66% of losses being stand-related is the largest single signal in the game, and no phase in this
plan addresses it. Before accepting that, determine which of these is true:

- **It is a game constraint** — the 24×36 field genuinely cannot hold enough stands beside the
  runways, taxiways and roads that the traffic needs. Then *apron depth* (remote stands with bus
  roads, airbridges that must touch a terminal, a fine-grained stand ladder to match the runway
  one) is a better use of a phase than multiple towers, and should be promoted into this plan
  ahead of Phase 5.
- **It is an auto-player artefact** — `scripts/run-day.ts` uses a fixed apron layout with a bounded
  set of slots, and demolishes the smallest stand to make room when full (see the comment above
  `addApron`, ~line 121–140). If the harness is running out of *its own* apron rather than the
  map's, the 66% is measuring the auto-player, not the game.

The cheapest way to tell them apart: hand-build a layout in the running game that maximises stands
at the expense of everything else, play days 45–50, and see whether the stand losses persist.
Failing that, raise the auto-player's apron slot count and re-run — if losses drop sharply, it was
the harness.

**Do not skip this to get to the fun phases.** It is one harness run and it decides whether one of
the phases below should exist.

---

## Phase 3 — Helicopters and helipads

Unchanged in substance from the original plan; this is the strongest content item here and does not
depend on Phase 2's outcome. Two additions at the end (`snapshot.ts`, `renderer.ts`) that the
original writeup missed.

### Design

A helicopter needs no runway, no taxiway, and no separate stand — it lands and parks on the same
tile. That is the whole point: it is a genuinely different placement problem (road access and pad
count, not runway length), not "airplane but shorter."

**Sentinel, not a new field.** Aircraft classes get a rotorcraft flag for free. `runwayLength: 0` is
currently impossible for a fixed-wing class (`MIN_RUNWAY_TILES = 3`, enforced at `build.ts:113` in
`checkRunway`), so `spec.runwayLength === 0` unambiguously means "this class uses a helipad, not a
runway." This avoids touching all 17 existing entries in `content/aircraft.ts` to add a boolean.

`minSurface`, `use` and `standSize` stay on `AircraftClass` (the interface is not worth forking for
two classes) but are simply unread for rotor classes — comment that explicitly at the two new
entries.

### Data model — `src/sim/types.ts`

```ts
export interface Helipad {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  reservedBy: number | null;
}
```

Add `helipads: Helipad[]` to `Airport`, initialised empty in `createAirport()`
(`src/sim/airport.ts`).

Add to `Aircraft`: `padId: string | null` (parallel to `runwayId`/`standId`, initialised `null` in
`spawnArrivals()` in `src/sim/step.ts`).

Add to `BlockReason`: `'no-helipad'` (none built), `'no-road-helipad'` (built, not road-served),
`'helipad-busy'` (all reserved right now — the rotor equivalent of `runway-busy`/`no-stand`).

### Content — `src/content/aircraft.ts`

Two new classes, staggered like the military strip was:

- `helicopter` — light utility/medevac type. `runwayLength: 0`, `endurance` similar to `bush`,
  modest fare, small passenger count (this is a charter premium, not a hub flow). `fromDay: 30` in
  `content/schedule.ts` — the exact point the campaign currently starts feeling thin.
- `heli-heavy` — heavier offshore/VIP type, gated behind a working fuel farm (reuse
  `requiresFuelFarm`), `fromDay: 40`, meaningfully higher fare to reward a second pad.

Add both to `TIERS` in `content/schedule.ts` with low weights. **Set these weights after Phase 1's
military reweight, not before** — the two interact, and on the fixed path a weight of 2 is a much
larger share of the day than it was under reputation thinning. This should read the way military
traffic was *meant* to: an occasional, well-paid movement, not a new dominant traffic type.

### Costs — `src/content/costs.ts`

`HELIPAD_COST: number` — price it above a large stand (£3,400) but well under a runway, since a pad
does the job of a runway and a stand in one tile. Starting point: **£4,200.**

### Connectivity — `src/sim/connectivity.ts`

Helipads need road access, same rule as everything else ("a building with no road does nothing").
Add `helipadHasRoad()` parallel to `standHasRoad()`, and extend `Services`/`buildServices()` to
include helipad ids in `roadServed`. Helipads are never taxiway-linked — they have no taxiway
concept — so they do not touch `links`.

### Assignment — `src/sim/assignment.ts`

`structuralBlock()` and `findAssignment()` both need an early branch: if
`aircraftClass(classId).runwayLength === 0`, skip the entire runway/taxi-link/stand chain and run a
parallel, much shorter check against `airport.helipads` (road-served or not; free or not). Return
the new `BlockReason`s in the same "most fundamental first" order the file already documents:
`no-helipad` → `no-road-helipad` → `helipad-busy`.

`findAssignment()`'s success case returns something the caller can act on. Either widen `Candidate`
to `{ runway: Runway; standId: string } | { padId: string }`, or — cleaner, since the two shapes
share no fields — give rotor aircraft their own `findHelipadAssignment()` and have
`findAssignment()` dispatch to it. `assignHoldingAircraft()` then needs the small amount of
branching this implies when it reserves the result and sets `aircraft.runwayId`/`standId` vs
`aircraft.padId`.

**Tower capacity still gates rotor movements** (a helicopter landing is still a movement the tower
has to sequence) — do not exempt it, that would make a helipad-only strategy trivially bypass the
tower entirely.

### Simulation — `src/sim/step.ts`

**Phase model:** a rotorcraft skips `taxi-in`/`taxi-out` — there is nothing to taxi between, the pad
is the stand. In `advanceTimed()`, the two transitions that currently go
`landing → taxi-in → parked` and `parked → taxi-out → departing` need a conditional: for rotor
classes, go `landing → parked` and `parked → departing` directly.

Do **not** try to do this by setting `taxiSeconds: 0` on the two new classes and hoping the phase
completes invisibly in one tick. It technically works but leaves a dead phase in the state machine
that every other piece of code touching `AircraftPhase` now has to reason about being a one-tick
no-op for two specific classes. Branch explicitly instead; it is clearer and matches how the file
already branches on `STRUCTURAL_REASONS`.

`land()`, `divert()`, `crash()`, `findDepartureRunway()`, `releaseRunway()`/`releaseStand()` all
currently assume a runway+stand pair. Add `releasePad()` and route rotor aircraft through it.
`crash()`'s "close the longest runway" penalty does not apply to a helipad — for a rotor crash,
close the pad it crashed on instead (helipads have no "longest" to sort by; there is just the one
it was using).

### Rendering — `src/render/aircraft.ts`, `src/render/renderer.ts`, `src/sprites/data.ts`

New `AircraftSilhouette` value `'helicopter'`. New sprite entry in `SPRITE_OF`/`LENGTH_OF`
(`lengthTiles: 1`). Author a new pixel-grid sprite in `src/sprites/data.ts` — the file's convention
is rows of palette-key strings, validated by `tests/sprites.test.ts`, so a malformed grid fails a
test rather than reaching the canvas.

**The pad itself also has to be drawn.** `src/render/renderer.ts` draws runways, stands, taxiways
and facilities; helipads need their own tile treatment there plus a sprite (or a procedural
marking — a circled H is a good candidate for `drawGuideLines()`-style procedural drawing rather
than an authored grid). The original writeup covered only `render/aircraft.ts`, which draws the
aircraft, not the infrastructure it sits on.

Rotor aircraft do not roll on landing — the `easeOut` landing-roll logic in `render/aircraft.ts`
assumes a taxi distance. They should descend vertically onto the pad tile instead. This is a
`render/`-only change; `sim/` still knows nothing about pixels.

### Build/placement — `src/sim/build.ts`, `src/ui/placement.ts`, `src/ui/drawer.ts`

`checkFacility`/`applyFacility` are shaped around `FacilityType`, and a helipad is not a `Facility`
(no `level`, and it needs its own reservation state like a runway/stand does) — give it its own
`checkHelipad`/`applyHelipad` pair in `build.ts`, mirroring `checkStand`/`applyStand`. Add a
`{ kind: 'helipad' }` variant to the `Tool` union in `ui/placement.ts`, wired into
`resolvePlacement`/`commitPlacement` the same way `stand` is (single tile, not a drag). Add a chip
for it in the drawer — Phase 6 changes where, and it belongs in its own "Helipads" section rather
than bolted onto Stands, since it is not sized the way stands are.

`checkDemolish`/`applyDemolish` in `build.ts` need a helipad branch too (refund at
`DEMOLITION_REFUND`, same as everything else).

### Saving — `src/save/snapshot.ts` *(missing from the original writeup)*

Helipads are persistent airport state and must round-trip. Four edits, and the last is the one that
bites:

1. Add `readonly helipads: ReadonlyArray<{ id: string; x: number; y: number }>` to `Snapshot`.
   (`reservedBy` is day state, not saved — a day in progress is deliberately not persisted.)
2. `toSnapshot`: `helipads: airport.helipads.map((h) => ({ id: h.id, x: h.x, y: h.y }))`.
3. `fromSnapshot`: validate and rehydrate with `reservedBy: null`, dropping any pad outside the map
   the way runways and stands already are.
4. **Line ~178, the `nextEntityId` scan.** It currently reads:

   ```ts
   const highest = [...airport.runways, ...airport.stands, ...airport.facilities]
   ```

   Helipads must go in that spread. Leave them out and entity ids collide after a load — a bug that
   surfaces two sessions later as a helipad and a stand sharing an id, which is exactly the class of
   failure the "ids come from `Airport.nextEntityId`" convention exists to prevent.

**Bump `SNAPSHOT_VERSION` 5 → 6.** This is the second bump in the plan (Phase 1 took 4 → 5). That
is fine and intended — two resets, each isolated to one phase so a save-format regression is easy
to bisect. Do not try to batch them.

### Tests

New `tests/helipads.test.ts` mirroring the shape of `tests/roads.test.ts` / `tests/grow.test.ts`:
build/road/assignment/crash cases for the two new classes. Extend `tests/sim.test.ts` for the new
phase transitions, `tests/build.test.ts` for `checkHelipad`/`applyHelipad`/`checkDemolish`,
`tests/placement.test.ts` for the new `Tool` variant, and **`tests/save.test.ts` for the helipad
round trip including the `nextEntityId` case above**. `tests/sprites.test.ts` picks up the new
sprite for free.

---

## Phase 4 — Multiple terminals (pooled capacity)

**Promoted ahead of towers, because Phase 1 makes it necessary and the evidence for towers is
weaker.** Ship this before Phase 5.

### Why Phase 1 makes this necessary

Terminal level 4 caps at 2,600 passengers a day. On the reputation-suppressed path the harness
never came close — it peaked at 1,197, which is why this would have looked like uncapping a
constraint nobody hits. On the fixed path, day 50 *demands* 3,050. The ceiling starts binding
somewhere in the last ten days, and there is currently nothing the player can do about it.

Confirm this with Phase 2's peak-passenger measurement before starting. If the measured peak is
still comfortably under 2,600, something in Phase 1 did not land the way it was measured here and
this phase should wait.

### The wrinkle

`fareMultiplier` cannot just be summed. Two level-1 terminals at 1.15× each would sum to 2.3×,
which combined with doubled passenger capacity roughly quadruples terminal revenue for the price of
two cheap buildings — a straightforward exploit.

### Changes

- `src/sim/airport.ts`: add `terminalsOf(airport): Facility[]` (parallel to the existing
  `shopsOf`, line 66). Replace the single-instance terminal lookups with:

  ```ts
  export function workingTerminalCapacity(
    airport: Airport,
    services: Services,
  ): { passengerCapacity: number; fareMultiplier: number; shopSlots: number } {
    const working = terminalsOf(airport).filter((t) => isWorking(services, t));
    const totalCapacity = working.reduce(
      (sum, t) => sum + terminalLevel(t.level).passengerCapacity,
      0,
    );
    // Capacity-weighted average, not a sum: the fare rate you earn should reflect the blend of
    // terminals actually processing passengers, not reward building lots of cheap ones.
    const weightedMultiplier =
      totalCapacity === 0
        ? 1
        : working.reduce(
            (sum, t) =>
              sum +
              terminalLevel(t.level).passengerCapacity * terminalLevel(t.level).fareMultiplier,
            0,
          ) / totalCapacity;
    return {
      passengerCapacity: totalCapacity,
      fareMultiplier: weightedMultiplier,
      shopSlots: working.reduce((sum, t) => sum + terminalLevel(t.level).shopSlots, 0),
    };
  }
  ```

- `src/sim/step.ts`: `land()` currently does
  `terminalLevel(workingTerminalLevel(state.airport, day.services))` at line 191 to get `level`,
  then reads `level.passengerCapacity`/`level.fareMultiplier` — replace with
  `workingTerminalCapacity(state.airport, day.services)` directly. It is already the shape `land()`
  wants; drop the intermediate `terminalLevel()` call, since the pooled function returns real
  numbers rather than a level to look up.

- `src/sim/airport.ts` — `workingShops()` (line 105): shop adjacency currently checks
  `Math.abs(shop.x - terminal.x) + Math.abs(shop.y - terminal.y) === 1` against *the* terminal.
  With multiple terminals, "inside the terminal" means touching **any working** terminal:

  ```ts
  export function workingShops(airport: Airport, services: Services): number {
    const terminals = terminalsOf(airport).filter((t) => isWorking(services, t));
    if (terminals.length === 0) return 0;
    return shopsOf(airport).filter(
      (shop) =>
        services.roadServed.has(shop.id) &&
        terminals.some((t) => Math.abs(shop.x - t.x) + Math.abs(shop.y - t.y) === 1),
    ).length;
  }
  ```

- `src/sim/build.ts` (lines 323–330): the `no-shop-slot` check in `checkFacility` currently reads
  `terminalLevel(terminal.level).shopSlots` off a single terminal, with no `services` in scope at
  all. Total slots become the sum across terminals. **Gate on *built*, not *working*, terminals** —
  matching how the rest of `checkFacility` already ignores road-service state at placement time.
  You are allowed to build things that do not work yet; `airportAdvice()` is what tells you they
  are dead weight.

- `src/sim/build.ts`: drop the `'already-built'` branch (line 329–330) for `type === 'terminal'`.
  Keep it for `fuel-farm`/`fire-station`, which stay singleton — not in scope here.

- `src/sim/build.ts`: `checkUpgradeFacility(state, type)` (line 338) and `applyUpgradeFacility`
  (line 509) are keyed by `type`, which only worked because there was one. Change both signatures
  to take a facility id — `checkUpgradeFacility(state, facilityId)` /
  `applyUpgradeFacility(state, quote, facilityId)` — looking the instance up by id instead of by
  type. Update the call sites in `ui/drawer.ts` (lines 296, 299, 314, 317, 319). **Do this edit
  once, covering both terminals and towers**, even though towers are Phase 5 — it is the same code
  path and splitting it means touching the same function twice.

- `src/content/buildings.ts`: `ADDITIONAL_TERMINAL_COST_MULTIPLIER`. With pooled capacity and flat
  per-instance pricing, a second terminal at level 1 (£900) is a far cheaper way to add capacity
  than upgrading to level 2 (£5,500) or level 4 (£110,000), which makes upgrading strictly worse
  than spamming cheap terminals. A per-instance multiplier indexed by "how many terminals already
  exist" — starting guess `[1, 1.5, 2.25]` — applied in `facilityCost()` when pricing a *new*
  terminal, not when upgrading an existing one. This is a starting guess, not a tuned number; see
  QA below.

- `src/sim/advice.ts` (line 131): anywhere it reasons about "the terminal" — including the warning
  about a shop with no terminal touching it — needs to check against all terminals, not one.

### Tests

`tests/passengers.test.ts` is the one most likely to assume a single terminal — read it fully
before editing (152 lines), it probably has several single-terminal fixtures worth turning into
multi-terminal cases rather than just patched to keep passing. `tests/build.test.ts` and
`tests/save.test.ts` need their `terminalLevelOf` assertions moved to `workingTerminalCapacity`.

### Manual QA

Two level-1 terminals (1.15× each) must earn **less** per passenger than one level-2 terminal
(1.30×) at the same total capacity. Confirm the weighted-average math actually produces that
ordering before calling this done — it is the entire reason for weighting instead of summing.

Then `npm run day` and check the auto-player reaches a second terminal at a sane day, the way
`CLAUDE.md`'s economy section already checks the day-4 gravel upgrade is reachable. If it buys one
on day 20, the multiplier is too low; if it never buys one while diverting for terminal overflow,
too high.

---

## Phase 5 — Multiple control towers (pooled capacity) — *gated*

### Gate: do not start this until Phase 2 says to

On the pre-Phase-1 path the tower's stack capacity of 9 was **never once exceeded across fifty
days** — the harness recorded zero crashes, and a crash is the only thing overflow causes. Tower
level 3 also provides 4 movements against a field that supports roughly 3 useful runways (15
arrivals ÷ ~5 clearances per strip). On that evidence the tower is not a binding constraint at any
point in the campaign, and uncapping it buys nothing but a balance problem.

Phase 1's heavier fixed traffic may change that — more aircraft holding for stands means a deeper
stack. **Build this phase if and only if Phase 2's harness run shows crashes appearing, or shows
holding aircraft going unmanaged.** If it still shows zero, spend the phase on apron depth instead
(see Phase 2's apron question) and come back to towers when the evidence exists.

### Why it is a smaller change than it sounds

`Airport.facilities` is already `Facility[]` — nothing in the data model assumes one tower. The
restriction lives in exactly two places: `facilityOf()` (`airport.ts:44`) does a `.find()`, and
`checkFacility()` (`build.ts:329`) returns `'already-built'`. Each `Facility` already carries its
own independent `level`. So this is "remove a constraint and sum across instances," not a data
migration.

### Rejected alternative, noted for the record

A spatially-zoned tower (each tower manages only nearby runways) would be a richer sim but
contradicts the pattern the rest of the codebase commits to: "Position has no simulation effect;
what a facility costs is land near the runways" (`CLAUDE.md`, Building section, and identically
true of `fuel-farm`/`fire-station` today). Pooled capacity keeps towers consistent with every other
facility and is a much smaller, lower-risk change. If tower placement should matter later, that is
a separate plan — flagged here so the decision is visible rather than buried in a diff.

### Changes

- `src/sim/airport.ts`: add `towersOf(airport): Facility[]`. Replace `towerLevelOf()`'s
  single-instance semantics with a pooled capacity function:

  ```ts
  export function workingTowerCapacity(
    airport: Airport,
    services: Services,
  ): { movements: number; stackCapacity: number } {
    const working = towersOf(airport).filter((t) => isWorking(services, t));
    return working.reduce(
      (sum, t) => {
        const level = towerLevel(t.level);
        return {
          movements: sum.movements + level.movements,
          stackCapacity: sum.stackCapacity + level.stackCapacity,
        };
      },
      { movements: 0, stackCapacity: 0 },
    );
  }
  ```

  Keep `towerLevelOf`/`workingTowerLevel` only if something still legitimately wants "do I have a
  tower at all" — `advice.ts:209` (`towerLevelNow`) is the one real candidate. Reroute every
  consumer of "the tower's movements/stack" to the new pooled function.

- `src/sim/assignment.ts:162`: `towerLevel(workingTowerLevel(...)).movements` becomes
  `workingTowerCapacity(...).movements`.
- `src/sim/step.ts:154`: `updateStackManagement()`'s equivalent becomes
  `workingTowerCapacity(...).stackCapacity`.
- `src/sim/build.ts`: drop the `'already-built'` branch for `type === 'tower'`. The
  `checkUpgradeFacility`/`applyUpgradeFacility` id-based signature change was already made in
  Phase 4 — nothing further needed here.
- `src/content/buildings.ts`: `ADDITIONAL_TOWER_COST_MULTIPLIER`, same shape and same reasoning as
  the terminal one. The gap is wider here (a second level-1 tower at £1,200 against a level-3
  upgrade at £45,000), so this matters more.

### Tests

`tests/build.test.ts` asserts `towerLevelOf(state.airport)` directly after upgrades (lines
~156–178) — move these to `workingTowerCapacity(...)`, and add a case: build two towers, confirm
movements/stack sum rather than the second silently failing as `'already-built'`.
`tests/placement.test.ts` and `tests/save.test.ts` have the same `towerLevelOf` assertions.

### Manual QA

Build two level-1 towers with independent road access; confirm the day's movement cap is 4 (2+2),
not 2. Demolish one tower's connecting road tile mid-game and confirm capacity drops to just the
working one, not to zero — this is the existing `isWorking()`/`roadServed` logic, now summed
instead of single-lookup, so it should fall out for free if the plumbing is right.

---

## Phase 6 — Build menu rework

UI-only, and last, so it only has to deal with the final chip set once — helipads, N terminals, and
(if Phase 5 shipped) N towers.

### Current shape, and why it swipes

`src/ui/drawer.ts`'s `chips()` returns one flat array of 15 items rendered into a single
`.chip-row` — CSS `overflow-x: auto`, horizontal flexbox (`src/ui/styles.css`, ~line 258).
Everything from grass strip to demolish lives in that one scrollable row, which is what makes
finding "fire station" a many-swipe hunt by day 20.

Separately: arming a tool does not auto-collapse the drawer. Closing is a manual second tap on the
`Close`/`Build` toggle (`src/main.ts`, `toggleButton`). The comment there explains why a tool
should *stay armed* after collapse — "Undo covers the stray drag that this allows" — and that
reasoning still holds. It just should not require a second manual tap to get there.

### Changes

`src/ui/drawer.ts`:

- Replace the flat `chips(): ToolChip[]` with grouped sections:

  ```ts
  interface ChipSection {
    readonly title: string;
    readonly chips: ToolChip[];
  }

  function chipSections(): ChipSection[] {
    return [
      { title: 'Runways', chips: [grass, gravel, asphalt, military] },
      { title: 'Taxiways & roads', chips: [taxiway, road] },
      { title: 'Stands', chips: [small, medium, large] },
      { title: 'Helipads', chips: [helipad] },              // Phase 3
      { title: 'Towers & terminals', chips: [tower, terminal] },
      { title: 'Support', chips: [fuelFarm, fireStation, shop] },
      { title: 'Demolish', chips: [demolish] },
    ];
  }
  ```

  Keep the existing flat lookup (`chips().find(...)` in `selectedLabel`, the `buttons` map, etc.)
  working by flattening sections back into one list where the code expects `ToolChip[]`. This is a
  rendering change, not a data-model one — `Tool`, `BuildCheck` and `minimumCost()` are untouched.

- Render each section as a small muted heading (match the existing `.forecast-heading` treatment)
  followed by a **grid**, not a flex row. Two columns feels right at phone width given the existing
  chip sizing, but check against a real viewport per the project's own gotcha about verifying
  `fitScale` on a real phone before assuming a layout is free.

- Add a `DrawerHandlers.onToolArmed?: () => void` callback, fired from inside the existing chip
  click handler at the point `selected`/`selectedId` are set — **not** on `clearSelection()`,
  since deselecting should not collapse anything.

`src/main.ts`:

- Pass `onToolArmed: () => setExpanded(false)` into `createDrawer(planningBody, state, { ... })`
  alongside the existing `onBeforeChange`.
- No change to the "stays armed after collapse" behaviour — `setExpanded(false)` already does
  exactly what tapping `Close` did. The `armed` label logic in `paintShell()`
  (`toggleButton.textContent = expanded ? 'Close' : (armed ?? 'Build')`) needs no change; it
  already handles "collapsed with something armed," because that state already existed. Players
  just had to ask for it manually.

**Exempt demolish from auto-collapse.** Every other tool arming into a full-screen map is covered
by undo. Demolish is the one combination — armed destructive tool, full field, no drawer in the
way — where a stray drag can remove an entire runway before the player realises the drawer closed.
Either keep the drawer open when demolish is armed, or require a confirm on the first demolish
after an auto-collapse. Undo does restore the money as well as the tile, so this is a papercut
rather than a disaster, but it is the papercut most likely to be reported as a bug.

**One interaction to watch.** Today, tapping the same chip twice
(`if (selectedId === chip.id) { api.clearSelection(); ... }`) deselects it. With the drawer already
collapsed after the first tap, there is no way to reach that chip again without reopening. The
collapsed bar's `Build`/`<tool name>` toggle is the way back in — confirm in QA that it remains
discoverable and that nothing about auto-collapse hides it.

`src/ui/styles.css`:

- New rules for the section heading and grid (`.chip-section`, `.chip-section-title`,
  `.chip-grid`). Retire `.chip-row`'s horizontal-scroll rules **only if** nothing else uses a
  horizontal row — check `renderUpgrades()`'s `upgrades` element (`chip-row upgrade-row`) and the
  forecast row (`forecast-row`) first.
- Reconsider `upgrade-row` at the same time. After Phases 4 and 5 it can hold an unbounded number
  of terminal/tower upgrade chips, one per built instance. A wrapping grid handles "I built four
  terminals" better than a horizontal scroll does.

### Tests

No `sim/` behaviour changes, so no `sim/` test changes. Check whether `tests/placement.test.ts` or
anything else drives the drawer's DOM directly — most tests call `resolvePlacement`/
`commitPlacement` directly rather than clicking buttons, in which case this phase needs no test
changes at all beyond a manual pass.

### Manual QA

On a real phone viewport (or DevTools device emulation at a small width): every section readable
without horizontal scrolling; tapping a chip collapses to the full map within one frame; the armed
tool's name shows in the collapsed bar; dragging out a build works exactly as before; tapping the
collapsed bar reopens the drawer with the same chip still highlighted; demolish behaves per the
exemption above.

---

## Order, and why

1. **Phase 1** — smallest, deletes code, touches the save format once. Bundle the version bump with
   nothing else so a save-format regression is easy to bisect.
2. **Phase 2** — one harness run. Gates Phases 4, 5, and the apron question.
3. **Phase 3 (helipads)** — largest standalone chunk, independent of everything else, and the item
   most likely to fix the actual complaint. Takes the second save-format bump.
4. **Phase 4 (terminals)** — necessary because of Phase 1. Do the shared
   `checkUpgradeFacility`/`applyUpgradeFacility` id-signature change here.
5. **Phase 5 (towers)** — only if Phase 2 justifies it. Reuses Phase 4's `build.ts` edit.
6. **Phase 6 (menu)** — last, once every tool it must display exists.

If Phase 2 says the apron is the real constraint, insert **apron depth** between 4 and 5 and drop
Phase 5 from this plan entirely. It would be doing more for the late campaign than pooled tower
capacity, on the evidence.

---

## Decisions made that you may want to override

- **Pooled tower/terminal capacity, not zone/position-based.** Argued above; reversible later, but
  changing it after the fact means redoing Phases 4–5's core function shape.
- **Phase 5 is gated on measurement, Phase 4 is not.** The asymmetry is deliberate: terminal
  capacity provably binds after Phase 1 (3,050 demanded against 2,600 available), tower capacity
  provably did not before it and may still not. If you would rather build both unconditionally,
  the risk is one phase of work and a balance multiplier serving a ceiling nobody reaches.
- **A descriptive service-level line replaces reputation in the debrief.** It reports, it does not
  feed back. If you would rather the debrief simply lose a line, drop it — but then cash is the
  only measure of progress and it only ever goes up.
- **Two helicopter classes** (`helicopter` day 30, `heli-heavy` day 40, the second gated on a fuel
  farm) rather than one. To ship just one, drop `heli-heavy` and its gate; nothing else in Phase 3
  is affected.
- **Cost multipliers for additional towers/terminals.** Without them, Phase 4 in particular is a
  straightforward exploit. `[1, 1.5, 2.25]` is a starting guess, not a tuned number.
- **Halving the `transport` weight in Phase 1.** A balance judgement made off two measured days.
  Verify with the mix print rather than trusting the number.
- **Bankruptcy stop for `scripts/run-day.ts`** replacing the reputation-zero stop. Affects the
  harness's own reporting, not the game — flagged since it is a judgement call about what
  "the airport is clearly broken" means once reputation cannot say it.
