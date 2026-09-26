import { loadArchive, loadPool } from './archive.js';
import { GAMES, getGame, meetsRequirements } from './registry.js';
import { runGame } from './engine.js';
import { OPTIONS, onSettingsChange, settings } from './settings.js';
import { audioContext, sfx } from './sfx.js';
import { fitStage } from './stage.js';
import { h, iconButton } from './ui.js';

const stage = document.getElementById('stage');
fitStage(stage);

const renderers = {
  sound: () => import('./games/sound.js'),
  picture: () => import('./games/picture.js'),
};

let stopCurrent = () => {};

function show(screen) {
  stage.querySelectorAll('.screen, .drawer, .drawer-backdrop').forEach((s) => s.remove());
  stage.prepend(screen);
}

function setAccent(accent) {
  stage.classList.remove('accent-red', 'accent-cyan');
  if (accent) stage.classList.add(`accent-${accent}`);
}

// --- recording helpers ------------------------------------------------------------

function applyRecordingOptions() {
  stage.classList.toggle('clean', Boolean(settings.clean));
  stage.querySelector('.safe-zones')?.remove();
  if (settings.safeZones) {
    stage.append(h('div', { class: 'safe-zones' },
      h('div', { class: 'top' }, 'App header'),
      h('div', { class: 'side' }, 'Like / share'),
      h('div', { class: 'bottom' }, 'Caption / buttons'),
    ));
  }
}
onSettingsChange(applyRecordingOptions);
applyRecordingOptions();

document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  if (e.key === 'z' || e.key === 'Z') settings.safeZones = !settings.safeZones;
  if (e.key === 'c' || e.key === 'C') settings.clean = !settings.clean;
});

// --- settings drawer ----------------------------------------------------------------

function openSettings(onClose) {
  const close = () => { backdrop.remove(); drawer.remove(); onClose?.(); };
  const backdrop = h('div', { class: 'drawer-backdrop', onclick: close });
  const drawer = h('div', { class: 'drawer', role: 'dialog', 'aria-label': 'Settings' },
    h('div', { class: 'corner right' }, iconButton('close', 'Close settings', close)),
    h('h3', { class: 'display' }, 'Settings'),
    OPTIONS.map((opt) => {
      const buttons = opt.choices.map(([value, label]) =>
        h('button', {
          'aria-pressed': String(settings[opt.key] === value),
          onclick: () => {
            settings[opt.key] = value;
            buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(opt.choices[i][0] === value)));
          },
        }, label),
      );
      return h('div', { class: 'setting' },
        h('div', { class: 'title' }, opt.title),
        h('div', { class: 'seg' }, buttons),
        opt.help && h('div', { class: 'help' }, opt.help),
      );
    }),
    h('div', { class: 'keys' }, 'Keyboard: 1–4 answer · Space reveal/next · R replay sound · Z safe zones · C clean mode · Esc menu'),
  );
  stage.append(backdrop, drawer);
}

// --- hub ------------------------------------------------------------------------------

async function showHub() {
  setAccent('red');
  let taps = 0;
  let tapTimer = 0;
  const logo = h('div', {
    class: 'hub-logo',
    // Hidden door to debug mode: tap the logo five times.
    onclick: () => {
      clearTimeout(tapTimer);
      if (++taps >= 5) location.href = 'debug/';
      tapTimer = setTimeout(() => { taps = 0; }, 1500);
    },
  },
    h('div', { class: 'mark' }, 'SCARIF'),
    h('div', { class: 'sub' }, 'Blaster Archives'),
    h('div', { class: 'rule' }),
  );
  const list = h('div', { class: 'game-list' });
  show(h('div', { class: 'screen' },
    h('div', { class: 'corner right' }, iconButton('gear', 'Settings', () => openSettings())),
    logo,
    list,
  ));

  let entries = [];
  try {
    entries = (await loadArchive()).entries;
  } catch {
    list.append(h('div', { class: 'hub-empty' }, "Couldn't load the blaster archive."));
    return;
  }
  const games = GAMES.map((g) => ({ ...g, eligible: entries.filter((e) => meetsRequirements(e, g.requires)).length }));

  for (const g of games) {
    const locked = g.eligible < g.minEntries;
    const needs = g.requires.sound ? 'with a sound' : 'with an image';
    list.append(h('button', {
      class: `game-tile accent-${g.accent} ${locked ? 'locked' : ''}`,
      onclick: () => { location.hash = `#/play/${g.id}`; },
    },
      h('div', { class: 'glyph' }, g.icon),
      h('div', {},
        h('h2', { class: 'display' }, g.title),
        h('div', { class: 'tag' }, g.tagline),
        h('div', { class: 'meta' }, locked
          ? `🔒 Needs ${g.minEntries} blasters ${needs} · ${g.eligible} added`
          : `${g.eligible} blasters in the archive`),
      ),
    ));
  }
}

// --- lobby & game -------------------------------------------------------------------------

async function showLobby(gameId) {
  const game = getGame(gameId);
  if (!game) { location.hash = '#/'; return; }
  setAccent(game.accent);

  const pool = await loadPool(game.id).catch(() => []);
  const ready = pool.length >= game.minEntries;
  const rounds = settings.rounds > 0 ? Math.min(settings.rounds, pool.length) : pool.length;

  const facts = ready
    ? [`${rounds} rounds`, settings.timer ? `${settings.timer}s timer` : 'no timer', settings.mode === 'host' ? 'host mode' : null]
      .filter(Boolean).join(' · ')
    : `Needs ${game.minEntries} blasters · ${pool.length} added. Add more in debug mode.`;

  show(h('div', { class: 'screen lobby' },
    h('div', { class: 'corner left' }, iconButton('home', 'Menu', () => { location.hash = '#/'; })),
    h('div', { class: 'corner right' }, iconButton('gear', 'Settings', () => openSettings(() => showLobby(gameId)))),
    h('div', { class: 'glyph' }, game.icon),
    h('h1', { class: 'display' }, game.title),
    h('div', { class: 'tag' }, game.tagline),
    h('div', { class: 'facts' }, facts),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', disabled: !ready, style: ready ? null : { opacity: 0.4 }, onclick: () => ready && start() }, 'Start'),
    ),
  ));

  const onKey = (e) => {
    if (e.key === 'Enter' && ready && !stage.querySelector('.drawer')) start();
  };
  document.addEventListener('keydown', onKey);
  stopCurrent = () => document.removeEventListener('keydown', onKey);

  async function start() {
    stopCurrent();
    audioContext(); // unlock audio inside the tap
    sfx.lock();
    const { renderer } = await renderers[game.module]();
    runGame({
      stage,
      game,
      pool,
      renderer,
      register: (stop) => { stopCurrent = stop; },
      onExit: () => { location.hash = '#/'; },
      onReplay: start,
    });
  }
}

// --- router -------------------------------------------------------------------------------

function route() {
  stopCurrent();
  stopCurrent = () => {};
  const m = location.hash.match(/^#\/play\/([\w-]+)/);
  if (m) showLobby(m[1]);
  else showHub();
}

window.addEventListener('hashchange', route);
route();
