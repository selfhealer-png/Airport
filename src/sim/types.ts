import type { Services } from './connectivity';

/**
 * Core simulation types.
 *
 * Nothing in `sim/` may import from `render/`, `ui/`, `input/` or `sprites/`. The simulation
 * is plain state plus reducers so it can be stepped headlessly in tests and in the day
 * harness, and so the speed controls are just "run N steps per frame".
 */

/** Natural ground. What the map is before anything is built on it. */
export type Terrain = 'grass' | 'woods' | 'water' | 'rock';

/** What a runway is surfaced with. Mown grass is a legitimate strip for light aircraft. */
export type RunwaySurface = 'grass' | 'gravel' | 'asphalt';

export const SURFACE_RANK: Readonly<Record<RunwaySurface, number>> = {
  grass: 0,
  gravel: 1,
  asphalt: 2,
};

/**
 * What a runway is cleared for.
 *
 * Exclusive in both directions on purpose: a military strip will not take airliners and an
 * airliner's runway will not take fast jets. If military runways doubled as civil ones,
 * building one would be strictly better than not, and the decision would evaporate. Dedicated
 * means an expensive strip that sits idle most of the day and pays for itself in bursts.
 */
export type RunwayUse = 'civil' | 'military';

export type StandSize = 'small' | 'medium' | 'large';

export const STAND_RANK: Readonly<Record<StandSize, number>> = {
  small: 0,
  medium: 1,
  large: 2,
};

/** A position on the map grid. */
export interface TileIndex {
  readonly x: number;
  readonly y: number;
}

export interface LevelMap {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Row-major, length `width * height`. */
  readonly terrain: readonly Terrain[];
}

/** Terrain that can be built on without clearing work. */
export function isBuildable(terrain: Terrain): boolean {
  return terrain === 'grass';
}

export function terrainAt(map: LevelMap, x: number, y: number): Terrain | undefined {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return undefined;
  return map.terrain[y * map.width + x];
}

/**
 * A runway. The map is portrait, so runways are vertical strips one tile wide, spanning
 * rows `y0..y1` inclusive. Length in tiles is what gates which aircraft can use it.
 */
export interface Runway {
  readonly id: string;
  readonly x: number;
  /** Mutable: extending a runway grows these rather than replacing the runway. */
  y0: number;
  y1: number;
  surface: RunwaySurface;
  /** Civil or military. Set when the strip is laid; there is no converting one to the other. */
  use: RunwayUse;
  /** Aircraft currently holding this runway (approaching, landing or departing). */
  reservedBy: number | null;
  /** A crash closes the runway for the remainder of the day. */
  closed: boolean;
}

export function runwayLength(runway: Runway): number {
  return runway.y1 - runway.y0 + 1;
}

export interface Stand {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly size: StandSize;
  reservedBy: number | null;
}

export interface Airport {
  readonly map: LevelMap;
  runways: Runway[];
  stands: Stand[];
  /** Row-major mask, 1 where a taxiway tile has been laid. */
  taxiways: Uint8Array;
  /**
   * Row-major mask, 1 where a road tile has been laid.
   *
   * Roads are the landside network: they carry everything that is not an aeroplane. A road
   * tile touching the edge of the map is an entrance, and anything built — runway, stand or
   * facility — has to reach one of those entrances to work. Roads are cheap, so the cost is
   * land and planning rather than money.
   */
  roads: Uint8Array;
  /** Placed facilities. Each occupies a tile, so land is a real constraint. */
  facilities: Facility[];
  /** Per-airport counter, so ids are deterministic and survive a save/load round trip. */
  nextEntityId: number;
}

export type FacilityType = 'tower' | 'terminal' | 'fuel-farm' | 'fire-station' | 'shop';

/**
 * A facility building. Tower and terminal carry a level; the other two are simply present
 * or not. Position has no effect on the simulation — what it costs is space near the
 * runways, which is the point.
 */
export interface Facility {
  readonly id: string;
  readonly type: FacilityType;
  readonly x: number;
  readonly y: number;
  level: number;
}

/**
 * Why an aircraft could not be given a runway. Recorded every tick while holding, so the
 * debrief can tell the player exactly which constraint cost them the aeroplane.
 */
export type BlockReason =
  | 'no-military-runway'
  | 'no-civil-runway'
  | 'no-runway-length'
  | 'no-runway-surface'
  | 'no-road-runway'
  | 'no-taxi-link'
  | 'no-stand'
  | 'no-stand-size'
  | 'no-road-stand'
  | 'runway-busy'
  | 'tower-capacity'
  | 'stack-overflow'
  | 'no-fuel-farm'
  | 'no-fire-station';

export type AircraftPhase =
  | 'holding'
  | 'approach'
  | 'landing'
  | 'taxi-in'
  | 'parked'
  | 'taxi-out'
  | 'departing'
  | 'done'
  | 'diverted'
  | 'crashed';

export interface Aircraft {
  readonly id: number;
  readonly classId: AircraftClassId;
  phase: AircraftPhase;
  /** Seconds of holding fuel left. Only burns while holding. */
  fuel: number;
  /** Seconds left in the current timed phase. */
  timer: number;
  /**
   * Whether the tower has this aircraft in its stack. Overflow aircraft are unmanaged: they
   * are never sequenced and cannot divert safely, so running dry means a crash.
   */
  managed: boolean;
  runwayId: string | null;
  standId: string | null;
  blockedReason: BlockReason | null;
}

export type AircraftClassId =
  | 'trainer'
  | 'light'
  | 'airtaxi'
  | 'utility'
  | 'bush'
  | 'commuter'
  | 'feeder'
  | 'regional'
  | 'regional-x'
  | 'narrowbody'
  | 'narrowbody-x'
  | 'freighter'
  | 'widebody'
  | 'superheavy'
  | 'fighter'
  | 'transport'
  | 'heavylift';

/**
 * Which aeroplane shape is drawn for a class.
 *
 * Several classes share a silhouette and are told apart by livery and size, which is what
 * lets the fleet grow across a long campaign without new pixel art for every class. Named
 * here as a plain union rather than as a sprite name so `sim/` keeps knowing nothing about
 * how the game is drawn.
 */
export type AircraftSilhouette =
  | 'single'
  | 'twin'
  | 'turboprop'
  | 'regional'
  | 'narrowbody'
  | 'widebody'
  | 'fighter'
  | 'transport';

export interface AircraftClass {
  readonly id: AircraftClassId;
  readonly name: string;
  /** Tiles of runway required to land. */
  readonly runwayLength: number;
  readonly minSurface: RunwaySurface;
  /** Which kind of runway this class will operate from. */
  readonly use: RunwayUse;
  readonly standSize: StandSize;
  readonly silhouette: AircraftSilhouette;
  /** Seconds of fuel available while holding. */
  readonly endurance: number;
  /**
   * The landing fee, paid whatever happens to the passengers. Cargo aircraft earn all their
   * money here; everything else earns most of it from the people on board.
   */
  readonly fare: number;
  /** Souls on board. Zero for freighters, which is what makes them worth a long runway. */
  readonly passengers: number;
  readonly approachSeconds: number;
  readonly landingSeconds: number;
  readonly taxiSeconds: number;
  readonly turnaroundSeconds: number;
  readonly departSeconds: number;
  /** Airport facilities this class refuses to operate without. */
  readonly requiresFuelFarm: boolean;
  readonly requiresFireStation: boolean;
}

export interface ScheduledArrival {
  readonly atSeconds: number;
  readonly classId: AircraftClassId;
}

export type DayOutcome = 'landed' | 'diverted' | 'crashed';

export interface DayEvent {
  readonly aircraftId: number;
  readonly classId: AircraftClassId;
  readonly outcome: DayOutcome;
  readonly reason: BlockReason | null;
  readonly atSeconds: number;
  readonly cash: number;
  /** Passengers processed through the terminal from this aircraft. */
  readonly passengers: number;
  /** Passengers this aircraft brought that the terminal could not take. */
  readonly passengersTurnedAway: number;
}

export interface DayState {
  readonly day: number;
  readonly schedule: readonly ScheduledArrival[];
  elapsed: number;
  nextArrival: number;
  nextAircraftId: number;
  aircraft: Aircraft[];
  events: DayEvent[];
  /**
   * Taxi links and road service, derived from the layout when the day starts. Building only
   * happens during planning, so this cannot go stale under a running day — and computing it
   * once is what keeps the per-tick assignment pass a lookup rather than a graph search.
   */
  services: Services;
  /** Passengers the terminal has processed today, against its daily capacity. */
  passengersHandled: number;
  /** Passengers that landed but found no room in the terminal. */
  passengersTurnedAway: number;
}

export type GamePhase = 'planning' | 'day' | 'debrief';

export interface GameState {
  airport: Airport;
  cash: number;
  day: number;
  phase: GamePhase;
  current: DayState | null;
  seed: number;
  /**
   * The campaign's service record: aeroplanes that got down, against aeroplanes that were
   * booked in. Purely descriptive — the debrief reports it and nothing reads it back into the
   * schedule, which is the whole point of the fixed path. Cash cannot do this job because
   * cash only ever goes up.
   */
  landedTotal: number;
  scheduledTotal: number;
}
