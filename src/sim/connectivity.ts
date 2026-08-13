import type { Airport, Facility, Helipad, Runway, Stand } from './types';

/**
 * Works out which stands each runway can taxi to.
 *
 * This is what stops "build one very long runway" from solving the game: a landed aircraft
 * has to reach a stand, and if it cannot, the runway stays blocked. A stand counts as linked
 * if it sits beside the runway itself, or if a chain of taxiway tiles reaches it.
 */

function key(x: number, y: number, width: number): number {
  return y * width + x;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

/** Tiles orthogonally touching the runway strip — where an aircraft can turn off. */
function runwayExits(runway: Runway): Array<[number, number]> {
  const exits: Array<[number, number]> = [];
  for (let y = runway.y0; y <= runway.y1; y++) {
    exits.push([runway.x - 1, y], [runway.x + 1, y]);
  }
  exits.push([runway.x, runway.y0 - 1], [runway.x, runway.y1 + 1]);
  return exits;
}

function inBounds(airport: Airport, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < airport.map.width && y < airport.map.height;
}

/** Stands touching any tile in `reached`, plus stands sitting directly on an exit tile. */
function standsTouching(
  airport: Airport,
  reached: ReadonlySet<number>,
  exits: ReadonlyArray<readonly [number, number]>,
): string[] {
  const width = airport.map.width;
  const exitKeys = new Set(exits.map(([x, y]) => key(x, y, width)));

  const linked: string[] = [];
  for (const stand of airport.stands) {
    if (exitKeys.has(key(stand.x, stand.y, width))) {
      linked.push(stand.id);
      continue;
    }
    const adjacent = NEIGHBOURS.some(([dx, dy]) =>
      reached.has(key(stand.x + dx, stand.y + dy, width)),
    );
    if (adjacent) linked.push(stand.id);
  }
  return linked;
}

/** Flood-fills the taxiway network outward from a runway's exits. */
function reachableTaxiways(airport: Airport, exits: ReadonlyArray<readonly [number, number]>): Set<number> {
  const width = airport.map.width;
  const reached = new Set<number>();
  const queue: Array<[number, number]> = [];

  for (const [x, y] of exits) {
    if (!inBounds(airport, x, y)) continue;
    const k = key(x, y, width);
    if (airport.taxiways[k] === 1 && !reached.has(k)) {
      reached.add(k);
      queue.push([x, y]);
    }
  }

  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(airport, nx, ny)) continue;
      const k = key(nx, ny, width);
      if (airport.taxiways[k] !== 1 || reached.has(k)) continue;
      reached.add(k);
      queue.push([nx, ny]);
    }
  }

  return reached;
}

/**
 * Runway id -> stand ids reachable from it. Recomputed whenever the layout changes, then
 * held on the day state so the per-tick assignment pass is a map lookup rather than a search.
 */
export function buildLinks(airport: Airport): ReadonlyMap<string, readonly string[]> {
  const links = new Map<string, readonly string[]>();
  for (const runway of airport.runways) {
    const exits = runwayExits(runway);
    links.set(runway.id, standsTouching(airport, reachableTaxiways(airport, exits), exits));
  }
  return links;
}

export function standById(airport: Airport, id: string): Stand | undefined {
  return airport.stands.find((stand) => stand.id === id);
}

export function runwayById(airport: Airport, id: string): Runway | undefined {
  return airport.runways.find((runway) => runway.id === id);
}

export function helipadById(airport: Airport, id: string): Helipad | undefined {
  return airport.helipads.find((pad) => pad.id === id);
}

/**
 * The landside road network.
 *
 * Taxiways carry aeroplanes; roads carry everything else — crews, fuel bowsers, fire cover,
 * baggage and the passengers themselves. What matters is that everything is on the *same*
 * network: a runway, an apron and a terminal each sitting on their own private stub of road
 * are not connected to anything.
 *
 * So this returns the single largest connected component, measured by how many built things
 * it touches, and only that component counts as the airport's road system.
 *
 * An earlier version rooted the network at the map edge, on the theory that an airport has a
 * landside access road. It was the right idea and the wrong game: the field is far taller
 * than a phone screen, so the boundary is several swipes away from anything the player is
 * looking at, and the rule amounted to "pay for forty tiles of road towards something you
 * cannot see". Requiring one shared network keeps the planning problem — buildings at one end
 * of the field still have to be linked to the apron at the other — without the invisible
 * errand.
 */
function components(airport: Airport): Array<Set<number>> {
  const { width, height } = airport.map;
  const seen = new Set<number>();
  const found: Array<Set<number>> = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = key(x, y, width);
      if (airport.roads[start] !== 1 || seen.has(start)) continue;

      const group = new Set<number>([start]);
      seen.add(start);
      const queue: Array<[number, number]> = [[x, y]];

      while (queue.length > 0) {
        const [cx, cy] = queue.pop()!;
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!inBounds(airport, nx, ny)) continue;
          const k = key(nx, ny, width);
          if (airport.roads[k] !== 1 || seen.has(k)) continue;
          seen.add(k);
          group.add(k);
          queue.push([nx, ny]);
        }
      }
      found.push(group);
    }
  }

  return found;
}

/** Everything the airport has built, as the tiles a road would have to touch. */
function servedThings(airport: Airport): Array<{ id: string; tiles: Array<[number, number]> }> {
  const things: Array<{ id: string; tiles: Array<[number, number]> }> = [];

  for (const runway of airport.runways) {
    const tiles: Array<[number, number]> = [];
    for (let y = runway.y0; y <= runway.y1; y++) tiles.push([runway.x, y]);
    things.push({ id: runway.id, tiles });
  }
  for (const stand of airport.stands) things.push({ id: stand.id, tiles: [[stand.x, stand.y]] });
  for (const pad of airport.helipads) things.push({ id: pad.id, tiles: [[pad.x, pad.y]] });
  for (const facility of airport.facilities) {
    things.push({ id: facility.id, tiles: [[facility.x, facility.y]] });
  }

  return things;
}

/**
 * The road system in use: whichever connected run of road serves the most built things.
 *
 * Ties go to the first found, which is deterministic because the scan is row-major.
 */
export function roadNetwork(airport: Airport): ReadonlySet<number> {
  const groups = components(airport);
  if (groups.length === 0) return new Set<number>();

  const things = servedThings(airport);
  let best = groups[0]!;
  let bestScore = -1;

  for (const group of groups) {
    const score = things.filter((thing) => touches(airport, group, thing.tiles)).length;
    if (score > bestScore) {
      bestScore = score;
      best = group;
    }
  }

  return best;
}

/** Whether any tile in `tiles` is orthogonally touched by a road in `network`. */
function touches(
  airport: Airport,
  network: ReadonlySet<number>,
  tiles: ReadonlyArray<readonly [number, number]>,
): boolean {
  const width = airport.map.width;
  return tiles.some(([x, y]) =>
    NEIGHBOURS.some(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      return inBounds(airport, nx, ny) && network.has(key(nx, ny, width));
    }),
  );
}

/** A runway needs road access along its length for fire cover and maintenance. */
export function runwayHasRoad(
  airport: Airport,
  network: ReadonlySet<number>,
  runway: Runway,
): boolean {
  const tiles: Array<[number, number]> = [];
  for (let y = runway.y0; y <= runway.y1; y++) tiles.push([runway.x, y]);
  return touches(airport, network, tiles);
}

/** A stand needs road access to move passengers and baggage to the terminal. */
export function standHasRoad(
  airport: Airport,
  network: ReadonlySet<number>,
  stand: Stand,
): boolean {
  return touches(airport, network, [[stand.x, stand.y]]);
}

/**
 * A helipad needs road access for exactly the reasons a stand does — the passengers have to
 * leave and the fire cover has to arrive. Helipads are never taxiway-linked: there is nothing
 * to taxi to, so they touch `roadServed` and never `links`.
 */
export function helipadHasRoad(
  airport: Airport,
  network: ReadonlySet<number>,
  pad: Helipad,
): boolean {
  return touches(airport, network, [[pad.x, pad.y]]);
}

/** A building with no road to it is staffed by nobody and does nothing at all. */
export function facilityHasRoad(
  airport: Airport,
  network: ReadonlySet<number>,
  facility: Facility,
): boolean {
  return touches(airport, network, [[facility.x, facility.y]]);
}

/**
 * Everything derived from the layout that the simulation needs while a day runs.
 *
 * Built once when the day starts and held on `DayState`, because building only happens
 * during planning — the layout cannot change under a running day. That matters: flooding the
 * road network for every aircraft on every tick would be thousands of searches a second.
 */
export interface Services {
  /** Runway id -> stand ids it can taxi to. */
  readonly links: ReadonlyMap<string, readonly string[]>;
  /** Ids of runways, stands and facilities the airport's road network reaches. */
  readonly roadServed: ReadonlySet<string>;
  /**
   * How many separate runs of road exist. More than one means the player has built roads
   * that do not join up, and only the largest is counted — which is worth saying out loud,
   * because the symptom ("this runway has no road") looks nothing like the cause.
   */
  readonly roadIslands: number;
}

export function buildServices(airport: Airport): Services {
  const network = roadNetwork(airport);
  const roadServed = new Set<string>();

  for (const runway of airport.runways) {
    if (runwayHasRoad(airport, network, runway)) roadServed.add(runway.id);
  }
  for (const stand of airport.stands) {
    if (standHasRoad(airport, network, stand)) roadServed.add(stand.id);
  }
  for (const pad of airport.helipads) {
    if (helipadHasRoad(airport, network, pad)) roadServed.add(pad.id);
  }
  for (const facility of airport.facilities) {
    if (facilityHasRoad(airport, network, facility)) roadServed.add(facility.id);
  }

  return { links: buildLinks(airport), roadServed, roadIslands: components(airport).length };
}
