# Airfield

An inverted tower defence game. In a normal tower defence you build to *stop* things getting
through; here you build to **let them through**.

Aircraft arrive on a daily schedule and hold with limited fuel. They land by themselves — if
the airport can take them. Your job is the airport: runways long enough and hard enough,
taxiways to the apron, stands big enough to park on, roads so anything can actually be
serviced, a tower that can sequence it all, and a terminal that can process the passengers.
Get it wrong and aeroplanes divert, or come down.

It runs as an installable PWA, portrait, built for phones. Runways therefore run vertically.

## Playing

Fifty days, from a mown grass strip to a jet-capable airport. Seventeen aircraft classes
across a runway ladder that steps 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14 and 16 tiles, so almost
every extension unlocks something new. Military traffic needs a strip of its own that no
airliner can use.

Between days you build; during a day you watch. The debrief afterwards tells you *why* each
aeroplane was lost, which is the only feedback the game gives — so it is written as carefully
as the rules it describes.

## Running it

```bash
npm install
npm run dev        # dev server, reachable from a phone on the same Wi-Fi
npm test           # the simulation is testable headlessly — no browser needed
npm run day        # plays the whole 50-day campaign and prints each debrief
npm run build      # production build into dist/
npm run preview    # serves the build — the only way to exercise the service worker
```

`npm run day` is the fastest way to see whether a balance change helped. The simulation is
pure and the schedules are seeded, so the same invocation always produces the same numbers: a
change in that output is a change in the game rather than noise.

## How it is put together

The one rule that matters is that `src/sim/` never imports from `render/`, `ui/`, `input/` or
`sprites/`. The simulation is plain state plus a `stepDay()` reducer, with no canvas and no
DOM. That is what makes it testable without a browser, makes the 1x/2x/4x speed controls
trivial — run the reducer more times per frame — and keeps the rendering swappable.

There are no image files. Every sprite is authored as rows of palette keys in
`src/sprites/data.ts`, so a typo in a sprite fails a test instead of reaching the canvas.

`CLAUDE.md` carries the detail: why a day ends when it does, why block reasons are ordered the
way they are, and the several traps that are easy to fall back into.
