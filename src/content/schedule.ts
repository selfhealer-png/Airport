import { createRandom } from '@/sim/random';
import { DAY_SECONDS } from '@/sim/step';
import type { AircraftClassId, ScheduledArrival } from '@/sim/types';

/**
 * Daily flight schedules — the game's waves.
 *
 * Difficulty rises on two axes at once: more aeroplanes, and heavier aeroplanes. Reputation
 * gates the heavy end, so an airport that keeps losing aircraft is not immediately handed
 * traffic it has just proved it cannot take.
 */

interface Tier {
  readonly classId: AircraftClassId;
  /** First day this class can appear at all. */
  readonly fromDay: number;
  /** Reputation at which airlines will send this class as often as they want to. */
  readonly minReputation: number;
  /** Relative frequency once unlocked. */
  readonly weight: number;
}

interface WeightedTier {
  readonly classId: AircraftClassId;
  readonly weight: number;
}

/**
 * The campaign ladder, spread over fifty days.
 *
 * Two things are being paced at once. `fromDay` sets the story — roughly one new aeroplane
 * every three or four days, so there is nearly always something to build towards — and
 * `minReputation` is the safety valve: an airport that is losing aircraft does not get handed
 * heavier ones on schedule. Weights fall as the classes get heavier so the top of the ladder
 * stays a garnish rather than the whole day's traffic.
 */
const TIERS: readonly Tier[] = [
  { classId: 'trainer', fromDay: 1, minReputation: 0, weight: 7 },
  { classId: 'light', fromDay: 1, minReputation: 0, weight: 6 },
  { classId: 'airtaxi', fromDay: 3, minReputation: 0, weight: 5 },
  { classId: 'utility', fromDay: 5, minReputation: 30, weight: 5 },
  { classId: 'bush', fromDay: 8, minReputation: 35, weight: 4 },
  { classId: 'commuter', fromDay: 11, minReputation: 40, weight: 4 },
  { classId: 'feeder', fromDay: 15, minReputation: 45, weight: 3 },
  { classId: 'regional', fromDay: 19, minReputation: 50, weight: 3 },
  { classId: 'regional-x', fromDay: 23, minReputation: 55, weight: 3 },
  { classId: 'narrowbody', fromDay: 27, minReputation: 60, weight: 2 },
  { classId: 'narrowbody-x', fromDay: 32, minReputation: 65, weight: 2 },
  { classId: 'freighter', fromDay: 36, minReputation: 65, weight: 2 },
  { classId: 'widebody', fromDay: 40, minReputation: 62, weight: 1 },
  { classId: 'superheavy', fromDay: 45, minReputation: 70, weight: 1 },

  // Military work arrives late and stays occasional. It needs a runway no airliner can use,
  // so the weights are deliberately thin — a dedicated strip should feel like a bet on a few
  // very well paid movements, not a second airport running alongside the first.
  { classId: 'fighter', fromDay: 30, minReputation: 55, weight: 2 },
  { classId: 'transport', fromDay: 38, minReputation: 60, weight: 2 },
  { classId: 'heavylift', fromDay: 45, minReputation: 68, weight: 1 },
];

/** The campaign runs fifty days. Surviving all of them with a licence intact is the win. */
export const CAMPAIGN_DAYS = 50;

/** Arrivals stop before the day ends so the last aeroplane has time to be dealt with. */
const LAST_ARRIVAL_FRACTION = 0.75;

/**
 * How many aeroplanes turn up.
 *
 * Tied to what a runway can physically absorb, which is the constraint that actually decides
 * whether a day is playable. An arrival occupies its runway for approach plus landing —
 * eight seconds or so — and arrivals are spread across a window of about thirty-eight, so
 * one strip clears roughly five a day and each extra runway (with the tower movements to use
 * it) buys about five more.
 *
 * An earlier curve reached thirteen arrivals by day nine, which needed three runways before
 * the player could afford a second. Every day past that point was spent watching aeroplanes
 * circle until they ran dry — the diversions were not a puzzle, they were arithmetic.
 *
 * It caps at fifteen for the same reason. The late campaign gets harder because a widebody is
 * arriving, not because thirty aeroplanes are: the passenger economy already makes size the
 * thing that pays, and a day nobody could physically clear is not a difficulty curve.
 */
export function arrivalsForDay(day: number): number {
  return Math.min(3 + Math.round(day * 0.28), 15);
}

/**
 * Which classes fly today, and how often.
 *
 * Two adjustments to each class's base weight.
 *
 * **Age.** A class halves in frequency for every six days it is behind the newest one, so a
 * day-40 airport is not still spending most of its movements on club trainers. Nothing ever
 * vanishes completely — a real airfield always has light traffic, and it keeps the small
 * stands worth owning.
 *
 * **Reputation.** This used to be a hard gate, and it produced a vicious oscillation: a good
 * day pushed reputation over a threshold, a fleet of aeroplanes the airport had never seen
 * arrived the next morning and all diverted, reputation collapsed, and they vanished again.
 * Worse, because a class below its threshold never appeared in the forecast either, the
 * player had no way to see it coming and no way to prepare — the game punished them for
 * something it had refused to tell them about. So reputation now *thins* heavy traffic
 * instead of hiding it: a struggling airport sees the occasional big aeroplane, which is a
 * warning it can act on rather than an ambush.
 */
function availableTiers(day: number, reputation: number): WeightedTier[] {
  const unlocked = TIERS.filter((t) => day >= t.fromDay);
  if (unlocked.length === 0) return [{ classId: TIERS[0]!.classId, weight: 1 }];

  const newest = Math.max(...unlocked.map((t) => t.fromDay));
  const weighted = unlocked.map((tier) => {
    const generationsBehind = Math.floor(Math.max(0, newest - tier.fromDay) / 6);
    const standing = Math.min(1, Math.max(0, 1 + (reputation - tier.minReputation) / 30));
    return { classId: tier.classId, weight: (tier.weight / 2 ** generationsBehind) * standing };
  });

  // Below a trickle, a class is not a warning any more, just noise in the forecast.
  const flying = weighted.filter((tier) => tier.weight >= 0.35);
  return flying.length > 0 ? flying : [{ classId: TIERS[0]!.classId, weight: 1 }];
}

/**
 * Builds one day's schedule. Deterministic in `(seed, day)`, so the same day always brings
 * the same traffic — the player is being tested on their airport, not on their luck.
 */
export function generateSchedule(
  day: number,
  reputation: number,
  seed: number,
): readonly ScheduledArrival[] {
  const random = createRandom(seed * 7919 + day);
  const tiers = availableTiers(day, reputation);
  const totalWeight = tiers.reduce((sum, t) => sum + t.weight, 0);
  const count = arrivalsForDay(day);
  const window = DAY_SECONDS * LAST_ARRIVAL_FRACTION;

  const arrivals: ScheduledArrival[] = [];
  for (let i = 0; i < count; i++) {
    let roll = random.next() * totalWeight;
    let classId: AircraftClassId = tiers[0]!.classId;
    for (const tier of tiers) {
      roll -= tier.weight;
      if (roll <= 0) {
        classId = tier.classId;
        break;
      }
    }

    // Spread arrivals evenly across the window, then jitter, so traffic comes in a steady
    // stream with occasional bunching rather than one unplayable clump.
    const slot = (i / count) * window;
    const jitter = (random.next() - 0.5) * (window / count);
    arrivals.push({ atSeconds: Math.max(0, Math.round((slot + jitter) * 10) / 10), classId });
  }

  return arrivals.sort((a, b) => a.atSeconds - b.atSeconds);
}
