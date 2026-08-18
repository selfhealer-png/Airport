import type { AircraftClass, AircraftClassId } from '@/sim/types';

/**
 * Aircraft classes, in the order the player meets them.
 *
 * The ladder is deliberately fine-grained: runway lengths step 3, 4, 5, 6, 7, 8, 9, 10, 12,
 * 13, 14, 16, so almost every extension of a strip unlocks something. A coarse ladder made
 * the middle of the campaign a long wait between milestones; this way the next aeroplane is
 * usually one or two tiles away.
 *
 * A landing pays a **landing fee** (`fare`) plus whatever the terminal can do with the
 * **passengers**. Keeping those apart is what gives the terminal a job: a longer runway lets
 * a bigger aeroplane in, and only terminal capacity turns the people on board into money.
 * The freighter is the deliberate exception — no passengers at all, so it rewards a long
 * runway before a big terminal, and it keeps earning on a day the terminal is swamped.
 *
 * The two **rotorcraft** are the other exception, and a bigger one: `runwayLength: 0` means
 * they need no runway at all, only a helipad, which is a runway and a stand in one tile. That
 * makes the late campaign a placement problem again rather than a longer-runway problem —
 * their `minSurface`, `use` and `standSize` below are never read by anything.
 *
 * The three military classes at the bottom need a **military runway**, which no airliner can
 * use and which cannot take one. They carry no passengers at all, so they never touch the
 * terminal: a military strip is a bet on infrastructure that pays in bursts, and the fighter
 * makes that bet cheap to enter — five tiles — while the airlifter makes it expensive.
 *
 * The facility gates are **staggered on purpose**. Requiring a fuel farm and a fire station
 * together put £7,500 of buildings behind the first jet, on top of paving and lengthening the
 * runway and buying a bigger stand — four upgrades at once, at a point in the campaign where
 * that is several days of income. Regional jets now need fuel only; the fire service arrives
 * with the narrowbody, one rung further up.
 *
 * Timings are tuned so a day is over in well under a minute at 1x, and **endurance is the
 * number that decides how long a bad day lasts**: an aeroplane blocked for a transient reason
 * holds until its tank runs dry, so generous endurance quietly turns a busy day into two
 * minutes of watching aircraft circle. It is scaled with the service times rather than held
 * fixed, so making the day shorter does not also make it easier.
 *
 * Every number here is balance, not logic — tune freely. `sim/` reads these and never
 * hardcodes a duration or a fare of its own.
 */
export const AIRCRAFT_CLASSES: Readonly<Record<AircraftClassId, AircraftClass>> = {
  trainer: {
    id: 'trainer',
    name: 'Club trainer',
    runwayLength: 3,
    minSurface: 'grass',
    use: 'civil',
    standSize: 'small',
    silhouette: 'single',
    endurance: 70,
    fare: 35,
    passengers: 2,
    approachSeconds: 4,
    landingSeconds: 3,
    taxiSeconds: 3,
    turnaroundSeconds: 4,
    departSeconds: 3,
    requiresFuelFarm: false,
    requiresFireStation: false,
    requiresBorderControl: false,
  },
  light: {
    id: 'light',
    name: 'Light single',
    runwayLength: 3,
    minSurface: 'grass',
    use: 'civil',
    standSize: 'small',
    silhouette: 'single',
    endurance: 66,
    fare: 55,
    passengers: 4,
    approachSeconds: 4,
    landingSeconds: 3,
    taxiSeconds: 3,
    turnaroundSeconds: 4,
    departSeconds: 3,
    requiresFuelFarm: false,
    requiresFireStation: false,
    requiresBorderControl: false,
  },
  airtaxi: {
    id: 'airtaxi',
    name: 'Air taxi',
    runwayLength: 4,
    minSurface: 'grass',
    use: 'civil',
    standSize: 'small',
    silhouette: 'twin',
    endurance: 62,
    fare: 110,
    passengers: 7,
    approachSeconds: 4,
    landingSeconds: 3,
    taxiSeconds: 3,
    turnaroundSeconds: 5,
    departSeconds: 3,
    requiresFuelFarm: false,
    requiresFireStation: false,
    requiresBorderControl: false,
  },
  utility: {
    id: 'utility',
    name: 'Utility turboprop',
    runwayLength: 4,
    minSurface: 'grass',
    use: 'civil',
    standSize: 'small',
    silhouette: 'twin',
    endurance: 60,
    fare: 150,
    passengers: 9,
    approachSeconds: 4,
    landingSeconds: 3,
    taxiSeconds: 3,
    turnaroundSeconds: 6,
    departSeconds: 3,
    requiresFuelFarm: false,
    requiresFireStation: false,
    requiresBorderControl: false,
  },
  bush: {
    id: 'bush',
    name: 'Bush twin',
    runwayLength: 5,
    minSurface: 'grass',
    use: 'civil',
    standSize: 'small',
    silhouette: 'twin',
    endurance: 58,
    fare: 220,
    passengers: 14,
    approachSeconds: 5,
    landingSeconds: 3,
    taxiSeconds: 3,
    turnaroundSeconds: 6,
    departSeconds: 3,
    requiresFuelFarm: false,
    requiresFireStation: false,
    requiresBorderControl: false,
  },
  commuter: {
    id: 'commuter',
    name: 'Commuter turboprop',
    runwayLength: 6,
    minSurface: 'gravel',
    use: 'civil',
    standSize: 'medium',
    silhouette: 'turboprop',
    endurance: 54,
    fare: 300,
    passengers: 19,
    approachSeconds: 5,
    landingSeconds: 3,
    taxiSeconds: 4,
    turnaroundSeconds: 8,
    departSeconds: 3,
    requiresFuelFarm: false,
    requiresFireStation: false,
    requiresBorderControl: false,
  },
  feeder: {
    id: 'feeder',
    name: 'Feeder turboprop',
    runwayLength: 7,
    minSurface: 'gravel',
    use: 'civil',
    standSize: 'medium',
    silhouette: 'turboprop',
    endurance: 52,
    fare: 480,
    passengers: 34,
    approachSeconds: 5,
    landingSeconds: 3,
    taxiSeconds: 4,
    turnaroundSeconds: 8,
    departSeconds: 3,
    requiresFuelFarm: false,
    requiresFireStation: false,
    requiresBorderControl: false,
  },
  regional: {
    id: 'regional',
    name: 'Regional jet',
    runwayLength: 8,
    minSurface: 'asphalt',
    use: 'civil',
    standSize: 'medium',
    silhouette: 'regional',
    endurance: 50,
    fare: 700,
    passengers: 50,
    approachSeconds: 6,
    landingSeconds: 4,
    taxiSeconds: 5,
    turnaroundSeconds: 10,
    departSeconds: 4,
    requiresFuelFarm: true,
    requiresFireStation: false,
    requiresBorderControl: false,
  },
  'regional-x': {
    id: 'regional-x',
    name: 'Stretched regional',
    runwayLength: 9,
    minSurface: 'asphalt',
    use: 'civil',
    standSize: 'medium',
    silhouette: 'regional',
    endurance: 48,
    fare: 950,
    passengers: 76,
    approachSeconds: 6,
    landingSeconds: 4,
    taxiSeconds: 5,
    turnaroundSeconds: 10,
    departSeconds: 4,
    requiresFuelFarm: true,
    requiresFireStation: false,
    requiresBorderControl: false,
  },
  narrowbody: {
    id: 'narrowbody',
    name: 'Narrowbody jet',
    runwayLength: 10,
    minSurface: 'asphalt',
    use: 'civil',
    standSize: 'large',
    silhouette: 'narrowbody',
    endurance: 45,
    fare: 1_500,
    passengers: 150,
    approachSeconds: 6,
    landingSeconds: 4,
    taxiSeconds: 5,
    turnaroundSeconds: 12,
    departSeconds: 4,
    requiresFuelFarm: true,
    requiresFireStation: true,
    requiresBorderControl: false,
  },
  'narrowbody-x': {
    id: 'narrowbody-x',
    name: 'Stretched narrowbody',
    runwayLength: 12,
    minSurface: 'asphalt',
    use: 'civil',
    standSize: 'large',
    silhouette: 'narrowbody',
    endurance: 43,
    fare: 1_900,
    passengers: 189,
    approachSeconds: 6,
    landingSeconds: 4,
    taxiSeconds: 5,
    turnaroundSeconds: 13,
    departSeconds: 4,
    requiresFuelFarm: true,
    requiresFireStation: true,
    requiresBorderControl: false,
  },
  freighter: {
    id: 'freighter',
    name: 'Freighter',
    runwayLength: 13,
    minSurface: 'asphalt',
    use: 'civil',
    standSize: 'large',
    silhouette: 'widebody',
    endurance: 42,
    // All of it in the landing fee: nobody on board means the terminal is irrelevant, which
    // is exactly why this is the aeroplane to chase when the terminal is the bottleneck.
    fare: 5_200,
    passengers: 0,
    approachSeconds: 6,
    landingSeconds: 4,
    taxiSeconds: 5,
    turnaroundSeconds: 11,
    departSeconds: 4,
    requiresFuelFarm: true,
    requiresFireStation: true,
    requiresBorderControl: false,
  },
  widebody: {
    id: 'widebody',
    name: 'Widebody jet',
    runwayLength: 14,
    minSurface: 'asphalt',
    use: 'civil',
    standSize: 'large',
    silhouette: 'widebody',
    endurance: 40,
    fare: 3_200,
    passengers: 300,
    approachSeconds: 7,
    landingSeconds: 4,
    taxiSeconds: 6,
    turnaroundSeconds: 15,
    departSeconds: 5,
    requiresFuelFarm: true,
    requiresFireStation: true,
    requiresBorderControl: true,
  },
  superheavy: {
    id: 'superheavy',
    name: 'Super heavy',
    runwayLength: 16,
    minSurface: 'asphalt',
    use: 'civil',
    standSize: 'large',
    silhouette: 'widebody',
    endurance: 38,
    fare: 4_800,
    passengers: 480,
    approachSeconds: 7,
    landingSeconds: 5,
    taxiSeconds: 6,
    turnaroundSeconds: 16,
    departSeconds: 5,
    requiresFuelFarm: true,
    requiresFireStation: true,
    requiresBorderControl: true,
  },
  // --- Military. Separate runway, no passengers, no use for the terminal. ---
  fighter: {
    id: 'fighter',
    name: 'Fast jet',
    // Deliberately short. The point of entry to military work is a cheap strip you cannot
    // share, not a long one — the cost is dedicating the land, not paving it.
    runwayLength: 5,
    minSurface: 'asphalt',
    use: 'military',
    standSize: 'small',
    silhouette: 'fighter',
    endurance: 40,
    fare: 2_200,
    passengers: 0,
    approachSeconds: 4,
    landingSeconds: 3,
    taxiSeconds: 3,
    turnaroundSeconds: 6,
    departSeconds: 3,
    requiresFuelFarm: true,
    requiresFireStation: true,
    requiresBorderControl: false,
  },
  transport: {
    id: 'transport',
    name: 'Military transport',
    runwayLength: 9,
    minSurface: 'asphalt',
    use: 'military',
    standSize: 'large',
    silhouette: 'transport',
    endurance: 46,
    fare: 4_800,
    passengers: 0,
    approachSeconds: 6,
    landingSeconds: 4,
    taxiSeconds: 5,
    turnaroundSeconds: 12,
    departSeconds: 4,
    requiresFuelFarm: true,
    requiresFireStation: true,
    requiresBorderControl: false,
  },
  /*
   * --- Rotorcraft. No runway, no taxiway, no stand: the pad is all three. ---
   *
   * `runwayLength: 0` is the sentinel that says so, and `minSurface`/`use`/`standSize` below
   * are unread — they exist only because forking `AircraftClass` for two entries would cost
   * more than four ignored fields.
   *
   * Deliberately modest passenger counts. A helicopter is a charter premium, not a hub flow:
   * the fare is where the money is, so a pad pays back without leaning on the terminal — and
   * a helipad-only airport can never out-earn a real one.
   */
  helicopter: {
    id: 'helicopter',
    name: 'Utility helicopter',
    runwayLength: 0,
    minSurface: 'grass',
    use: 'civil',
    standSize: 'small',
    silhouette: 'helicopter',
    endurance: 44,
    fare: 900,
    passengers: 6,
    approachSeconds: 4,
    landingSeconds: 4,
    // Unread: a rotorcraft goes landing → parked → departing, with no taxi phase at all.
    taxiSeconds: 0,
    turnaroundSeconds: 8,
    departSeconds: 4,
    requiresFuelFarm: false,
    requiresFireStation: false,
    requiresBorderControl: false,
  },
  'heli-heavy': {
    id: 'heli-heavy',
    name: 'Offshore helicopter',
    runwayLength: 0,
    minSurface: 'grass',
    use: 'civil',
    standSize: 'small',
    silhouette: 'helicopter',
    endurance: 40,
    fare: 2_600,
    passengers: 19,
    approachSeconds: 5,
    landingSeconds: 4,
    taxiSeconds: 0,
    turnaroundSeconds: 12,
    departSeconds: 4,
    // The gate that makes a second pad a decision rather than a formality.
    requiresFuelFarm: true,
    requiresFireStation: false,
    requiresBorderControl: false,
  },
  heavylift: {
    id: 'heavylift',
    name: 'Strategic airlifter',
    runwayLength: 15,
    minSurface: 'asphalt',
    use: 'military',
    standSize: 'large',
    silhouette: 'transport',
    endurance: 40,
    fare: 9_500,
    passengers: 0,
    approachSeconds: 7,
    landingSeconds: 5,
    taxiSeconds: 6,
    turnaroundSeconds: 16,
    departSeconds: 5,
    requiresFuelFarm: true,
    requiresFireStation: true,
    requiresBorderControl: false,
  },
};

export function aircraftClass(id: AircraftClassId): AircraftClass {
  return AIRCRAFT_CLASSES[id];
}

/**
 * Whether this class lands on a helipad rather than a runway.
 *
 * `MIN_RUNWAY_TILES` is 3 and `checkRunway` enforces it, so a zero here can never mean a very
 * short runway — which is what lets the sentinel stand in for a flag without adding a field
 * to all nineteen entries.
 */
export function isRotorcraft(id: AircraftClassId): boolean {
  return AIRCRAFT_CLASSES[id].runwayLength === 0;
}
