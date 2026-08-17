import './ui/styles.css';
import { bakeAtlas } from '@/sprites/atlas';
import { Renderer, type BuildPreview } from '@/render/renderer';
import { centreOn, clampCamera, createCamera, deviceRatio, fitScale } from '@/render/camera';
import { attachPointerControls } from '@/input/pointer';
import { LEVEL_MEADOW } from '@/content/levels';
import { generateSchedule } from '@/content/schedule';
import { createGame } from '@/sim/airport';
import { clearGame, loadGame, saveGame } from '@/save/storage';
import { capture, createHistory } from '@/save/history';
import { explainBuildError, isAffordableQuote } from '@/sim/build';
import { SIM_DT, startDay, stepDay } from '@/sim/step';
import { createDrawer } from '@/ui/drawer';
import { createDayBar, type Speed } from '@/ui/daybar';
import { showDebrief } from '@/ui/debrief';
import { CAMPAIGN_DAYS } from '@/content/schedule';
import { commitPlacement, resolvePlacement, type Placement } from '@/ui/placement';
import { createMenu, type CurrentGame } from '@/ui/menu';
import { clearProgress, loadProgress, markCompleted } from '@/save/progress';
import { toSnapshot, restoreInto } from '@/save/snapshot';
import { LEVELS } from '@/content/levels';
import type { GamePhase, TileIndex } from '@/sim/types';

/**
 * Start-up failures are invisible on a phone, so anything thrown here is put on screen
 * instead of vanishing into a console nobody can open.
 */
function reportFatal(error: unknown): void {
  const pre = document.querySelector<HTMLElement>('#crash');
  if (!pre) return;
  pre.hidden = false;
  pre.textContent = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
}

window.addEventListener('error', (event) => reportFatal(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportFatal(event.reason));

/**
 * Picks up a new version on the first launch after a deploy rather than the second.
 *
 * The service worker claims the page as soon as it activates, but nothing was reloading — so
 * a launch would install the new build and carry on showing the old one, and only the launch
 * after that looked any different. On a phone, where the app is opened and dismissed rather
 * than refreshed, that reads as the update simply not having worked.
 *
 * Guarded on there already being a controller, because `clientsClaim` also fires this the
 * very first time the worker takes over a page that had none — reloading then would be a
 * pointless flash on a player's first ever visit.
 */
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

/** Real seconds a single frame may contribute, so a backgrounded tab cannot fast-forward a day. */
const MAX_FRAME_SECONDS = 0.25;

function start(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#map');
  const wrap = document.querySelector<HTMLElement>('#map-wrap');
  const drawerRoot = document.querySelector<HTMLElement>('#drawer');
  const modalRoot = document.querySelector<HTMLElement>('#modal');
  const menuRoot = document.querySelector<HTMLElement>('#menu');
  const titleButton = document.querySelector<HTMLElement>('#hud-title');
  const cashLabel = document.querySelector<HTMLElement>('#hud-cash');
  const dayLabel = document.querySelector<HTMLElement>('#hud-day');
  if (
    !canvas || !wrap || !drawerRoot || !modalRoot || !menuRoot ||
    !titleButton || !cashLabel || !dayLabel
  ) {
    throw new Error('App shell is missing an expected element.');
  }

  const drawerHost = drawerRoot;
  const modalHost = modalRoot;
  const menuHost = menuRoot;
  const title = titleButton;
  const cash = cashLabel;
  const dayText = dayLabel;

  // A previous session's airport, or a new field if there is nothing to restore.
  const state = loadGame() ?? createGame(LEVEL_MEADOW, 42);
  const camera = createCamera();
  const renderer = new Renderer(canvas, bakeAtlas());

  const history = createHistory();

  /*
   * The planning UI is in two halves.
   *
   * `planningBar` is always on screen: open the airport, undo, and a toggle for everything
   * else. `planningBody` — the forecast, the advice and every build chip — is hidden until
   * asked for, because on a phone it was taking half the screen and the map is the thing
   * being played. The bar still carries the top warning, so collapsing costs the detail but
   * never the signal.
   */
  const planningBody = document.createElement('div');
  planningBody.className = 'drawer-body';
  const drawer = createDrawer(planningBody, state, {
    onBeforeChange: () => history.push(capture(state)),
    /*
     * Arming a tool collapses the drawer to a full-size map.
     *
     * The tool deliberately stays armed — see `paintShell()` — so this is exactly what
     * tapping `Close` already did, and the player had to do it manually every single time:
     * pick a chip, then reach for a second button before there was any map worth drawing on.
     * The bar's toggle, now labelled with the armed tool, is the way back in.
     */
    onToolArmed: () => setExpanded(false),
  });

  const planningPanel = document.createElement('div');
  const planningBar = document.createElement('div');
  planningBar.className = 'drawer-bar';

  const hint = document.createElement('button');
  hint.type = 'button';
  hint.className = 'drawer-hint';

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'chip chip-toggle';

  const undoButton = document.createElement('button');
  undoButton.type = 'button';
  undoButton.className = 'chip chip-undo';
  undoButton.textContent = 'Undo';

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'primary-button';
  openButton.textContent = 'Open the airport';
  openButton.addEventListener('click', beginDay);

  let expanded = false;

  const paintShell = (): void => {
    planningBody.hidden = !expanded;
    undoButton.disabled = !history.canUndo;

    /*
     * A tool stays armed when the drawer closes, and the bar says so.
     *
     * Clearing it on close seemed safer, but it made the drawer unusable on a phone: the only
     * way to build was to pick a chip and then drag on whatever sliver of map the open drawer
     * had left. Now the player arms a tool, closes for a full-size map, and draws on it —
     * and if a stray drag builds something, Undo is right there.
     */
    const armed = expanded ? null : drawer.selectedLabel;
    toggleButton.textContent = expanded ? 'Close' : (armed ?? 'Build');
    toggleButton.classList.toggle('is-selected', expanded || armed !== null);

    const { text, warnings } = drawer.headline(state);
    const message = armed ? `Placing ${armed.toLowerCase()} — drag on the map.` : text;
    // The hint is the collapsed view's whole teaching channel, so it is only hidden when
    // there is genuinely nothing to say.
    hint.hidden = expanded || message === '';
    hint.textContent = message;
    hint.classList.toggle('is-warn', !armed && warnings > 0);
    toggleButton.classList.toggle('has-warnings', !expanded && !armed && warnings > 0);
  };

  const setExpanded = (next: boolean): void => {
    expanded = next;
    paintShell();
  };

  toggleButton.addEventListener('click', () => setExpanded(!expanded));
  hint.addEventListener('click', () => setExpanded(true));

  undoButton.addEventListener('click', () => {
    if (!history.undo(state)) return;
    // The layout changed underneath the current drag, so anything in flight is now stale.
    drawer.clearSelection();
    placement = null;
    dragFrom = null;
    drawer.refresh(state);
    updateHud();
    paintShell();
    report('Undone.');
    saveGame(state);
  });

  /*
   * Start over asks twice. On a phone the drawer is under the thumb, and a single stray tap
   * that wipes an hour of progress is unforgivable; the confirmation lapses on its own so it
   * cannot be left armed.
   */
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'text-button';
  resetButton.textContent = 'Start over';
  let resetArmed: ReturnType<typeof setTimeout> | null = null;
  /*
   * Reloading fires `pagehide`, and the autosave listener there would write the still-loaded
   * game straight back over the save we just deleted. This latch stops the wipe undoing
   * itself.
   */
  let wiping = false;

  const disarmReset = (): void => {
    if (resetArmed) clearTimeout(resetArmed);
    resetArmed = null;
    resetButton.textContent = 'Start over';
    resetButton.classList.remove('is-armed');
  };

  resetButton.addEventListener('click', () => {
    if (!resetArmed) {
      resetButton.textContent = 'Tap again to wipe this airport';
      resetButton.classList.add('is-armed');
      resetArmed = setTimeout(disarmReset, 4000);
      return;
    }
    disarmReset();
    // Only this level's game goes. Unlocks live on their own key precisely so that finishing
    // a level is never undone by starting again.
    clearGame();
    showMenu();
  });

  planningBody.append(resetButton);
  planningBar.append(toggleButton, undoButton, openButton);
  planningPanel.append(hint, planningBar, planningBody);

  // 2x by default: at 1x a busy day is a long watch, and the interesting decisions are all
  // in the planning phase. The choice persists across days once the player changes it.
  const DEFAULT_SPEED: Speed = 2;
  let speed: Speed = DEFAULT_SPEED;
  let paused = false;
  const dayBar = createDayBar({
    onTogglePause() {
      paused = !paused;
      dayBar.setPaused(paused);
    },
    onSpeed(next) {
      speed = next;
    },
  }, DEFAULT_SPEED);

  let dragFrom: TileIndex | null = null;
  let placement: Placement | null = null;
  /** False until the player pans or zooms; while false the map keeps re-fitting itself. */
  let framed = false;
  let accumulator = 0;
  let lastFrame = performance.now();

  /*
   * The map re-frames itself to fit until the player first pans or zooms, and never again
   * after that.
   *
   * Framing only on the very first layout was too early: the drawer is populated after the
   * canvas is measured, so the map was fitted to a viewport a good eighty pixels taller than
   * the one it ended up with — about five tiles' worth, which then hung off the bottom with
   * no way to zoom out. iOS makes it worse, resolving safe-area insets and the standalone
   * viewport a beat after first paint.
   *
   * Re-framing on *every* resize is the opposite mistake: opening the build drawer would
   * throw away wherever the player had panned to. Tying it to whether they have taken control
   * gets both — the layout can settle however it likes on the way in, and the moment they
   * touch the map it is theirs.
   */
  const relayout = (): void => {
    if (!renderer.resize()) return;
    const { width, height } = renderer.viewport;

    if (!framed) {
      camera.scale = fitScale(state.airport.map, width, height, deviceRatio());
      centreOn(camera, state.airport.map, width, height);
      return;
    }

    clampCamera(camera, state.airport.map, width, height);
  };

  new ResizeObserver(relayout).observe(wrap);
  relayout();

  function showPlanning(): void {
    drawerHost.replaceChildren(planningPanel);
    drawer.refresh(state);
    paintShell();
    updateHud();
  }

  /**
   * Every level plays the same fifty days.
   *
   * Identical traffic across maps makes the terrain the only variable, which suits a game
   * whose whole claim is that you are tested on your airport and not on your luck. A per-level
   * seed is a one-line change if that stops being true.
   */
  const SEED = 42;

  /** True while the menu is up, so the autosave does not write a game nobody is playing. */
  let inMenu = false;

  const currentGame = (): CurrentGame | null => {
    const saved = loadGame();
    return saved ? { levelId: saved.airport.map.id, day: saved.day } : null;
  };

  const menu = createMenu(menuHost, {
    onPlay: (levelId) => enterLevel(levelId),
    onResetEverything: () => {
      wiping = true;
      clearGame();
      clearProgress();
      window.location.reload();
    },
  });

  /*
   * The level name is the way back. Leaving mid-day loses that day — but so does a reload,
   * because a day in progress is deliberately never saved, so this is the existing rule
   * rather than a new one.
   */
  title.addEventListener('click', () => {
    if (state.phase === 'planning') saveGame(state);
    showMenu();
  });

  function showMenu(): void {
    inMenu = true;
    menu.refresh(loadProgress(), currentGame());
    menuHost.hidden = false;
  }

  /**
   * Starts or resumes a level.
   *
   * Restores *into* the existing state rather than swapping in a new object: the render loop,
   * the pointer handlers and the drawer all closed over this one when they were wired up, so
   * replacing it would leave them driving a game nobody can see. That is the same reason undo
   * works this way.
   */
  function enterLevel(levelId: string): void {
    const map = LEVELS.find((level) => level.id === levelId);
    if (!map) return;

    const saved = loadGame();
    // Built through `toSnapshot` even for a fresh game, so entering a level goes down exactly
    // the same path as loading one — `restoreInto` validates it either way.
    const snapshot =
      saved && saved.airport.map.id === levelId
        ? toSnapshot(saved)
        : toSnapshot(createGame(map, SEED));
    if (!restoreInto(state, snapshot)) return;

    history.clear();
    drawer.clearSelection();
    placement = null;
    dragFrom = null;
    // Levels may differ in size, so the map has to re-fit itself; without this the new field
    // is drawn at the previous one's zoom and offset, with nothing to explain why.
    framed = false;
    relayout();

    // Stepping stops the moment `inMenu` goes true, so this is normally near zero already —
    // but a stale fractional-day's worth of accumulated time must never carry into a day that
    // has not started yet, restored or otherwise.
    accumulator = 0;

    inMenu = false;
    menuHost.hidden = true;
    saveGame(state);
    showPlanning();
  }

  function beginDay(): void {
    drawer.clearSelection();
    placement = null;
    dragFrom = null;
    paused = false;
    accumulator = 0;
    dayBar.setPaused(false);

    // Undo does not reach back across a day: the schedule has run and the money has moved,
    // so there is no coherent state to return to.
    history.clear();
    setExpanded(false);

    // Saved before the day rather than during it: a day in progress is not persisted, so a
    // reload drops the player back into planning for this same day.
    saveGame(state);
    startDay(state, generateSchedule(state.day, state.seed));
    drawerHost.replaceChildren(dayBar.element);
    if (state.current) dayBar.update(state.current);
  }

  function finishDay(): void {
    const day = state.current;
    if (!day) return;
    const finalDay = state.day >= CAMPAIGN_DAYS;
    showDebrief(
      modalHost,
      day,
      () => {
        // Recorded on dismissal of day 50, and idempotent: the campaign carries on as a
        // sandbox afterwards, so every later day satisfies this too.
        if (finalDay) markCompleted(state.airport.map.id);
        state.day += 1;
        state.phase = 'planning';
        state.current = null;
        saveGame(state);
        showPlanning();
      },
      finalDay,
      { landedTotal: state.landedTotal, scheduledTotal: state.scheduledTotal },
    );
  }

  const describe = (current: Placement): string => {
    if (isAffordableQuote(current.check)) {
      const { cost } = current.check;
      const price =
        cost < 0 ? `Refund £${Math.abs(cost).toLocaleString()}` : `£${cost.toLocaleString()}`;
      // Extending a runway and laying a new one look identical on the map, so when the drag
      // is doing something other than the obvious the status says which.
      return current.summary ? `${current.summary} — ${price}` : price;
    }
    return explainBuildError(current.check);
  };

  /**
   * The running cost of a drag has to be visible whether the drawer is open or shut.
   *
   * The status line lives inside the panel, so with the drawer closed — which is how it is
   * built to be used — the player was dragging out a runway with no idea what it would cost
   * until the money had already gone.
   */
  const report = (message: string): void => {
    drawer.setStatus(message);
    if (!expanded) {
      hint.hidden = false;
      hint.textContent = message;
    }
  };

  const updatePlacement = (to: TileIndex): void => {
    const tool = drawer.selected;
    if (!tool || !dragFrom) return;
    placement = resolvePlacement(state, tool, dragFrom, to);
    report(describe(placement));
  };

  /**
   * Money moves during a day without anything else on screen changing, so the figure flashes
   * in the direction it moved. Without it a fare landing and a crash penalty look identical.
   */
  let shownCash = state.cash;

  function updateHud(): void {
    if (state.cash !== shownCash) {
      cash.classList.remove('is-up', 'is-down');
      // Reading offsetWidth restarts the animation; without it a second change in quick
      // succession would not replay it.
      void cash.offsetWidth;
      cash.classList.add(state.cash > shownCash ? 'is-up' : 'is-down');
      shownCash = state.cash;
    }
    cash.textContent = `£${state.cash.toLocaleString()}`;
    title.textContent = state.airport.map.name;
    dayText.textContent = `Day ${state.day}`;
  }

  attachPointerControls(canvas, camera, {
    // Building is only possible while planning; during a day the map is a spectacle.
    isBuilding: () => state.phase === 'planning' && drawer.selected !== null,
    onBuildStart(tile) {
      dragFrom = tile;
      updatePlacement(tile);
    },
    onBuildMove(tile) {
      updatePlacement(tile);
    },
    onCameraMoved() {
      framed = true;
    },
    onBuildEnd() {
      const tool = drawer.selected;
      // Captured before the commit and only kept if the commit happened, so a refused
      // placement never leaves a do-nothing entry on the undo stack.
      const before = tool && placement ? capture(state) : null;
      if (tool && placement && commitPlacement(state, tool, placement)) {
        if (before) history.push(before);
        drawer.refresh(state);
        updateHud();
        report(tool.kind === 'demolish' ? 'Removed.' : 'Built.');
        saveGame(state);
      } else if (placement) {
        report(describe(placement));
      }
      dragFrom = null;
      placement = null;
    },
  });

  window.addEventListener('orientationchange', relayout);

  // Phones kill backgrounded tabs without warning; `pagehide` and a hidden `visibilitychange`
  // are the last reliable moments to write.
  const persist = (): void => {
    if (wiping) return;
    // Nothing to save from the menu, and writing here would resurrect a game the player has
    // just abandoned with Start over — the same hazard the `wiping` latch exists for.
    if (inMenu) return;
    if (state.phase === 'planning') saveGame(state);
  };
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
  });

  const frame = (now: number): void => {
    const elapsed = Math.min((now - lastFrame) / 1000, MAX_FRAME_SECONDS);
    lastFrame = now;

    const phase = (): GamePhase => state.phase;

    // The menu covers the map, so stepping behind it is work nobody can see — and if a day
    // finished while it was up, `finishDay()` would fire every frame against a `#modal` the
    // menu occludes, raising a debrief nothing can ever dismiss.
    if (phase() === 'day' && !paused && !inMenu) {
      // Fixed-step: the speed multiplier just runs the reducer more times per frame, which
      // is why 4x cannot desynchronise the simulation from what the tests exercise.
      accumulator += elapsed * speed;
      while (accumulator >= SIM_DT) {
        stepDay(state, SIM_DT);
        accumulator -= SIM_DT;
        if (phase() !== 'day') break;
      }
      if (state.current) dayBar.update(state.current);
      updateHud();
      if (phase() === 'debrief') finishDay();
    }

    const preview: BuildPreview | undefined = placement
      ? { tiles: placement.tiles, valid: isAffordableQuote(placement.check) }
      : undefined;
    renderer.draw(state, camera, preview);
    requestAnimationFrame(frame);
  };

  showPlanning();
  showMenu();
  requestAnimationFrame(frame);
}

try {
  start();
} catch (error) {
  reportFatal(error);
}
