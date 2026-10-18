// Character matchup modes shared by the character games (Who Would Win?,
// Who's That?): who can appear together. Built from the groups in
// registry.js, so a new group gets its own "only" mode automatically.
//
//   versus modes: `a` vs `b` (lists of group ids), e.g. Jedi vs Sith
//   only modes:   one group (`only`)
//   close:        similar fight strength
//
// "⭐ Icons only" is a separate on/off filter (per game) that narrows the
// roster to the most popular characters (js/icons.js) before any mode applies,
// so it combines with every mode: icons-only Jedi vs Sith, icons-only Clones…
import { isIconic } from './icons.js';
import { SIDE_IDS, SIDES } from './registry.js';
import { h } from './ui.js';

const shortName = (id) => SIDES[id].short || SIDES[id].label;

export const CHAR_MODES = [
  { id: 'mixed', label: '🎲 Anyone', title: 'Anyone vs anyone' },
  { id: 'jvs', label: '⚔️ Jedi vs Sith', title: 'Jedi vs Sith', a: ['sith'], b: ['jedi'] },
  { id: 'cvd', label: '🤖 Clones vs Droids', title: 'Clones vs Droids', a: ['droid'], b: ['clone'] },
  { id: 'hvf', label: '🎯 Hunters vs Force users', title: 'Hunters vs Force', a: ['hunter'], b: ['jedi', 'sith'] },
  { id: 'close', label: '🔥 Close fights', title: 'Close fight', close: true },
  ...SIDE_IDS.map((id) => ({
    id, row: 'only', only: id, label: SIDES[id].shortPlural || SIDES[id].plural, title: `${shortName(id)} vs ${shortName(id)}`,
  })),
];

// How often a character should come up: the more popular (fan power, plus a
// boost for icons), the more often. Fan power 95 icon ≈ 6× a fan power 40
// unknown, but everyone still appears sometimes.
export function popularity(c) {
  return (0.15 + ((Number(c.power) || 50) / 100) ** 2.5) * (isIconic(c) ? 1.5 : 1);
}
// Random order where popular characters tend to come first (each one's chance
// of coming next is proportional to its popularity).
export function popularShuffle(list) {
  return list
    .map((c) => [Math.random() ** (1 / popularity(c)), c])
    .sort((x, y) => y[0] - x[0])
    .map(([, c]) => c);
}
// Picks an index from `items`, weighted by weight(item).
export function weightedIndex(items, weight) {
  const ws = items.map(weight);
  let r = Math.random() * ws.reduce((s, w) => s + w, 0);
  for (let i = 0; i < ws.length; i++) if ((r -= ws[i]) <= 0) return i;
  return ws.length - 1;
}

export const inGroups = (c, groups) => groups.includes(c.side);
export const iconsOf = (pool) => pool.filter(isIconic);
export const bySide = (pool, side) => pool.filter((c) => c.side === side);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// "⭐ Icons only" used to be a mode of its own: now it's Anyone + the filter.
function migrate(key) {
  if (store.get(key) === 'icons') { store.set(key, 'mixed'); store.set(`${key}.icons`, '1'); }
}
// The icons-only filter for a game (stored next to its mode).
export const iconsOnly = (key) => { migrate(key); return store.get(`${key}.icons`) === '1'; };
export const setIconsOnly = (key, on) => store.set(`${key}.icons`, on ? '1' : '0');
// The characters a game can use right now: everyone, or just the icons.
export const rosterFor = (key, pool) => (iconsOnly(key) ? iconsOf(pool) : pool);

// The saved mode for a game (by storage key), if it's playable; else the first.
export function savedMode(key, modes, playable) {
  migrate(key);
  const saved = modes.find((m) => m.id === store.get(key));
  return saved && playable(saved) ? saved : modes[0];
}

// The two-row mode picker for a lobby: versus modes, then one-group modes.
// Modes that can't be played with the current archive are greyed out.
// `iconCount`: how many icons the archive has (the filter needs at least 2).
export function modePicker({ key, modes, current, playable, refresh, iconCount = 0, title = 'Matchups' }) {
  const button = (m) => {
    const ok = playable(m);
    return h('button', {
      'aria-pressed': String(m.id === current.id),
      disabled: !ok || null,
      title: ok ? null : 'Not enough characters for this mode yet',
      onclick: () => { store.set(key, m.id); refresh(); },
    }, m.label);
  };
  const iconsOn = iconsOnly(key);
  const iconToggle = h('button', {
    class: `wv-icons-toggle ${iconsOn ? 'on' : ''}`,
    'aria-pressed': String(iconsOn),
    disabled: (!iconsOn && iconCount < 2) || null,
    title: 'Only the most popular characters. Works with any matchup below.',
    onclick: () => { setIconsOnly(key, !iconsOn); refresh(); },
  }, iconsOn ? '⭐ Icons only: ON' : '☆ Icons only: OFF');
  return h('div', { class: 'hl-choose wv-modes' },
    h('div', { class: 'wv-filter' }, iconToggle),
    h('div', { class: 'title' }, title),
    h('div', { class: 'seg' }, modes.filter((m) => m.row !== 'only').map(button)),
    h('div', { class: 'title wv-only-title' }, 'One group only'),
    h('div', { class: 'seg wv-only' }, modes.filter((m) => m.row === 'only').map(button)),
  );
}
