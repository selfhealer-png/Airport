import { aircraftClass, isRotorcraft } from '@/content/aircraft';
import {
  certificationLevel,
  requiredCertification,
  retailAllowance,
  towerLevel,
  TOWER_LEVELS,
} from '@/content/buildings';
import { LEVEL_MEADOW } from '@/content/levels';
import { arrivalsForDay, CAMPAIGN_DAYS, generateSchedule } from '@/content/schedule';
import {
  createGame,
  facilityOf,
  terminalsOf,
  workingTerminalCapacity,
} from '@/sim/airport';
import { buildServices } from '@/sim/connectivity';
import { tomorrowsTraffic } from '@/sim/advice';
import { structuralBlock } from '@/sim/assignment';
import {
  applyCertify,
  applyDemolish,
  applyExtendRunway,
  applyFacility,
  applyHelipad,
  applyResurface,
  applyRoadRun,
  applyRunway,
  applyStand,
  applyTaxiwayRun,
  applyUpgradeFacility,
  checkCertify,
  checkDemolish,
  checkExtendRunway,
  checkFacility,
  checkHelipad,
  checkResurface,
  checkRoadRun,
  checkRunway,
  checkStand,
  checkTaxiwayRun,
  checkUpgradeFacility,
  isAffordableQuote,
  type BuildCheck,
} from '@/sim/build';
import { explainReason, runDay } from '@/sim/step';
import { summariseDay } from '@/ui/debrief';
import {
  STAND_RANK,
  SURFACE_RANK,
  type DayState,
  type FacilityType,
  type GameState,
  type StandSize,
} from '@/sim/types';

/**
 * Headless campaign harness: plays the whole campaign against a competent-but-not-clever
 * player and prints each debrief.
 *
 * This is how balance is checked without playing. It used to run a *fixed* airport, which
 * answered "what does the traffic look like" but never the question that actually matters
 * over fifty days — can the player afford the next rung when the traffic demands it? So the
 * harness now builds as it goes, in the obvious order, and a wall shows up as a run of
 * diverted aeroplanes it never manages to spend its way out of.
 *
 * Because the simulation is pure and the schedule is seeded, the same invocation always
 * produces the same numbers: a change in this output means a change in the game, not noise.
 *
 *   npm run day            # the full fifty-day campaign
 *   npm run day -- 12      # the first twelve days
 */

/*
 * The layout the auto-player grows into, west to east:
 *
 *   0  military road          8  apron, west stands
 *   1  military runway        9  apron road
 *   2  military taxiway      10  apron, east stands
 *   3  military stand        11  taxiway to runway B
 *   4  road (runway A)       12  taxiway to runway B
 *   5  civil runway A        13  civil runway B
 *   6  taxiway to apron      14  road (runway B)
 *   7  taxiway to apron      16  buildings, 17 their road
 *                            18  helipads
 *
 * Helipads go in their own column beside the building road, not on the apron. They need no
 * taxiway at all — only a road — so putting them where the taxiways are would waste apron
 * rows on traffic that cannot use them.
 *
 * The shape is load-bearing. Two runways can only both *work* if each has an unbroken
 * taxiway to a stand, so the apron sits in the middle with a runway either side and the road
 * that serves the stands runs between the two stand columns rather than beside them. Roads
 * cannot be crossed by a taxiway, so a road anywhere between a runway and the apron silently
 * turns the second runway into an ornament — which is exactly what the previous layout did.
 */
const MIL_ROAD_X = 0;
const MIL_RUNWAY_X = 1;
const MIL_TAXI_X = 2;
const MIL_STAND_X = 3;
const MIL_STAND_ROW = 14;

const ROAD_A_X = 4;
const RUNWAY_X = 5;
const RUNWAY_TOP = 8;
const SERVICE_ROAD_X = ROAD_A_X;

const WEST_STAND_X = 8;
const APRON_ROAD_X = 9;
const EAST_STAND_X = 10;

const RUNWAY_B_X = 13;
const ROAD_B_X = 14;

const BUILDING_X = 16;
const BUILDING_ROAD_X = 17;
const HELIPAD_X = 18;
const HELIPAD_ROWS = [6, 8, 10, 12] as const;

/**
 * Where the terminal starts, and how far down the building column it may grow.
 *
 * A terminal is a chain now, so it needs contiguous rows rather than scattered ones: each
 * module has to touch the one before it, and each needs the service road beside it. Rows are
 * filled top-down from the core, which makes adjacency automatic and means the road that
 * `placeAt` lays already covers everything above.
 *
 * The support buildings were moved to the bottom of the column to make room. Eleven slots was
 * not enough — the auto-player filled them with gate halls and retail and then had nowhere to
 * put border control, so every widebody of the late campaign diverted. Twenty-two is more than
 * the campaign can use, which is the point: running out of *column* is an artefact of the
 * harness's layout, not a fact about the game.
 */
const TERMINAL_ROW = 8;
const TERMINAL_LAST_ROW = 30;
const STAND_ROWS = [10, 13, 16, 19, 22, 25, 28] as const;

/** Spends only if the check passes and the money is there. Returns whether it built. */
function tryBuild(check: BuildCheck, apply: (quote: { cost: number }) => void): boolean {
  if (!isAffordableQuote(check)) return false;
  apply(check);
  return true;
}

/**
 * The opening airport: a short strip, one stand, and the roads that make them legal.
 *
 * The spine along row 0 comes first. Every other road in this layout is a spur off it, and
 * without it they are separate networks serving separate halves of an airport — which is
 * exactly what the road rule is there to catch.
 */
function foundAirport(state: GameState): void {
  tryBuild(checkRoadRun(state, MIL_ROAD_X, 0, BUILDING_ROAD_X, 0), (q) =>
    applyRoadRun(state, q, MIL_ROAD_X, 0, BUILDING_ROAD_X, 0),
  );
  tryBuild(checkRunway(state, RUNWAY_X, RUNWAY_TOP, RUNWAY_TOP + 3, 'grass', 'civil'), (q) =>
    applyRunway(state, q, RUNWAY_X, RUNWAY_TOP, RUNWAY_TOP + 3, 'grass', 'civil'),
  );
  tryBuild(checkRoadRun(state, ROAD_A_X, 0, ROAD_A_X, RUNWAY_TOP + 3), (q) =>
    applyRoadRun(state, q, ROAD_A_X, 0, ROAD_A_X, RUNWAY_TOP + 3),
  );
  tryBuild(checkRoadRun(state, APRON_ROAD_X, 0, APRON_ROAD_X, STAND_ROWS[0]), (q) =>
    applyRoadRun(state, q, APRON_ROAD_X, 0, APRON_ROAD_X, STAND_ROWS[0]),
  );
  addApron(state, 'small');
}

/**
 * Adds the next stand of `size`, with the taxiways and road that make it usable.
 *
 * Stands fill the west column first, then the east one, and every stand is joined to every
 * civil runway that exists. If the apron is full, the smallest stand smaller than `size` is
 * demolished to make room — without that the auto-player filled every row with small stands
 * in the first fortnight and then diverted anything bigger for the rest of the campaign,
 * which is a trap a real player digs themselves out of with the demolish tool.
 */
function addApron(state: GameState, size: StandSize): boolean {
  const slots: Array<{ x: number; y: number }> = [];
  for (const column of [WEST_STAND_X, EAST_STAND_X]) {
    for (const row of STAND_ROWS) slots.push({ x: column, y: row });
  }

  let spot = slots.find((s2) => !state.airport.stands.some((st) => st.x === s2.x && st.y === s2.y));

  if (!spot) {
    const replaceable = state.airport.stands
      .filter((st) => STAND_RANK[st.size] < STAND_RANK[size])
      .sort((a, b) => STAND_RANK[a.size] - STAND_RANK[b.size])[0];
    if (!replaceable) return false;

    const refund = checkDemolish(state, replaceable.x, replaceable.y);
    if (!isAffordableQuote(refund)) return false;
    applyDemolish(state, refund, replaceable.x, replaceable.y);
    spot = { x: replaceable.x, y: replaceable.y };
  }

  const at = spot;
  const built = tryBuild(checkStand(state, at.x, at.y, size), (q) =>
    applyStand(state, q, at.x, at.y, size),
  );
  if (!built) return false;

  linkApronRow(state, at.y);
  tryBuild(checkRoadRun(state, APRON_ROAD_X, 0, APRON_ROAD_X, at.y), (q) =>
    applyRoadRun(state, q, APRON_ROAD_X, 0, APRON_ROAD_X, at.y),
  );
  return true;
}

/**
 * Joins a row of the apron to whichever civil runways exist, on both sides.
 *
 * Each side gets a vertical spine beside its runway before the horizontal run. Without it, a
 * stand on a row past the end of the runway has a taxiway that touches nothing at either end,
 * and the aeroplanes divert for "no stand big enough" while a perfectly good stand sits empty
 * three rows down.
 */
function linkApronRow(state: GameState, row: number): void {
  const west = state.airport.runways.find((r) => r.x === RUNWAY_X);
  if (west) {
    const spine = RUNWAY_X + 1;
    tryBuild(checkTaxiwayRun(state, spine, west.y0, spine, row), (q) =>
      applyTaxiwayRun(state, q, spine, west.y0, spine, row),
    );
    tryBuild(checkTaxiwayRun(state, spine, row, WEST_STAND_X - 1, row), (q) =>
      applyTaxiwayRun(state, q, spine, row, WEST_STAND_X - 1, row),
    );
  }

  const east = state.airport.runways.find((r) => r.x === RUNWAY_B_X);
  if (east) {
    const spine = RUNWAY_B_X - 1;
    tryBuild(checkTaxiwayRun(state, spine, east.y0, spine, row), (q) =>
      applyTaxiwayRun(state, q, spine, east.y0, spine, row),
    );
    tryBuild(checkTaxiwayRun(state, EAST_STAND_X + 1, row, spine, row), (q) =>
      applyTaxiwayRun(state, q, EAST_STAND_X + 1, row, spine, row),
    );
  }
}

/**
 * Builds or grows the military side to take `needs` tiles of runway.
 *
 * Nothing here can be shared with the civil airport, so it is a second small aerodrome: a
 * strip, a taxiway, one large stand and a road joining it to the rest of the network.
 */
function ensureMilitary(state: GameState, needs: number): void {
  const existing = state.airport.runways.find((r) => r.use === 'military');

  if (!existing) {
    const built = tryBuild(
      checkRunway(state, MIL_RUNWAY_X, RUNWAY_TOP, RUNWAY_TOP + needs - 1, 'asphalt', 'military'),
      (q) =>
        applyRunway(state, q, MIL_RUNWAY_X, RUNWAY_TOP, RUNWAY_TOP + needs - 1, 'asphalt', 'military'),
    );
    if (!built) return;

    tryBuild(checkRoadRun(state, MIL_ROAD_X, 0, MIL_ROAD_X, RUNWAY_TOP + needs), (q) =>
      applyRoadRun(state, q, MIL_ROAD_X, 0, MIL_ROAD_X, RUNWAY_TOP + needs),
    );
    tryBuild(checkTaxiwayRun(state, MIL_TAXI_X, MIL_STAND_ROW, MIL_TAXI_X, MIL_STAND_ROW), (q) =>
      applyTaxiwayRun(state, q, MIL_TAXI_X, MIL_STAND_ROW, MIL_TAXI_X, MIL_STAND_ROW),
    );
    // Runway A's service road runs right past this stand, so it needs no road of its own —
    // it only has to touch one that is already on the network.
    tryBuild(checkStand(state, MIL_STAND_X, MIL_STAND_ROW, 'large'), (q) =>
      applyStand(state, q, MIL_STAND_X, MIL_STAND_ROW, 'large'),
    );
    return;
  }

  const length = existing.y1 - existing.y0 + 1;
  if (length >= needs) return;
  tryBuild(checkExtendRunway(state, existing.id, needs - length), (q) =>
    applyExtendRunway(state, q, existing.id, needs - length),
  );
  const grown = state.airport.runways.find((r) => r.use === 'military')!.y1;
  tryBuild(checkRoadRun(state, MIL_ROAD_X, 0, MIL_ROAD_X, grown), (q) =>
    applyRoadRun(state, q, MIL_ROAD_X, 0, MIL_ROAD_X, grown),
  );
}

/**
 * Adds a helipad beside the building road.
 *
 * A pad is a runway and a stand in one tile, so this is the whole of it — one `checkHelipad`
 * against a column that already has a road running down it. That brevity is the point of the
 * feature: the rotary side of the airport is a placement problem, not a construction project.
 */
function addPad(state: GameState): boolean {
  const row = HELIPAD_ROWS.find(
    (r) => !state.airport.helipads.some((p) => p.x === HELIPAD_X && p.y === r),
  );
  if (row === undefined) return false;

  const built = tryBuild(checkHelipad(state, HELIPAD_X, row), (q) =>
    applyHelipad(state, q, HELIPAD_X, row),
  );
  if (!built) return false;

  tryBuild(checkRoadRun(state, BUILDING_ROAD_X, 0, BUILDING_ROAD_X, row), (q) =>
    applyRoadRun(state, q, BUILDING_ROAD_X, 0, BUILDING_ROAD_X, row),
  );
  return true;
}

/** Places a facility on the building row, with the road that switches it on. */
function place(state: GameState, type: 'tower' | 'terminal' | 'fuel-farm' | 'fire-station'): void {
  const row = { tower: 4, terminal: TERMINAL_ROW, 'fuel-farm': 32, 'fire-station': 34 }[type];
  placeAt(state, type, row);
}

function placeAt(state: GameState, type: FacilityType, row: number): boolean {
  const built = tryBuild(checkFacility(state, type, BUILDING_X, row), (q) =>
    applyFacility(state, q, type, BUILDING_X, row),
  );
  if (!built) return false;
  tryBuild(checkRoadRun(state, BUILDING_ROAD_X, 0, BUILDING_ROAD_X, row), (q) =>
    applyRoadRun(state, q, BUILDING_ROAD_X, 0, BUILDING_ROAD_X, row),
  );
  return true;
}

/**
 * Bolts one module onto the end of the terminal chain.
 *
 * Top-down from the core, so the new module always touches the last one and the road laid to
 * reach it already serves everything above. Returns false when the column is full, which is
 * the auto-player's version of running out of land.
 */
function extendTerminal(state: GameState, type: FacilityType): boolean {
  for (let row = TERMINAL_ROW + 1; row <= TERMINAL_LAST_ROW; row++) {
    if (state.airport.facilities.some((f) => f.x === BUILDING_X && f.y === row)) continue;
    return placeAt(state, type, row);
  }
  return false;
}

/**
 * One planning phase.
 *
 * Deliberately reactive rather than optimal: it fixes whatever the forecast says is about to
 * be turned away, then spends any spare money on the thing that pays next. A cleverer player
 * would do better, which is the point — if this one can clear the campaign, the balance is
 * not a wall.
 */
function plan(state: GameState): void {
  if (state.airport.runways.length === 0) {
    foundAirport(state);
    return;
  }

  const expected = generateSchedule(state.day, state.seed).reduce(
    (sum, a) => sum + aircraftClass(a.classId).passengers,
    0,
  );

  /*
   * Licence first, but *only* for traffic the airport could otherwise take today.
   *
   * Certification is a standing daily charge, so holding a category you cannot fill is a slow
   * bleed against nothing. Buying it off runway length alone was exactly that mistake: the
   * auto-player took Category C the day it laid a ten-tile strip, then could not afford the
   * fuel farm the same traffic needed, and spent the rest of the campaign diverting jets it
   * was paying £1,200 a day to be allowed to accept.
   *
   * `structuralBlock` returning exactly `not-certified` is the precise test — every more
   * fundamental gap is checked before it, so that answer means "the licence is the only thing
   * standing in the way". A sensible player follows the same rule.
   */
  const services = buildServices(state.airport);
  const blockedOnLicence = generateSchedule(state.day, state.seed).some(
    (a) => structuralBlock(state.airport, services, a.classId) === 'not-certified',
  );
  if (blockedOnLicence) {
    tryBuild(checkCertify(state), (q) => applyCertify(state, q));
  }

  // Capability first: everything below is worthless while an aeroplane is being turned away
  // for something the airport simply does not have.
  for (const entry of tomorrowsTraffic(state).filter((e) => e.problem)) {
    const spec = aircraftClass(entry.classId);

    if (isRotorcraft(entry.classId)) {
      // The offshore type needs a fuel farm as well as a pad; the light one needs neither.
      if (spec.requiresFuelFarm && !facilityOf(state.airport, 'fuel-farm')) place(state, 'fuel-farm');
      addPad(state);
      continue;
    }

    if (spec.use === 'military') {
      // Military work shares the fuel farm and fire station but nothing else.
      if (!facilityOf(state.airport, 'fuel-farm')) place(state, 'fuel-farm');
      if (!facilityOf(state.airport, 'fire-station')) place(state, 'fire-station');
      ensureMilitary(state, spec.runwayLength);
      continue;
    }

    // Every strip is brought up together. A second runway left short and grassy while the
    // first is paved is not a second runway, it is a field the tower ignores.
    for (const strip of state.airport.runways.filter((r) => r.use === 'civil')) {
      const stripLength = strip.y1 - strip.y0 + 1;
      if (stripLength < spec.runwayLength) {
        tryBuild(checkExtendRunway(state, strip.id, spec.runwayLength - stripLength), (q) =>
          applyExtendRunway(state, q, strip.id, spec.runwayLength - stripLength),
        );
      }
      if (SURFACE_RANK[strip.surface] < SURFACE_RANK[spec.minSurface]) {
        tryBuild(checkResurface(state, strip.id, spec.minSurface), (q) =>
          applyResurface(state, q, strip.id, spec.minSurface),
        );
      }
    }
    // The strip grew, so the service road has to grow with it.
    const grown = state.airport.runways[0]!.y1;
    tryBuild(checkRoadRun(state, SERVICE_ROAD_X, 0, SERVICE_ROAD_X, grown), (q) =>
      applyRoadRun(state, q, SERVICE_ROAD_X, 0, SERVICE_ROAD_X, grown),
    );

    if (spec.requiresFuelFarm && !facilityOf(state.airport, 'fuel-farm')) place(state, 'fuel-farm');
    if (spec.requiresFireStation && !facilityOf(state.airport, 'fire-station')) {
      place(state, 'fire-station');
    }

    const best = state.airport.stands.reduce((rank, st) => Math.max(rank, STAND_RANK[st.size]), -1);
    if (best < STAND_RANK[spec.standSize]) addApron(state, spec.standSize);
  }

  /*
   * Then throughput. One runway absorbs roughly five arrivals a day, and a stand is held from
   * approach right through the turnaround — which is far longer than a runway reservation, so
   * the apron has to grow faster than the runways do.
   *
   * A stand per arrival, not one per two. The old ratio, and a cap of `STAND_ROWS.length`
   * that ignored the layout's second stand column, held the auto-player to seven stands for
   * the whole late campaign and made "every suitable stand was occupied" two thirds of every
   * loss in this harness — a number that read as a game constraint and was really this line.
   * Measured on seed 42: the fix takes total losses over fifty days from 124 to 58 and the
   * campaign service level from 75% to 88%, without touching the map or the simulation.
   *
   * It is not simply "build more", either: at `arrivals + 3` the auto-player spends itself
   * out of a fire station in the first fortnight and never recovers, which is the trap a real
   * player also has to avoid.
   */
  const arrivals = arrivalsForDay(state.day);
  const biggestSize: StandSize = state.airport.stands.some((s) => s.size === 'large')
    ? 'large'
    : state.airport.stands.some((s) => s.size === 'medium')
      ? 'medium'
      : 'small';

  const wantedStands = Math.min(STAND_ROWS.length * 2, arrivals);
  while (state.airport.stands.length < wantedStands && addApron(state, biggestSize)) {
    // keep going while there is both a need and the money
  }

  // Pads scale with rotary traffic the way stands scale with everything else: a pad is held
  // from approach through the turnaround, so one movement in flight is one pad occupied.
  const rotaryBooked = generateSchedule(state.day, state.seed).filter((a) =>
    isRotorcraft(a.classId),
  ).length;
  while (state.airport.helipads.length < Math.min(HELIPAD_ROWS.length, rotaryBooked) && addPad(state)) {
    // keep going while there is both a need and the money
  }

  const movements = towerLevel(facilityOf(state.airport, 'tower')?.level ?? 0).movements;
  // The second civil strip, on the far side of the apron so its taxiways never cross a road.
  const first = state.airport.runways.find((r) => r.x === RUNWAY_X);
  const wantsTwo = movements > 1 && arrivals > 8;
  if (first && wantsTwo && !state.airport.runways.some((r) => r.x === RUNWAY_B_X)) {
    const built = tryBuild(
      checkRunway(state, RUNWAY_B_X, first.y0, first.y1, first.surface, 'civil'),
      (q) => applyRunway(state, q, RUNWAY_B_X, first.y0, first.y1, first.surface, 'civil'),
    );
    if (built) {
      tryBuild(checkRoadRun(state, ROAD_B_X, 0, ROAD_B_X, first.y1), (q) =>
        applyRoadRun(state, q, ROAD_B_X, 0, ROAD_B_X, first.y1),
      );
      for (const row of new Set(state.airport.stands.map((st) => st.y))) linkApronRow(state, row);
    }
  }
  // The tower is what lets a second runway be used at all, so it follows immediately.
  const tower = facilityOf(state.airport, 'tower');
  if (!tower) {
    place(state, 'tower');
  } else if (tower.level < TOWER_LEVELS.length - 1 && arrivals > movements * 5) {
    tryBuild(checkUpgradeFacility(state, tower.id), (q) =>
      applyUpgradeFacility(state, q, tower.id),
    );
  }

  /*
   * The terminal, built as a chain down the building column.
   *
   * The order is the whole strategy and it is not the order the buildings appear in the
   * drawer. Capacity first, because a passenger turned away is income already lost and no
   * other module helps with it. Baggage next, because it buys apron throughput — which is the
   * constraint a big terminal creates. Border control only when something is actually booked
   * that needs it, since it is the dearest building in the game and pays nothing on its own.
   * Retail last: it multiplies passenger income rather than creating any.
   */
  const terminalServices = buildServices(state.airport);
  const capacity = workingTerminalCapacity(state.airport, terminalServices);
  const modules = (type: FacilityType): number =>
    state.airport.facilities.filter((f) => f.type === type).length;

  const needsBorder = generateSchedule(state.day, state.seed).some(
    (arrival) => aircraftClass(arrival.classId).requiresBorderControl,
  );

  if (terminalsOf(state.airport).length === 0) {
    place(state, 'terminal');
  } else if (needsBorder && modules('border-control') === 0) {
    // Ahead of capacity, dear as it is. An aeroplane that cannot land at all costs more than
    // one that lands and loses half its passengers at the door.
    extendTerminal(state, 'border-control');
  } else if (expected > capacity.passengerCapacity * 0.6) {
    extendTerminal(state, 'gate-hall');
  }

  const gateHalls = modules('gate-hall');

  // Three is where `baggageTurnaroundFactor` stops improving; buying a fourth is a donation.
  if (gateHalls >= 2 && modules('baggage-hall') < 3) {
    extendTerminal(state, 'baggage-hall');
  }

  if (expected > 100 && modules('shop') < retailAllowance(gateHalls)) {
    extendTerminal(state, 'shop');
  }
}

function summarise(day: DayState): string {
  const result = summariseDay(day);
  const reasons = new Map<string, number>();
  for (const event of day.events) {
    if (event.outcome === 'landed') continue;
    const label = explainReason(event.reason);
    reasons.set(label, (reasons.get(label) ?? 0) + 1);
  }

  const lines = [
    `  landed ${result.landed}  diverted ${result.diverted}  crashed ${result.crashed}` +
      `  (scheduled ${day.schedule.length})  took ${day.elapsed.toFixed(0)}s`,
    `  pax ${result.passengers.toLocaleString()}` +
      (result.passengersTurnedAway > 0
        ? `  turned away ${result.passengersTurnedAway.toLocaleString()}`
        : ''),
  ];
  for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
    lines.push(`    ${count} lost — ${reason}`);
  }
  return lines.join('\n');
}

const days = Number.parseInt(process.argv[2] ?? `${CAMPAIGN_DAYS}`, 10);
const state = createGame(LEVEL_MEADOW, 42);

console.log(`Airfield campaign harness — ${LEVEL_MEADOW.name}, seed ${state.seed}`);
console.log('An auto-player builds reactively from the forecast each planning phase.\n');

for (let day = 1; day <= days; day++) {
  state.day = day;
  state.phase = 'planning';
  plan(state);

  const cashBefore = state.cash;
  const schedule = generateSchedule(day, state.seed);
  const result = runDay(state, schedule);

  const runway = state.airport.runways[0];
  const length = runway ? runway.y1 - runway.y0 + 1 : 0;
  console.log(`Day ${day}  [${state.airport.runways.length}rwy ${length}t ${runway?.surface ?? '-'}, ` +
    `${state.airport.stands.length} stands, ` +
    `${state.airport.helipads.length} pads, ` +
    `${certificationLevel(state.airport.certification).name.replace('Category ', 'cat')}, ` +
    `T${terminalsOf(state.airport).length}` +
    `g${state.airport.facilities.filter((f) => f.type === 'gate-hall').length}` +
    `b${state.airport.facilities.filter((f) => f.type === 'baggage-hall').length}` +
    `s${state.airport.facilities.filter((f) => f.type === 'shop').length}` +
    `${state.airport.facilities.some((f) => f.type === 'border-control') ? 'B' : ''}/` +
    `C${facilityOf(state.airport, 'tower')?.level ?? 0}]`);
  console.log(summarise(result));
  const running = result.handlingCost + result.certificationCost;
  const served = state.scheduledTotal === 0
    ? 0
    : Math.round((state.landedTotal / state.scheduledTotal) * 100);
  console.log(
    `  cash £${cashBefore.toLocaleString()} → £${state.cash.toLocaleString()}` +
      `   running −£${running.toLocaleString()}` +
      `   campaign ${state.landedTotal}/${state.scheduledTotal} (${served}%)`,
  );
  console.log('');

  // Reputation used to be how the harness noticed a run had gone wrong. Cash is the honest
  // replacement now the schedule is a fixed path: an airport that cannot pay for its crashes
  // is broken in a way worth stopping on, and nothing clamps the balance at zero.
  if (state.cash < -5_000) {
    console.log(`Bankrupt on day ${day}.`);
    break;
  }
}
