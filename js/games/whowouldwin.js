// "Who Would Win?": two characters, tap the one you think wins. It's opinion
// only; after each pick the fan split is shown. Modes pick who fights whom
// (anyone, Jedi vs Sith, Jedi only, Sith only, close fights).
import * as chat from '../chat.js';
import { voteRound } from '../chatvotes.js';
import { countdown, resultsScreen, showScreen } from '../engine.js';
import { SIDES } from '../registry.js';
import { sfx } from '../sfx.js';
import { h, iconButton, wait } from '../ui.js';
import { record, split, splitLabel } from '../votes.js';

const AUTO_NEXT_MS = 2600;
const MIN_CHAT_VOTES = 3; // fewer than this → show the fan estimate instead

const RANKS = [
  [80, 'Totally Normal Fan', 'You think like the rest of the galaxy.'],
  [60, 'Mostly Normal', 'A few spicy picks in there.'],
  [40, 'Hot Take Haver', 'You were born to argue in the comments.'],
  [20, 'Chaos Agent', 'The fans would like a word.'],
  [0, 'Certified Contrarian', 'Did you pick the underdog every time?'],
];

// --- modes ------------------------------------------------------------------------------

const MODE_KEY = 'scarif.wvw.mode';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const bySide = (pool, side) => pool.filter((c) => c.side === side);
function everyPair(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
  return out;
}
// Matchups with similar fan power: start strict and widen until there are enough.
function closePairs(pool) {
  const all = everyPair(pool);
  const want = Math.min(12, all.length);
  for (const gap of [5, 8, 12, 18, 100]) {
    const pairs = all.filter(([a, b]) => Math.abs((a.power || 50) - (b.power || 50)) <= gap);
    if (pairs.length >= want) return pairs;
  }
  return all;
}

// pairs(pool) → [[a, b], …]. `fixed` keeps a on top (red) and b on the bottom
// (blue); otherwise each matchup is flipped at random.
export const MODES = [
  { id: 'mixed', label: '🎲 Anyone', title: 'Who would win?', pairs: (pool) => everyPair(pool) },
  {
    id: 'jvs', label: '⚔️ Jedi vs Sith', title: 'Jedi vs Sith', fixed: true,
    // Sith on red (1), Jedi on blue (2).
    pairs: (pool) => bySide(pool, 'sith').flatMap((s) => bySide(pool, 'jedi').map((j) => [s, j])),
  },
  { id: 'jedi', label: 'Jedi only', title: 'Jedi vs Jedi', pairs: (pool) => everyPair(bySide(pool, 'jedi')) },
  { id: 'sith', label: 'Sith only', title: 'Sith vs Sith', pairs: (pool) => everyPair(bySide(pool, 'sith')) },
  { id: 'close', label: '🔥 Close fights', title: 'Close fight', pairs: closePairs },
];

function currentMode(pool) {
  const saved = MODES.find((m) => m.id === store.get(MODE_KEY));
  return saved && saved.pairs(pool).length ? saved : MODES[0];
}
const fighters = (pairs) => new Set(pairs.flat().map((c) => c.id)).size;

// Uses the Rounds setting; "All" (0) means unlimited matchups here.
export function lobby({ pool, settings, refresh }) {
  const length = settings.rounds;
  const mode = currentMode(pool);
  const pairs = mode.pairs(pool);
  const extra = pool.length >= 2 && h('div', { class: 'hl-choose wv-modes' },
    h('div', { class: 'title' }, 'Matchups'),
    h('div', { class: 'seg' }, MODES.map((m) => {
      const n = m.pairs(pool).length;
      return h('button', {
        'aria-pressed': String(m.id === mode.id),
        disabled: !n || null,
        title: n ? null : 'Not enough characters for this mode yet',
        onclick: () => { store.set(MODE_KEY, m.id); refresh(); },
      }, m.label);
    })),
  );
  return {
    ready: pairs.length > 0,
    extra,
    notReady: 'Needs 2 characters with a picture. Add pictures in debug mode → Characters.',
    facts: `${mode.id === 'mixed' ? 'Anyone vs anyone' : mode.title} · ${length ? `${length} matchups` : 'unlimited matchups'} · ${fighters(pairs)} fighters`,
  };
}

// Picks matchups from `pairs` on demand: no repeats until every matchup has
// been used, and nobody fights twice in a row when it can be avoided.
function pairer(pairs, fixed) {
  let unused = [];
  let prev = new Set();
  return () => {
    if (!unused.length) unused = [...pairs];
    let idx = -1;
    for (let tries = 0; tries < 80; tries++) {
      const i = Math.floor(Math.random() * unused.length);
      const [a, b] = unused[i];
      if (!prev.has(a.id) && !prev.has(b.id)) { idx = i; break; }
    }
    if (idx < 0) idx = Math.floor(Math.random() * unused.length);
    const [pair] = unused.splice(idx, 1);
    prev = new Set([pair[0].id, pair[1].id]);
    return fixed || Math.random() < 0.5 ? [pair[0], pair[1]] : [pair[1], pair[0]];
  };
}

export async function run({ stage, game, pool, settings, register, onExit, onReplay }) {
  let alive = true;
  let keyHandler = null;
  let cleanupRound = () => {};
  const onKey = (e) => keyHandler?.(e);
  document.addEventListener('keydown', onKey);
  const stop = () => {
    alive = false;
    cleanupRound();
    document.removeEventListener('keydown', onKey);
  };
  register?.(stop);
  const exit = () => { stop(); onExit(); };

  const total = settings.rounds; // 0 ("All") = unlimited
  const mode = currentMode(pool);
  const pairs = mode.pairs(pool);
  const nextPair = pairer(pairs, mode.fixed);
  const sideMode = mode.id === 'mixed' || mode.id === 'jvs';
  let played = 0;
  let finishing = false; // "Finish" tapped in unlimited mode
  new Set(pairs.flat()).forEach((c) => { new Image().src = c.image; });

  keyHandler = (e) => e.key === 'Escape' && exit();
  if (!(await countdown(stage, () => alive))) return;

  let agreed = 0;
  const picks = { jedi: 0, sith: 0 };
  let underdogs = 0; // picked the one with less fan power

  for (let i = 0; alive && (total === 0 || i < total) && !finishing; i++) {
    const result = await round(i, nextPair());
    if (result === 'exit') return;
  }
  if (alive) finish();

  function round(index, [a, b]) {
    return new Promise((resolve) => {
      let phase = 'picking';
      let timerRaf = 0;
      let nextTimer = 0;

      const chatOn = chat.isOn();
      const half = (c, pos) => {
        const pct = h('div', { class: 'wv-pct' });
        const n = pos === 'top' ? 1 : 2;
        const count = h('span', { class: 'n' }, '0 votes');
        const chatEl = chatOn ? h('div', { class: 'wv-chat' }, h('b', {}, `TYPE ${n}`), count) : null;
        // With chat on, the colour starts dimmed and lights up with the votes:
        // red from the left edge, blue from the right edge.
        const dim = chatOn ? h('div', { class: 'wv-dim' }) : null;
        const el = h('button', { class: `wv-half wv-${pos}`, 'aria-label': `${c.name} wins` },
          dim,
          h('div', { class: 'wv-img' }, h('img', { src: c.image, alt: '', draggable: 'false' })),
          h('div', { class: 'wv-label' },
            h('span', { class: `wv-side ${c.side}` }, SIDES[c.side]?.label || c.side),
            h('span', { class: 'wv-name' }, c.name),
          ),
          pct,
          chatEl,
          h('div', { class: 'wv-pick' }, '✓ Your pick'),
        );
        el.addEventListener('click', () => onTap(c));
        return { el, pct, chatEl, count, dim };
      };
      const top = half(a, 'top');
      const bottom = half(b, 'bottom');

      // Chat votes: 1 / 2, red / blue, top / bottom, left / right, or the name.
      const votes = chatOn ? voteRound([
        { id: 'a', keys: ['1', 'red', 'top', 'left'], names: [a.name] },
        { id: 'b', keys: ['2', 'blue', 'bottom', 'right'], names: [b.name] },
      ], {
        onUpdate: ({ counts, total }) => {
          if (phase !== 'picking') return;
          top.count.textContent = `${counts.a} vote${counts.a === 1 ? '' : 's'}`;
          bottom.count.textContent = `${counts.b} vote${counts.b === 1 ? '' : 's'}`;
          setFill(counts.a / total, counts.b / total);
        },
      }) : null;

      // Lit share of each half (0–1): red's lit part grows from its left edge,
      // blue's from its right edge.
      function setFill(shareA, shareB) {
        if (!chatOn) return;
        top.dim.style.left = `${shareA * 100}%`;
        bottom.dim.style.right = `${shareB * 100}%`;
      }
      if (chatOn) {
        // Test chat leans towards the character with more fan power.
        const fav = (a.power || 50) >= (b.power || 50) ? ['1', a.name] : ['2', b.name];
        chat.setTestHint(() => (phase === 'picking' ? [...fav, ...fav, '1', '2', a.name, b.name] : []));
      }

      const timerFill = h('div', { class: 'fill' });
      const timer = h('div', { class: `timer ${settings.timer ? '' : 'hidden'}` }, timerFill);
      const hostHint = h('div', { class: 'wv-host chrome' });

      const screen = h('div', { class: `screen round-screen wv-screen ${chatOn ? 'has-chat' : ''}` },
        h('div', { class: 'corner left chrome' }, iconButton('home', 'Quit to menu', () => { finish(); resolve('exit'); exit(); })),
        // Stays visible in clean mode (it sits under the app's own header strip).
        total === 0 && h('div', { class: 'corner right' },
          h('button', { class: 'btn ghost wv-finish', onclick: () => endRun() }, 'Finish'),
        ),
        h('div', { class: 'hud' },
          h('div', { class: 'wv-title' }, mode.title),
          h('span', { class: 'pill' }, total ? `${index + 1} / ${total}` : `#${index + 1}`),
        ),
        timer,
        chatOn && h('div', { class: 'wv-instruct' },
          `💬 ${chat.config.membersOnly ? 'Members' : 'Vote in chat'}: type `, h('b', { class: 'red' }, '1'), ' or ', h('b', { class: 'blue' }, '2'),
        ),
        h('div', { class: 'wv-panel' }, top.el, bottom.el, h('div', { class: 'wv-or' }, 'OR')),
        hostHint,
      );
      showScreen(stage, screen);

      keyHandler = (e) => {
        if (e.repeat) return;
        const k = e.key.toLowerCase();
        if (k === 'arrowup' || k === '1' || k === 'w') onTap(a);
        else if (k === 'arrowdown' || k === '2' || k === 's') onTap(b);
        else if (k === ' ' || k === 'enter') { e.preventDefault(); if (phase === 'shown') next(); }
        else if (k === 'escape') { finish(); resolve('exit'); exit(); }
        else if (k === 'f' && total === 0) endRun();
      };

      cleanupRound = finish;
      if (settings.timer) startTimer();

      function finish() {
        cancelAnimationFrame(timerRaf);
        clearTimeout(nextTimer);
        votes?.cancel();
        cleanupRound = () => {};
      }

      function startTimer() {
        const total = settings.timer * 1000;
        const start = performance.now();
        let lastTick = null;
        const step = (now) => {
          const left = Math.max(0, total - (now - start));
          timerFill.style.transform = `scaleX(${left / total})`;
          const secs = Math.ceil(left / 1000);
          timer.classList.toggle('low', secs <= 3);
          if (secs <= 3 && secs > 0 && secs !== lastTick) { lastTick = secs; sfx.tick(); }
          if (left <= 0) return reveal(null);
          timerRaf = requestAnimationFrame(step);
        };
        timerRaf = requestAnimationFrame(step);
      }

      function onTap(c) {
        if (phase === 'picking') reveal(c);
        else if (phase === 'shown') next();
      }

      async function reveal(pick) {
        if (phase !== 'picking') return;
        phase = 'revealing';
        cancelAnimationFrame(timerRaf);
        timer.classList.add('hidden');
        if (pick) {
          (pick === a ? top : bottom).el.classList.add('picked');
          (pick === a ? bottom : top).el.classList.add('not-picked');
          picks[pick.side] = (picks[pick.side] || 0) + 1;
          const other = pick === a ? b : a;
          if ((pick.power || 50) < (other.power || 50)) underdogs++;
          record(a, b, pick);
          sfx.choose();
        }
        // Real chat votes win over the fan estimate when there are enough.
        const chatTally = votes?.tally();
        votes?.cancel();
        let result;
        let label;
        if (chatTally && chatTally.total >= MIN_CHAT_VOTES) {
          const pctA = Math.round((chatTally.counts.a / chatTally.total) * 100);
          result = { a: pctA, b: 100 - pctA, source: 'chat' };
          label = `Chat vote · ${chatTally.total}`;
        } else {
          result = await split(a, b);
          label = splitLabel(result.source);
        }
        if (!alive) return;
        top.chatEl?.remove();
        bottom.chatEl?.remove();
        setFill(result.a / 100, result.b / 100);
        countUp(top.pct, result.a, label);
        countUp(bottom.pct, result.b, label);
        screen.classList.add('revealed');
        played++;
        const fav = result.a >= result.b ? a : b;
        (fav === a ? top : bottom).el.classList.add('fan-fav');
        if (pick && (result.a === result.b || pick === fav)) agreed++;
        await wait(700);
        if (!alive) return;
        phase = 'shown';
        if (finishing) return next();
        if (settings.mode === 'host') hostHint.textContent = 'Tap to continue';
        else nextTimer = setTimeout(next, AUTO_NEXT_MS);
      }

      function next() {
        if (phase !== 'shown') return;
        phase = 'done';
        finish();
        resolve('next');
      }

      // Unlimited mode: end now (or right after this reveal) and show results.
      function endRun() {
        finishing = true;
        if (phase === 'picking') {
          phase = 'done';
          finish();
          resolve('next');
        } else if (phase === 'shown') next();
      }
    });
  }

  function countUp(el, target, label) {
    const num = h('b', {}, '0%');
    el.replaceChildren(num, h('small', {}, label));
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 650);
      num.textContent = `${Math.round(target * (1 - (1 - p) ** 3))}%`;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function finish() {
    if (!played) return exit();
    const pct = (agreed / played) * 100;
    const [, rank, blurb] = RANKS.find(([min]) => pct >= min);
    const replay = () => { stop(); onReplay(); };
    keyHandler = (e) => {
      if (e.key === 'Escape') exit();
      if (e.key === 'Enter' || e.key === ' ') replay();
    };
    resultsScreen(stage, {
      title: 'Are you a normal Star Wars fan?',
      big: agreed,
      of: played,
      caption: 'picks matched the fan favourite',
      rank,
      blurb,
      // Jedi/Sith picks only mean something when both sides are fighting.
      stats: sideMode
        ? [[`${picks.jedi || 0}`, 'Jedi picks'], [`${picks.sith || 0}`, 'Sith picks']]
        : [[`${underdogs}`, 'Underdog picks'], [`${played}`, 'Matchups']],
      cta: 'Who would YOU pick? 👇',
      onMenu: exit,
      onReplay: replay,
    });
  }
}
