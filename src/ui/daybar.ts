import { aircraftClass } from '@/content/aircraft';
import type { DayState } from '@/sim/types';

/**
 * The controls shown while a day is running: pause, speed, and how the day is going.
 *
 * Speed multipliers are free because the simulation is a fixed-step reducer — running it
 * four times per frame is the whole implementation.
 */

/*
 * 8x exists for the quiet opening of a campaign, where there is nothing to build for days at
 * a time. It is free: the loop is a fixed-step reducer, so a speed multiplier only runs
 * `stepDay` more times per frame and cannot desynchronise from what the tests exercise.
 */
export const SPEEDS = [1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

export interface DayBar {
  setPaused(paused: boolean): void;
  update(day: DayState): void;
  readonly element: HTMLElement;
}

export interface DayBarHandlers {
  onTogglePause(): void;
  onSpeed(speed: Speed): void;
}

export function createDayBar(handlers: DayBarHandlers, initialSpeed: Speed = 1): DayBar {
  const element = document.createElement('div');
  element.className = 'daybar';

  const progress = document.createElement('div');
  progress.className = 'day-progress';
  const bar = document.createElement('span');
  progress.append(bar);

  const counts = document.createElement('p');
  counts.className = 'day-counts';

  const controls = document.createElement('div');
  controls.className = 'day-controls';

  const pause = document.createElement('button');
  pause.type = 'button';
  pause.className = 'chip';
  pause.textContent = 'Pause';
  pause.addEventListener('click', handlers.onTogglePause);
  controls.append(pause);

  const speedButtons = new Map<Speed, HTMLButtonElement>();
  for (const speed of SPEEDS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = `${speed}×`;
    button.addEventListener('click', () => {
      handlers.onSpeed(speed);
      for (const [value, other] of speedButtons) {
        other.classList.toggle('is-selected', value === speed);
      }
    });
    speedButtons.set(speed, button);
    controls.append(button);
  }
  speedButtons.get(initialSpeed)?.classList.add('is-selected');

  element.append(progress, counts, controls);

  return {
    element,
    setPaused(paused) {
      pause.textContent = paused ? 'Resume' : 'Pause';
      pause.classList.toggle('is-selected', paused);
    },
    update(day) {
      // Progress through the inbound list, not through the clock. A day ends when the last
      // arrival is resolved, so a clock-based bar sat pinned at full while aeroplanes were
      // still stacking up — the exact moment the player most wants to know how far in it is.
      const fraction = day.schedule.length === 0 ? 1 : day.events.length / day.schedule.length;
      bar.style.width = `${(Math.min(1, fraction) * 100).toFixed(1)}%`;

      let landed = 0;
      let lost = 0;
      for (const event of day.events) {
        if (event.outcome === 'landed') landed += 1;
        else lost += 1;
      }

      const holding = day.aircraft.filter((a) => a.phase === 'holding');
      counts.textContent = `${landed} down · ${lost} lost · ${holding.length} holding`;

      // Someone about to run dry is the one thing worth interrupting the player for.
      const critical = holding.some(
        (a) => a.fuel / aircraftClass(a.classId).endurance < 0.25,
      );
      counts.classList.toggle('is-critical', critical);
    },
  };
}
