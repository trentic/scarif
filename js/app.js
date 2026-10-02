import { keepLoadable, loadArchive, poolFor } from './archive.js';
import { ARCHIVES, GAMES, getGame, meetsRequirements, requirementLabel } from './registry.js';
import * as chat from './chat.js';
import { openChatPanel } from './chatpanel.js';
import { runGame } from './engine.js';
import { OPTIONS, onSettingsChange, settings } from './settings.js';
import { audioContext, sfx } from './sfx.js';
import { fitStage } from './stage.js';
import { h, iconButton } from './ui.js';

const stage = document.getElementById('stage');
fitStage(stage);

// Each module exports either `renderer` (runs on the shared quiz engine) or
// `run()` (its own game loop), plus an optional `lobby()` hook.
const modules = {
  sound: () => import('./games/sound.js'),
  picture: () => import('./games/picture.js'),
  zoom: () => import('./games/zoom.js'),
  speed: () => import('./games/speed.js'),
  higherlower: () => import('./games/higherlower.js'),
  whowouldwin: () => import('./games/whowouldwin.js'),
};

let stopCurrent = () => {};

function show(screen) {
  stage.querySelectorAll('.screen, .drawer, .drawer-backdrop').forEach((s) => s.remove());
  stage.prepend(screen);
}

function setAccent(accent) {
  stage.classList.remove('accent-red', 'accent-cyan', 'accent-gold', 'accent-green');
  if (accent) stage.classList.add(`accent-${accent}`);
}

// --- recording helpers ------------------------------------------------------------

function applyRecordingOptions() {
  stage.classList.toggle('clean', Boolean(settings.clean));
  stage.querySelector('.safe-zones')?.remove();
  // Safe-zone guides are for vertical (Shorts/TikTok/Reels) videos only.
  if (settings.safeZones && settings.layout !== '43') {
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
  if ((e.key === 'p' || e.key === 'P') && settings.layout === '43') {
    const order = ['left', 'center', 'right'];
    settings.stagePos = order[(order.indexOf(settings.stagePos) + 1) % order.length];
  }
});

// --- chat status chip -------------------------------------------------------------------
// Test chat always shows a badge (so viewers know votes are fake); otherwise
// the chip is a streamer aid and hides in clean mode.
const chatChip = h('div', { class: 'chat-chip' });
stage.append(chatChip);
function renderChatChip() {
  const { status, detail } = chat.state;
  const test = chat.config.source === 'test' && status !== 'off';
  chatChip.className = `chat-chip ${status} ${test ? 'test' : 'chrome'}`;
  chatChip.hidden = status === 'off';
  chatChip.textContent = test ? '🧪 TEST CHAT (fake votes)'
    : status === 'live' ? '🔴 Chat live'
    : status === 'error' || status === 'quota' ? `⚠ Chat: ${detail}`
    : status === 'connecting' ? '💬 Connecting…'
    : '💬 Chat ready';
}
chat.on('status', renderChatChip);
renderChatChip();

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
            // Show/hide options that depend on this one (e.g. 4:3 position).
            drawer.querySelectorAll('[data-when]').forEach((el) => {
              const dep = OPTIONS.find((o) => o.key === el.dataset.when);
              el.hidden = !dep.when(settings);
            });
          },
        }, label),
      );
      return h('div', { class: 'setting', 'data-when': opt.when ? opt.key : null, hidden: opt.when ? !opt.when(settings) : false },
        h('div', { class: 'title' }, opt.title),
        h('div', { class: 'seg' }, buttons),
        opt.help && h('div', { class: 'help' }, opt.help),
      );
    }),
    h('div', { class: 'keys' }, 'Keyboard: 1–4 answer · Space reveal/next · R replay sound · Z safe zones · C clean mode · P move 4:3 left/center/right · Esc menu'),
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
    h('div', { class: 'corner right' }, iconButton('chat', 'Chat', () => openChatPanel(stage)), iconButton('gear', 'Settings', () => openSettings())),
    logo,
    list,
  ));

  for (const [key, info] of Object.entries(ARCHIVES)) {
    const games = GAMES.filter((g) => g.archive === key);
    if (!games.length) continue;
    const section = h('div', { class: 'game-section' });
    list.append(h('div', { class: 'section-title' }, info.title), section);

    let entries;
    try {
      entries = (await loadArchive(key)).entries;
    } catch {
      section.append(h('div', { class: 'hub-empty' }, `Couldn't load the ${info.noun} archive.`));
      continue;
    }
    for (const g of games) {
      const eligible = entries.filter((e) => meetsRequirements(e, g.requires)).length;
      const locked = eligible < g.minEntries;
      section.append(h('button', {
        class: `game-tile accent-${g.accent} ${locked ? 'locked' : ''}`,
        onclick: () => { location.hash = `#/play/${g.id}`; },
      },
        h('div', { class: 'glyph' }, g.icon),
        h('div', {},
          h('h2', { class: 'display' }, g.title),
          h('div', { class: 'tag' }, g.tagline),
          h('div', { class: 'meta' }, locked
            ? `🔒 Needs ${g.minEntries} ${info.noun} ${requirementLabel(g.requires)} · ${eligible} added`
            : `${eligible} ${info.noun} in the archive`),
        ),
      ));
    }
  }
}

// --- lobby & game -------------------------------------------------------------------------

async function showLobby(gameId) {
  const game = getGame(gameId);
  if (!game) { location.hash = '#/'; return; }
  setAccent(game.accent);

  const [archive, mod] = await Promise.all([
    loadArchive(game.archive).catch(() => ({ entries: [], stats: [] })),
    modules[game.module](),
  ]);
  const pool = poolFor(game, archive);
  const refresh = () => showLobby(gameId);

  // Games can customise the lobby (extra controls, their own facts line).
  const custom = mod.lobby?.({ game, pool, archive, settings, refresh }) || {};
  const ready = custom.ready ?? pool.length >= game.minEntries;
  const rounds = settings.rounds > 0 ? Math.min(settings.rounds, pool.length) : pool.length;

  const facts = !ready
    ? custom.notReady || `Needs ${game.minEntries} ${ARCHIVES[game.archive].noun} ${requirementLabel(game.requires)} · ${pool.length} added. Add more in debug mode.`
    : custom.facts || [`${rounds} rounds`, settings.timer ? `${settings.timer}s timer` : 'no timer', settings.mode === 'host' ? 'host mode' : null]
      .filter(Boolean).join(' · ');

  show(h('div', { class: 'screen lobby' },
    h('div', { class: 'corner left' }, iconButton('home', 'Menu', () => { location.hash = '#/'; })),
    h('div', { class: 'corner right' }, iconButton('chat', 'Chat', () => openChatPanel(stage, refresh)), iconButton('gear', 'Settings', () => openSettings(refresh))),
    h('div', { class: 'glyph' }, game.icon),
    h('h1', { class: 'display' }, game.title),
    h('div', { class: 'tag' }, game.tagline),
    h('div', { class: 'facts' }, facts),
    custom.extra || null,
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
    // Only use entries whose picture actually loads.
    const playable = game.requires.image ? await keepLoadable(pool) : pool;
    if (playable.length < game.minEntries) {
      showLobby(gameId);
      alert(`Only ${playable.length} ${ARCHIVES[game.archive].noun} have a picture that loads right now. Check the pictures in debug mode.`);
      return;
    }
    const opts = {
      stage,
      game,
      pool: playable,
      archive,
      settings,
      register: (stop) => { stopCurrent = () => { stop(); chat.endGame(); }; },
      onExit: () => { location.hash = '#/'; },
      onReplay: start,
    };
    chat.startGame(); // read chat only while a game is running
    if (mod.run) mod.run(opts);
    else runGame({ ...opts, renderer: mod.renderer });
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
