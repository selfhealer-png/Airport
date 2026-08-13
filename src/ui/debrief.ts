import { aircraftClass } from '@/content/aircraft';
import { explainReason } from '@/sim/step';
import type { DayState } from '@/sim/types';

/**
 * The end-of-day debrief.
 *
 * Waves play themselves, so this screen is the only feedback the player gets and it carries
 * the whole teaching load. Losses are grouped by *reason* rather than listed per aeroplane,
 * because "six lost, no runway long enough" tells you what to build and "flight 4 diverted"
 * does not.
 */

export interface Grouped {
  readonly reason: string;
  readonly count: number;
  readonly classes: string;
}

/** Losses collapsed by reason — exported so the teaching text itself can be tested. */
export function groupLosses(day: DayState): Grouped[] {
  const byReason = new Map<string, { count: number; classes: Set<string> }>();

  for (const event of day.events) {
    if (event.outcome === 'landed') continue;
    const label = explainReason(event.reason);
    const entry = byReason.get(label) ?? { count: 0, classes: new Set<string>() };
    entry.count += 1;
    entry.classes.add(aircraftClass(event.classId).name);
    byReason.set(label, entry);
  }

  return [...byReason]
    .map(([reason, entry]) => ({
      reason,
      count: entry.count,
      classes: [...entry.classes].join(', '),
    }))
    .sort((a, b) => b.count - a.count);
}

export interface DebriefResult {
  readonly landed: number;
  readonly diverted: number;
  readonly crashed: number;
  readonly cash: number;
  readonly reputation: number;
  readonly passengers: number;
  readonly passengersTurnedAway: number;
}

export function summariseDay(day: DayState): DebriefResult {
  let landed = 0;
  let diverted = 0;
  let crashed = 0;
  let cash = 0;
  let reputation = 0;
  let passengers = 0;
  let passengersTurnedAway = 0;

  for (const event of day.events) {
    if (event.outcome === 'landed') landed += 1;
    if (event.outcome === 'diverted') diverted += 1;
    if (event.outcome === 'crashed') crashed += 1;
    cash += event.cash;
    reputation += event.reputation;
    passengers += event.passengers;
    passengersTurnedAway += event.passengersTurnedAway;
  }

  return { landed, diverted, crashed, cash, reputation, passengers, passengersTurnedAway };
}

const signed = (value: number): string => (value >= 0 ? `+${value}` : `${value}`);

/** Renders the debrief into `root` and resolves when the player dismisses it. */
export function showDebrief(
  root: HTMLElement,
  day: DayState,
  onContinue: () => void,
  finalDay = false,
): void {
  const result = summariseDay(day);
  const losses = groupLosses(day);

  const panel = document.createElement('div');
  panel.className = 'debrief-panel';

  const heading = document.createElement('h2');
  heading.textContent = finalDay ? `Day ${day.day} — the last day` : `Day ${day.day} closed`;

  const tally = document.createElement('div');
  tally.className = 'debrief-tally';
  for (const [label, value, tone] of [
    ['Landed', result.landed, 'good'],
    ['Diverted', result.diverted, result.diverted > 0 ? 'warn' : 'muted'],
    ['Crashed', result.crashed, result.crashed > 0 ? 'bad' : 'muted'],
  ] as const) {
    const cell = document.createElement('div');
    cell.className = `tally-cell tone-${tone}`;
    const number = document.createElement('span');
    number.className = 'tally-number';
    number.textContent = `${value}`;
    const caption = document.createElement('span');
    caption.className = 'tally-caption';
    caption.textContent = label;
    cell.append(number, caption);
    tally.append(cell);
  }

  const money = document.createElement('p');
  money.className = 'debrief-money';
  money.textContent =
    `${result.cash >= 0 ? '+' : '−'}£${Math.abs(result.cash).toLocaleString()}` +
    `  ·  reputation ${signed(result.reputation)}`;

  // Passengers are the second scoreboard: an airport can land everything and still be
  // failing, because the terminal turned half the people away at the door.
  const people = document.createElement('p');
  people.className = 'debrief-people';
  if (result.passengersTurnedAway > 0) {
    people.classList.add('is-over');
    people.textContent =
      `${result.passengers.toLocaleString()} passengers handled · ` +
      `${result.passengersTurnedAway.toLocaleString()} turned away — the terminal is too small`;
  } else {
    people.textContent = `${result.passengers.toLocaleString()} passengers handled`;
  }

  const reasons = document.createElement('ul');
  reasons.className = 'debrief-reasons';
  if (losses.length === 0) {
    const item = document.createElement('li');
    item.className = 'reason-clean';
    item.textContent = 'Every aeroplane got down. Nothing to fix.';
    reasons.append(item);
  } else {
    for (const loss of losses) {
      const item = document.createElement('li');
      const count = document.createElement('strong');
      count.textContent = `${loss.count} lost`;
      const because = document.createElement('span');
      because.textContent = ` — ${loss.reason}`;
      const who = document.createElement('em');
      who.textContent = loss.classes;
      item.append(count, because, document.createElement('br'), who);
      reasons.append(item);
    }
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary-button';
  button.textContent = finalDay ? 'Keep the airport open' : 'Back to the drawing board';
  button.addEventListener('click', () => {
    root.hidden = true;
    root.replaceChildren();
    onContinue();
  });

  if (finalDay) {
    // The campaign has an end, but the airport does not have to. Traffic keeps arriving on
    // the day-50 schedule, so there is still a sandbox to play in afterwards.
    const closing = document.createElement('p');
    closing.className = 'debrief-closing';
    closing.textContent =
      'Fifty days from a grass field to this. The schedule holds at its heaviest from ' +
      'here, so the airport is yours to keep growing.';
    panel.append(heading, tally, money, people, closing, reasons, button);
  } else {
    panel.append(heading, tally, money, people, reasons, button);
  }
  root.replaceChildren(panel);
  root.hidden = false;
}
