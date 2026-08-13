import { aircraftClass } from '@/content/aircraft';
import { TILE_PX } from '@/sprites/palette';
import type { PlaneSpriteName } from '@/sprites/data';
import { runwayById, standById } from '@/sim/connectivity';
import type { Aircraft, AircraftSilhouette, Airport, DayState, Runway, Stand } from '@/sim/types';

/**
 * Where to draw each aeroplane, and which way round.
 *
 * The simulation deliberately stores no coordinates — an aircraft is a phase and a timer.
 * Positions are derived here instead, so `sim/` stays headless and the visuals can be
 * rewritten without touching game logic. Every phase has a known duration, so the timer
 * counting down doubles as an animation clock.
 */

/**
 * Quarter turns clockwise from nose-up. Only quarter turns are used because they are the
 * one rotation that preserves the pixel grid exactly — anything else smears the sprite.
 */
export type Quarter = 0 | 1 | 2 | 3;

export interface AircraftView {
  /** Centre of the sprite, in world pixels. */
  readonly x: number;
  readonly y: number;
  readonly rotation: Quarter;
  readonly sprite: PlaneSpriteName;
  /** Sprite length in whole tiles; width is always one. */
  readonly lengthTiles: number;
  /**
   * Height above the ground, 0 (rolling) to 1 (cruising). Drives the drop shadow, which is
   * the only cue that separates an aeroplane on final from one taxiing across the same tile.
   */
  readonly altitude: number;
  /** Fuel remaining as a fraction, for the low-fuel warning ring. Null once committed. */
  readonly fuelFraction: number | null;
  /** Tyre smoke at the moment of touchdown, 0 to 1. */
  readonly touchdown: number;
}

const SPRITE_OF: Readonly<Record<AircraftSilhouette, PlaneSpriteName>> = {
  single: 'plane.single',
  twin: 'plane.twin',
  turboprop: 'plane.turboprop',
  regional: 'plane.regional',
  narrowbody: 'plane.narrowbody',
  widebody: 'plane.widebody',
  fighter: 'plane.fighter',
  transport: 'plane.transport',
};

/** How long each silhouette is, in tiles. Must match the authored sprite heights. */
const LENGTH_OF: Readonly<Record<AircraftSilhouette, number>> = {
  single: 1,
  twin: 1,
  turboprop: 2,
  regional: 2,
  narrowbody: 2,
  widebody: 2,
  fighter: 1,
  transport: 2,
};

const centre = (tile: number): number => tile * TILE_PX + TILE_PX / 2;

const clamp01 = (t: number): number => Math.min(Math.max(t, 0), 1);

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/** How far through the current timed phase this aircraft is, 0 to 1. */
function progress(aircraft: Aircraft, duration: number): number {
  if (duration <= 0) return 1;
  return clamp01(1 - aircraft.timer / duration);
}

/** Fast at first, then settling — a landing roll bleeding off speed. */
const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/** Slow at first, then away — a take-off roll building speed. */
const easeIn = (t: number): number => t ** 3;

interface Placed {
  x: number;
  y: number;
  rotation: Quarter;
}

/**
 * An L-shaped ground path: along the runway column first, then across to the apron.
 *
 * Aircraft have no route in the simulation, but cutting the corner diagonally looks like an
 * aeroplane driving over the grass. Turning once, on the axis, reads as following the
 * taxiway even though the simulation only knows the two endpoints.
 */
function elbow(
  from: { x: number; y: number },
  to: { x: number; y: number },
  t: number,
  verticalFirst: boolean,
): Placed {
  const corner = verticalFirst ? { x: from.x, y: to.y } : { x: to.x, y: from.y };
  const legA = Math.abs(corner.x - from.x) + Math.abs(corner.y - from.y);
  const legB = Math.abs(to.x - corner.x) + Math.abs(to.y - corner.y);
  const total = legA + legB;

  if (total === 0) return { x: to.x, y: to.y, rotation: 0 };

  const travelled = clamp01(t) * total;
  const [start, end, local] =
    travelled <= legA
      ? [from, corner, legA === 0 ? 1 : travelled / legA]
      : [corner, to, legB === 0 ? 1 : (travelled - legA) / legB];

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let rotation: Quarter = 0;
  if (Math.abs(dx) > Math.abs(dy)) rotation = dx > 0 ? 1 : 3;
  else if (dy !== 0) rotation = dy > 0 ? 2 : 0;

  return { x: lerp(start.x, end.x, local), y: lerp(start.y, end.y, local), rotation };
}

/**
 * Holding aircraft orbit above the field.
 *
 * They are spread around an ellipse by arrival order and pushed onto wider rings as the
 * stack fills, so a congested tower looks congested — that is the player's cue that the
 * stack, rather than the runway, is the thing to fix.
 */
function holdingPosition(airport: Airport, index: number, count: number, elapsed: number): Placed {
  const ring = index % 3;
  const radius = (2.6 + ring * 1.4) * TILE_PX;
  const angle = elapsed * 0.5 + (index / Math.max(count, 1)) * Math.PI * 2;

  return {
    x: centre(airport.map.width / 2) + Math.cos(angle) * radius * 1.5,
    y: centre(3.5) + Math.sin(angle) * radius * 0.8,
    // Velocity of (cos, sin) is (-sin, cos): a positive cosine means heading south.
    rotation: Math.cos(angle) > 0 ? 2 : 0,
  };
}

/** Where an aircraft leaves or rejoins the runway: the far threshold it rolls out to. */
const exitOf = (runway: Runway): { x: number; y: number } => ({
  x: centre(runway.x),
  y: centre(runway.y1),
});

const standAt = (stand: Stand): { x: number; y: number } => ({
  x: centre(stand.x),
  y: centre(stand.y),
});

/** Builds a drawable view for every aircraft that is currently somewhere on the airfield. */
export function aircraftViews(airport: Airport, day: DayState): AircraftView[] {
  const views: AircraftView[] = [];
  const holding = day.aircraft.filter((a) => a.phase === 'holding');

  for (const aircraft of day.aircraft) {
    const spec = aircraftClass(aircraft.classId);
    const sprite = SPRITE_OF[spec.silhouette];
    const lengthTiles = LENGTH_OF[spec.silhouette];
    const runway = aircraft.runwayId ? runwayById(airport, aircraft.runwayId) : undefined;
    const stand = aircraft.standId ? standById(airport, aircraft.standId) : undefined;

    const push = (placed: Placed, altitude: number, extra?: Partial<AircraftView>): void => {
      views.push({
        x: placed.x,
        y: placed.y,
        rotation: placed.rotation,
        sprite,
        lengthTiles,
        altitude,
        fuelFraction: null,
        touchdown: 0,
        ...extra,
      });
    };

    switch (aircraft.phase) {
      case 'holding': {
        const index = holding.indexOf(aircraft);
        push(holdingPosition(airport, index, holding.length, day.elapsed), 1, {
          fuelFraction: Math.max(0, aircraft.fuel / spec.endurance),
        });
        break;
      }

      case 'approach': {
        if (!runway) break;
        // Descends from off the top of the field onto the threshold, shadow closing in.
        const t = progress(aircraft, spec.approachSeconds);
        push(
          {
            x: centre(runway.x),
            y: lerp(centre(runway.y0 - 9), centre(runway.y0), t),
            rotation: 2,
          },
          lerp(1, 0.08, t),
        );
        break;
      }

      case 'landing': {
        if (!runway) break;
        const t = progress(aircraft, spec.landingSeconds);
        push(
          {
            x: centre(runway.x),
            y: lerp(centre(runway.y0), centre(runway.y1), easeOut(t)),
            rotation: 2,
          },
          0,
          // A puff at the moment the wheels bite, fading over the first third of the roll.
          { touchdown: clamp01(1 - t * 3) },
        );
        break;
      }

      case 'taxi-in': {
        if (!stand) break;
        const t = progress(aircraft, spec.taxiSeconds);
        const from = runway ? exitOf(runway) : standAt(stand);
        push(elbow(from, standAt(stand), t, true), 0);
        break;
      }

      case 'parked': {
        if (!stand) break;
        push({ ...standAt(stand), rotation: 0 }, 0);
        break;
      }

      case 'taxi-out': {
        if (!stand) break;
        const t = progress(aircraft, spec.taxiSeconds);
        const to = runway ? exitOf(runway) : standAt(stand);
        // Mirrors the arrival: across the apron first, then up the runway column.
        push(elbow(standAt(stand), to, t, false), 0);
        break;
      }

      case 'departing': {
        if (!runway) break;
        const t = progress(aircraft, spec.departSeconds);
        push(
          {
            x: centre(runway.x),
            y: lerp(centre(runway.y1), centre(runway.y0 - 7), easeIn(t)),
            rotation: 0,
          },
          // Stays on the ground for the roll, then climbs away.
          clamp01((t - 0.45) / 0.55),
        );
        break;
      }

      default:
        break;
    }
  }

  return views;
}
