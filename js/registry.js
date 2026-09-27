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
    // `stats: true` = the entry has at least one stat value (see debug mode).
    requires: { image: true, stats: true },
    minEntries: 3,
  },
];

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
  return 'with an image';
}

export function gamesForEntry(entry) {
  return GAMES.filter((g) => meetsRequirements(entry, g.requires)).map((g) => g.id);
}
