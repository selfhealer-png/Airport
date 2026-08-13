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
  sim/        state, stepDay(), aircraft lifecycle, runway assignment, economy, reputation
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

### Passengers and retail

A landing pays twice: a **landing fee** that is always collected, and the **passengers**, but
only as many as the terminal can process that day. `TerminalLevel.passengerCapacity` is a
per-day budget spent across every flight, not a per-flight limit.

This split is the terminal's whole job. A longer runway lets a bigger aeroplane in; it does
nothing about the three hundred people on board. The **freighter carries none**, which is why
it rewards a long runway before a big terminal and keeps earning on a day the terminal is
swamped.

Shops sit *inside* the terminal, which on a tile grid means orthogonally touching it, and are
capped by `TerminalLevel.shopSlots`. `checkFacility` refuses a bad placement rather than
letting it be built and quietly earn nothing — £3,500 is too much to lose to something the
game could simply have declined.

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
- **A save stores roads and runway use, and is version 4.** Bump `SNAPSHOT_VERSION` whenever the shape
  changes; old saves are then rejected and a fresh game starts, which is the intended
  migration story.
- Entity ids come from `Airport.nextEntityId`, not a module-level counter, so a game's ids are
  deterministic and survive a save/load round trip.

## Gotchas

- **Do not write files with Python's `pathlib.write_text()` here.** It defaults to cp1252 on
  this machine and throws partway through on any non-ASCII character, truncating the file it
  already opened. Pass `encoding='utf-8'`, or use the editor tools.
- Large TypeScript files written through Bash heredocs have failed to parse; use the Write
  tool for anything substantial.
- **Service workers need a secure origin.** `npm run dev` over the LAN (`http://192.168.x.x`)
  will run the game on a phone but will not register the service worker or offer to install.
  Full PWA testing needs `localhost`, HTTPS, or a tunnel.
- The map is portrait-only by design. Landscape is not handled and is not meant to be.
- **The field's height is set by the phone, not by the campaign.** Zoom steps in whole device
  pixels, so on a 3x screen the levels either side of 1 are 2/3 and 4/3 — nothing between. At
  42 rows the field was a hair too tall to fit at 1 and dropped to 2/3, drawing the whole
  airport a third smaller than it needed to be. Check `fitScale` against a real phone viewport
  before growing `FIELD_HEIGHT`; the cost is invisible on a desktop window.
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

Seventeen classes now, including three military ones on a dedicated strip.

Remaining: **levels 2+** actually using water, rock and woods (only `LEVEL_MEADOW` exists, and
it is all grass), and a further balancing pass. Two known rough edges:

- The late campaign **runs away**: the auto-player finishes day 50 on several hundred thousand
  pounds with nothing left to buy. An economic sink (upkeep, staffing) is the obvious lever
  and is not built.
- Reputation **oscillates** through the last fifteen days, and because the soft schedule gate
  scales heavy traffic by reputation, a dip collapses the day back to club trainers and the
  takings with it. Survivable, but it makes the end of the campaign lumpy.

`npm run day` plays the **whole fifty-day campaign against an auto-player** and prints each
debrief: landed/diverted/crashed with reasons, passengers handled and turned away, how long
each day took, and what the airport looks like that day. Deterministic for a given seed, so a
change in the output is a change in the game rather than noise.

It builds as it goes — reactively, from the forecast, in the obvious order — because the
question that matters over fifty days is not "what does the traffic look like" but **"can the
player afford the next rung when the traffic demands it"**. A wall shows up as a run of
diversions it never spends its way out of; a death spiral shows up as `Licence revoked`.

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

Reputation gates heavy traffic **softly** — it thins the weights rather than hiding classes.
A hard gate produced a vicious oscillation: a good day crossed a threshold, a fleet the
airport had never seen arrived and all diverted, reputation collapsed, and they vanished
again. Worse, a class below its threshold never appeared in the forecast either, so the game
punished the player for something it had refused to warn them about.

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
