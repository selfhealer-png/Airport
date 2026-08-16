import { LEVELS } from '@/content/levels';
import { isUnlocked } from '@/save/progress';
import type { LevelMap } from '@/sim/types';

/**
 * The level menu.
 *
 * What each row offers is a pure function of the levels, what has been finished and what game
 * exists — kept out of the DOM so the campaign's rules can be tested headlessly, the same way
 * `ui/placement.ts` keeps drag behaviour testable.
 */

export type MenuRowState = 'locked' | 'start' | 'continue' | 'replay';

export interface CurrentGame {
  readonly levelId: string;
  readonly day: number;
}

export interface MenuRow {
  readonly levelId: string;
  readonly name: string;
  readonly state: MenuRowState;
  /** Whether this level has ever been finished. Independent of `state`. */
  readonly completed: boolean;
  /**
   * Whether tapping this row would destroy the game in progress, and must therefore ask
   * twice. There is one game at a time, so anything but carrying on the current one does.
   */
  readonly confirms: boolean;
  /** The day the in-progress game is on. Present only when `state` is `'continue'`. */
  readonly day?: number;
  /** The level that would unlock this one. Present only when `state` is `'locked'`. */
  readonly unlockedBy?: string;
}

export function menuRows(
  levels: readonly LevelMap[],
  completed: readonly string[],
  current: CurrentGame | null,
): MenuRow[] {
  return levels.map((level, index) => {
    const isCompleted = completed.includes(level.id);
    const holdsGame = current?.levelId === level.id;

    if (!isUnlocked(level.id, completed)) {
      // `exactOptionalPropertyTypes` is on, so an absent field is omitted, never undefined.
      const previous = levels[index - 1];
      return {
        levelId: level.id,
        name: level.name,
        state: 'locked' as const,
        completed: isCompleted,
        confirms: false,
        ...(previous ? { unlockedBy: previous.name } : {}),
      };
    }

    if (holdsGame && current) {
      // In-progress beats completed: offering "play again" here would discard the game.
      return {
        levelId: level.id,
        name: level.name,
        state: 'continue' as const,
        completed: isCompleted,
        confirms: false,
        day: current.day,
      };
    }

    return {
      levelId: level.id,
      name: level.name,
      state: isCompleted ? ('replay' as const) : ('start' as const),
      completed: isCompleted,
      confirms: current !== null,
    };
  });
}

export interface MenuHandlers {
  onPlay(levelId: string): void;
  onResetEverything(): void;
}

export interface Menu {
  refresh(completed: readonly string[], current: CurrentGame | null): void;
}

/** What a row's second line says, given its state. */
function describeRow(row: MenuRow): string {
  switch (row.state) {
    case 'locked':
      return row.unlockedBy ? `Locked — finish ${row.unlockedBy} first` : 'Locked';
    case 'continue':
      return `Continue — day ${row.day ?? 1}`;
    case 'replay':
      return '✓ Completed · Play again';
    case 'start':
      return 'Start';
  }
}

/**
 * Renders the menu into `root`.
 *
 * Rebuilt wholesale on every `refresh` rather than patched. It is a handful of buttons shown
 * between games, so the simplicity is worth more than the churn — and it means the arming
 * state below cannot survive a refresh by accident.
 */
export function createMenu(root: HTMLElement, handlers: MenuHandlers): Menu {
  /*
   * Replacing an airport asks twice, the way "Start over" does.
   *
   * On a phone a single stray tap must not destroy an hour of building, and the confirmation
   * lapses on its own so it can never be left armed.
   */
  let armed: string | null = null;
  let armedTimer: ReturnType<typeof setTimeout> | null = null;

  const disarm = (): void => {
    if (armedTimer) clearTimeout(armedTimer);
    armedTimer = null;
    armed = null;
  };

  const api: Menu = {
    refresh(completed, current) {
      /*
       * A re-render invalidates any pending confirmation: the wiring layer may call refresh()
       * with fresher state while a row is still armed, and the old timer must not survive to
       * fire later and repaint this stale-data render over it. Cancel it up front, every time.
       */
      if (armedTimer) clearTimeout(armedTimer);
      armedTimer = null;

      const panel = document.createElement('div');
      panel.className = 'menu-panel';

      const title = document.createElement('h1');
      title.className = 'menu-title';
      title.textContent = 'Airfield';

      const sub = document.createElement('p');
      sub.className = 'menu-sub';
      sub.textContent = 'Build the airport so the aeroplanes can land.';

      const levelsHeading = document.createElement('p');
      levelsHeading.className = 'menu-heading';
      levelsHeading.textContent = 'Levels';

      panel.append(title, sub, levelsHeading);

      for (const row of menuRows(LEVELS, completed, current)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu-row';
        button.disabled = row.state === 'locked';
        button.classList.toggle('is-armed', armed === row.levelId);

        const name = document.createElement('span');
        name.className = 'menu-row-name';
        name.textContent = row.name;

        const state = document.createElement('span');
        state.className = 'menu-row-state';
        state.textContent =
          armed === row.levelId ? 'Tap again — this replaces your airport' : describeRow(row);

        button.append(name, state);
        button.addEventListener('click', () => {
          if (!row.confirms) {
            disarm();
            handlers.onPlay(row.levelId);
            return;
          }
          if (armed === row.levelId) {
            disarm();
            handlers.onPlay(row.levelId);
            return;
          }
          disarm();
          armed = row.levelId;
          // Scheduled after the render call below, not before: refresh() cancels any
          // in-flight timer as its first act, and this one must survive to arm the row.
          api.refresh(completed, current);
          armedTimer = setTimeout(() => {
            disarm();
            api.refresh(completed, current);
          }, 4000);
        });

        panel.append(button);
      }

      // Visible rather than absent, so it reads as a promise instead of a gap.
      const scenarios = document.createElement('p');
      scenarios.className = 'menu-heading';
      scenarios.textContent = 'Scenarios';

      const soon = document.createElement('button');
      soon.type = 'button';
      soon.className = 'menu-row';
      soon.disabled = true;
      const soonName = document.createElement('span');
      soonName.className = 'menu-row-name';
      soonName.textContent = 'Scenarios';
      const soonState = document.createElement('span');
      soonState.className = 'menu-row-state';
      soonState.textContent = 'Coming later';
      soon.append(soonName, soonState);

      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'text-button';
      reset.textContent = 'Reset everything';
      let resetArmed: ReturnType<typeof setTimeout> | null = null;
      reset.addEventListener('click', () => {
        if (!resetArmed) {
          reset.textContent = 'Tap again to wipe every level';
          reset.classList.add('is-armed');
          resetArmed = setTimeout(() => {
            resetArmed = null;
            reset.textContent = 'Reset everything';
            reset.classList.remove('is-armed');
          }, 4000);
          return;
        }
        clearTimeout(resetArmed);
        handlers.onResetEverything();
      });

      panel.append(scenarios, soon, reset);
      root.replaceChildren(panel);
    },
  };

  return api;
}
