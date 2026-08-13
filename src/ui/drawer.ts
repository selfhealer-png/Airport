import { TERMINAL_LEVELS, TOWER_LEVELS } from '@/content/buildings';
import {
  FACILITY_COST,
  MILITARY_RUNWAY_PREMIUM,
  LEVELLED_FACILITIES,
  MIN_RUNWAY_TILES,
  ROAD_COST_PER_TILE,
  RUNWAY_COST_PER_TILE,
  STAND_COST,
  TAXIWAY_COST_PER_TILE,
} from '@/content/costs';
import { checkUpgradeFacility, explainBuildError, facilityCost, isAffordableQuote, applyUpgradeFacility, runwayCost } from '@/sim/build';
import { facilityOf } from '@/sim/airport';
import { airportAdvice, tomorrowsTraffic } from '@/sim/advice';
import type { GameState } from '@/sim/types';
import type { Tool } from './placement';

/**
 * The bottom-sheet build drawer.
 *
 * Portrait phones have very little room, so this is one scrolling row of chips rather than a
 * nested menu: every buildable thing is one tap away, and the selected chip stays lit while
 * the player drags on the map above.
 */

interface ToolChip {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly tool: Tool;
}

function chips(): ToolChip[] {
  return [
    {
      id: 'runway-grass',
      label: 'Grass strip',
      hint: `£${RUNWAY_COST_PER_TILE.grass}/tile`,
      tool: { kind: 'runway', surface: 'grass', use: 'civil' },
    },
    {
      id: 'runway-gravel',
      label: 'Gravel runway',
      hint: `£${RUNWAY_COST_PER_TILE.gravel}/tile`,
      tool: { kind: 'runway', surface: 'gravel', use: 'civil' },
    },
    {
      id: 'runway-asphalt',
      label: 'Paved runway',
      hint: `£${RUNWAY_COST_PER_TILE.asphalt}/tile`,
      tool: { kind: 'runway', surface: 'asphalt', use: 'civil' },
    },
    {
      id: 'runway-military',
      label: 'Military strip',
      hint: `£${Math.round(RUNWAY_COST_PER_TILE.asphalt * MILITARY_RUNWAY_PREMIUM)}/tile`,
      tool: { kind: 'runway', surface: 'asphalt', use: 'military' },
    },
    {
      id: 'taxiway',
      label: 'Taxiway',
      hint: `£${TAXIWAY_COST_PER_TILE}/tile`,
      tool: { kind: 'taxiway' },
    },
    {
      id: 'road',
      label: 'Road',
      hint: `£${ROAD_COST_PER_TILE}/tile`,
      tool: { kind: 'road' },
    },
    {
      id: 'stand-small',
      label: 'Small stand',
      hint: `£${STAND_COST.small}`,
      tool: { kind: 'stand', size: 'small' },
    },
    {
      id: 'stand-medium',
      label: 'Medium stand',
      hint: `£${STAND_COST.medium}`,
      tool: { kind: 'stand', size: 'medium' },
    },
    {
      id: 'stand-large',
      label: 'Large stand',
      hint: `£${STAND_COST.large.toLocaleString()}`,
      tool: { kind: 'stand', size: 'large' },
    },
    {
      id: 'tower',
      label: 'Control tower',
      hint: `£${TOWER_LEVELS[1]!.cost.toLocaleString()}`,
      tool: { kind: 'facility', type: 'tower' },
    },
    {
      id: 'terminal',
      label: 'Terminal',
      hint: `£${TERMINAL_LEVELS[1]!.cost.toLocaleString()}`,
      tool: { kind: 'facility', type: 'terminal' },
    },
    {
      id: 'fuel-farm',
      label: 'Fuel farm',
      hint: `£${FACILITY_COST['fuel-farm'].toLocaleString()}`,
      tool: { kind: 'facility', type: 'fuel-farm' },
    },
    {
      id: 'fire-station',
      label: 'Fire station',
      hint: `£${FACILITY_COST['fire-station'].toLocaleString()}`,
      tool: { kind: 'facility', type: 'fire-station' },
    },
    {
      id: 'shop',
      label: 'Shop',
      hint: `£${FACILITY_COST.shop.toLocaleString()}`,
      tool: { kind: 'facility', type: 'shop' },
    },
    { id: 'demolish', label: 'Demolish', hint: 'Part refund', tool: { kind: 'demolish' } },
  ];
}

export interface Drawer {
  /** The tool the player has selected, or null when they are just looking around. */
  readonly selected: Tool | null;
  /** What that tool is called, for telling the player what their next drag will do. */
  readonly selectedLabel: string | null;
  /** Shows the cost or the reason a placement is refused. */
  setStatus(message: string): void;
  /** Re-reads game state: affordability, upgrade availability. */
  refresh(state: GameState): void;
  clearSelection(): void;
  /**
   * The single most important thing the drawer would say, and how many warnings there are.
   *
   * The collapsed bar shows this, so hiding the drawer costs the player the detail but never
   * the signal that something is wrong.
   */
  headline(state: GameState): { text: string; warnings: number };
}

export interface DrawerHandlers {
  /**
   * Called immediately before the drawer changes the game itself — currently only facility
   * upgrades. Lets the caller record an undo point for a change it did not initiate.
   */
  onBeforeChange?: () => void;
}

export function createDrawer(
  root: HTMLElement,
  state: GameState,
  handlers: DrawerHandlers = {},
): Drawer {
  const status = document.createElement('p');
  status.className = 'drawer-status';

  const row = document.createElement('div');
  row.className = 'chip-row';

  const upgrades = document.createElement('div');
  upgrades.className = 'chip-row upgrade-row';

  // Today's booked traffic, so the player can build for what is actually coming.
  const forecast = document.createElement('div');
  forecast.className = 'forecast';

  // Advice sits above the chips because it usually tells you what to buy next.
  const advice = document.createElement('ul');
  advice.className = 'advice-list';

  root.replaceChildren(forecast, advice, status, row, upgrades);

  let selected: Tool | null = null;
  let selectedId: string | null = null;
  const buttons = new Map<string, HTMLButtonElement>();

  const paintSelection = (): void => {
    for (const [id, button] of buttons) {
      button.classList.toggle('is-selected', id === selectedId);
    }
  };

  const api: Drawer = {
    get selected() {
      return selected;
    },
    get selectedLabel() {
      return selectedId === null ? null : (chips().find((c) => c.id === selectedId)?.label ?? null);
    },
    setStatus(message) {
      status.textContent = message;
    },
    refresh(current) {
      for (const chip of chips()) {
        const button = buttons.get(chip.id);
        if (!button) continue;
        // Only a hard "you cannot afford the cheapest possible version" greys a chip out;
        // per-tile affordability is reported live while dragging instead.
        const minimum = minimumCost(chip);
        button.classList.toggle('is-unaffordable', minimum > current.cash);
      }
      renderUpgrades(current);
      renderAdvice(current);
      renderForecast(current);
    },
    headline(current) {
      const items = airportAdvice(current);
      const warnings = items.filter((a) => a.tone === 'warn').length;
      const top = items.find((a) => a.tone === 'warn') ?? items[0];
      return { text: top?.text ?? '', warnings };
    },
    clearSelection() {
      selected = null;
      selectedId = null;
      paintSelection();
      status.textContent = defaultStatus;
    },
  };

  const defaultStatus = 'Pick something to build, then drag on the field.';
  status.textContent = defaultStatus;

  for (const chip of chips()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.innerHTML = `<span class="chip-label"></span><span class="chip-hint"></span>`;
    button.querySelector('.chip-label')!.textContent = chip.label;
    button.querySelector('.chip-hint')!.textContent = chip.hint;

    button.addEventListener('click', () => {
      if (selectedId === chip.id) {
        api.clearSelection();
        return;
      }
      selected = chip.tool;
      selectedId = chip.id;
      paintSelection();
      status.textContent = `${chip.label} — ${chip.hint}`;
    });

    buttons.set(chip.id, button);
    row.append(button);
  }

  /** Today's inbound traffic, with anything the airport cannot take called out. */
  function renderForecast(current: GameState): void {
    const heading = document.createElement('p');
    heading.className = 'forecast-heading';
    heading.textContent = `Booked in for day ${current.day}`;

    const list = document.createElement('div');
    list.className = 'forecast-row';

    const entries = tomorrowsTraffic(current);
    for (const entry of entries) {
      const pill = document.createElement('span');
      pill.className = entry.problem ? 'forecast-pill is-blocked' : 'forecast-pill';
      pill.textContent = `${entry.count}x ${entry.name}`;
      if (entry.problem) pill.title = entry.problem;
      list.append(pill);
    }

    // Entries arrive most-numerous first, so the first blocked one is the aeroplane the
    // player stands to lose the most of today. That is the upgrade worth naming.
    const costliest = entries.find((entry) => entry.problem);
    const note = document.createElement('p');
    note.className = 'forecast-note';
    // On an empty field everything is blocked and saying so is just noise — the advice line
    // already tells the player to drag out a runway.
    if (costliest && current.airport.runways.length > 0) {
      note.textContent = `You cannot take the ${costliest.name.toLowerCase()}: ${costliest.problem}.`;
    }

    forecast.replaceChildren(heading, list, note);
  }

  /** Warnings about money already spent that is quietly doing nothing. */
  function renderAdvice(current: GameState): void {
    advice.replaceChildren(
      ...airportAdvice(current).map((item) => {
        const li = document.createElement('li');
        li.className = `advice advice-${item.tone}`;
        li.textContent = item.text;
        return li;
      }),
    );
  }

  /** Tower and terminal upgrade in place, so they get their own buttons once built. */
  function renderUpgrades(current: GameState): void {
    const items: HTMLElement[] = [];

    for (const type of ['tower', 'terminal'] as const) {
      const facility = facilityOf(current.airport, type);
      if (!facility) continue;

      const check = checkUpgradeFacility(current, type);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip chip-upgrade';

      const label = type === 'tower' ? 'Tower' : 'Terminal';
      const hint = isAffordableQuote(check)
        ? `£${check.cost.toLocaleString()}`
        : explainBuildError(check);
      button.innerHTML = `<span class="chip-label"></span><span class="chip-hint"></span>`;
      button.querySelector('.chip-label')!.textContent = `${label} → L${facility.level + 1}`;
      button.querySelector('.chip-hint')!.textContent = hint;
      button.disabled = !isAffordableQuote(check);

      button.addEventListener('click', () => {
        const fresh = checkUpgradeFacility(current, type);
        if (!isAffordableQuote(fresh)) return;
        handlers.onBeforeChange?.();
        applyUpgradeFacility(current, fresh, type);
        api.refresh(current);
        api.setStatus(`${label} upgraded to level ${facilityOf(current.airport, type)?.level}.`);
      });

      items.push(button);
    }

    upgrades.replaceChildren(...items);
  }

  api.refresh(state);
  return api;
}

/** The least this chip could possibly cost, used only to grey out the obviously impossible. */
function minimumCost(chip: ToolChip): number {
  switch (chip.tool.kind) {
    case 'runway':
      return runwayCost(MIN_RUNWAY_TILES, chip.tool.surface, chip.tool.use);
    case 'taxiway':
      return TAXIWAY_COST_PER_TILE;
    case 'road':
      return ROAD_COST_PER_TILE;
    case 'stand':
      return STAND_COST[chip.tool.size];
    case 'facility':
      return facilityCost(chip.tool.type, LEVELLED_FACILITIES.has(chip.tool.type) ? 1 : 0);
    case 'demolish':
      return 0;
  }
}
