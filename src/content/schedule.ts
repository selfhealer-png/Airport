import { createRandom } from '@/sim/random';
import { DAY_SECONDS } from '@/sim/step';
import type { AircraftClassId, ScheduledArrival } from '@/sim/types';

/**
 * Daily flight schedules — the game's waves.
 *
 * Difficulty rises on two axes at once: more aeroplanes, and heavier aeroplanes, both paced
 * purely by the day number. The schedule is a fixed path: `(seed, day)` decides everything,
 * so what is coming is knowable in advance and the player is being tested on their airport.
 *
 * There used to be a reputation input that thinned the heavy end. It read as a safety valve
 * and behaved as a cliff: once every class fell under the weight floor the function fell back
 * to trainers alone, so a bad day did not get a lighter schedule, it got the flying club and
 * nothing else — a day of widebody infrastructure earning five hundred pounds. Removing it
 * costs a pacing variable and nothing else; there was never a fail state attached to it.
 */

interface Tier {
  readonly classId: AircraftClassId;
  /** First day this class can appear at all. */
  readonly fromDay: number;
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
 * `fromDay` sets the story — roughly one new aeroplane every three or four days, so there is
 * nearly always something to build towards. Weights fall as the classes get heavier so the
 * top of the ladder stays a garnish rather than the whole day's traffic.
 */
const TIERS: readonly Tier[] = [
  { classId: 'trainer', fromDay: 1, weight: 7 },
  { classId: 'light', fromDay: 1, weight: 6 },
  { classId: 'airtaxi', fromDay: 3, weight: 5 },
  { classId: 'utility', fromDay: 5, weight: 5 },
  { classId: 'bush', fromDay: 8, weight: 4 },
  { classId: 'commuter', fromDay: 11, weight: 4 },
  { classId: 'feeder', fromDay: 15, weight: 3 },
  { classId: 'regional', fromDay: 19, weight: 3 },
  { classId: 'regional-x', fromDay: 23, weight: 3 },
  { classId: 'narrowbody', fromDay: 27, weight: 2 },
  { classId: 'narrowbody-x', fromDay: 32, weight: 2 },
  { classId: 'freighter', fromDay: 36, weight: 2 },
  { classId: 'widebody', fromDay: 40, weight: 1 },
  { classId: 'superheavy', fromDay: 45, weight: 1 },

  /*
   * Rotorcraft. A second progression axis that needs no runway at all — which is the point of
   * arriving at day 30, where the campaign otherwise becomes "extend the strip again".
   *
   * Weighted like the military classes and for the same reason: a pad should be an occasional
   * well-paid movement, not a traffic type that reshapes the day. Measured, not guessed — at
   * the first weights tried, rotary traffic was 26% of the late campaign and, with military
   * already at 19%, nearly half of every day was traffic that never touched the main runways.
   * At 1.6/0.6 it settles around 15%, which is the band the military classes sit in.
   *
   * The same floor arithmetic applies as above, and more sharply: `helicopter` thins to 0.4
   * by day 45, and a weight of 1.4 would put it at 0.35 — which fails the `>= 0.35` test
   * anyway, because 1.4/4 is 0.34999999999999997 in binary floating point. Leave the margin.
   */
  { classId: 'helicopter', fromDay: 30, weight: 1.6 },
  { classId: 'heli-heavy', fromDay: 40, weight: 0.6 },

  /*
   * Military work arrives late and stays occasional. It needs a runway no airliner can use,
   * so the weights are deliberately thin — a dedicated strip should feel like a bet on a few
   * very well paid movements, not a second airport running alongside the first.
   *
   * Reputation used to be doing half that thinning by accident. On the fixed path the weights
   * have to carry it alone, and at the old 2/2/1 the three classes together were 34% of every
   * day from 45 on — a share at which the strip stops being a bet and becomes mandatory
   * infrastructure. Retuned against the measured share rather than by eye: 25% at the peak.
   *
   * The fractions are deliberate. Age-thinning halves a weight every six days behind the
   * newest class, and anything under 0.35 is dropped from the day entirely — so `fighter` at
   * a round 1 would *vanish* from day 45, taking it out of the forecast as well as the sky.
   * That is the same cliff reputation used to produce. 1.6 thins to 0.4 and keeps flying.
   */
  { classId: 'fighter', fromDay: 30, weight: 1.6 },
  { classId: 'transport', fromDay: 38, weight: 0.8 },
  { classId: 'heavylift', fromDay: 45, weight: 0.5 },
];

/** The campaign runs fifty days, after which the schedule holds at its heaviest. */
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
 * One adjustment to each class's base weight: **age**. A class halves in frequency for every
 * six days it is behind the newest one, so a day-40 airport is not still spending most of its
 * movements on club trainers. Nothing ever vanishes completely — a real airfield always has
 * light traffic, and it keeps the small stands worth owning.
 */
export function availableTiers(day: number): WeightedTier[] {
  const unlocked = TIERS.filter((t) => day >= t.fromDay);
  if (unlocked.length === 0) return [{ classId: TIERS[0]!.classId, weight: 1 }];

  const newest = Math.max(...unlocked.map((t) => t.fromDay));
  const weighted = unlocked.map((tier) => {
    const generationsBehind = Math.floor(Math.max(0, newest - tier.fromDay) / 6);
    return { classId: tier.classId, weight: tier.weight / 2 ** generationsBehind };
  });

  // Below a trickle, a class is not a warning any more, just noise in the forecast.
  const flying = weighted.filter((tier) => tier.weight >= 0.35);
  return flying.length > 0 ? flying : [{ classId: TIERS[0]!.classId, weight: 1 }];
}

/**
 * Builds one day's schedule. Deterministic in `(seed, day)`, so the same day always brings
 * the same traffic — the player is being tested on their airport, not on their luck.
 */
export function generateSchedule(day: number, seed: number): readonly ScheduledArrival[] {
  const random = createRandom(seed * 7919 + day);
  const tiers = availableTiers(day);
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
