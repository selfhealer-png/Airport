import {
  GATE_HALL_CAPACITY,
  NO_TERMINAL_CAPACITY,
  passengerRevenue,
  TERMINAL_CORE_CAPACITY,
  TOWER_LEVELS,
} from '@/content/buildings';
import type { Services } from './connectivity';
import type {
  Airport,
  Facility,
  FacilityType,
  GameState,
  LevelMap,
  RunwaySurface,
  RunwayUse,
  StandSize,
} from './types';

/**
 * Construction of airport and game state, plus the small mutations the build system needs.
 * Kept beside the simulation because the shape of the state is the simulation's business.
 */

/**
 * Enough for a first airport including its roads.
 *
 * Roads added a requirement to day one — a strip and an apron are useless until something
 * can drive to them — so the opening budget had to grow with it. A starting balance that
 * cannot buy a working airport is not difficulty, it is a dead end.
 */
export const STARTING_CASH = 2_400;

export function createAirport(map: LevelMap): Airport {
  return {
    map,
    runways: [],
    stands: [],
    helipads: [],
    taxiways: new Uint8Array(map.width * map.height),
    roads: new Uint8Array(map.width * map.height),
    groundworks: new Uint8Array(map.width * map.height),
    facilities: [],
    // Category A: light aircraft and helicopters, and free to hold.
    certification: 0,
    nextEntityId: 1,
  };
}

/**
 * Facility accessors. The simulation asks these rather than reading fields, so placing a
 * facility and upgrading one both flow through a single source of truth.
 */
export function facilityOf(airport: Airport, type: FacilityType): Facility | undefined {
  return airport.facilities.find((facility) => facility.type === type);
}

/** Level 0 means "no tower": one movement at a time and a stack of two. */
export function towerLevelOf(airport: Airport): number {
  return facilityOf(airport, 'tower')?.level ?? 0;
}

export function hasFuelFarm(airport: Airport): boolean {
  return facilityOf(airport, 'fuel-farm') !== undefined;
}

export function hasFireStation(airport: Airport): boolean {
  return facilityOf(airport, 'fire-station') !== undefined;
}

/** Every retail unit on the airport. Unlike a tower, modules are not unique. */
export function shopsOf(airport: Airport): Facility[] {
  return airport.facilities.filter((facility) => facility.type === 'shop');
}

/**
 * Every terminal. There may be several: terminal level 4 caps at 2,600 passengers a day and
 * the late campaign books over three thousand, so a second building is the only way past a
 * ceiling that would otherwise simply stop the airport growing.
 */
export function terminalsOf(airport: Airport): Facility[] {
  return airport.facilities.filter((facility) => facility.type === 'terminal');
}

/**
 * Built versus working.
 *
 * The accessors above answer "what did the player pay for". The ones below answer "what is
 * actually doing anything today", which since roads arrived is a different question: a
 * building with no road to an entrance has no staff, no deliveries and no power, so it
 * contributes nothing. Keeping the two apart stops the build system and the simulation from
 * disagreeing about whether a tower exists.
 */
function isWorking(services: Services, facility: Facility | undefined): boolean {
  return facility !== undefined && services.roadServed.has(facility.id);
}

export function workingTowerLevel(airport: Airport, services: Services): number {
  const tower = facilityOf(airport, 'tower');
  return isWorking(services, tower) ? (tower?.level ?? 0) : 0;
}

/**
 * What the airport's terminals can do between them.
 *
 * Everything **sums**, across every module of every terminal, and that is the whole shape of
 * the change from the old level ladder. A ladder had to defend itself against two cheap sheds
 * beating one good building, which is why it carried a capacity-weighted average of fare
 * multipliers that nobody could have guessed at from playing. Modules cost a tile each, so
 * "more" is already paid for in land, and plain addition is honest.
 *
 * A module counts only if `services.terminalModules` has it — road-served and joined to a
 * road-served core. A gate hall in a field is a shed.
 */
export function workingTerminalCapacity(
  airport: Airport,
  services: Services,
): {
  passengerCapacity: number;
  revenuePerPassenger: number;
  baggageHalls: number;
  borderControl: boolean;
} {
  const cores = terminalsOf(airport).filter((t) => isWorking(services, t));

  // No terminal, or none of them working, is still a windsock and a gate in a hedge. It takes
  // a handful of people off a light aircraft, which is what makes the opening days of a
  // campaign pay at all — dropping this floor to zero quietly breaks day one.
  if (cores.length === 0) {
    return {
      passengerCapacity: NO_TERMINAL_CAPACITY,
      revenuePerPassenger: passengerRevenue(0, 0),
      baggageHalls: 0,
      borderControl: false,
    };
  }

  const modules = airport.facilities.filter((f) => services.terminalModules.has(f.id));
  const count = (type: FacilityType): number =>
    modules.filter((m) => m.type === type).length;

  const gateHalls = count('gate-hall');
  const baggageHalls = count('baggage-hall');

  return {
    passengerCapacity: cores.length * TERMINAL_CORE_CAPACITY + gateHalls * GATE_HALL_CAPACITY,
    revenuePerPassenger: passengerRevenue(baggageHalls, count('shop')),
    baggageHalls,
    borderControl: count('border-control') > 0,
  };
}

/** Gate halls actually attached to a working terminal. What retail is capped against. */
export function workingGateHalls(airport: Airport, services: Services): number {
  return airport.facilities.filter(
    (f) => f.type === 'gate-hall' && services.terminalModules.has(f.id),
  ).length;
}

export function hasWorkingFuelFarm(airport: Airport, services: Services): boolean {
  return isWorking(services, facilityOf(airport, 'fuel-farm'));
}

export function hasWorkingFireStation(airport: Airport, services: Services): boolean {
  return isWorking(services, facilityOf(airport, 'fire-station'));
}

export function createGame(map: LevelMap, seed = 1): GameState {
  return {
    airport: createAirport(map),
    cash: STARTING_CASH,
    day: 1,
    phase: 'planning',
    current: null,
    seed,
    landedTotal: 0,
    scheduledTotal: 0,
  };
}

function makeId(airport: Airport, prefix: string): string {
  return `${prefix}${airport.nextEntityId++}`;
}

/**
 * Adds a vertical runway spanning rows `y0..y1` inclusive at column `x`.
 * Rows are normalised, so a drag in either direction gives the same runway.
 */
export function addRunway(
  airport: Airport,
  x: number,
  y0: number,
  y1: number,
  surface: RunwaySurface,
  use: RunwayUse = 'civil',
): string {
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const id = makeId(airport, 'rwy');
  airport.runways.push({
    id,
    x,
    y0: top,
    y1: bottom,
    surface,
    use,
    reservedBy: null,
    closed: false,
  });
  return id;
}

export function addStand(airport: Airport, x: number, y: number, size: StandSize): string {
  const id = makeId(airport, 'std');
  airport.stands.push({ id, x, y, size, reservedBy: null });
  return id;
}

export function addHelipad(airport: Airport, x: number, y: number): string {
  const id = makeId(airport, 'pad');
  airport.helipads.push({ id, x, y, reservedBy: null });
  return id;
}

export function addTaxiway(airport: Airport, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= airport.map.width || y >= airport.map.height) return;
  airport.taxiways[y * airport.map.width + x] = 1;
}

/** Lays a straight run of taxiway tiles. Either axis; diagonals are not supported. */
export function addTaxiwayRun(
  airport: Airport,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  if (x0 !== x1 && y0 !== y1) {
    throw new Error('Taxiway runs must be straight along one axis.');
  }
  const stepX = Math.sign(x1 - x0);
  const stepY = Math.sign(y1 - y0);
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    addTaxiway(airport, x0 + stepX * i, y0 + stepY * i);
  }
}

export function hasTaxiway(airport: Airport, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= airport.map.width || y >= airport.map.height) return false;
  return airport.taxiways[y * airport.map.width + x] === 1;
}

export function addRoad(airport: Airport, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= airport.map.width || y >= airport.map.height) return;
  airport.roads[y * airport.map.width + x] = 1;
}

/** Lays a straight run of road tiles. Either axis; diagonals are not supported. */
export function addRoadRun(
  airport: Airport,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  if (x0 !== x1 && y0 !== y1) {
    throw new Error('Road runs must be straight along one axis.');
  }
  const stepX = Math.sign(x1 - x0);
  const stepY = Math.sign(y1 - y0);
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    addRoad(airport, x0 + stepX * i, y0 + stepY * i);
  }
}

/**
 * Ground that has been worked. What that bought is read from the terrain underneath —
 * see `terrainAllows`.
 */
export function hasGroundwork(airport: Airport, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= airport.map.width || y >= airport.map.height) return false;
  return airport.groundworks[y * airport.map.width + x] === 1;
}

export function addGroundwork(airport: Airport, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= airport.map.width || y >= airport.map.height) return;
  airport.groundworks[y * airport.map.width + x] = 1;
}

export function hasRoad(airport: Airport, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= airport.map.width || y >= airport.map.height) return false;
  return airport.roads[y * airport.map.width + x] === 1;
}
