// "Higher or Lower": is the next blaster's stat higher or lower than this
// one's? One wrong answer ends the run. Stat types (e.g. "Price" in credits)
// and each blaster's values are set in debug mode.
import { countdown, rankFor, resultsScreen, showScreen } from '../engine.js';
import { sfx } from '../sfx.js';
import { formatStat, h, iconButton, shuffle, wait } from '../ui.js';

const MIN_ITEMS = 3;
const CHOICE_KEY = 'scarif.hl.stat';
const BEST_KEY = 'scarif.hl.best.';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// Stat types with enough blasters to play.
function playableTypes(archive, pool) {
  return (archive.stats || [])
    .map((t) => ({ ...t, items: pool.filter((e) => Number.isFinite(e.stats?.[t.id])) }))
    .filter((t) => t.items.length >= MIN_ITEMS);
}

export function lobby({ archive, pool, refresh }) {
  const types = playableTypes(archive, pool);
  if (!types.length) {
    return {
      ready: false,
      notReady: `Needs ${MIN_ITEMS} blasters with the same stat. Add stat types and values in debug mode.`,
    };
  }
  let choice = store.get(CHOICE_KEY);
  if (choice !== 'random' && !types.some((t) => t.id === choice)) choice = types.length > 1 ? 'random' : types[0].id;

  const options = [['random', '🎲 Random'], ...types.map((t) => [t.id, `${t.name} (${t.items.length})`])];
  const extra = types.length > 1 && h('div', { class: 'hl-choose' },
    h('div', { class: 'title' }, 'Compare by'),
    h('div', { class: 'seg' }, options.map(([id, label]) => h('button', {
      'aria-pressed': String(id === choice),
      onclick: () => { store.set(CHOICE_KEY, id); refresh(); },
    }, label))),
  );
  const chosen = types.find((t) => t.id === choice);
  return {
    ready: true,
    extra,
    facts: `${chosen ? chosen.name : 'Random stat'} · one wrong answer ends the run`,
  };
}

export async function run({ stage, game, pool, archive, register, onExit, onReplay }) {
  let alive = true;
  let keyHandler = null;
  const onKey = (e) => keyHandler?.(e);
  document.addEventListener('keydown', onKey);
  const stop = () => {
    alive = false;
    document.removeEventListener('keydown', onKey);
  };
  register?.(stop);
  const exit = () => { stop(); onExit(); };

  const types = playableTypes(archive, pool);
  const choice = store.get(CHOICE_KEY);
  const type = types.find((t) => t.id === choice) || types[Math.floor(Math.random() * types.length)];
  const items = shuffle(type.items);
  items.forEach((e) => { new Image().src = e.image; });
  const value = (e) => e.stats[type.id];
  const fmt = (v) => formatStat(v, type.unit);

  keyHandler = (e) => e.key === 'Escape' && exit();
  if (!(await countdown(stage, () => alive))) return;

  let index = 0; // items[index] is the known one, items[index + 1] the challenger
  let streak = 0;
  let locked = false;

  const streakPill = h('span', { class: 'pill streak' }, '🔥 0');
  const cards = h('div', { class: 'hl-cards' });
  const screen = h('div', { class: 'screen round-screen hl-screen' },
    h('div', { class: 'corner left chrome' }, iconButton('home', 'Quit to menu', exit)),
    h('div', { class: 'hud' },
      h('div', { class: 'round hl-stat' }, h('b', {}, type.name.toUpperCase())),
      h('div', { class: 'score' }, streakPill),
    ),
    cards,
  );
  showScreen(stage, screen);

  function card(entry, known) {
    const val = h('div', { class: 'hl-value' }, known ? fmt(value(entry)) : '???');
    const el = h('div', { class: `hl-card ${known ? 'known' : 'unknown'}` },
      h('div', { class: 'hl-img' }, h('img', { src: entry.image, alt: '', draggable: 'false' })),
      h('div', { class: 'hl-name' }, entry.name),
      val,
    );
    return { el, val };
  }

  let challenger = null;

  function render(slide) {
    const top = card(items[index], true);
    challenger = card(items[index + 1], false);
    const buttons = h('div', { class: 'hl-buttons' },
      h('button', { class: 'btn hl-up', onclick: () => guess('higher') }, '▲ Higher'),
      h('button', { class: 'btn hl-down', onclick: () => guess('lower') }, '▼ Lower'),
    );
    challenger.el.append(buttons);
    cards.replaceChildren(top.el, h('div', { class: 'hl-vs' }, 'VS'), challenger.el);
    if (slide) {
      cards.classList.remove('slide');
      void cards.offsetWidth;
      cards.classList.add('slide');
    }
    locked = false;
  }

  async function countUp(el, target) {
    const decimals = Number.isInteger(target) ? 0 : 1;
    const t0 = performance.now();
    const dur = 700;
    await new Promise((resolve) => {
      const step = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        const eased = 1 - (1 - p) ** 3;
        el.textContent = formatStat((target * eased).toFixed(decimals), type.unit);
        if (p < 1) requestAnimationFrame(step);
        else { el.textContent = fmt(target); resolve(); }
      };
      requestAnimationFrame(step);
    });
  }

  async function guess(dir) {
    if (locked || !alive) return;
    locked = true;
    challenger.el.querySelector('.hl-buttons').classList.add('used');
    const a = value(items[index]);
    const b = value(items[index + 1]);
    await countUp(challenger.val, b);
    if (!alive) return;
    const right = a === b || (dir === 'higher' ? b > a : b < a);
    challenger.el.classList.add(right ? 'right' : 'wrong');
    if (right) {
      streak++;
      streakPill.textContent = `🔥 ${streak}`;
      streakPill.classList.remove('bump'); void streakPill.offsetWidth; streakPill.classList.add('bump');
      sfx.correct();
      flash(a === b ? 'Tie!' : 'Correct!', 'good');
      await wait(900);
      if (!alive) return;
      index++;
      if (index + 1 >= items.length) return finish(true);
      render(true);
    } else {
      sfx.wrong();
      flash('Wrong!', 'bad');
      await wait(1500);
      if (alive) finish(false);
    }
  }

  function flash(text, kind) {
    const el = h('div', { class: `flash hl-flash ${kind}` }, text);
    screen.append(el);
    setTimeout(() => el.remove(), 1400);
  }

  keyHandler = (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w' || k === 'h') guess('higher');
    else if (k === 'arrowdown' || k === 's' || k === 'l') guess('lower');
    else if (k === 'escape') exit();
  };

  render(false);

  function finish(won) {
    const max = items.length - 1;
    const bestKey = BEST_KEY + type.id;
    const best = Math.max(streak, Number(store.get(bestKey)) || 0);
    store.set(bestKey, String(best));
    const [, rank, blurb] = won
      ? [100, 'The Chosen One', `You beat the whole archive on ${type.name.toLowerCase()}!`]
      : rankFor(streak, max);
    const replay = () => { stop(); onReplay(); };
    keyHandler = (e) => {
      if (e.key === 'Escape') exit();
      if (e.key === 'Enter' || e.key === ' ') replay();
    };
    resultsScreen(stage, {
      title: `${game.title} · ${type.name}`,
      big: streak,
      of: max,
      rank,
      blurb,
      stats: [
        [`🏆 ${best}`, 'Best streak'],
        [String(items.length), 'In the deck'],
      ],
      cta: 'What streak did you get? 👇',
      onMenu: exit,
      onReplay: replay,
    });
  }
}
