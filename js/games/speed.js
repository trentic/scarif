// "Speed Round": as many blasters as you can name before the clock runs out.
// No reveal pause: a right or wrong answer flashes and the next one appears.
import { countdown, resultsScreen, showScreen } from '../engine.js';
import { sfx } from '../sfx.js';
import { h, iconButton, shuffle } from '../ui.js';

const LETTERS = ['A', 'B', 'C', 'D'];
const NEXT_AFTER_RIGHT = 250;
const NEXT_AFTER_WRONG = 700;

// Ranks by answers per minute, so 30s and 90s rounds compare fairly.
const RANKS = [
  [30, 'The Chosen One', 'Faster than a blaster bolt.'],
  [22, 'Jedi Master', 'Reflexes of a Jedi.'],
  [15, 'Jedi Knight', 'Quick draw. Keep training.'],
  [9, 'Padawan', 'Getting faster every round.'],
  [4, 'Youngling', 'Blink and you missed it.'],
  [0, 'Stormtrooper', 'Still aiming…'],
];

export function lobby({ settings }) {
  return { facts: `${settings.speedSeconds}s on the clock · as many as you can` };
}

export async function run({ stage, game, pool, settings, register, onExit, onReplay }) {
  let alive = true;
  let raf = 0;
  let nextTimer = 0;
  let keyHandler = null;
  const onKey = (e) => keyHandler?.(e);
  document.addEventListener('keydown', onKey);
  const stop = () => {
    alive = false;
    cancelAnimationFrame(raf);
    clearTimeout(nextTimer);
    document.removeEventListener('keydown', onKey);
  };
  register?.(stop);
  const exit = () => { stop(); onExit(); };

  pool.forEach((e) => { new Image().src = e.image; });

  keyHandler = (e) => e.key === 'Escape' && exit();
  if (!(await countdown(stage, () => alive))) return;

  const seconds = settings.speedSeconds || 60;
  let score = 0;
  let answered = 0;
  let streak = 0;
  let bestStreak = 0;

  // Cycle through the pool in shuffled passes, never repeating back to back.
  let queue = [];
  let last = null;
  const nextTarget = () => {
    if (!queue.length) {
      queue = shuffle(pool);
      if (queue[0] === last && queue.length > 1) queue.push(queue.shift());
    }
    last = queue.shift();
    return last;
  };

  // --- screen -------------------------------------------------------------------
  const clock = h('div', { class: 'speed-clock' });
  const scorePill = h('span', { class: 'pill' }, '★ 0');
  const streakPill = h('span', { class: 'pill streak' }, '🔥 0');
  const timerFill = h('div', { class: 'fill' });
  const timer = h('div', { class: 'timer' }, timerFill);
  const img = h('img', { alt: '', draggable: 'false' });
  const frame = h('div', { class: 'picture-frame speed-frame' }, img);
  const prompt = h('div', { class: 'prompt' }, frame);
  const answers = h('div', { class: 'answers' });

  showScreen(stage, h('div', { class: 'screen round-screen' },
    h('div', { class: 'corner left chrome' }, iconButton('home', 'Quit to menu', exit)),
    h('div', { class: 'hud' }, clock, h('div', { class: 'score' }, streakPill, scorePill)),
    timer,
    prompt,
    answers,
  ));

  let target = null;
  let choices = [];
  let locked = false;

  function deal() {
    target = nextTarget();
    choices = shuffle([target, ...shuffle(pool.filter((e) => e.id !== target.id)).slice(0, 3)]);
    img.src = target.image;
    frame.classList.remove('pop');
    void frame.offsetWidth;
    frame.classList.add('pop');
    answers.replaceChildren(...choices.map((entry, i) =>
      h('button', { class: 'answer', onclick: () => pick(i) },
        h('span', { class: 'key' }, LETTERS[i]),
        h('span', {}, entry.name),
      ),
    ));
    locked = false;
  }

  function pick(i) {
    if (locked || !alive) return;
    locked = true;
    answered++;
    const buttons = [...answers.children];
    const right = choices[i] === target;
    if (right) {
      score++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      buttons[i].classList.add('correct');
      sfx.correct();
    } else {
      streak = 0;
      buttons[i].classList.add('wrong');
      buttons[choices.indexOf(target)].classList.add('correct');
      sfx.wrong();
    }
    scorePill.textContent = `★ ${score}`;
    streakPill.textContent = `🔥 ${streak}`;
    nextTimer = setTimeout(deal, right ? NEXT_AFTER_RIGHT : NEXT_AFTER_WRONG);
  }

  keyHandler = (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    const idx = ['1', '2', '3', '4'].indexOf(k) >= 0 ? Number(k) - 1 : ['a', 'b', 'c', 'd'].indexOf(k);
    if (idx >= 0) pick(idx);
    else if (k === 'escape') exit();
  };

  // --- clock ------------------------------------------------------------------------
  const total = seconds * 1000;
  const started = performance.now();
  let lastTick = null;
  const tick = (now) => {
    const left = Math.max(0, total - (now - started));
    const secs = Math.ceil(left / 1000);
    clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    timerFill.style.transform = `scaleX(${left / total})`;
    const low = secs <= 5;
    timer.classList.toggle('low', low);
    clock.classList.toggle('low', low);
    if (low && secs > 0 && secs !== lastTick) { lastTick = secs; sfx.tick(); }
    if (left <= 0) return finish();
    raf = requestAnimationFrame(tick);
  };

  deal();
  raf = requestAnimationFrame(tick);

  function finish() {
    locked = true;
    clearTimeout(nextTimer);
    const perMinute = (score / seconds) * 60;
    const [, rank, blurb] = RANKS.find(([min]) => perMinute >= min);
    const replay = () => { stop(); onReplay(); };
    keyHandler = (e) => {
      if (e.key === 'Escape') exit();
      if (e.key === 'Enter' || e.key === ' ') replay();
    };
    resultsScreen(stage, {
      title: game.title,
      big: score,
      of: null,
      rank,
      blurb,
      stats: [
        [answered ? `${Math.round((score / answered) * 100)}%` : '–', 'Accuracy'],
        [`🔥 ${bestStreak}`, 'Best streak'],
      ],
      cta: `How many can you get in ${seconds}s? 👇`,
      onMenu: exit,
      onReplay: replay,
    });
  }
}
