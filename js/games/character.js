// "Who's That?": a character's picture (clear, or hidden by the Picture mode
// setting) and two names to choose from. Two big answers leave room for a
// tall picture and keep everything inside the Shorts / TikTok safe zone.
// The lobby has the same matchup modes as Who Would Win? (js/charmodes.js):
// they decide who can appear and who the wrong answer is.
import { bySide, CHAR_MODES, inGroups, modePicker, savedMode } from '../charmodes.js';
import { renderer as picture } from './picture.js';

const MODE_KEY = 'scarif.whos.mode';
const MODES = CHAR_MODES.map((m) => (m.close ? { ...m, label: '🔥 Tough calls', title: 'Tough calls' } : m));

// Who can be shown in a mode.
function poolFor(mode, pool) {
  if (mode.a) return pool.filter((c) => inGroups(c, [...mode.a, ...mode.b]));
  if (mode.only) return bySide(pool, mode.only);
  return pool;
}
function playable(mode, pool) {
  if (mode.a) return pool.some((c) => inGroups(c, mode.a)) && pool.some((c) => inGroups(c, mode.b));
  return poolFor(mode, pool).length >= 2;
}
let mode = MODES[0]; // set by the lobby; read when picking wrong answers

export function lobby({ pool, settings, refresh }) {
  mode = savedMode(MODE_KEY, MODES, (m) => playable(m, pool));
  const modePool = poolFor(mode, pool);
  return {
    pool: modePool,
    ready: playable(mode, pool),
    extra: pool.length >= 2 && modePicker({ key: MODE_KEY, modes: MODES, current: mode, playable: (m) => playable(m, pool), refresh }),
    notReady: 'Needs 2 characters with a picture. Add pictures in debug mode → Characters.',
    facts: [mode.id === 'mixed' ? 'Anyone' : mode.title, `${settings.rounds > 0 ? Math.min(settings.rounds, modePool.length) : modePool.length} rounds`,
      settings.timer ? `${settings.timer}s timer` : 'no timer'].join(' · '),
  };
}

const RANKS = [
  [100, 'Holocron Keeper', 'You know every face in the galaxy.'],
  [80, 'Jedi Archivist', 'If it’s not in your memory, it doesn’t exist.'],
  [60, 'Rebel Spy', 'Good eye. Most faces checked out.'],
  [40, 'Cantina Regular', 'You’ve seen them around, at least.'],
  [20, 'Moisture Farmer', 'Out on Tatooine, who knows anybody?'],
  [0, 'Jawa', 'Utinni! Who are all these people?'],
];

export const renderer = {
  choices: 2,
  ranks: RANKS,
  screenClass: 'who-screen',

  preload: picture.preload,

  mount(el, entry, ctx) {
    const view = picture.mount(el, entry, ctx);
    const tag = el.querySelector('.corner-tag');
    if (tag) tag.textContent = 'Who is it?';
    return view;
  },

  // The wrong answer should be a believable mix-up: someone from the same
  // group with similar fan power (with a little randomness so pairs vary).
  // Versus modes take it from the other side (a Jedi's decoy is a Sith);
  // Tough calls takes the closest fan power.
  distractors(target, pool, n) {
    let candidates = pool;
    if (mode.a) {
      const other = inGroups(target, mode.a) ? mode.b : mode.a;
      candidates = pool.filter((c) => inGroups(c, other));
      if (!candidates.length) candidates = pool; // e.g. the other side's pictures didn't load
    }
    const jitter = mode.close ? 2 : 18;
    const score = (c) => (mode.a || c.side === target.side ? 0 : 25) + Math.abs((c.power || 50) - (target.power || 50)) + Math.random() * jitter;
    return candidates
      .filter((c) => c.id !== target.id && c.name.toLowerCase() !== target.name.toLowerCase())
      .map((c) => [score(c), c])
      .sort((a, b) => a[0] - b[0])
      .slice(0, n)
      .map(([, c]) => c);
  },
};
