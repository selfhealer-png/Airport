# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Airfield** — an inverted tower defence game. In a normal TD you build to *stop* things getting
through; here you build to *let them through*. Aircraft arrive on a daily schedule, hold with
limited fuel, and land automatically if the airport can take them. Failing means planes divert
or crash, not that a base loses HP. The progression fantasy is a grass field becoming a
jet-capable airport.

It ships as an installable **PWA targeting phones, portrait-locked**. Runways therefore run
vertically on screen.

The full design lives at `C:\Users\SamP\.claude\plans\i-d-like-to-create-crystalline-mochi.md`.

## Commands

Node 24 is installed at `C:\Program Files\nodejs`. Git Bash does not pick it up automatically —
prefix Bash commands with `export PATH="$PATH:/c/Program Files/nodejs";` or use PowerShell.

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server, `--host` enabled so a phone on the same Wi-Fi can load it |
| `npm run build` | Regenerates icons, typechecks, then builds to `dist/` with a service worker |
| `npm run preview` | Serves the production build (the only way to exercise the service worker) |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest in watch mode |
| `npm test -- tests/sim.test.ts` | One file |
| `npm test -- -t "serves lowest fuel first"` | One test by name |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run icons` | Regenerates `public/*.png` from the game palette |
| `npm run day -- 12` | Headless harness: runs 12 days and prints each debrief |

### Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`.
Pages serves from a repository subpath (`user.github.io/<repo>/`), which is why
**`base: './'` is set in `vite.config.ts`** and why the manifest's `start_url` and `scope` are
relative. With Vite's default absolute `/assets/…` paths every script 404s and the page comes
up blank — and it fails only when deployed, never locally, so it is worth knowing about before
changing it. Serving `dist/` from any subdirectory reproduces the problem in seconds.

## Architecture

**The one rule that matters: `src/sim/` must not import from `render/`, `ui/`, `input/` or
`sprites/`.** The simulation is plain state plus a `stepDay()` reducer with no canvas and no
DOM. That is what makes the game testable headlessly, makes the 1x/2x/4x speed controls
trivial (run N sim steps per frame), and keeps rendering swappable. Every test covering game
behaviour runs without a browser environment.

```
src/
  sim/        state, stepDay(), aircraft lifecycle, runway/helipad assignment, economy
  content/    aircraft classes, facility levels, level maps, schedules — balance data only
  render/     camera + canvas drawing of sim state
  sprites/    palette, authored pixel data, and the atlas baker
  ui/         DOM overlay — HUD, bottom-sheet build drawer, debrief
  input/      pointer handling: drag to pan, pinch to zoom, tap to select
  save/       localStorage snapshot of progress and layout
  main.ts     wires the above together
scripts/      icon generation and the day harness (run via vite-node, not node)
```

### How a day resolves

The schedule is a **fixed path**: `generateSchedule(day, seed)` decides everything, so what
arrives tomorrow is knowable today. There used to be a reputation input that claimed to *thin*
heavy traffic and in fact deleted it — once every class fell under the 0.35 weight floor,
`availableTiers()` returned its fallback of `TIERS[0]`, so a bad day got club trainers and
nothing else. Nothing else was attached to it: there is no licence-revoked fail state anywhere
in `src/`, the campaign simply ends at day 50. What replaced it is descriptive only —
`landedTotal`/`scheduledTotal` on `GameState`, reported by the debrief as a service level, read
by nothing.

Two consequences worth knowing before touching `content/schedule.ts`:

- **Weights are fractional on purpose.** Age-thinning halves a weight for every six days a
  class is behind the newest, and anything under `0.35` is dropped from the day entirely. A
  round `1` for `fighter` thins to `0.25` and the class vanishes from the sky *and the
  forecast* at day 45 — the same cliff reputation used to produce. Worse, `1.4` thins to
  `0.34999999999999997`, which fails the `>=` test while looking like it should pass.
- **Traffic that does not use the main runways is measured, not guessed.** Military and rotary
  classes each sit around 16–21% of the late campaign. They were both well past that when
  first tuned, and at those numbers a military strip and a helipad stop being bets and become
  mandatory infrastructure. Check the share (`availableTiers` weights against the total) rather
  than reasoning about individual numbers.

`stepDay()` in `src/sim/step.ts` runs a fixed order every tick, and the order is load-bearing:
spawn arrivals, decide who the tower is managing, burn fuel and resolve anyone who ran dry,
assign runways, advance timed phases. Resolving fuel *before* assignment stops an aircraft
that has just diverted from still consuming a movement slot.

`assignHoldingAircraft()` considers holding aircraft **lowest fuel first**, and every aircraft
it cannot place records a `BlockReason`. Those reasons are the game's entire teaching
mechanism: waves play themselves, so the debrief explaining *why* an aeroplane was lost is the
only feedback the player gets. Two rules protect that:

- Reasons are ordered most-fundamental first in `findAssignment()`, so the player is told to
  build a longer runway before being told the runway was busy.
- A busy tower is only reported as the reason when the aircraft could otherwise have been
  taken. Never blame a transient constraint for a structural one.

**A day ends when the last inbound is resolved**, not when a clock runs out and not after
departures finish. Waiting for either produced minutes of empty sky. Aircraft still turning
round on stand do not hold the day open; departures still compete for runways while the day
runs, so the pressure they create is unchanged.

Aircraft blocked for a **structural** reason (`STRUCTURAL_REASONS` in `step.ts` — no runway
long enough, wrong surface, no linked stand of the right size, missing facility) are diverted
after a short hold instead of burning a full tank. Waiting could never help, so making the
player watch it is dead time. Transient reasons (runway busy, stand occupied, tower at
capacity) keep holding, because those can resolve.

Crashes are not bad luck. Aircraft beyond the tower's `stackCapacity` are unmanaged: never
sequenced, and unable to divert safely, so they come down if they run dry. That is what makes
tower upgrades matter.

Throughput is a layout puzzle, not a runway-length puzzle. A landed aircraft must reach a free
stand of adequate size via `buildLinks()` connectivity, or the runway stays blocked — which is
what stops "one very long runway" from solving the game.

### Roads: the landside network

Taxiways carry aeroplanes; **roads carry everything else** — crews, fuel bowsers, fire cover,
baggage, and the passengers themselves. One rule covers all of it:

> Everything built except a taxiway must touch the airport's road network.

The network is **one connected component** — `roadNetwork()` returns whichever run of road
touches the most built things, and only that one counts. Two private stubs serving two halves
of an airport are not a road network, which is what makes roads a planning problem rather than
a formality. They are priced at £25/tile on purpose: what a road costs is land and routing,
not money.

An earlier version rooted the network at the **map edge**, on the theory that an airport has a
landside access road. Right idea, wrong game: the field is 42 tiles tall and a phone shows
about twelve rows at the minimum integer camera scale, so the boundary is several swipes away
from anything the player is looking at. The rule amounted to "pay for forty tiles of road
towards something off screen". If map-edge rooting ever comes back, the entrance has to be
visible from where the airport is being built.

Consequences, all in `structuralBlock()` and the `working…` accessors:

- A runway with no road alongside cannot be opened (`no-road-runway`) — fire cover has to
  reach it.
- A stand with no road cannot be used (`no-road-stand`) — nothing can get the passengers off.
- A **building with no road does nothing at all**. `towerLevelOf()` says what was *built*;
  `workingTowerLevel(airport, services)` says what is *staffed*. Keep those apart — the build
  system and the simulation would otherwise disagree about whether a tower exists.

`DayState.services` (a `Services` from `buildServices()`) holds taxi links and road service
together, computed once when the day starts. Building only happens during planning, so it
cannot go stale under a running day — and flooding the road network per aircraft per tick
would be thousands of graph searches a second.

### Military traffic needs its own runway

`Runway.use` and `AircraftClass.use` are both `RunwayUse` (`'civil' | 'military'`), and the
match is **exclusive in both directions**: a military strip will not take airliners and an
airliner's runway will not take fast jets. That symmetry is the mechanic. If military runways
doubled as civil ones, building one would be strictly better than not and the decision would
evaporate; dedicated means an expensive strip that sits idle most of the day and pays in
bursts.

The three military classes carry **no passengers at all**, so they never touch the terminal —
a military strip is a bet on infrastructure, not on footfall. The fighter needs only five
tiles, which makes the bet cheap to enter; the strategic airlifter needs fifteen.

Two details worth keeping:

- The use check runs **before** the length check in `structuralBlock()`, because a strip
  cleared for the wrong thing is the wrong runway, not a short one — telling the player to
  lengthen it would send them to build the wrong thing entirely.
- It is skipped when the airport has **no runways at all**, so an empty field still reports
  `no-runway-length` ("no runway long enough") rather than "no civilian runway", which would
  be a baffling thing to read on day one.

`sim/advice.ts` warns in both directions: military movements booked with no strip to take
them, and a strip standing idle on a day with nothing military due.

### Rotorcraft need no runway at all

A **helipad is a runway and a stand in one tile**. A helicopter lands on it, parks on it and
lifts off it, so there is no length, no surface, no taxi link and no stand size in the way.
That makes the late campaign a placement problem again rather than "extend the strip once
more", which is the whole reason the feature exists.

`runwayLength: 0` is the sentinel that marks a rotor class (`isRotorcraft()` in
`content/aircraft.ts`). `MIN_RUNWAY_TILES` is 3 and `checkRunway` enforces it, so a zero can
never mean a very short runway. `minSurface`, `use` and `standSize` stay on `AircraftClass` and
are simply unread for those classes — cheaper than forking the interface for two entries.

Four rules it does **not** escape, each of which would break something if relaxed:

- A pad with no road does nothing, same as everything else since roads.
- A rotor movement still costs the tower a movement. Exempting it would let a helipad-only
  airport bypass the tower entirely.
- A pad is held from approach through the whole turnaround — there is no pushback that frees a
  gate early — so **pad count** is what a busy rotary day needs.
- `structuralBlock()` answers `no-helipad` for a rotor class on a fully paved airport, never
  `no-runway-length`. Telling the player to lengthen a runway would send them to spend
  thousands on the wrong thing.

The phase model **branches explicitly** in `advanceTimed()`: `landing → parked → departing`,
with no taxi phase. Do not instead set `taxiSeconds: 0` and let the phase complete invisibly —
it works, and it leaves a dead phase that every other piece of code touching `AircraftPhase`
has to know is a one-tick no-op for two specific classes.

A rotor crash closes the pad it came down on, not the longest runway. There is no "longest" pad
to sort by, and taking the strip the airliners needed for something that never touched it would
be a nonsense. `CLOSED_BY_WRECKAGE` in `step.ts` is how — a reservation to an id no aircraft can
hold, cleared by `startDay` with every other reservation.

### Groundworks: what an obstacle becomes

Water, rock and woods sat in `Terrain` for two phases as pure walls. What turns them into
decisions is not the price — it is **what each one becomes**, and the difference is what may
*cross* it:

| Terrain | Groundwork | Carries |
| --- | --- | --- |
| `woods` | Felling | Anything. It becomes ordinary ground. |
| `water` | Bridge | Roads and taxiways. No runway, stand, helipad or building. |
| `rock` | Tunnel | Roads only. |

**Clearing deliberately does not produce grass.** That version keeps suggesting itself and it
is wrong: if every obstacle converts to buildable ground then terrain is a **money tax** — it
slows a rich player down and stops nobody, and every obstacle map eventually plays as the
meadow with a bill attached. Authoring a river through a level would buy nothing the moment
the player could afford the river.

The three rules give the obstacles genuinely different characters. Woods are the pressure
valve, the one you buy your way past outright, which is what stops an obstacle map being
unwinnable. Water splits the **ground** without splitting the routes across it, so an airport
can straddle an inlet. Rock splits the **airside** absolutely — a runway and its apron can
never sit on opposite sides of a ridge, while the landside still reaches both. That last one
is what makes the single-connected-road-network rule a planning problem on those maps rather
than a formality.

`terrainAllows(terrain, worked, kind)` in `sim/types.ts` is the whole rule, and it replaced
`isBuildable`, which had exactly one call site. `tileIsFree()` in `build.ts` gained the `kind`
and every `check…` passes a literal.

`Airport.groundworks` is one `Uint8Array` mask beside `taxiways` and `roads`. **What the work
bought is read from the terrain underneath rather than stored**, so no tile can end up a bridge
over grass and there is no second field to keep in step.

Two consequences:

- **Groundworks are permanent and refund nothing.** `checkDemolish` never touches the mask —
  bare worked ground reports `nothing-there`, and removing the road across a tunnel refunds the
  road alone. Undo is the only way back, which is why it now repaints the shell after a build.
- **One chip, priced per tile by what is underneath.** A drag across a wooded slope onto rock
  is quoted correctly rather than at a blended rate. Grass in the run costs nothing and is
  skipped rather than refused — the same forgiveness `checkGrowRunway` shows a drag along an
  already-paved strip.

Three appearances from one mask, joined tile-to-tile where a run continues so a causeway reads
as one structure: stumps on felled ground, decking over water, a dark cut through rock. A
player who cannot see what they bought will buy it twice.

### Passengers, and the modular terminal

A landing pays twice: a **landing fee** that is always collected, and the **passengers**, but
only as many as the terminal can process that day. Terminal capacity is a per-day budget spent
across every flight, not a per-flight limit.

This split is the terminal's whole job. A longer runway lets a bigger aeroplane in; it does
nothing about the three hundred people on board. The **freighter carries none**, which is why
it rewards a long runway before a big terminal and keeps earning on a day the terminal is
swamped. The landing fee is **flat** — it is what the *runway* earns. It used to be multiplied
by the terminal's level, which meant a freighter that never touched the terminal still paid
more for a better one.

**A terminal is a core plus modules, not a building with a level.** The level ladder said
everything about a terminal in one number, which made the biggest building in the game the
least interesting decision on the map: tap upgrade, pay, done. Four module types, one tile
each — gate hall (capacity), baggage hall (revenue *and* turnaround), retail unit (revenue),
border control (unlocks the long-haul classes).

**A module works only as part of a terminal**: road-served, and reachable from a road-served
core through a chain of road-served modules. `Services.terminalModules` is that flood fill,
computed in `buildServices()` beside the road network and the taxi links because all three
answer the same kind of question once, when the day starts. So a concourse is a *layout*, and
cutting the middle out of one strands everything past the cut.

**Everything sums.** The old ladder had to defend itself against two cheap sheds beating one
good building, which is why it carried a capacity-weighted average of fare multipliers that
nobody could have deduced from playing. Modules cost a tile each, so "more" is already paid
for in the only currency that is scarce, and plain addition is honest. `TERMINAL_LEVELS`,
`ADDITIONAL_TERMINAL_COST_MULTIPLIER` and `newTerminalCost` are all gone.

Two things it is worth not re-deriving:

- **`workingTerminalCapacity` must keep the no-terminal floor** (`NO_TERMINAL_CAPACITY`, 60).
  A windsock and a gate in a hedge is what makes day one pay for the first runway, and a naive
  sum returns zero instead — which silently breaks the opening of every campaign.
- **Retail is rationed against gate halls** (`RETAIL_PER_GATE_HALLS`, two halls to a shop).
  Land alone is too weak a cap: retail earns per passenger of every flight, so without a limit
  the winning move is a field of shops beside a single core. One shop per hall was the first
  rule and read beautifully — until a nine-hall terminal licensed nine shops and day 50 closed
  on £1.1M.

**Border control is the only requirement about *who* is on board rather than what the
aeroplane needs to operate**, which is why it is a terminal module and not a support building.
It is checked in `structuralBlock()` after the runway and the licence, so the player is told
to build the strip before the dearest building in the game. Going through `structuralBlock`
is what gets it into the forecast and the debrief for free — and that is the test of whether a
gate belongs in this game at all. Its first run had no debrief wording, so a fortnight of the
campaign reported losses as "unknown"; a constraint the player cannot be warned about is a
punishment, not a mechanic.

**Baggage halls shorten every turnaround** as well as paying per head. That is the module that
argues with the apron rather than with the bank, and it is what stops the terminal being purely
a revenue decision. Capped at three (`baggageTurnaroundFactor`), because past that the
constraint is the apron itself.

Measured against the same seed, the old ladder finished day 50 on **£850,115 at 90% served**;
modules finish on **£740,557 at 91%**. The economy still runs away, but less than it did.

Every module sits *inside* the terminal, which on a tile grid means orthogonally touching the
core or another module. `checkFacility` refuses a bad placement rather than letting it be built
and quietly earn nothing — a gate hall is £1,100 and that is too much to lose to something the
game could simply have declined. It is gated on what is **built**, not on what is *working*:
you are allowed to build ahead of the road, and `airportAdvice()` is what tells you a module is
dead weight. Gating on the working set would make the order you build in matter for no reason
anyone could deduce.

### Running costs, and why their *shape* matters more than their size

Two costs recur; everything else in the game is capital you pay for once and own. They exist
because without them the campaign ran away — the auto-player finished day 50 having spent 22%
of everything it ever earned and sat on the other 78% with nothing left to buy.

- **Ground handling** (`HANDLING_FEE_FRACTION`) is a flat proportion of what a flight actually
  took, charged in `land()`.
- **Aerodrome certification** (`CERTIFICATION_LEVELS`) is a standing daily fee for the size of
  aeroplane you are licensed to accept, charged once in `closeDay()` whether anything flew.

**The economy is a compounding growth process, and that governs everything about how a cost
here has to be priced.** Daily profit grows about 150x between day 5 and day 50 because income
is reinvested into capacity that earns more income. A drag applied during the growth phase
therefore does not produce a proportionally smaller endgame — it stalls the engine. Measured:
a 15% handling charge took fifty-day gross takings from £1.75M to **£20k**, because the airport
never accumulated enough to pave a runway and never escaped its first plateau.

Three rules follow, and each was learned by breaking the campaign:

- **Price recurring costs off revenue, never off activity.** A flat £3 per passenger was 33% of
  passenger revenue on day 8, when a head is worth £8, and 9% on day 50, when a level-4
  terminal and four shops make the same head worth £32. Per-movement and per-tile charges are
  regressive here for the same reason: headcount, turnaround seconds and tile counts all grow
  perhaps 5x across a campaign in which money grows 150x.
- **Charge on what was earned, not on what was scheduled.** Handling is charged only on
  aeroplanes that actually landed, so a bad day costs less. That is what stops a running cost
  becoming the death spiral reputation used to be.
- **A standing fee needs an escape hatch.** Certification is opt-in, and
  `checkSurrenderCertification` gives it back. An airport that overreached can always stop
  paying for a category it cannot fill.

Certification is checked in `structuralBlock()` **after** runway length and surface, which is
deliberate: the player should be told to build the strip first and buy the licence last, when
they can actually use it, rather than paying rent on a category they have nowhere to put.

It is also the only mechanic that asks *should I chase this class at all?* Runway length,
stands and terminals all make bigger strictly better once affordable; a daily fee against the
category held makes a well-run regional airport a real alternative to a stretched
international one.

### Building

`src/sim/build.ts` exposes every operation as a **`check…` / `apply…` pair**. `check` returns
either a `BuildQuote` (the cost) or a `BuildError` explaining the refusal; `apply` trusts that
the check passed. The drawer uses the same `check` to price a drag live and to explain why a
placement is refused, so what is previewed and what is built cannot disagree.

**Dragging a runway chip along a runway that already exists grows it** rather than refusing
as `occupied` — longer, better surfaced, or both in the one drag. `checkGrowRunway()` prices
it as *what the finished runway is worth, minus what has already been paid for it*, so
extending a 4-tile grass strip to 8 tiles of gravel costs exactly what building it that way
would have. Any other pricing punishes the player for having started small, which is the only
way the game lets anyone start.

A surface *below* the one already down is ignored rather than refused: dragging the grass chip
along a paved strip means "make it longer", not "tear the tarmac up". `touchedRunways()` is
what separates growing from building — drag over the strip you have and it grows, drag clear
of it and you get a second one.

`src/ui/placement.ts` sits between the two and is deliberately **DOM-free**: a drag is just
two tiles, so `resolvePlacement()` and `commitPlacement()` are covered by
`tests/placement.test.ts` without a browser. Anything about how a drag behaves — runways
staying in their starting column, taxiways snapping to an axis — belongs there, not in
`main.ts`.

Facilities are placed on tiles and the simulation reads them through accessors
(`towerLevelOf`, `hasFuelFarm`, …) rather than flags on `Airport`. Position has no simulation
effect; what a facility costs is land near the runways.

### The day loop

`main.ts` runs a **fixed-timestep** loop: real elapsed time accumulates and `stepDay()` is
called in `SIM_DT` slices. The speed multiplier simply runs the reducer more times per frame,
so 1x/2x/4x cannot diverge from what the tests exercise. Frame time is clamped
(`MAX_FRAME_SECONDS`) so a backgrounded tab resumes rather than fast-forwarding a whole day.

Aircraft have **no coordinates in the simulation** — they are a phase plus a timer. Screen
positions are derived in `render/aircraft.ts` from the phase, the timer (which doubles as an
animation clock, since every phase has a known duration) and the assigned runway/stand. Keep
it that way: giving `sim/` positions would break headless testing for no gain.

`ui/debrief.ts` groups losses by **reason**, not by aeroplane, and `tests/debrief.test.ts`
pins that wording. It is the only feedback the player gets, so treat its text as game logic.

### The build menu

`src/ui/drawer.ts` renders **labelled sections in a wrapping grid**, not one horizontally
scrolling row. The row was fine at four chips and unusable at sixteen: the only cue that "fire
station" existed at all was a scrollbar phones do not draw. `chipSections()` owns the grouping
and `chips()` flattens it back for every lookup that does not care about layout — `Tool`,
`BuildCheck` and `minimumCost()` know nothing about sections.

Height is the cost, and **auto-collapse is what pays it**: arming a tool fires
`DrawerHandlers.onToolArmed`, which the shell turns into `setExpanded(false)`. That is exactly
what tapping `Close` already did, and the player had to do it manually every single time. Two
details:

- It does **not** fire on deselection — putting a tool down should not move the drawer — and it
  does **not** fire for **demolish**. Every other tool arming onto a suddenly full-size map is
  covered by undo; demolish is the one combination where a stray drag takes a whole runway out
  before the player has noticed the drawer went away.
- The grid's tracks are `minmax(min(140px, 100%), 1fr)`. See the gotcha below about grid tracks:
  a long chip label in an `auto` track pushes the drawer *and the canvas beside it* past the
  viewport.

### Auto-play, and what counts as a problem

The opening of a campaign has stretches where there is genuinely nothing to build for days,
and tapping through them is not gameplay. The play button in the HUD keeps opening the airport
until something wants looking at, glowing for as long as it is running — a mode that silently
keeps starting days is alarming if you cannot see whether it is on.

**`needsAttention(state, lastDay)` in `sim/advice.ts` is the whole of its judgement**, and it
is deliberately one definition rather than two that can drift. It fires on, in order: an
aeroplane lost in the day just played; traffic booked for tomorrow that `structuralBlock`
says the airport cannot take; or any `warn` from `airportAdvice`. Pure, so it is tested
headlessly — a false null sails past something the player needed to see, and a false reason
makes the feature stop constantly and be worthless.

Two consequences worth keeping:

- **The debrief is skipped while auto-play has nothing to report**, and shown when it stops.
  So the debrief appears exactly when control is being handed back, which makes it worth
  reading rather than a tap to get past. The final day is never skipped.
- **Auto-play always switches itself off when it stops**, and pressing play with a problem
  already on the board refuses and says what it is, rather than appearing to do nothing.

The broad stop condition is a deliberate choice: it will stop most days once the campaign gets
busy, because by then the advice panel usually has something to say. It is a large win over
the first fortnight and tapers off, which is where the tedium actually was.

The HUD's other button stops auto-play and opens the build drawer — the way to intervene
rather than wait for the game to stop you. Both live in the HUD rather than the drawer because
they must be reachable while a day is running, when the drawer belongs to the day bar.

### The drawer must never resize the map

`#drawer` is a grid row, so anything that changes its height resizes `#map-wrap`, and a resize
runs `relayout()`. Because `fitScale` snaps to whole device pixels, the rungs are far apart —
on a 390x844 phone the map went from scale 1 with the drawer shut to **2/3** with it open, and
back the instant a tool was armed and the drawer auto-collapsed. The map jumped a third of its
size every time the player reached for something to build, and they could not pan it back,
because arming a tool puts the map into build mode.

So **only the bar takes up layout**. The hint and the expanding body are `position: absolute`
against `.drawer-panel` and float above it, over the map. Two consequences to keep:

- `#drawer` must **not** clip. It used to carry `max-height` + `overflow-y: auto` for its own
  scrolling, which ate the floated children whole — they sit outside its box by design. The
  bound and the scrolling belong on `.drawer-body`, the only part that can get tall, and that
  is also the one place that opts back into `touch-action: pan-y` against the root's `none`.
- The panel is classed `drawer-panel` rather than selected as `#drawer > div`, because the day
  bar replaces it in the same host while a day runs and must not be floated.

**The hint stays in layout and goes `visibility: hidden` when empty.** Floating it was the
first attempt and it was worse: it then sat over the bottom of the field, hiding the very map
it was telling the player to drag a runway onto, with no way to dismiss it. Only `.drawer-body`
floats. `visibility` rather than `display` because the space it holds must never change.

**`#drawer` carries a `min-height`** so the planning panel and the day bar occupy the same
space. Without it the map area changed the moment a day started and the field re-centred. The
number is measured (bar 61 + hint 44 + gap 8) — re-measure it if either bar changes shape.

**Do not verify any of this by comparing canvas pixels in a headless browser tab.** A
backgrounded tab throttles `requestAnimationFrame` to a stop, so the canvas is simply never
redrawn and every frame compares equal — which reads as "the camera did not move" whatever the
truth is. Layout measurements (`getBoundingClientRect`) are unaffected and are the reliable
signal; anything about the camera belongs in `tests/camera.test.ts`.

### Placing something on a 11-pixel tile

At the fitted zoom a tile is about 11 CSS px — smaller than the part of a thumb that touches
the glass. Four things together make that placeable, and they solve four different problems;
none substitutes for another.

- **Arming a tool zooms in.** `buildZoom()` in `render/camera.ts` picks the smallest crisp
  step whose tiles are at least `BUILD_TILE_PX` across, and putting the tool away restores
  wherever the player was. Not 44px, the usual touch-target minimum: that would need scale
  2.75 and show 8% of the field, and the field is 35x45 precisely so a level can be seen
  whole. A build is not a blind one-shot tap — the preview shows what will happen and the drag
  is correctable until release — so the bar is "a thumb's wobble moves you a fraction of a
  tile", not "you can hit it without looking".
- **Two fingers pan as well as pinch**, in `input/pointer.ts`. This is what makes zooming in
  usable at all: one-finger drag belongs to building, so before this, zooming in left you
  unable to reach the rest of the field. Zoom is applied about the midpoint first and the
  translation added after, so the two compose. The translation is gated on `canPan` and the
  zoom is not — gating both would make the panning state unreachable.
- **The game aims above your fingertip.** `AIM_OFFSET_PX` in `input/drag.ts`, with a crosshair
  drawn at the aim point. Applies to every tool including demolish: a rule that holds
  sometimes is a rule a thumb cannot learn. It clamps near the top of the map, which leaves a
  band where the crosshair stops climbing — the honest cost, and survivable because a contact
  in that band still targets the top visible row.
- **The anchor floats.** For the first `ANCHOR_LOCK_PX` of travel the start tile follows the
  finger, then locks. The first tile of a line used to be fixed the instant the finger landed,
  with no preview and no second chance — the highest-precision moment in the game and the only
  one with no feedback at all. Single-tile tools already worked this way (`resolvePlacement`
  ignores `from` for them); the crosshair is what makes it discoverable.

`input/drag.ts` is DOM-free and holds the whole gesture shape as a pure reducer, for the same
reason `ui/placement.ts` is: the offsets and the lock threshold are the parts most likely to be
subtly wrong and the parts a `node` test can reach. `pointer.ts` is a thin event pump over it.

**What a drag *means* is untouched.** Runways still lock to their starting column, taxiways
still snap to an axis, growing still beats refusing. This changed how a drag is *made*, not
what it does, which is what keeps `tests/placement.test.ts` a valid oracle throughout.

Three bugs fixed on the way, all in the gesture layer:

- **A second finger used to commit the build**, not cancel it — `endBuild()` called
  `onBuildEnd`, which builds. `pointercancel` shared that path, so an iOS notification banner
  mid-drag built a runway. There is now an `onBuildCancel` channel, and cancelling gives the
  gesture the abort it never had.
- **`onCameraMoved` fired even when the pinch changed nothing**, so resting two fingers on the
  map set `framed` permanently and the map never re-fitted itself again — the exact poison the
  `canPan` gate exists to prevent, arriving through the other gesture.
- **A third finger killed the pinch** and lifting back did not recover, because the baseline
  was never recomputed. The gesture is now defined by the two oldest contacts and re-bases
  whenever the pointer set changes.

`onTap` was deleted. It was unreachable whenever a tool was armed, and with no tool armed
there is nothing a tap on the map should do.

### Panning is only allowed when there is something off screen

`fieldOverflows()` in `render/camera.ts` gates the one-finger drag, via `PointerHandlers.canPan`.
At the fitted zoom the whole field is on screen, so a pan could only shove it off centre and
leave it there — and worse, any pan sets `framed`, after which the map never re-fits itself
again for the rest of the session. That one flag is why a stray drag used to poison every later
layout change.

**Pinch is deliberately not gated.** Panning unlocks only once the field is bigger than the
screen, so gating the zoom too would make that state unreachable and kill zooming outright.

### Undo, and the collapsed drawer

`save/history.ts` is undo for the planning phase. It stores **whole-state snapshots**, not
inverse operations: a build is not always one tile — a runway drag, a resurface, a demolition
that removes an entire strip — and each would need its own hand-written inverse to get right.
Snapshots are already built, validated and tested for saving, so undo reuses them and cannot
disagree with what a reload would restore. Undoing restores the **money** as well as the tile,
because losing 40% to a demolition was a punishment for a slip of the thumb rather than for a
decision.

Two rules it depends on:

- `restoreInto()` writes into the **existing** `GameState` object rather than returning a new
  one. The app shell, the pointer handlers and the render loop all closed over the original
  when they were wired up; swapping it would leave them driving a game nobody can see.
- The snapshot is captured **before** a build and pushed only if the build actually happened,
  so a refused placement never leaves a do-nothing entry on the stack. `beginDay()` clears the
  stack — undo does not reach back across a day, because the schedule has run and the money
  has moved.

The planning UI is in two halves. `planningBar` is always on screen (open the airport, undo,
and a toggle); `planningBody` — forecast, advice, every build chip — is hidden until asked
for, because it was taking half a phone screen from the thing being played. The bar carries
`drawer.headline()`, the single most important thing the drawer would have said, so collapsing
costs the player the detail but **never the signal** that something is wrong.

Two things the collapsed state depends on:

- **A tool stays armed when the drawer closes**, and the bar shows its name. Clearing it
  seemed safer, but it made the drawer unusable on a phone: the only way to build was to arm
  a chip and then drag on whatever sliver of map the open drawer had left. Undo covers the
  stray drag that this allows.
- **`report()` mirrors the status line into the bar.** The running cost of a drag lives in
  `.drawer-status`, which is inside the hidden panel — so with the drawer shut, the player was
  dragging out a runway with no idea what it cost until the money had gone.

### Updating an installed copy

The service worker is `registerType: 'autoUpdate'`, so it uses `skipWaiting` and
`clientsClaim` and takes over the moment it activates. But `registerSW.js` only *registers*
it — nothing reloads — so a launch would install the new build and carry on showing the old
one, and only the launch after that looked different. On a phone, where the app is opened and
dismissed rather than refreshed, that reads as the update not having worked at all.

`main.ts` therefore reloads on `controllerchange`, guarded on a controller already existing:
`clientsClaim` fires the same event the first time a worker claims a page that had none, and
reloading then is a pointless flash on a player's first visit.

iOS still needs the app **fully dismissed from the app switcher**, not merely backgrounded — a
resumed process never navigates, so nothing checks for a new worker.

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
with a hole in it. `tests/levels.test.ts` then asserts these across *every* level:

- terrain length matches the declared size;
- there is room somewhere for the longest runway in the game, and two distinct columns for the
  longest military one;
- **a road can reach every part of the field**, stated against `terrainAllows` rather than
  against a list of terrains;
- **the largest single grass region has room for the longest runway.**

Those last two replaced "all grass is one connected region", and the reason is worth keeping.
That rule existed because `roadNetwork()` counts only the largest connected run of road, so a
map whose obstacles split the buildable ground in two would silently make one half useless — a
runway there could be paid for and never open. It caught exactly that while Bracken Rise was
being drawn. **Groundworks retired it**: every obstacle can now be worked to carry a road, so
no grass region can be stranded, and Tidewater splits its ground deliberately. What survives is
the *reason* — a region a road cannot reach is dead ground — which is why the test is written
against `terrainAllows` and will fire the day a terrain is added that roads cannot cross.

The largest-region check is the other half. Splitting a field is fine; making the player bridge
before they can lay their first strip is a wall rather than a puzzle, and on day one there is
no money for it.

**Tidewater** is the water level. Both banks are real airports-in-waiting and the inlet sits
about sixteen columns from either edge: comfortable for a first strip and its apron, tight for
the airport day 40 wants. So bridging is a mid-campaign decision rather than a day-one tax.

**The day harness is meadow-only.** `scripts/run-day.ts` hardcodes column positions
(`RUNWAY_X = 5`, `WEST_STAND_X = 8`, `STAND_ROWS`, and the terminal chain down `BUILDING_X`)
that a map with obstacles in them would turn into nonsense, so Bracken Rise and Tidewater are
**not** balance-checked by anything. Treat a new map as
a new balance target rather than assuming it inherits the meadow's tuning — the campaign is
already tuned against seed 42 on one map, and seeds 99 and 3 clear only 42% and 24% of their
traffic even on the meadow.

### Scenarios

A scenario is an airport you **inherit** rather than one you found. The campaign teaches
building from nothing, which is a different problem from the one most airports have: somebody
else's decisions, already paid for, already in the way.

`Scenario.startDay` does the job a win condition would, which is why there is not one. Traffic
escalates on a fixed schedule, so the day sets the difficulty — and the campaign already ends
at day 50, so taking over on day 30 *is* a twenty-day scenario. Nothing new to build, nothing
new to explain, and the ending is the one the player already knows.

Scenarios are authored **as code** in `content/scenarios.ts`: the `add…` helpers are the same
ones `apply…` calls, so a scenario is written the way an airport is built. The catch is that
those helpers **do not validate** — they are what runs *after* a check has passed — so a
scenario can describe an airport the build system would have refused.
`tests/scenarios.test.ts` is that check, and it earns its place. It caught a taxiway painted
across a runway (a tile that was two things at once) and a premise that was simply false
(Overspill's "full" apron had open ground beside every stand). It also pins that each scenario
is still *unsolved* on the day it hands over the keys, through the same `tomorrowsTraffic()`
the forecast uses — an inherited airport that already copes is not a scenario, it is a save.

`GameState.scenarioId` is carried on the state rather than derived. Without it the menu offers
"Continue" against the *level* a scenario borrows and loads somebody else's airport under that
level's name. Scenario completions are namespaced in the progress list (`scenario:<id>`), which
is what stops finishing one from unlocking a campaign field — they are side content, always
open, in both directions.

### The tutorial

Six steps on day one of the first level, teaching the two rules nothing else can: an aeroplane
needs a runway **and a way off it**, and everything except a taxiway needs a road. Both are
invisible until they bite, and when they bite the aeroplane is already gone.

Steps are **predicates over a real `GameState`** in `content/tutorial.ts`, pure and DOM-free
for the same reason `ui/placement.ts` is — `tests/tutorial.test.ts` drives a game through all
six with the same `check…`/`apply…` pairs a thumb drives. That is the only way to know the
sequence can be finished at all, and writing it immediately caught the test's own roads being
two disconnected networks. Every predicate reuses the **simulation's** connectivity functions,
so the tutorial cannot congratulate a player on something that will not work.

**Nothing is gated.** `currentStep()` returns the first *unsatisfied* step rather than tracking
an index, so building the stand first simply means the game never asks for it. A tutorial that
traps you is worse than none.

There is **no skip control and no `tutorialDone` flag**, both of which the design called for
and neither of which earns its place: the tutorial only appears on day one of a fresh campaign
and its last step is "open the airport", so the button already on screen is the skip. Day one
happens once per campaign, and starting a new one should teach it again.

It reuses the existing **hint** rather than adding a panel — already in layout, already sized
for a phone, already proven not to cover the map. A floating tutorial panel over the field you
are being told to build on is a mistake this project has shipped once already.

Three things it needs from the rest of the app, each found by playing it:

- **The step outranks the armed-tool message.** The other way round, arming the grass strip
  replaced "drag out a runway here" the instant the player acted on it, and the next step never
  appeared while a tool stayed armed.
- **`armBuildZoom()` centres on the outlined tiles** when there are any. Zooming about the
  viewport centre is right once the player has framed something, but on the first build the map
  is merely fitted — so the target scrolled off and the game hid the "here" it had just named.
- **A successful build reports the next step, not "Built."** The build is already visible on
  the map; the receipt would otherwise sit there as the last word.

`tutorialApplies()` is kept apart from the steps because it is a different question — whether
to be here at all. Day one, no scenario, first level. The suggested runway position is fixed,
and there is nothing to say it is buildable ground on a map with a river in it.

**Reaching a later level for testing:** five taps on the menu title unlocks everything, and the
title then says so — `Airfield — all levels unlocked` — because a cheat that fires silently is
a cheat you forget is on. "Reset everything" clears it like any other progress. It is a
gesture rather than a URL parameter or a console call because the game is an installed PWA on
a phone, where there is no address bar to type into and no console to call from.

### Saving

`save/snapshot.ts` is pure: `toSnapshot` / `fromSnapshot` convert a `GameState` to plain JSON
and back, with no `localStorage` anywhere, so the round trip is tested headlessly.
`save/storage.ts` is the thin browser wrapper and swallows every error — blocked storage or a
full quota must degrade to "the game forgets", never to a crash.

Two rules the format depends on:

- A save stores the **level's id**, not its terrain, and rehydrates from `content/levels.ts`.
  Editing a map therefore never invalidates existing saves.
- **A day in progress is not saved.** Reloading mid-day returns the player to that day's
  planning phase. Persisting the aircraft state machine would buy nothing and break easily.

`fromSnapshot` validates every field and returns `null` on anything it does not trust; entities
outside the map are dropped rather than failing the whole load. Bump `SNAPSHOT_VERSION` when the
shape changes — old saves are then rejected and a fresh game starts.

### Pixel art is code, not assets

There are no image files in the repo. Sprites are authored in `src/sprites/data.ts` as arrays
of strings, one character per pixel, keyed against `src/sprites/palette.ts`. `.` means
transparent. `toPixelGrid()` validates that every sprite is rectangular and every character is
a real palette key, and `tests/sprites.test.ts` parses all of them — so a typo in a sprite
fails a test rather than reaching the canvas.

Two consumers share that data: `sprites/atlas.ts` bakes to canvases for the browser, and
`scripts/gen-icons.ts` encodes PNGs for the app icons. `sprites/pixels.ts` is therefore
**DOM-free** and must stay that way. `SpriteAtlas` is the seam — swapping in real PNG sheets
later means rewriting `atlas.ts` and nothing else.

`public/*.png` is generated and gitignored. Change the palette, not the PNGs.

`art-preview.html` (plus `src/dev/art-preview.ts`) is a dev-only contact sheet of every
sprite at 4x, including one aeroplane at all four quarter turns. Vite only builds
`index.html`, so it never ships. Open it at `/art-preview.html` after touching sprite data —
a bad grid is far easier to spot there than by playing until the aeroplane that uses it
happens to arrive.

### Aircraft are silhouettes, not classes

Aircraft sprites are **families** — `single`, `twin`, `turboprop`, `regional`, `narrowbody`,
`widebody` — and a class points at one through `silhouette` in `content/aircraft.ts`. Several
classes deliberately share a family. A long campaign adds classes constantly, and one bespoke
grid per class would make every balance idea an art job; sharing families makes a new class
pure data.

`AircraftSilhouette` is declared in `sim/types.ts` as a plain string union, *not* as a sprite
name, so `sim/` still knows nothing about how the game is drawn. `render/aircraft.ts` owns the
mapping from family to sprite.

Aircraft may be **longer than one tile** — they are one tile wide and a whole number of tiles
long — and that size difference is how the player reads the progression at a glance. The
whole-tile rule is what lets the renderer rotate them in quarter turns; quarter turns are the
only rotation that preserves the pixel grid, which is why `AircraftView.rotation` is a
quarter and never an angle.

### Things that join up are drawn, not authored

Taxiway guide lines are drawn procedurally in `Renderer.drawGuideLines()`, from each tile's
centre toward whichever neighbours an aeroplane could actually roll onto. Authoring the
straight/corner/tee/crossroads combinations would be sixteen grids to keep in step with each
other. Anything else that has to join tile-to-tile belongs in that routine too.

### Keeping pixel art crisp

Three things cooperate and all three are load-bearing:

- `Camera.scale` is CSS px per sprite px and **may be fractional**. What actually keeps pixel
  art crisp is a whole number of *device* pixels per sprite pixel, so the allowed zooms are
  `steps / dpr` — on a 3x phone that legitimately includes 1/3 and 2/3. `snapScale()` owns
  that lattice and `zoomAt()` snaps to it, so pinch zoom steps between levels rather than
  sliding continuously.

  Insisting on whole *CSS* pixels was stricter than necessary and had a real cost: the field
  is 24 tiles — 384 world px — so a minimum scale of 1 made the map permanently wider than a
  360 px phone, and the player could never see their own airport.
- `deviceRatio()` is the single source of the ratio, used by both the renderer and the pinch
  handler. If they disagreed, zoom would snap to a lattice the renderer was not drawing on.
  It returns the **true** ratio (capped at 3), not a floored one: flooring 1.5 or 2.625 to a
  whole number left the backing store not matching the display, so the browser rescaled every
  sprite.
- `Renderer.resize()` sizes the canvas backing store to that ratio, and screen positions round
  to whole **device** pixels (`Math.round(v * dpr) / dpr`), not whole CSS pixels.
- **A tile is drawn from its own snapped edge to its neighbour's snapped edge**, never at a
  fixed width. At a fractional zoom a tile is not a whole number of CSS pixels — 10.67 at 2/3
  on a 3x screen — so snapping each origin independently while drawing them all the same width
  leaves sub-pixel gaps that show up as seams ruled down the map.
- `imageSmoothingEnabled = false` is reset on every draw (context state is lost on resize),
  with `image-rendering: pixelated` on the canvas as a backstop.

### Coordinate spaces

Three, and mixing them is the easiest bug to write here:

- **tile** — map grid indices; what `sim/` and the content data speak.
- **world px** — tiles x `TILE_PX` (16); what `Camera.x/y` stores.
- **screen px** — CSS pixels relative to the canvas; what pointer events give you.

`screenToTile()` converts; there is no tile-to-screen helper because `Renderer.draw()` is
currently the only thing that needs it.

## Conventions

- TypeScript is strict, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
  Indexed access yields `T | undefined` — that is intentional, handle it rather than asserting.
- `@/` maps to `src/`, configured in both `tsconfig.json` and `vite.config.ts`. Keep them in sync.
- **TypeScript 7** (the native compiler). `baseUrl` was removed; `paths` entries must be
  relative (`"./src/*"`).
- Balance numbers belong in `src/content/`, never inlined into `sim/` logic.
- **A save stores roads, runway use, helipads, the aerodrome licence, groundworks and the
  scenario it came from, and is version 8.** Bump `SNAPSHOT_VERSION`
  whenever the shape changes; old saves are then rejected and a fresh game starts, which is the
  intended migration story. Anything with an id must also join the `nextEntityId` scan in
  `fromSnapshot` — leaving helipads out of it was a bug that would have surfaced two sessions
  later as a pad and a stand sharing an id.
- Entity ids come from `Airport.nextEntityId`, not a module-level counter, so a game's ids are
  deterministic and survive a save/load round trip.

## Gotchas

- **A `check…` passing does not mean an `add…` helper will refuse a bad placement.** The
  `add…` functions in `sim/airport.ts` paint and do not ask — they are what runs *after* a
  check has passed. Anything that builds without going through `check…` (scenarios, the day
  harness, test fixtures) can therefore describe an airport the game would have turned down: a
  taxiway across a runway, two things on one tile, a structure on unworked rock. If you write
  one, write the invariant test with it.
- **Do not write files with Python's `pathlib.write_text()` here.** It defaults to cp1252 on
  this machine and throws partway through on any non-ASCII character, truncating the file it
  already opened. Pass `encoding='utf-8'`, or use the editor tools.
- Large TypeScript files written through Bash heredocs have failed to parse; use the Write
  tool for anything substantial.
- **Service workers need a secure origin.** `npm run dev` over the LAN (`http://192.168.x.x`)
  will run the game on a phone but will not register the service worker or offer to install.
  Full PWA testing needs `localhost`, HTTPS, or a tunnel.
- The map is portrait-only by design. Landscape is not handled and is not meant to be.
- **The field's size is set by the phone, not by the campaign.** Zoom steps in whole device
  pixels, so on a 3x screen the rungs are 1/3, 2/3, 1 and 4/3 — nothing between. The field is
  **35x45 and sits on the 2/3 rung**, which is the largest map that still fits *entirely* on
  the smallest phone worth supporting (an SE, 375x490 of map area). That is deliberate: no
  level should ever need panning to be seen whole, because the puzzle is the road and taxiway
  network and you have to see all of it at once.

  It used to be 24x36 at scale 1, which looked better and was too small to play on — an
  airport fills about 19x31 tiles, so it took 68% of the field before terrain took its share.
  Dropping one rung costs a third of the apparent sprite size and buys 1.8x the ground. Grow
  `FIELD_WIDTH`/`FIELD_HEIGHT` past 35x45 and the field stops fitting an SE; check `fitScale`
  against a real viewport first, because the cost is invisible on a desktop window.
  `scale-preview.html` draws every level at phone size with an airport on it, for exactly this.
- **A CSS `display` declaration beats `[hidden]`.** Overlays (`#modal`, `#crash`) need an
  explicit `[hidden] { display: none }` rule or they scrim the whole game.
- **Grid tracks must be `minmax(0, …)`.** A track's automatic minimum is its content's
  min-content size, so the wide build drawer will otherwise push every sibling — including the
  canvas — past the viewport, and the map ends up drawn off screen on a phone.
- **The map re-frames itself to fit until the player first pans or zooms, then never again.**
  `relayout()` calls `fitScale` + `centreOn` while `framed` is false; `onCameraMoved` from the
  pointer layer sets it true, after which resizes only `clampCamera`.

  Both halves are load-bearing and each was wrong on its own. Re-framing on *every* resize
  meant opening the build drawer threw away wherever the player had panned to. Framing only on
  the very first layout was too early: the drawer is populated after the canvas is first
  measured, so the map was fitted to a viewport some eighty pixels taller than the one it
  ended up in — about five tiles, which hung off the bottom with no way to zoom out. iOS
  compounds it, resolving safe-area insets and the standalone viewport a beat after paint.
- Verifying the running game in a **background browser tab** is unreliable: `requestAnimationFrame`
  is throttled, so the day appears to crawl. That is the frame clamp working, not a bug.
- **`pagehide` autosave will resurrect a deleted save.** `window.location.reload()` fires
  `pagehide`, so anything that wipes storage must first set the `wiping` latch in `main.ts`
  that suppresses the listener.

## Build order

Done: **phase 1** (scaffold, PWA shell, tile rendering, pan/zoom), **phase 2** (sim core,
assignment, fuel/divert/crash, schedules, day harness), **phase 3** (build rules, costs,
demolition, drag-to-place, build drawer), **phase 4** (day loop, aircraft rendering, speed
controls, debrief) and **phase 5** (art pass: silhouette families, multi-tile aircraft,
quarter-turn rotation, shadows and eased landing rolls, procedural taxi lines, HUD polish).

Save/load was pulled forward out of phase 6 and is done: progress survives a reload, with a
two-tap "Start over" to wipe it.

**Phase 6** is largely done: fourteen aircraft classes on a runway ladder stepping 3, 4, 5, 6,
7, 8, 9, 10, 12, 13, 14, 16; a fifty-day campaign with an ending; roads; passengers; terminal
retail. `Terrain` gained `woods` and the meadow grew to 24x42 to hold it all.

Nineteen classes now: three military ones on a dedicated strip, and two rotorcraft on helipads.

Since then: reputation removed in favour of a fixed schedule path, helipads, pooled terminal
capacity, the sectioned build menu, and precision building (build zoom, two-finger pan, aim
offset, floating anchor).

**The depth pack** closed the three items that were listed here as remaining, and replaced the
terminal ladder while it was at it: **groundworks** (fell, bridge, tunnel), **modular
terminals** with border control, **two scenarios**, a **six-step tutorial**, and **Tidewater**,
the water level. On seed 42 the auto-player clears fifty days at a 91% service level with no
crashes.

Remaining rough edges:

- The late campaign still **runs away**, though modules made it less bad rather than worse:
  £740,557 at day 50 against £850,115 for the old ladder, on the same seed. Getting the surplus
  to zero would need running costs near 70% of revenue, which is repricing the game rather than
  trimming it. Modules are a genuine sink but a **one-off** one; upkeep on them is the obvious
  next lever and was deliberately left out until the campaign has been re-measured.
- **The campaign is balanced against seed 42 alone, and is fragile on others.** Measured on the
  fifty-day harness with running costs *disabled*: seed 42 and seed 7 clear at ~90%, seed 99 at
  42%, seed 3 at **24%**. That is a pre-existing property of the economy and the auto-player,
  not something the running costs introduced — but they do make a bad seed worse, so tuning
  against a single seed hides real fragility.
- **Multiple control towers** are deliberately not built. Pooling movement and stack capacity
  the way terminals now pool passengers would be a small change — `facilityOf()` and one
  `'already-built'` branch — but the harness records **zero crashes across all fifty days**, and
  a crash is the only thing stack overflow causes. The tower is not a binding constraint
  anywhere in the campaign, so uncapping it buys nothing but a balance problem. Build it if and
  when a harness run starts showing crashes or unmanaged holding aircraft.

`npm run day` plays the **whole fifty-day campaign against an auto-player** and prints each
debrief: landed/diverted/crashed with reasons, passengers handled and turned away, how long
each day took, and what the airport looks like that day. Deterministic for a given seed, so a
change in the output is a change in the game rather than noise.

**Its results are chaotic under small balance changes, and that is a property of the tool, not
noise.** The auto-player's purchases are step functions — it either affords a thing on a given
day or it does not — so a small change to a constant flips one decision and cascades through
the rest of the campaign. Observed while tuning: *lowering* the handling fraction from 0.08 to
0.05 took seed 7 from 88% to 63%, and from 0.05 to 0.03 took seed 42 from 90% to 35%. Do not
read a single run as a smooth signal, and do not tune to three significant figures against it.

It builds as it goes — reactively, from the forecast, in the obvious order — because the
question that matters over fifty days is not "what does the traffic look like" but **"can the
player afford the next rung when the traffic demands it"**. A wall shows up as a run of
diversions it never spends its way out of; a broken run shows up as `Bankrupt on day N`.

Reading its output is how the phases above were decided, and it is worth knowing that **the
harness can lie about the game**. Its apron policy once wanted `ceil(arrivals / 2)` stands
capped at `STAND_ROWS.length`, silently ignoring the second stand column its own layout
defines — seven stands for the entire late campaign. That, and not the map, was two thirds of
every loss it reported, and it read exactly like a genuine spatial constraint. Before concluding
that the *game* is short of something, check that the auto-player is not short of it first.

It did it again with modular terminals. Its terminal column had eleven slots; the auto-player
filled them with gate halls and retail and then had nowhere left for border control, so every
widebody of the late campaign diverted — which looked exactly like the new gate being priced
wrong. Running out of *column* is an artefact of that layout, not a fact about the game.

Its layout is load-bearing and was got wrong twice, both times silently:

- **A road cannot be crossed by a taxiway.** A road anywhere between a runway and the apron
  turns that runway into an ornament — it gets built, it gets paid for, and it never takes an
  aeroplane. The apron therefore sits in the middle with a runway either side and the apron
  road running *between* the two stand columns.
- **A stand on a row past the end of the runway needs a vertical spine** beside the runway to
  reach it. Without one its taxiway touches nothing at either end, and the symptom is
  aeroplanes diverting for "no stand big enough" while a perfectly good stand sits empty three
  rows down.

Two metrics to watch:

- **Day length.** It is what made the game feel slow in play. The lever is `endurance`: an
  aeroplane blocked for a transient reason holds until its tank runs dry, so generous
  endurance quietly turns a busy day into two minutes of watching aircraft circle.
- **Arrival count against runway throughput.** A runway is reserved from approach through
  touchdown — eight to ten seconds — and arrivals are spread over about thirty-eight, so one
  strip clears roughly five a day. `arrivalsForDay()` is tied to that and caps at fifteen.
  Traffic past what the map can physically absorb is not difficulty, it is arithmetic.


`sim/advice.ts` produces the planning-phase warnings. It exists because the debrief only
explains aeroplanes that were *lost*; advice covers the other failure mode, money spent on
something that quietly does nothing (a runway with no taxiway to a stand, or a second runway
when the tower can only sequence one movement at a time).

The same file's `tomorrowsTraffic()` is the third piece of feedback: what is booked in today
and which of it the airport cannot take. Traffic escalates on a fixed schedule, so without it
the player has no way to learn that day 4 wants gravel until the commuters are already
turning away. It calls `structuralBlock()` from `sim/assignment.ts` — the *same* function the
assignment pass uses — so the forecast can never promise traffic the simulation then refuses.
Anything about what the airport is fundamentally capable of belongs in `structuralBlock`, not
duplicated into the forecast.

### The economy

The progression is a ladder of upgrades, each unlocked by the fares of the class below it, and
it is checkable rather than a matter of taste. `scripts/run-day.ts` plays a fixed layout; to
check the *player's* path instead — can they afford the next rung when the traffic demands it
— drive `check…`/`apply…` and `runDay()` from a scratch script. On seed 42 the intended shape
is: build a 4-tile grass strip and a small stand from the £1,500 opening balance, and days 1–3
of light traffic pay for the day-4 commuter upgrade (extend to 6 tiles, resurface to gravel,
medium stand) with a little to spare. A rung the player cannot reach is a wall, not a
difficulty curve — that is exactly what an earlier, pricier gravel made day 4.
