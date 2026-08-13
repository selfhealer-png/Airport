import type { SpriteSource } from './pixels';

/**
 * Every sprite in the game, authored as grids of palette keys, one character per pixel.
 * See `palette.ts` for the key meanings; `.` is transparent.
 *
 * Two size rules, both checked by `tests/sprites.test.ts`:
 *
 * - Everything that sits on the map is exactly one tile, 16x16.
 * - Aircraft are one tile wide and a whole number of tiles long, so a narrowbody is
 *   visibly twice the aeroplane a light single is. Size *is* the progression, and the
 *   player should be able to see it at a glance without reading the HUD.
 *
 * Runway markings are transparent overlays rather than baked into an asphalt tile, so the
 * same dashes and thresholds work over grass, gravel and asphalt alike.
 */

// --- Terrain ---------------------------------------------------------------------------

const GRASS_A: SpriteSource = [
  'gggggggggggggggg',
  'ggghgggggggggggg',
  'gggggggggggGgggg',
  'gggggggggggggggg',
  'gggggggggghggggg',
  'ggGggggggggggggg',
  'gggggggggggggggg',
  'ggggggghggggggGg',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'gghggggggGgggggg',
  'gggggggggggggggg',
  'ggggggggggggghgg',
  'gggGgggggggggggg',
  'gggggggggggggggg',
  'ggggggggggggggGg',
];

const GRASS_B: SpriteSource = [
  'gggggggggggggggg',
  'gggggggghggggggg',
  'ggGgggggggggghgg',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'ggggghgggggGgggg',
  'gggggggggggggggg',
  'ggggggggggggggGg',
  'ghgggggggggggggg',
  'gggggggggGgggggg',
  'gggggggggggggggg',
  'gggggghggggggggg',
  'ggGggggggggggggg',
  'gggggggggggggggg',
  'gggggggggghggggg',
  'gggggggggggggggg',
];

/**
 * A third variant carrying one clump of wildflowers. Deliberately a single clump in a
 * single corner: scattered across the tile it tiles into a speckle that reads as static,
 * and the renderer keeps this variant rare for the same reason.
 */
const GRASS_C: SpriteSource = [
  'gggggggggggggggg',
  'ggggggggghgggggg',
  'gggggggggggggggg',
  'ggGggggggggggggg',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'ggggggggggggggGg',
  'gggghggggggggggg',
  'gggggggggggggggg',
  'gggzgggggggggggg',
  'ggzzzggggggggggg',
  'gggzgggggggggGgg',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'ggggGggggggggggg',
];

/** A clump of trees. Unbuildable ground that still reads as a field, not a wall. */
const WOODS: SpriteSource = [
  'ggggggFFgggggggg',
  'gggggFFFFggggggg',
  'ggFFgFFFFFgggFFg',
  'gFFFFFffFFFggFFF',
  'FFFffFFFFFFFgFFF',
  'FFfffFFffFFFFFff',
  'gFFffFFfffFFFfff',
  'ggFFgTTfffFFgffg',
  'gggggTTgFFggggFF',
  'ggFFFggggFFFFFFF',
  'gFFFFFggFFFfffFF',
  'FFFfffFgFFfffffg',
  'FFfffffgggTTffgg',
  'gFTTfffgggTTgggg',
  'ggTTgFggggggggGg',
  'gggggggggggggggg',
];

const GRAVEL: SpriteSource = [
  'dddddddddddddddd',
  'ddDddddddddDdddd',
  'dddddddddddddddd',
  'ddddddDddddddddd',
  'dddddddddddddDdd',
  'dddddddddddddddd',
  'dDdddddddddddddd',
  'dddddddDdddddddd',
  'dddddddddddddddd',
  'ddddddddddddDddd',
  'dddDdddddddddddd',
  'dddddddddddddddd',
  'ddddddddDddddddd',
  'dddddddddddddddd',
  'ddDdddddddddDddd',
  'dddddddddddddddd',
];

const ASPHALT: SpriteSource = [
  'aaaaaaaaaaaaaaaa',
  'aaaAaaaaaaaaaaaa',
  'aaaaaaaaaaaAaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaAaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aAaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaAa',
  'aaaaaaaaaaaaaaaa',
  'aaaaAaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaAaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaAaaaaaaaaaaaaa',
  'aaaaaaaaaaaAaaaa',
  'aaaaaaaaaaaaaaaa',
];

const WATER: SpriteSource = [
  'wwwwwwwwwwwwwwww',
  'wwwwWWwwwwwwwwww',
  'wwwwwwwwwwWWwwww',
  'wwwwwwwwwwwwwwww',
  'wWWwwwwwwwwwwwww',
  'wwwwwwwwWWwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwWWww',
  'wwWWwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwWWwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwWWwwww',
  'wWWwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwWWwwwwwww',
];

const ROCK: SpriteSource = [
  'ggggggrrrrgggggg',
  'gggggrrccrrggggg',
  'ggggrrccccrrgggg',
  'gggrrccRRccrrggg',
  'ggrrrcRRRRcrrrgg',
  'grrrrRRRRRRrrrrg',
  'rrrcrRRRRRRrcrrr',
  'rrccRRRRRRRRccrr',
  'rrRRRRRRRRRRRRrr',
  'rRRRRRRccRRRRRRr',
  'RRRRRRcccRRRRRRR',
  'RRRRRRRRRRRRRRRR',
  'RRRRRccRRRRRRRRR',
  'RRRRRRRRRRRccRRR',
  'RRRRRRRRRRRRRRRR',
  'RRRRRRRRRRRRRRRR',
];

// --- Runway surfaces and markings -------------------------------------------------------

/**
 * Mown grass. Deliberately a lighter, yellower green than the surrounding field — at the
 * zoom levels a phone actually uses, a strip that only differs by texture disappears, and
 * the player cannot see the runway they just paid for.
 */
const SURFACE_GRASS: SpriteSource = Array.from({ length: 16 }, () => 'MMNNMMNNMMNNMMNN');

/**
 * Centreline dashes with white edge lines. Transparent, laid over whichever surface the
 * runway is built from. The edge lines are what make a grass strip read as a runway rather
 * than as slightly different grass.
 */
const RUNWAY_CENTRELINE: SpriteSource = [
  '.m............m.',
  '.m............m.',
  '.m.....mm.....m.',
  '.m.....mm.....m.',
  '.m.....mm.....m.',
  '.m.....mm.....m.',
  '.m.....mm.....m.',
  '.m.....mm.....m.',
  '.m............m.',
  '.m............m.',
  '.m.....mm.....m.',
  '.m.....mm.....m.',
  '.m.....mm.....m.',
  '.m.....mm.....m.',
  '.m.....mm.....m.',
  '.m.....mm.....m.',
];

/**
 * Military markings. Same geometry as the civil ones so a strip still reads as a runway at a
 * glance, but in hazard yellow rather than white — the player has to be able to tell at a
 * distance which of their strips an inbound can actually use.
 */
const RUNWAY_CENTRELINE_MILITARY: SpriteSource = RUNWAY_CENTRELINE.map((row) =>
  row.replaceAll('m', 'y'),
);

/** Threshold piano keys, drawn on the first and last tile of a runway. */
const RUNWAY_THRESHOLD: SpriteSource = [
  '.m............m.',
  '.m............m.',
  '.mm.mm.mm.mm.mm.',
  '.mm.mm.mm.mm.mm.',
  '.mm.mm.mm.mm.mm.',
  '.mm.mm.mm.mm.mm.',
  '.mm.mm.mm.mm.mm.',
  '.mm.mm.mm.mm.mm.',
  '.m............m.',
  '.m............m.',
  '.m............m.',
  '.m............m.',
  '.m............m.',
  '.m............m.',
  '.m............m.',
  '.m............m.',
];

const RUNWAY_THRESHOLD_MILITARY: SpriteSource = RUNWAY_THRESHOLD.map((row) =>
  row.replaceAll('m', 'y'),
);

// --- Built things ------------------------------------------------------------------------

/**
 * Taxiway base. The yellow guide line is drawn procedurally in the renderer from the
 * neighbours a tile actually has, so runs, corners and junctions all join up without
 * authoring a sprite for each of the sixteen combinations.
 */
const TAXIWAY: SpriteSource = [
  'AAAAAAAAAAAAAAAA',
  'AaaaaaaaaaaaaaaA',
  'AaaaaaaaaaaAaaaA',
  'AaaaaaaaaaaaaaaA',
  'AaaaaaAaaaaaaaaA',
  'AaaaaaaaaaaaaaaA',
  'AaaaaaaaaaaaaaaA',
  'AaaaaaaaaaaaaaaA',
  'AaaaaaaaaaaaaaaA',
  'AaaaAaaaaaaaaaaA',
  'AaaaaaaaaaaaaaaA',
  'AaaaaaaaaAaaaaaA',
  'AaaaaaaaaaaaaaaA',
  'AaAaaaaaaaaaaaaA',
  'AaaaaaaaaaaAaaaA',
  'AAAAAAAAAAAAAAAA',
];

/**
 * Road base. Narrower and darker than a taxiway, with a verge on each side, so the landside
 * network reads as a different kind of surface at a glance rather than as taxiway that has
 * gone the wrong way. The white centre line is drawn procedurally, like the taxiway's.
 */
const ROAD: SpriteSource = [
  'GGssssssssssssGG',
  'GGssssssssssssGG',
  'GGssssssssssssGG',
  'GGssssssssssssGG',
  'GGssssssssssssGG',
  'GGssssssssssssGG',
  'GGssssssssssssGG',
  'GGssssssssssssGG',
  'GGssssssssssssGG',
  'GGssssssssssssGG',
  'GGssssssssssssGG',
  'GGssssssssssssGG',
  'GGssssssssssssGG',
  'GGssssssssssssGG',
  'GGssssssssssssGG',
  'GGssssssssssssGG',
];

/**
 * Stands. The painted box widens with the size class, so the apron is readable at a glance
 * and an aeroplane parked on the wrong size looks wrong.
 */
function stand(barWidth: number): SpriteSource {
  const pad = (16 - 2 - barWidth) / 2;
  const bar = `C${'c'.repeat(pad)}${'y'.repeat(barWidth)}${'c'.repeat(pad)}C`;
  const stem = `C${'c'.repeat(6)}yy${'c'.repeat(6)}C`;
  const plain = `C${'c'.repeat(14)}C`;
  const corner = `Cyy${'c'.repeat(10)}yyC`;
  const edge = 'C'.repeat(16);
  return [
    edge,
    corner,
    plain,
    bar,
    stem,
    stem,
    stem,
    stem,
    stem,
    stem,
    plain,
    plain,
    plain,
    plain,
    corner,
    edge,
  ];
}

const TOWER: SpriteSource = [
  '................',
  '.......y........',
  '.....ssssss.....',
  '.....sqQQqs.....',
  '.....sqQQqs.....',
  '.....ssssss.....',
  '......scss......',
  '......scss......',
  '......scss......',
  '......scss......',
  '.....cccccc.....',
  '....cccccccc....',
  '....cCLLLLCc....',
  '....cccccccc....',
  '....cCCCCCCc....',
  '................',
];

const TERMINAL: SpriteSource = [
  '................',
  '..CCCCCCCCCCCC..',
  '..CccccccccccC..',
  '..CcLqcLqcLqcC..',
  '..CccccccccccC..',
  '..CcqLcqLcqLcC..',
  '..CccccccccccC..',
  '..CCCCCCCCCCCC..',
  '..cccccccccccc..',
  '..cCCCCCCCCCCc..',
  '..cccccccccccc..',
  '..cyycyycyycyc..',
  '..cccccccccccc..',
  '................',
  '................',
  '................',
];

const FUEL_FARM: SpriteSource = [
  '................',
  '..cccc....cccc..',
  '..cCCc....cCCc..',
  '..cCCc....cCCc..',
  '..cCCc....cCCc..',
  '..cccc....cccc..',
  '.....CCCCCC.....',
  '....oooooooo....',
  '....oCCCCCCo....',
  '....oooooooo....',
  '.....CCCCCC.....',
  '..cccc....cccc..',
  '..cCCc....cCCc..',
  '..cccc....cccc..',
  '................',
  '................',
];

/** A retail unit. Reads as a smaller, brighter relative of the terminal it must sit beside. */
const SHOP: SpriteSource = [
  '................',
  '................',
  '...CCCCCCCCCC...',
  '...CjjjjjjjjC...',
  '...CccccccccC...',
  '...CqLccccLqC...',
  '...CqLccccLqC...',
  '...CccccccccC...',
  '...CCCCCCCCCC...',
  '...cccccccccc...',
  '...cyyccccyyc...',
  '...cccccccccc...',
  '................',
  '................',
  '................',
  '................',
];

const FIRE_STATION: SpriteSource = [
  '................',
  '..nnnnnnnnnnnn..',
  '..nvvvvvvvvvvn..',
  '..nvnnvvnnvvvn..',
  '..nnnnnnnnnnnn..',
  '..cccccccccccc..',
  '..cssccssccssc..',
  '..cssccssccssc..',
  '..cssccssccssc..',
  '..cccccccccccc..',
  '..cyycccccyycc..',
  '..cccccccccccc..',
  '................',
  '................',
  '................',
  '................',
];

// --- Aircraft ------------------------------------------------------------------------------

/**
 * Aircraft are drawn nose-up and rotated in quarter turns, which is the only rotation that
 * stays pixel-exact — so one sprite covers all four directions of travel.
 *
 * These are *silhouette families*, not classes. Several aircraft classes share a family and
 * are told apart by size and livery, which is what lets the fleet grow across a long campaign
 * without every new class needing new pixel art.
 */

/** Light single piston. One tile — the smallest thing that flies. */
const PLANE_SINGLE: SpriteSource = [
  '................',
  '................',
  '.....iiiiii.....',
  '.......kk.......',
  '......kppk......',
  '......kqqk......',
  '...kkkppppkkk...',
  '...kjjjjjjjjk...',
  '......kppk......',
  '.......pp.......',
  '.......pp.......',
  '....kkppppkk....',
  '....kjjjjjjk....',
  '......kkkk......',
  '................',
  '................',
];

/** Light twin. Still one tile, but it fills it — noticeably more aeroplane. */
const PLANE_TWIN: SpriteSource = [
  '................',
  '.......kk.......',
  '......kppk......',
  '......kqqk......',
  '..iii......iii..',
  'kkkkkkkppkkkkkkk',
  'kppEEppppppEEppk',
  'kjjeejjjjjjeejjk',
  'kkkkkkppppkkkkkk',
  '.......pp.......',
  '.......pp.......',
  '....kkppppkk....',
  '....kjjjjjjk....',
  '......kkkk......',
  '................',
  '................',
];

/** Commuter turboprop. Two tiles long, with a cabin you can count the windows of. */
const PLANE_TURBOPROP: SpriteSource = [
  '................',
  '................',
  '.......kk.......',
  '......kppk......',
  '......kqqk......',
  '......kppk......',
  '......pppp......',
  '......pppp......',
  '..iii......iii..',
  '..iii......iii..',
  'kkkkkkkkkkkkkkkk',
  'kppEEppppppEEppk',
  'kppEEppppppEEppk',
  'kjjeejjjjjjeejjk',
  'kkkkkkppppkkkkkk',
  '......pppp......',
  '......pQQp......',
  '......pppp......',
  '......pQQp......',
  '......pppp......',
  '......pQQp......',
  '......pppp......',
  '......pppp......',
  '....kkppppkk....',
  '....kjjjjjjk....',
  '....kkppppkk....',
  '......pppp......',
  '......kppk......',
  '.......kk.......',
  '................',
  '................',
  '................',
];

/** Regional jet: swept wing, rear-mounted engines, T-tail. No propellers. */
const PLANE_REGIONAL: SpriteSource = [
  '................',
  '................',
  '.......kk.......',
  '......kppk......',
  '.....kppppk.....',
  '.....kqqqqk.....',
  '.....kppppk.....',
  '.....pppppp.....',
  '.....pqppqp.....',
  '.....pppppp.....',
  '...kkppppppkk...',
  '.kkjjjjjjjjjjkk.',
  'kkjjjjjjjjjjjjkk',
  'kkkkkkppppkkkkkk',
  '......pppp......',
  '......pQQp......',
  '......pppp......',
  '......pQQp......',
  '......pppp......',
  '....EEppppEE....',
  '....EeppppeE....',
  '....EEppppEE....',
  '......pppp......',
  '....kkppppkk....',
  '....kjjjjjjk....',
  '....kkppppkk....',
  '......pppp......',
  '......kppk......',
  '.......kk.......',
  '................',
  '................',
  '................',
];

/** Narrowbody jet: full-span wing, engines slung under it. Two tiles and every pixel used. */
const PLANE_NARROWBODY: SpriteSource = [
  '................',
  '.......kk.......',
  '......kppk......',
  '.....kppppk.....',
  '....kpqqqqpk....',
  '....kppppppk....',
  '....kpqqqqpk....',
  '....kppppppk....',
  '....kpqqqqpk....',
  '....kppppppk....',
  '..kkppppppppkk..',
  'kkjjjjjjjjjjjjkk',
  'kkjjjjjjjjjjjjkk',
  'kkEEkkppppkkEEkk',
  '..ee..pppp..ee..',
  '....kpQQQQpk....',
  '....kppppppk....',
  '....kpQQQQpk....',
  '....kppppppk....',
  '....kpQQQQpk....',
  '....kppppppk....',
  '....kpQQQQpk....',
  '....kppppppk....',
  '.....kppppk.....',
  '...kkkppppkkk...',
  '...kjjjjjjjjk...',
  '...kkkppppkkk...',
  '.....kppppk.....',
  '......kppk......',
  '.......kk.......',
  '................',
  '................',
];

/** Widebody jet: a wider fuselage and engines you can see from the terminal. */
const PLANE_WIDEBODY: SpriteSource = [
  '.......kk.......',
  '......kppk......',
  '.....kppppk.....',
  '....kppppppk....',
  '...kppppppppk...',
  '...kpqqqqqqpk...',
  '...kppppppppk...',
  '...kpqqqqqqpk...',
  '...kppppppppk...',
  '.kkkppppppppkkk.',
  'kkjjjjjjjjjjjjkk',
  'kkjjjjjjjjjjjjkk',
  'kEEEkppppppkEEEk',
  '.eee.pppppp.eee.',
  'kkkkkkppppkkkkkk',
  '...kppppppppk...',
  '...kpQQQQQQpk...',
  '...kppppppppk...',
  '...kpQQQQQQpk...',
  '...kppppppppk...',
  '...kpQQQQQQpk...',
  '...kppppppppk...',
  '....kppppppk....',
  '.....kppppk.....',
  '..kkkkppppkkkk..',
  '..kjjjjjjjjjjk..',
  '..kkkkppppkkkk..',
  '.....kppppk.....',
  '......kppk......',
  '.......kk.......',
  '................',
  '................',
];

const PLANE_FIGHTER: SpriteSource = [
  '.......kk.......',
  '.......xx.......',
  '......kxxk......',
  '......kQQk......',
  '......xxxx......',
  '.....kxxxxk.....',
  '...kkxxxxxxkk...',
  '..kXXXXXXXXXXk..',
  '..kXXXXXXXXXXk..',
  '......xxxx......',
  '....kkxxxxkk....',
  '....kXXXXXXk....',
  '.....kxxxxk.....',
  '......kkkk......',
  '................',
  '................',
];

/** Four-engine military transport. High wing, drab, and unmistakably not an airliner. */
const PLANE_TRANSPORT: SpriteSource = [
  '................',
  '................',
  '.......kk.......',
  '......kxxk......',
  '.....kxQQxk.....',
  '.....kxxxxk.....',
  '.....xxxxxx.....',
  '.....xxxxxx.....',
  '..iii......iii..',
  '..iii......iii..',
  'kkkkkkkkkkkkkkkk',
  'kxEExxxxxxxxEExk',
  'kXeeXXXXXXXXeeXk',
  'kkkkkkxxxxkkkkkk',
  '.....xxxxxx.....',
  '.....xQQQQx.....',
  '.....xxxxxx.....',
  '.....xQQQQx.....',
  '.....xxxxxx.....',
  '.....xxxxxx.....',
  '.....xxxxxx.....',
  '.....xxxxxx.....',
  '.....kxxxxk.....',
  '...kkkxxxxkkk...',
  '...kXXXXXXXXk...',
  '...kkkxxxxkkk...',
  '.....kxxxxk.....',
  '......kxxk......',
  '.......kk.......',
  '................',
  '................',
  '................',
];

export const SPRITES = {
  'terrain.grass.a': GRASS_A,
  'terrain.grass.b': GRASS_B,
  'terrain.grass.c': GRASS_C,
  'terrain.woods': WOODS,
  'terrain.gravel': GRAVEL,
  'terrain.asphalt': ASPHALT,
  'terrain.water': WATER,
  'terrain.rock': ROCK,
  'surface.grass': SURFACE_GRASS,
  'surface.gravel': GRAVEL,
  'surface.asphalt': ASPHALT,
  'runway.centreline': RUNWAY_CENTRELINE,
  'runway.threshold': RUNWAY_THRESHOLD,
  'runway.centreline.military': RUNWAY_CENTRELINE_MILITARY,
  'runway.threshold.military': RUNWAY_THRESHOLD_MILITARY,
  'taxiway': TAXIWAY,
  'road': ROAD,
  'stand.small': stand(6),
  'stand.medium': stand(10),
  'stand.large': stand(14),
  'facility.tower': TOWER,
  'facility.terminal': TERMINAL,
  'facility.fuel-farm': FUEL_FARM,
  'facility.fire-station': FIRE_STATION,
  'facility.shop': SHOP,
  'plane.single': PLANE_SINGLE,
  'plane.twin': PLANE_TWIN,
  'plane.turboprop': PLANE_TURBOPROP,
  'plane.regional': PLANE_REGIONAL,
  'plane.narrowbody': PLANE_NARROWBODY,
  'plane.widebody': PLANE_WIDEBODY,
  'plane.fighter': PLANE_FIGHTER,
  'plane.transport': PLANE_TRANSPORT,
} as const satisfies Record<string, SpriteSource>;

export type SpriteName = keyof typeof SPRITES;

/** Sprite names that are aircraft, kept apart because they may be more than one tile long. */
export type PlaneSpriteName = Extract<SpriteName, `plane.${string}`>;
