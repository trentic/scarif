// "Star Wars Wordle": guess the 5-letter Star Wars word in 6 tries.
//
// Daily: one word per day (local midnight), the same for everyone, numbered
// from the schedule's start date and cycling through data/wordle.json (365
// words). Progress, stats and streaks are kept in this browser.
// Practice: random words any time; doesn't touch the daily stats.
//
// Guesses must be in data/wordle-guesses.txt (English 5-letter words plus
// Star Wars words). Tiles: green = right letter, right spot; yellow = in the
// word, wrong spot; grey = not in the word. Letters that repeat are only
// marked as many times as they appear in the answer.
import { SITE_ROOT } from '../archive.js';
import { showScreen } from '../engine.js';
import { sfx } from '../sfx.js';
import { h, iconButton } from '../ui.js';

const WORD = 5;
const TRIES = 6;
const HINT_AFTER = 3; // misses before the category shows (Wordle hint setting)
const PRACTICE_SKIP_DAYS = 30; // practice never uses the next 30 daily words
const STORE = 'scarif.wordle.v1';
const MODE_KEY = 'scarif.wordle.mode';
const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', '+ZXCVBNM-']; // + = Enter, - = Backspace
const WIN_TEXT = ['The Force is strong with you', 'Impressive. Most impressive.', 'Jedi Master', 'Jedi Knight', 'Padawan', 'Phew! Close one'];

const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const loadState = () => ({ daily: {}, stats: { played: 0, won: 0, streak: 0, best: 0, lastWon: 0, dist: [0, 0, 0, 0, 0, 0] }, ...store.get(STORE, {}) });

// --- puzzle of the day ---------------------------------------------------------------------

const decode = (k) => atob(k).split('').reverse().join('');
const localDay = (d) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
function puzzleNumber(start, now = new Date()) {
  const [y, m, d] = start.split('-').map(Number);
  return Math.max(1, localDay(now) - localDay(new Date(y, m - 1, d)) + 1);
}
function puzzle(archive, n) {
  const e = archive.entries[(n - 1) % archive.entries.length];
  return { word: decode(e.k), category: archive.categories[e.c] };
}
function untilMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mins = Math.max(1, Math.round((next - now) / 60000));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

// Scores a guess: 2 = right spot (green), 1 = in the word (yellow), 0 = not in it.
export function score(guess, answer) {
  const result = Array(WORD).fill(0);
  const left = {};
  for (let i = 0; i < WORD; i++) {
    if (guess[i] === answer[i]) result[i] = 2;
    else left[answer[i]] = (left[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < WORD; i++) {
    if (result[i] !== 2 && left[guess[i]] > 0) { result[i] = 1; left[guess[i]]--; }
  }
  return result;
}

let guessList = null;
async function loadGuesses() {
  if (guessList) return guessList;
  try {
    const res = await fetch(new URL('data/wordle-guesses.txt', SITE_ROOT));
    guessList = new Set((await res.text()).split(/\s+/).filter(Boolean).map((w) => w.toUpperCase()));
  } catch {
    guessList = null; // offline: accept any 5 letters rather than block play
  }
  return guessList;
}

// --- lobby -----------------------------------------------------------------------------------

export function lobby({ archive, refresh }) {
  loadGuesses(); // warm up while the lobby shows
  const mode = store.get(MODE_KEY, 'daily') === 'practice' ? 'practice' : 'daily';
  const n = puzzleNumber(archive.start);
  const today = loadState().daily[n];
  const status = !today?.guesses?.length ? 'not played yet'
    : today.done ? `${today.won ? `solved in ${today.guesses.length}` : 'missed'} · next word in ${untilMidnight()}`
      : `in progress · ${today.guesses.length}/${TRIES} guesses`;
  const btn = (id, label) => h('button', {
    'aria-pressed': String(id === mode),
    onclick: () => { store.set(MODE_KEY, id); refresh(); },
  }, label);
  return {
    ready: archive.entries.length > 0,
    extra: h('div', { class: 'hl-choose' },
      h('div', { class: 'title' }, 'Mode'),
      h('div', { class: 'seg' }, btn('daily', `📅 Daily #${n}`), btn('practice', '♾️ Practice')),
    ),
    facts: mode === 'daily' ? `Daily #${n} · ${status}` : 'Random words · doesn’t count towards your streak',
    startLabel: mode === 'practice' ? 'Play' : today?.done ? 'See today’s result' : today?.guesses?.length ? 'Continue' : `Play #${n}`,
  };
}

// --- game ------------------------------------------------------------------------------------

export async function run({ stage, archive, settings, register, onExit }) {
  let keyHandler = null;
  const onKey = (e) => keyHandler?.(e);
  document.addEventListener('keydown', onKey);
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
  const stop = () => {
    document.removeEventListener('keydown', onKey);
    timers.forEach(clearTimeout);
  };
  register?.(stop);
  const exit = () => { stop(); onExit(); };

  const words = await loadGuesses();
  const daily = store.get(MODE_KEY, 'daily') !== 'practice';
  const n = puzzleNumber(archive.start);

  play();

  function play() {
    let answer;
    let category;
    let state = loadState();
    let guesses = [];
    if (daily) {
      ({ word: answer, category } = puzzle(archive, n));
      guesses = state.daily[n]?.guesses || [];
    } else {
      // Any word except the next few weeks of daily puzzles.
      const total = archive.entries.length;
      const skip = new Set(Array.from({ length: Math.min(PRACTICE_SKIP_DAYS, total - 1) }, (_, i) => (n - 1 + i) % total));
      const options = archive.entries.map((_, i) => i).filter((i) => !skip.has(i));
      ({ word: answer, category } = puzzle(archive, options[Math.floor(Math.random() * options.length)] + 1));
    }

    let current = '';
    let busy = false;
    let over = false;
    const keyState = {}; // letter → best score seen (0, 1, 2)

    // board
    const tiles = [];
    const rows = Array.from({ length: TRIES }, (_, r) => {
      const row = h('div', { class: 'wd-row' });
      tiles[r] = Array.from({ length: WORD }, () => {
        const t = h('div', { class: 'wd-tile' });
        row.append(t);
        return t;
      });
      return row;
    });
    const board = h('div', { class: 'wd-board' }, rows);

    // keyboard
    const keyEls = {};
    const keyboard = h('div', { class: 'wd-keys' }, ROWS.map((line) => h('div', { class: 'wd-krow' }, [...line].map((ch) => {
      const label = ch === '+' ? 'Enter' : ch === '-' ? '⌫' : ch;
      const el = h('button', {
        class: `wd-key ${ch === '+' || ch === '-' ? 'wide' : ''}`,
        'aria-label': ch === '+' ? 'Enter' : ch === '-' ? 'Delete' : ch,
        onclick: () => press(ch === '+' ? 'ENTER' : ch === '-' ? 'BACK' : ch),
      }, label);
      if (/[A-Z]/.test(ch)) keyEls[ch] = el;
      return el;
    }))));

    const hint = h('div', { class: 'wd-hint' });
    const toast = h('div', { class: 'wd-toast' });
    const title = daily ? `Wordle #${n}` : 'Practice';
    const screen = h('div', { class: 'screen wd-screen' },
      h('div', { class: 'corner left chrome' }, iconButton('home', 'Quit to menu', exit)),
      h('div', { class: 'hud' }, h('div', { class: 'wd-title' }, title), h('span', { class: 'pill' }, daily ? '📅 Daily' : '♾️ Practice')),
      hint,
      h('div', { class: 'wd-main' }, board, keyboard),
      toast,
    );
    showScreen(stage, screen);

    // Restore a daily game in progress (or finished) without animation.
    guesses.forEach((g, r) => paintRow(r, g, score(g, answer), false));
    updateHint();
    if (daily && state.daily[n]?.done) {
      over = true;
      later(() => endPanel(state.daily[n].won), 300);
    }

    keyHandler = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || stage.querySelector('.drawer')) return;
      if (e.key === 'Escape') return exit();
      if (e.key === 'Enter') { e.preventDefault(); press('ENTER'); }
      else if (e.key === 'Backspace') press('BACK');
      else if (/^[a-z]$/i.test(e.key)) press(e.key.toUpperCase());
    };

    function press(k) {
      if (over || busy) return;
      const r = guesses.length;
      if (k === 'BACK') {
        if (!current) return;
        current = current.slice(0, -1);
        const t = tiles[r][current.length];
        t.textContent = '';
        t.classList.remove('filled');
      } else if (k === 'ENTER') {
        submit();
      } else if (current.length < WORD) {
        const t = tiles[r][current.length];
        current += k;
        t.textContent = k;
        t.classList.remove('filled');
        void t.offsetWidth;
        t.classList.add('filled');
      }
    }

    function submit() {
      const r = guesses.length;
      if (current.length < WORD) return shake(r, 'Not enough letters');
      if (words && !words.has(current)) return shake(r, 'Not in word list');
      const guess = current;
      const result = score(guess, answer);
      guesses.push(guess);
      current = '';
      busy = true;
      sfx.lock();
      paintRow(r, guess, result, true);
      const won = guess === answer;
      const lost = !won && guesses.length === TRIES;
      if (daily) save(won, lost);
      later(() => {
        busy = false;
        updateHint();
        if (won) {
          over = true;
          rows[r].classList.add('win');
          sfx.correct();
          say(WIN_TEXT[guesses.length - 1], 2200);
          later(() => endPanel(true), 1700);
        } else if (lost) {
          over = true;
          sfx.wrong();
          say(answer, 3000);
          later(() => endPanel(false), 1700);
        }
      }, WORD * 260 + 300);
    }

    function paintRow(r, guess, result, animate) {
      tiles[r].forEach((t, i) => {
        t.textContent = guess[i];
        const apply = () => {
          t.classList.add(['grey', 'yellow', 'green'][result[i]], 'done');
          const k = keyEls[guess[i]];
          if (k && (keyState[guess[i]] ?? -1) < result[i]) {
            keyState[guess[i]] = result[i];
            k.classList.remove('grey', 'yellow', 'green');
            k.classList.add(['grey', 'yellow', 'green'][result[i]]);
          }
        };
        if (!animate) return apply();
        t.style.animationDelay = `${i * 260}ms`;
        t.classList.add('flip');
        later(apply, i * 260 + 160);
      });
    }

    function save(won, lost) {
      state = loadState();
      state.daily[n] = { guesses: [...guesses], done: won || lost, won };
      if (won || lost) {
        const s = state.stats;
        if (s.lastPlayed !== n) {
          s.lastPlayed = n;
          s.played++;
          if (won) {
            s.won++;
            s.streak = s.lastWon === n - 1 ? s.streak + 1 : 1;
            s.best = Math.max(s.best, s.streak);
            s.lastWon = n;
            s.dist[guesses.length - 1]++;
          } else {
            s.streak = 0;
          }
        }
      }
      store.set(STORE, state);
    }

    function updateHint() {
      const misses = guesses.filter((g) => g !== answer).length;
      const show = over || (settings.wordleHint !== 'off' && misses >= HINT_AFTER);
      hint.textContent = show ? `💡 Hint: ${category}` : settings.wordleHint === 'off' ? '' : `Hint after ${HINT_AFTER} misses`;
      hint.classList.toggle('on', show);
    }

    function shake(r, text) {
      rows[r].classList.remove('shake');
      void rows[r].offsetWidth;
      rows[r].classList.add('shake');
      say(text, 1200);
    }

    function say(text, ms) {
      toast.textContent = text;
      toast.classList.add('show');
      clearTimeout(toast.hideTimer);
      toast.hideTimer = setTimeout(() => toast.classList.remove('show'), ms);
    }

    function shareText() {
      const grid = guesses.map((g) => score(g, answer).map((s) => ['⬛', '🟨', '🟩'][s]).join('')).join('\n');
      const won = guesses.at(-1) === answer;
      return `Star Wars Wordle #${n} ${won ? guesses.length : 'X'}/${TRIES}\n\n${grid}\n${location.origin}${location.pathname}`;
    }

    function endPanel(won) {
      updateHint();
      toast.classList.remove('show');
      const s = loadState().stats;
      const maxDist = Math.max(1, ...s.dist);
      const shareBtn = h('button', {
        class: 'btn',
        onclick: async () => {
          try { await navigator.clipboard.writeText(shareText()); shareBtn.textContent = 'Copied ✓'; } catch { shareBtn.textContent = 'Copy failed'; }
        },
      }, 'Share');
      const panel = h('div', { class: 'wd-end' },
        h('div', { class: 'wd-end-word' }, won ? WIN_TEXT[guesses.length - 1] : 'The word was'),
        h('div', { class: 'wd-answer' }, answer.split('').map((c) => h('span', {}, c))),
        h('div', { class: 'wd-cat' }, category),
        daily ? [
          h('div', { class: 'wd-stats' },
            [[s.played, 'Played'], [s.played ? Math.round((s.won / s.played) * 100) : 0, 'Win %'], [s.streak, 'Streak'], [s.best, 'Best']]
              .map(([v, l]) => h('div', {}, h('b', {}, v), h('span', {}, l)))),
          h('div', { class: 'wd-dist' }, s.dist.map((c, i) => h('div', { class: 'wd-bar-row' },
            h('span', {}, i + 1),
            h('div', { class: `wd-bar ${won && guesses.length === i + 1 ? 'mine' : ''}`, style: { width: `${8 + (c / maxDist) * 92}%` } }, c),
          ))),
          h('div', { class: 'wd-next' }, `Next word in ${untilMidnight()}`),
        ] : null,
        h('div', { class: 'wd-actions' },
          daily ? shareBtn : h('button', { class: 'btn', onclick: () => { timers.forEach(clearTimeout); play(); } }, 'Next word'),
          h('button', { class: 'btn ghost', onclick: exit }, 'Menu'),
        ),
      );
      screen.append(panel);
      sfx.fanfare();
      keyHandler = (e) => {
        if (e.key === 'Escape') exit();
        if (e.key === 'Enter' && !daily) { e.preventDefault(); play(); }
      };
    }
  }
}
