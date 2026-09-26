// Game registry, shared by the server (to filter the database) and the
// browser (to draw the hub and run the games).
//
// Each game declares what an entry needs before it can appear in that game.
// `requires` maps a media field on an entry to `true`, so
// `requires: { sound: true }` means "only entries with a sound effect".
// To add a new game, add an object here and a matching module in
// public/js/games/.

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
];

export function getGame(id) {
  return GAMES.find((g) => g.id === id) || null;
}

export function meetsRequirements(entry, requires = {}) {
  return Object.entries(requires).every(([field, needed]) => !needed || Boolean(entry[field]));
}

export function gamesForEntry(entry) {
  return GAMES.filter((g) => meetsRequirements(entry, g.requires)).map((g) => g.id);
}
