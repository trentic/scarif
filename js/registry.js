// Game registry, used by the hub, the games and the debug dashboard.
//
// Each game declares what an archive entry needs before it can appear in that
// game. `requires` maps a media field on an entry to `true`, so
// `requires: { sound: true }` means "only entries with a sound effect".
// To add a new game, add an object here and a matching renderer in
// js/games/ (see README).

export const MEDIA_FIELDS = ['image', 'sound'];

export const GAMES = [
  {
    id: 'blaster-sounds',
    title: 'Guess the Blaster',
    tagline: 'by its sound',
    icon: '🔊',
    accent: 'red',
    module: 'sound',
    archive: 'blasters',
    requires: { image: true, sound: true },
    minEntries: 4,
  },
  {
    id: 'blaster-pictures',
    title: 'Name That Blaster',
    tagline: 'by its picture',
    icon: '🎯',
    accent: 'cyan',
    module: 'picture',
    archive: 'blasters',
    requires: { image: true },
    minEntries: 4,
  },
  {
    id: 'blaster-zoom',
    title: 'Zoom Out',
    tagline: 'guess it early, score more',
    icon: '🔍',
    accent: 'gold',
    module: 'zoom',
    archive: 'blasters',
    requires: { image: true },
    minEntries: 4,
  },
  {
    id: 'blaster-speed',
    title: 'Speed Round',
    tagline: 'beat the clock',
    icon: '⚡',
    accent: 'red',
    module: 'speed',
    archive: 'blasters',
    requires: { image: true },
    minEntries: 4,
  },
  {
    id: 'higher-lower',
    title: 'Higher or Lower',
    tagline: 'one wrong ends it',
    icon: '📊',
    accent: 'green',
    module: 'higherlower',
    archive: 'blasters',
    // `stats: true` = the entry has at least one stat value (see debug mode).
    requires: { image: true, stats: true },
    minEntries: 3,
  },
  {
    id: 'wordle',
    title: 'Star Wars Wordle',
    tagline: 'a new word every day',
    icon: '🔤',
    accent: 'green',
    module: 'wordle',
    archive: 'words',
    requires: {},
    minEntries: 1,
    chat: false, // no chat mode: don't read live chat while playing
    blurb: 'Guess the 5-letter word in 6 tries',
  },
  {
    id: 'whos-that',
    title: 'Who’s That?',
    tagline: 'name the character',
    icon: '🕵️',
    accent: 'cyan',
    module: 'character',
    archive: 'characters',
    requires: { image: true },
    minEntries: 2,
  },
  {
    id: 'who-would-win',
    title: 'Who Would Win?',
    tagline: 'pick your fighter',
    icon: '⚔️',
    accent: 'red',
    module: 'whowouldwin',
    archive: 'characters',
    requires: { image: true },
    minEntries: 2,
  },
];

// The archives games draw from. Each is its own JSON file in data/.
export const ARCHIVES = {
  blasters: { file: 'archive', title: 'Blaster games', noun: 'blasters' },
  characters: { file: 'characters', title: 'Character games', noun: 'characters' },
  words: { file: 'wordle', title: 'Daily puzzle', noun: 'words' },
};

// Character groups. To add one, add it here (plus its colours in css/app.css
// and debug/debug.css); debug mode and the Who Would Win? modes pick it up.
// When a character is listed in several groups, `rank` decides (higher wins).
export const SIDES = {
  jedi: { label: 'Jedi', plural: 'Jedi', rank: 0 },
  sith: { label: 'Sith', plural: 'Sith', rank: 4 },
  hunter: { label: 'Bounty Hunter', plural: 'Bounty Hunters', short: 'Hunter', shortPlural: 'Hunters', rank: 3 },
  clone: { label: 'Clone Trooper', plural: 'Clone Troopers', short: 'Clone', shortPlural: 'Clones', rank: 1 },
  droid: { label: 'Combat Droid', plural: 'Combat Droids', short: 'Droid', shortPlural: 'Droids', rank: 2 },
};
export const SIDE_IDS = Object.keys(SIDES);

export function getGame(id) {
  return GAMES.find((g) => g.id === id) || null;
}

// A field counts as present when it's truthy; objects (like `stats`) must
// also be non-empty.
function has(value) {
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

export function meetsRequirements(entry, requires = {}) {
  return Object.entries(requires).every(([field, needed]) => !needed || has(entry[field]));
}

// Human wording for what a game needs, e.g. "with a sound".
export function requirementLabel(requires = {}) {
  if (requires.stats) return 'with stats';
  if (requires.sound) return 'with a sound';
  return 'with a picture';
}

export function gamesForEntry(entry) {
  return GAMES.filter((g) => meetsRequirements(entry, g.requires)).map((g) => g.id);
}
