// Character matchup modes shared by the character games (Who Would Win?,
// Who's That?): who can appear together. Built from the groups in
// registry.js, so a new group gets its own "only" mode automatically.
//
//   versus modes: `a` vs `b` (lists of group ids), e.g. Jedi vs Sith
//   only modes:   one group (`only`)
//   close:        similar fan power
//   iconic:       only the most popular characters, any group (js/icons.js)
import { isIconic } from './icons.js';
import { SIDE_IDS, SIDES } from './registry.js';
import { h } from './ui.js';

const shortName = (id) => SIDES[id].short || SIDES[id].label;

export const CHAR_MODES = [
  { id: 'mixed', label: '🎲 Anyone', title: 'Anyone vs anyone' },
  { id: 'icons', label: '⭐ Icons only', title: 'Icons only', iconic: true },
  { id: 'jvs', label: '⚔️ Jedi vs Sith', title: 'Jedi vs Sith', a: ['sith'], b: ['jedi'] },
  { id: 'cvd', label: '🤖 Clones vs Droids', title: 'Clones vs Droids', a: ['droid'], b: ['clone'] },
  { id: 'hvf', label: '🎯 Hunters vs Force users', title: 'Hunters vs Force', a: ['hunter'], b: ['jedi', 'sith'] },
  { id: 'close', label: '🔥 Close fights', title: 'Close fight', close: true },
  ...SIDE_IDS.map((id) => ({
    id, row: 'only', only: id, label: SIDES[id].shortPlural || SIDES[id].plural, title: `${shortName(id)} vs ${shortName(id)}`,
  })),
];

export const inGroups = (c, groups) => groups.includes(c.side);
export const iconsOf = (pool) => pool.filter(isIconic);
export const bySide = (pool, side) => pool.filter((c) => c.side === side);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// The saved mode for a game (by storage key), if it's playable; else the first.
export function savedMode(key, modes, playable) {
  const saved = modes.find((m) => m.id === store.get(key));
  return saved && playable(saved) ? saved : modes[0];
}

// The two-row mode picker for a lobby: versus modes, then one-group modes.
// Modes that can't be played with the current archive are greyed out.
export function modePicker({ key, modes, current, playable, refresh, title = 'Matchups' }) {
  const button = (m) => {
    const ok = playable(m);
    return h('button', {
      'aria-pressed': String(m.id === current.id),
      disabled: !ok || null,
      title: ok ? null : 'Not enough characters for this mode yet',
      onclick: () => { store.set(key, m.id); refresh(); },
    }, m.label);
  };
  return h('div', { class: 'hl-choose wv-modes' },
    h('div', { class: 'title' }, title),
    h('div', { class: 'seg' }, modes.filter((m) => m.row !== 'only').map(button)),
    h('div', { class: 'title wv-only-title' }, 'One group only'),
    h('div', { class: 'seg wv-only' }, modes.filter((m) => m.row === 'only').map(button)),
  );
}
