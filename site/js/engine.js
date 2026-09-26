// Shared quiz flow: countdown → rounds (prompt + 4 answers + timer) → results.
// Each game only supplies a "renderer" that draws the prompt for one entry:
//
//   renderer.mount(promptEl, entry, ctx) → { reveal(), replay?(), destroy() }
//   renderer.preload?(entry)
import { settings } from './settings.js';
import { sfx } from './sfx.js';
import { h, iconButton, shuffle, wait } from './ui.js';

const LETTERS = ['A', 'B', 'C', 'D'];
const AUTO_NEXT_MS = 2800;

const RANKS = [
  [100, 'The Chosen One', 'Flawless. The Force is strong with you.'],
  [80, 'Jedi Master', 'You could run the Temple armoury.'],
  [60, 'Jedi Knight', 'Solid aim. Keep training.'],
  [40, 'Padawan', 'You know your way around a blaster.'],
  [20, 'Youngling', 'Better stick to training remotes.'],
  [0, 'Stormtrooper', "Couldn't hit the side of a Star Destroyer."],
];

export function rankFor(score, total) {
  const pct = total ? (score / total) * 100 : 0;
  return RANKS.find(([min]) => pct >= min);
}

export async function runGame({ stage, game, pool, renderer, onExit, onReplay, register }) {
  let alive = true;
  let cleanupRound = () => {};
  const stop = () => {
    alive = false;
    cleanupRound();
    document.removeEventListener('keydown', onKey);
  };

  register?.(stop);

  let keyHandler = null;
  const onKey = (e) => keyHandler?.(e);
  document.addEventListener('keydown', onKey);

  const show = (screen) => {
    stage.querySelectorAll('.screen').forEach((s) => s.remove());
    stage.prepend(screen);
  };

  const exit = () => {
    stop();
    onExit();
  };

  const count = settings.rounds > 0 ? Math.min(settings.rounds, pool.length) : pool.length;
  const targets = shuffle(pool).slice(0, count);
  targets.forEach((e) => renderer.preload?.(e));

  // --- countdown -------------------------------------------------------------
  keyHandler = (e) => e.key === 'Escape' && exit();
  for (const n of [3, 2, 1]) {
    if (!alive) return stop;
    show(h('div', { class: 'screen countdown' }, h('div', { class: 'num' }, n)));
    sfx.beep();
    await wait(850);
  }
  if (!alive) return stop;
  sfx.pew();

  // --- rounds ------------------------------------------------------------------
  let score = 0;
  let streak = 0;
  let bestStreak = 0;

  for (let i = 0; i < targets.length && alive; i++) {
    const result = await playRound(i);
    if (result === 'exit') return stop;
  }
  if (!alive) return stop;
  showResults();
  return stop;

  function playRound(index) {
    return new Promise((resolve) => {
      const target = targets[index];
      const others = shuffle(pool.filter((e) => e.id !== target.id)).slice(0, 3);
      const choices = shuffle([target, ...others]);
      const correctIdx = choices.indexOf(target);

      let phase = 'asking'; // asking → revealed
      let picked = null;
      let timerRaf = 0;
      let nextTimer = 0;
      let lastTick = null;

      // HUD
      const scorePill = h('span', { class: 'pill' }, `★ ${score}`);
      const streakPill = h('span', { class: 'pill streak' }, `🔥 ${streak}`);
      const hud = h('div', { class: 'hud' },
        h('div', { class: 'round' }, 'ROUND ', h('b', {}, index + 1), ` / ${targets.length}`),
        h('div', { class: 'score' }, streakPill, scorePill),
      );

      const timerFill = h('div', { class: 'fill' });
      const timer = h('div', { class: `timer ${settings.timer ? '' : 'hidden'}` }, timerFill);

      const prompt = h('div', { class: 'prompt', onclick: () => onPromptTap() });

      const answerEls = choices.map((entry, i) =>
        h('button', { class: 'answer', onclick: () => pick(i) },
          h('span', { class: 'key' }, LETTERS[i]),
          h('span', {}, entry.name),
        ),
      );
      const answers = h('div', { class: 'answers' }, answerEls);

      const hostBtn = h('button', { class: 'btn', onclick: () => hostAction() }, 'Reveal');
      const hostBar = h('div', { class: 'host-bar chrome' }, hostBtn);
      if (settings.mode !== 'host') hostBar.style.visibility = 'hidden';

      const screen = h('div', { class: 'screen round-screen' },
        h('div', { class: 'corner left chrome' }, iconButton('home', 'Quit to menu', () => { finish(); resolve('exit'); exit(); })),
        hud, timer, prompt, answers, hostBar,
      );
      show(screen);

      const view = renderer.mount(prompt, target, { settings });

      keyHandler = (e) => {
        if (e.repeat) return;
        const k = e.key.toLowerCase();
        const idx = ['1', '2', '3', '4'].indexOf(k) >= 0 ? Number(k) - 1 : ['a', 'b', 'c', 'd'].indexOf(k);
        if (idx >= 0 && idx < choices.length) pick(idx);
        else if (k === ' ' || k === 'enter') { e.preventDefault(); onPromptTap(); }
        else if (k === 'r') view.replay?.();
        else if (k === 'escape') { finish(); resolve('exit'); exit(); }
      };

      cleanupRound = finish;
      startTimer();

      function finish() {
        cancelAnimationFrame(timerRaf);
        clearTimeout(nextTimer);
        view.destroy?.();
        cleanupRound = () => {};
      }

      function startTimer() {
        if (!settings.timer) return;
        const total = settings.timer * 1000;
        const start = performance.now();
        const step = (now) => {
          const left = Math.max(0, total - (now - start));
          timerFill.style.transform = `scaleX(${left / total})`;
          const secs = Math.ceil(left / 1000);
          timer.classList.toggle('low', secs <= 3);
          if (secs <= 3 && secs > 0 && secs !== lastTick) { lastTick = secs; sfx.tick(); }
          if (left <= 0) return timeUp();
          timerRaf = requestAnimationFrame(step);
        };
        timerRaf = requestAnimationFrame(step);
      }

      function timeUp() {
        if (phase !== 'asking') return;
        if (settings.mode === 'host') {
          // In host mode the timer just locks answers; the host reveals.
          answers.style.pointerEvents = 'none';
          if (picked === null) flash('Time!', 'time');
          return;
        }
        reveal();
      }

      function pick(i) {
        if (phase !== 'asking') return;
        if (settings.mode === 'host') {
          picked = i;
          answerEls.forEach((el, j) => el.classList.toggle('picked', j === i));
          sfx.lock();
          return;
        }
        picked = i;
        reveal();
      }

      function onPromptTap() {
        if (settings.mode === 'host') hostAction();
        else if (phase === 'asking') view.replay?.();
        else next();
      }

      function hostAction() {
        if (phase === 'asking') reveal();
        else next();
      }

      function reveal() {
        if (phase !== 'asking') return;
        phase = 'revealed';
        cancelAnimationFrame(timerRaf);
        answers.style.pointerEvents = 'none';

        answerEls.forEach((el, j) => {
          el.classList.remove('picked');
          if (j === correctIdx) el.classList.add('correct');
          else if (j === picked) el.classList.add('wrong');
          else el.classList.add('faded');
        });

        if (picked === correctIdx) {
          score++;
          streak++;
          bestStreak = Math.max(bestStreak, streak);
          flash(streak >= 3 ? `${streak} streak!` : 'Correct!', 'good');
          sfx.correct();
        } else if (picked !== null) {
          streak = 0;
          flash('Wrong!', 'bad');
          sfx.wrong();
        } else if (settings.mode !== 'host') {
          streak = 0;
          flash("Time's up!", 'time');
          sfx.wrong();
        }
        scorePill.textContent = `★ ${score}`;
        streakPill.textContent = `🔥 ${streak}`;
        [scorePill, streakPill].forEach((p) => { p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); });

        view.reveal();
        hostBtn.textContent = index + 1 < targets.length ? 'Next' : 'Results';
        if (settings.mode !== 'host') nextTimer = setTimeout(next, AUTO_NEXT_MS);
      }

      function next() {
        if (phase !== 'revealed') return;
        phase = 'done';
        finish();
        resolve('next');
      }

      function flash(text, kind) {
        const el = h('div', { class: `flash ${kind}` }, text);
        prompt.append(el);
        setTimeout(() => el.remove(), 1400);
      }
    });
  }

  function showResults() {
    const [, rank, blurb] = rankFor(score, targets.length);
    sfx.fanfare();
    keyHandler = (e) => {
      if (e.key === 'Escape') exit();
      if (e.key === 'Enter' || e.key === ' ') { stop(); onReplay(); }
    };
    show(h('div', { class: 'screen results' },
      h('div', { class: 'label' }, game.title),
      h('div', { class: 'big' }, score, h('small', {}, ` / ${targets.length}`)),
      h('div', { class: 'rank display' }, rank),
      h('div', { class: 'rank-sub' }, blurb),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, `${Math.round((score / targets.length) * 100)}%`), h('span', {}, 'Accuracy')),
        h('div', { class: 'stat' }, h('b', {}, `🔥 ${bestStreak}`), h('span', {}, 'Best streak')),
      ),
      h('div', { class: 'cta' }, 'Comment your score 👇'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', onclick: exit }, 'Menu'),
        h('button', { class: 'btn', onclick: () => { stop(); onReplay(); } }, 'Play again'),
      ),
    ));
  }
}
