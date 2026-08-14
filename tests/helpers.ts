import { CERTIFICATION_LEVELS } from '@/content/buildings';
import { addRoad } from '@/sim/airport';
import { occupantAt } from '@/sim/build';
import type { Airport } from '@/sim/types';

/**
 * Lays road on every free tile.
 *
 * Since roads arrived, nothing works without one — a runway needs fire cover alongside it, a
 * stand needs a way to move passengers off, a building with no road has no staff. That is a
 * genuine constraint and it has its own tests, but most tests are about something else
 * entirely and should not each carry a hand-routed road network.
 *
 * Call this *after* everything is built. Anything occupied is skipped, so the roads fill in
 * around the airport rather than fighting it, and every tile reaches the map edge, which is
 * what makes the network count as connected.
 */
/**
 * Licenses the aerodrome for anything that flies.
 *
 * A new airport holds Category A — light aircraft and helicopters — because that is what a
 * mown field is. Most tests are about something other than certification and should not each
 * have to reason about which category a narrowbody falls into, so they call this and get on
 * with it. Tests that *are* about the licence set `airport.certification` themselves.
 */
export function licensed(airport: Airport): void {
  airport.certification = CERTIFICATION_LEVELS.length - 1;
}

export function fullyServiced(airport: Airport): void {
  for (let y = 0; y < airport.map.height; y++) {
    for (let x = 0; x < airport.map.width; x++) {
      if (occupantAt(airport, x, y) === null) addRoad(airport, x, y);
    }
  }
}
