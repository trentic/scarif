// "Who Would Win?": two random characters (any side vs any side), tap the one
// you think wins. It's opinion only; after each pick the fan split is shown.
import * as chat from '../chat.js';
import { voteRound } from '../chatvotes.js';
import { countdown, resultsScreen, showScreen } from '../engine.js';
import { SIDES } from '../registry.js';
import { sfx } from '../sfx.js';
import { h, iconButton, shuffle, wait } from '../ui.js';
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

// Uses the Rounds setting; "All" (0) means unlimited matchups here.
export function lobby({ pool, settings }) {
  const length = settings.rounds;
  return {
    notReady: 'Needs 2 characters with a picture. Add pictures in debug mode → Characters.',
    facts: `${length ? `${length} matchups` : 'Unlimited matchups'} · ${pool.length} fighters · no wrong answers`,
  };
}

// Random pairs on demand: no repeated matchup until every pairing has been
// used, and nobody fights twice in a row when there are enough characters.
function pairer(pool) {
  const maxPairs = (pool.length * (pool.length - 1)) / 2;
  const seen = new Set();
  let prev = new Set();
  return () => {
    if (seen.size >= maxPairs) seen.clear();
    for (let tries = 0; tries < 500; tries++) {
      const [a, b] = shuffle(pool);
      const key = [a.id, b.id].sort().join('|');
      if (seen.has(key)) continue;
      if (pool.length >= 4 && tries < 400 && (prev.has(a.id) || prev.has(b.id))) continue;
      seen.add(key);
      prev = new Set([a.id, b.id]);
      return [a, b];
    }
    const [a, b] = shuffle(pool);
    return [a, b];
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
  const nextPair = pairer(pool);
  let played = 0;
  let finishing = false; // "Finish" tapped in unlimited mode
  pool.forEach((c) => { new Image().src = c.image; });

  keyHandler = (e) => e.key === 'Escape' && exit();
  if (!(await countdown(stage, () => alive))) return;

  let agreed = 0;
  const picks = { jedi: 0, sith: 0 };

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
        const chatEl = chatOn ? h('div', { class: 'wv-chat' }, `💬 Type ${pos === 'top' ? 1 : 2}`) : null;
        const el = h('button', { class: `wv-half wv-${pos}`, 'aria-label': `${c.name} wins` },
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
        return { el, pct, chatEl };
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
          top.chatEl.textContent = `💬 1 · ${counts.a} vote${counts.a === 1 ? '' : 's'}`;
          bottom.chatEl.textContent = `💬 2 · ${counts.b} vote${counts.b === 1 ? '' : 's'}`;
          void total;
        },
      }) : null;
      if (chatOn) {
        // Test chat leans towards the character with more fan power.
        const fav = (a.power || 50) >= (b.power || 50) ? ['1', a.name] : ['2', b.name];
        chat.setTestHint(() => (phase === 'picking' ? [...fav, ...fav, '1', '2', a.name, b.name] : []));
      }

      const timerFill = h('div', { class: 'fill' });
      const timer = h('div', { class: `timer ${settings.timer ? '' : 'hidden'}` }, timerFill);
      const hostHint = h('div', { class: 'wv-host chrome' });

      const screen = h('div', { class: 'screen round-screen wv-screen' },
        h('div', { class: 'corner left chrome' }, iconButton('home', 'Quit to menu', () => { finish(); resolve('exit'); exit(); })),
        // Stays visible in clean mode (it sits under the app's own header strip).
        total === 0 && h('div', { class: 'corner right' },
          h('button', { class: 'btn ghost wv-finish', onclick: () => endRun() }, 'Finish'),
        ),
        h('div', { class: 'hud' },
          h('div', { class: 'wv-title' }, 'Who would win?'),
          h('span', { class: 'pill' }, total ? `${index + 1} / ${total}` : `#${index + 1}`),
        ),
        timer,
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
      stats: [
        [`${picks.jedi || 0}`, 'Jedi picks'],
        [`${picks.sith || 0}`, 'Sith picks'],
      ],
      cta: 'Who would YOU pick? 👇',
      onMenu: exit,
      onReplay: replay,
    });
  }
}
