import { REPO } from '../config.js';
import { GAMES, meetsRequirements } from '../js/registry.js';
import { formatStat, h, icons } from '../js/ui.js';
import { GitHub } from './github.js';
import { keepLocalCopy, loadVault, MIN_PASSWORD, openToken, sealToken, VAULT_PATH } from './vault.js';
import { leaveCharacters, renderCharacters } from './characters.js';
import { createTrimmer } from './trimmer.js';
import {
  addEntry, addStatType, deleteEntry, deleteStatType, downloadImage, readMedia, slugify, StoreError, updateEntry, updateStatType,
} from './store.js';

const app = document.getElementById('app');
const topActions = document.getElementById('top-actions');

const lockSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10.5" width="16" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><circle cx="12" cy="15.5" r="1.4"/></svg>';
const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

// The unlocked GitHub client only ever lives in memory.
let gh = null;
const state = { entries: [], statTypes: [], query: '', filter: 'all', publishing: null, tab: 'blasters' };
try { state.tab = localStorage.getItem('scarif.debug.tab') || 'blasters'; } catch {}

// --- helpers --------------------------------------------------------------------------

function toast(message, kind = '') {
  const el = h('div', { class: `toast ${kind}` }, message);
  const box = document.getElementById('toasts');
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => el.remove(), 5000);
}

let player = null;
function playSound(url) {
  player?.pause();
  player = new Audio(url);
  player.play().catch(() => toast("Couldn't play that sound.", 'err'));
}

function gameChips(entryLike) {
  return GAMES.map((g) => h('span', {
    class: `chip accent-${g.accent} ${meetsRequirements(entryLike, g.requires) ? 'on' : ''}`,
    title: `${g.title}: needs ${Object.keys(g.requires).filter((k) => g.requires[k]).join(' + ')}`,
  }, g.icon, ' ', g.title));
}

function lock() {
  leaveCharacters();
  gh = null;
  boot();
}

function handleAuthError(err) {
  if (err.status === 401) {
    toast('GitHub rejected the saved token. Use "Set up again" on the unlock screen with a new token.', 'err');
    return true;
  }
  return false;
}

// --- boot / gate -----------------------------------------------------------------------

async function boot() {
  topActions.replaceChildren();
  if (gh) return openTab(state.tab);
  app.replaceChildren(h('div', { class: 'gate' }, h('p', {}, 'Loading…')));
  const vault = await loadVault();
  if (vault) renderGate(vault);
  else renderSetup();
}

function passwordInput(id, placeholder, autocomplete) {
  return h('input', { type: 'password', id, placeholder, autocomplete, required: true });
}

function renderSetup({ reset = false } = {}) {
  const error = h('div', { class: 'form-error', role: 'alert' });
  const token = h('input', { type: 'password', id: 'gh-token', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…', required: true });
  const pw = passwordInput('pw', `At least ${MIN_PASSWORD} characters`, 'new-password');
  const pw2 = passwordInput('pw2', 'Type it again', 'new-password');
  const idle = reset ? 'Save new password' : 'Set password';
  const btn = h('button', { class: 'btn big', type: 'submit' }, idle);

  app.replaceChildren(h('div', { class: 'gate wide' },
    h('div', { class: 'key-icon', html: lockSvg }),
    h('h1', {}, reset ? 'Set up again' : 'Set up debug mode'),
    h('p', {}, 'One time only. After this, any device just needs the password.'),
    h('ol', { class: 'steps' },
      h('li', {},
        h('a', { href: TOKEN_URL, target: '_blank', rel: 'noopener' }, 'Create a fine-grained GitHub token ↗'),
        ' with:',
        h('ul', {},
          h('li', {}, 'Repository access: ', h('b', {}, 'Only select repositories'), ' → ', h('code', {}, `${REPO.owner}/${REPO.repo}`)),
          h('li', {}, 'Permissions → Repository → ', h('b', {}, 'Contents: Read and write')),
        ),
      ),
      h('li', {}, 'Paste it below and choose the debug-mode password.'),
    ),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = '';
        if (pw.value !== pw2.value) {
          error.textContent = "The passwords don't match.";
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Checking token…';
        try {
          const client = new GitHub(token.value.trim(), REPO);
          await client.checkAccess();
          btn.textContent = 'Saving…';
          const vault = await sealToken(token.value.trim(), pw.value);
          await client.putText(VAULT_PATH, `${JSON.stringify(vault, null, 2)}\n`, 'Debug mode: set password');
          keepLocalCopy(vault);
          gh = client;
          toast('Password set. Welcome to debug mode.', 'ok');
          boot();
        } catch (err) {
          error.textContent = err.message;
        } finally {
          btn.disabled = false;
          btn.textContent = idle;
        }
      },
    },
      h('div', {}, h('label', { for: 'gh-token' }, 'GitHub token'), token,
        h('div', { class: 'hint' }, 'Stored in the repo only in encrypted form, locked with your password.')),
      h('div', {}, h('label', { for: 'pw' }, 'Password'), pw,
        h('div', { class: 'hint' }, 'The encrypted file is public, so make it long. A short phrase of 4+ words works well.')),
      h('div', {}, h('label', { for: 'pw2' }, 'Confirm password'), pw2),
      error,
      btn,
      reset && h('button', { class: 'btn ghost', type: 'button', onclick: () => boot() }, 'Back'),
    ),
  ));
  token.focus();
}

function renderGate(vault) {
  const error = h('div', { class: 'form-error', role: 'alert' });
  const pw = passwordInput('pw', 'Password', 'current-password');
  const btn = h('button', { class: 'btn big', type: 'submit' }, 'Unlock');
  app.replaceChildren(h('div', { class: 'gate' },
    h('div', { class: 'key-icon', html: lockSvg }),
    h('h1', {}, 'Debug mode'),
    h('p', {}, 'Enter the password to manage the blaster archive.'),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = '';
        btn.disabled = true;
        btn.textContent = 'Unlocking…';
        try {
          const token = await openToken(vault, pw.value);
          const client = new GitHub(token, REPO);
          await client.checkAccess();
          gh = client;
          boot();
        } catch (err) {
          error.textContent = err.status === 401
            ? 'Password correct, but GitHub rejected the saved token (expired?). Use "Set up again" with a new token.'
            : err.message;
          pw.select();
        } finally {
          btn.disabled = false;
          btn.textContent = 'Unlock';
        }
      },
    },
      h('div', {}, h('label', { for: 'pw' }, 'Password'), pw),
      error,
      btn,
    ),
    h('p', { class: 'hint', style: { marginTop: '32px' } },
      'Forgot the password or need a new token? ',
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); renderSetup({ reset: true }); } }, 'Set up again'),
    ),
  ));
  pw.focus();
}

// --- tabs -------------------------------------------------------------------------------

const TABS = [['blasters', '🔫 Blasters'], ['characters', '⚔️ Characters']];
const tabsBar = h('div', { class: 'tabs-bar', role: 'tablist' });
const content = h('div');

function openTab(tab) {
  state.tab = TABS.some(([key]) => key === tab) ? tab : 'blasters';
  try { localStorage.setItem('scarif.debug.tab', state.tab); } catch {}
  leaveCharacters();
  tabsBar.replaceChildren(...TABS.map(([key, label]) => h('button', {
    role: 'tab',
    'aria-selected': String(key === state.tab),
    onclick: () => key !== state.tab && openTab(key),
  }, label)));
  topActions.replaceChildren(
    publishEl,
    h('a', { class: 'btn ghost small', href: '../', target: '_blank', rel: 'noopener' }, 'Open games ↗'),
    h('button', { class: 'btn ghost small', onclick: lock }, 'Lock'),
  );
  app.replaceChildren(tabsBar, content);
  if (state.tab === 'characters') {
    renderCharacters(content, {
      gh,
      toast,
      watchPublish,
      onAuthError: (err) => (handleAuthError(err) ? (lock(), true) : false),
    });
  } else {
    loadDashboard();
  }
}

// --- dashboard (blasters) -------------------------------------------------------------------

async function loadDashboard() {
  content.replaceChildren(h('div', { class: 'gate' }, h('p', {}, 'Loading archive…')));
  try {
    const head = await gh.head();
    setArchive(await gh.readArchive(head.sha));
  } catch (err) {
    if (handleAuthError(err)) return lock();
    // Don't show an empty (and editable) archive when it couldn't be read.
    content.replaceChildren(h('div', { class: 'gate' },
      h('h1', {}, "Couldn't load the archive"),
      h('p', {}, err.message),
      h('button', { class: 'btn big', onclick: () => location.reload() }, 'Reload'),
    ));
    return;
  }
  renderDashboard();
}

function setArchive(archive) {
  state.statTypes = archive.stats || [];
  state.entries = archive.entries.map((e) => ({ ...e, imageUrl: gh.rawUrl(e.image), soundUrl: gh.rawUrl(e.sound) }));
}

// Called after every commit: update the view, then watch for the site to go live.
// `full` rebuilds the whole dashboard (stat types changed, so forms change too).
function committed(archive, { full = false } = {}) {
  setArchive(archive);
  if (full) renderDashboard();
  else {
    renderStats();
    renderLibrary();
    renderStatTypes();
  }
  watchPublish(archive.updatedAt);
}

async function watchPublish(stamp, file = 'archive') {
  state.publishing = stamp;
  renderPublish('Publishing to the site…');
  const started = Date.now();
  while (state.publishing === stamp && Date.now() - started < 10 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 8000));
    try {
      const res = await fetch(`../data/${file}.json?v=${Date.now()}`, { cache: 'no-store' });
      if ((await res.json()).updatedAt === stamp) {
        if (state.publishing === stamp) {
          state.publishing = null;
          renderPublish('Live on the site ✓', 'ok');
          setTimeout(() => !state.publishing && renderPublish(''), 6000);
        }
        return;
      }
    } catch {}
  }
  if (state.publishing === stamp) renderPublish('Saved to GitHub. The site is taking a while to update. Check the repo’s Actions tab for the Pages deploy.', 'warn');
}

const publishEl = h('span', { class: 'publish' });
function renderPublish(text, kind = '') {
  publishEl.className = `publish ${kind}`;
  publishEl.textContent = text;
}

const statsEl = h('div', { class: 'stats' });
const libraryGrid = h('div');

function renderDashboard() {

  const search = h('input', {
    type: 'search',
    placeholder: 'Search names…',
    value: state.query,
    oninput: (e) => { state.query = e.target.value; renderLibrary(); },
  });
  const filters = [['all', 'All'], ['sound', 'With sound'], ['nosound', 'No sound']];
  const filterBtns = filters.map(([key, label]) => h('button', {
    'aria-pressed': String(state.filter === key),
    onclick: () => {
      state.filter = key;
      filterBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(filters[i][0] === key)));
      renderLibrary();
    },
  }, label));

  content.replaceChildren(
    statsEl,
    h('div', { class: 'layout' },
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Add to archive')),
        entryForm({ onSaved: (archive) => { toast('Added to the archive.', 'ok'); committed(archive); } }),
      ),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h2', {}, 'Archive'),
          h('div', { class: 'filter' }, filterBtns),
        ),
        h('div', { class: 'library-tools' }, search),
        libraryGrid,
      ),
    ),
    statTypesEl,
    passwordCard(),
  );
  renderStats();
  renderLibrary();
  renderStatTypes();
}

function renderStats() {
  const withSound = state.entries.filter((e) => e.sound).length;
  statsEl.replaceChildren(
    h('div', { class: 'stat' }, h('b', {}, state.entries.length), h('span', {}, 'Entries')),
    h('div', { class: 'stat' }, h('b', {}, withSound), h('span', {}, 'With sound effect')),
    ...GAMES.map((g) => {
      const n = state.entries.filter((e) => meetsRequirements(e, g.requires)).length;
      return h('div', { class: `stat ${n < g.minEntries ? 'warn' : ''}` },
        h('b', {}, n),
        h('span', {}, `${g.icon} ${g.title}${n < g.minEntries ? ` (needs ${g.minEntries})` : ''}`),
      );
    }),
  );
}

function renderLibrary() {
  const q = state.query.trim().toLowerCase();
  const list = state.entries.filter((e) =>
    (!q || e.name.toLowerCase().includes(q) || e.id.includes(q)) &&
    (state.filter === 'all' || (state.filter === 'sound') === Boolean(e.sound)),
  );

  if (list.length === 0) {
    libraryGrid.replaceChildren(h('div', { class: 'empty' },
      state.entries.length ? 'Nothing matches.' : 'The archive is empty. Add your first blaster on the left.'));
    return;
  }

  libraryGrid.replaceChildren(h('div', { class: 'grid' }, list.map((e) => h('article', { class: 'entry' },
    h('div', { class: 'thumb' },
      h('img', { src: e.imageUrl, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
      e.sound && h('button', { class: 'play', 'aria-label': `Play ${e.name}`, html: icons.play, onclick: () => playSound(e.soundUrl) }),
    ),
    h('div', { class: 'body' },
      h('div', { class: 'name' }, e.name),
      h('div', {}, h('code', {}, e.id)),
      e.sound ? null : h('div', { class: 'no-sound' }, 'No sound effect'),
      statLine(e),
      /^https?:/.test(e.image) ? h('div', { class: 'no-sound' }, 'Image is linked, not copied') : null,
      h('div', { class: 'chips' }, gameChips(e)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost small', onclick: () => openEdit(e) }, 'Edit'),
        h('button', {
          class: 'btn danger small',
          onclick: async (ev) => {
            if (!confirm(`Delete "${e.name}"? This removes its image and sound too.`)) return;
            ev.target.disabled = true;
            try {
              committed(await deleteEntry(gh, e.id));
              toast(`Deleted ${e.name}.`);
            } catch (err) {
              if (handleAuthError(err)) return lock();
              toast(err.message, 'err');
              ev.target.disabled = false;
            }
          },
        }, 'Delete'),
      ),
    ),
  ))));
}

function statLine(e) {
  const parts = state.statTypes.filter((t) => Number.isFinite(e.stats?.[t.id])).map((t) => `${t.name}: ${formatStat(e.stats[t.id], t.unit)}`);
  return parts.length ? h('div', { class: 'entry-stats' }, parts.join(' · ')) : null;
}

const statTypesEl = h('section', { class: 'card' });

function renderStatTypes() {
  const error = h('div', { class: 'form-error', role: 'alert' });
  const name = h('input', { type: 'text', placeholder: 'Stat name, e.g. Price', maxlength: '40', required: true });
  const unit = h('input', { type: 'text', placeholder: 'Unit, e.g. credits (optional)', maxlength: '20' });
  const btn = h('button', { class: 'btn ghost', type: 'submit' }, 'Add stat');

  const run = async (el, work) => {
    el.disabled = true;
    error.textContent = '';
    try {
      committed(await work(), { full: true });
    } catch (err) {
      if (handleAuthError(err)) return lock();
      error.textContent = err.message;
      el.disabled = false;
    }
  };

  const rows = state.statTypes.map((t) => {
    const count = state.entries.filter((e) => Number.isFinite(e.stats?.[t.id])).length;
    return h('div', { class: 'key-row' },
      h('div', {},
        h('b', {}, t.name), t.unit ? h('span', { class: 'label-note' }, ` (${t.unit})`) : null,
        h('small', {}, `${count} blaster${count === 1 ? '' : 's'} have a value${count < 3 ? ' · Higher or Lower needs 3' : ''}`),
      ),
      h('div', { class: 'row-actions' },
        h('button', {
          class: 'btn ghost small',
          onclick: (ev) => {
            const newName = prompt('Stat name', t.name);
            if (newName == null) return;
            const newUnit = prompt('Unit (leave empty for none)', t.unit || '');
            if (newUnit == null) return;
            run(ev.target, () => updateStatType(gh, t.id, { name: newName, unit: newUnit }));
          },
        }, 'Edit'),
        h('button', {
          class: 'btn danger small',
          onclick: (ev) => {
            if (!confirm(`Delete the "${t.name}" stat? Its values are removed from every blaster.`)) return;
            run(ev.target, () => deleteStatType(gh, t.id));
          },
        }, 'Delete'),
      ),
    );
  });

  statTypesEl.replaceChildren(
    h('div', { class: 'card-head' }, h('h2', {}, 'Stats'), h('span', { class: 'hint' }, 'Numbers for 📊 Higher or Lower')),
    rows.length ? h('div', {}, rows) : h('p', { class: 'hint' }, 'No stats yet. Add one (e.g. Price in credits, Length in cm, Year of first appearance), then fill in values when adding or editing blasters.'),
    h('form', {
      class: 'add-key',
      onsubmit: (e) => {
        e.preventDefault();
        run(btn, () => addStatType(gh, { name: name.value, unit: unit.value }));
      },
    }, name, unit, btn),
    error,
  );
}

function passwordCard() {
  const error = h('div', { class: 'form-error', role: 'alert' });
  const pw = passwordInput('new-pw', `New password (${MIN_PASSWORD}+ characters)`, 'new-password');
  const pw2 = passwordInput('new-pw2', 'Confirm new password', 'new-password');
  const btn = h('button', { class: 'btn ghost', type: 'submit' }, 'Change password');
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Password')),
    h('form', {
      class: 'add-key',
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = '';
        if (pw.value !== pw2.value) {
          error.textContent = "The passwords don't match.";
          return;
        }
        btn.disabled = true;
        try {
          const vault = await sealToken(gh.token, pw.value);
          await gh.putText(VAULT_PATH, `${JSON.stringify(vault, null, 2)}\n`, 'Debug mode: change password');
          keepLocalCopy(vault);
          pw.value = pw2.value = '';
          toast('Password changed. Other devices pick it up once the site updates (about a minute).', 'ok');
        } catch (err) {
          if (handleAuthError(err)) return lock();
          error.textContent = err.message;
        } finally {
          btn.disabled = false;
        }
      },
    }, pw, pw2, btn),
    error,
  );
}

function openEdit(entry) {
  const dialog = h('dialog', {});
  const close = () => { dialog.querySelectorAll('audio').forEach((a) => a.pause()); dialog.close(); dialog.remove(); };
  dialog.append(
    h('div', { class: 'card-head' }, h('h2', {}, 'Edit entry')),
    entryForm({
      entry,
      onSaved: (archive) => { close(); toast('Saved.', 'ok'); committed(archive); },
      onCancel: close,
    }),
  );
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dialog);
  dialog.showModal();
}

// --- add / edit form ------------------------------------------------------------------------

function entryForm({ entry = null, onSaved, onCancel }) {
  const uid = Math.random().toString(36).slice(2, 8);
  let imageFile = null;
  let soundFile = null;
  let imageMode = 'upload';

  // 1. name
  const name = h('input', { type: 'text', id: `name-${uid}`, required: true, maxlength: '80', placeholder: 'e.g. DL-44 Heavy Blaster Pistol', value: entry?.name || '' });
  const calledAs = h('code', {}, entry?.id || '…');
  const nameHint = h('div', { class: 'hint' }, 'Called as ', calledAs, entry ? ' (stays the same if you rename)' : '');
  name.addEventListener('input', () => {
    if (!entry) calledAs.textContent = slugify(name.value) || '…';
  });

  // 2. image
  const imgPreview = h('img', { alt: '', hidden: !entry, src: entry?.imageUrl || null, referrerpolicy: 'no-referrer' });
  const imgPrompt = h('span', { hidden: Boolean(entry) }, 'Drop an image or click to choose');
  const imgInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/avif', 'aria-label': 'Image file' });
  const imgDrop = h('div', { class: 'drop' }, imgPreview, imgPrompt, imgInput);
  const urlInput = h('input', { type: 'url', placeholder: 'https://… (right-click an image → Copy image address)' });
  const urlPreview = h('img', { alt: '', hidden: true, referrerpolicy: 'no-referrer', style: { maxHeight: '160px', maxWidth: '100%', marginTop: '10px', objectFit: 'contain' } });
  const linkOnly = h('input', { type: 'checkbox' });
  const urlPane = h('div', { hidden: true }, urlInput, urlPreview,
    h('label', { class: 'check' }, linkOnly, 'Link to it instead of copying'),
    h('div', { class: 'hint' }, 'Copying stores the image in your repo, so it keeps working if the original disappears. Some sites block copying. If so, tick the box, or save the image and upload it.'));

  const setImageFile = (file) => {
    if (!file) return;
    imageFile = file;
    imgPreview.src = URL.createObjectURL(file);
    imgPreview.hidden = false;
    imgPrompt.hidden = true;
    updateUnlocks();
  };
  imgInput.addEventListener('change', () => setImageFile(imgInput.files[0]));
  wireDrop(imgDrop, setImageFile);
  urlInput.addEventListener('input', () => {
    const ok = /^https?:\/\/\S+$/i.test(urlInput.value.trim());
    urlPreview.hidden = !ok;
    if (ok) urlPreview.src = urlInput.value.trim();
    updateUnlocks();
  });
  urlPreview.addEventListener('error', () => { urlPreview.hidden = true; });

  const tabBtns = [['upload', 'Upload'], ['url', 'Image address']].map(([mode, label]) => h('button', {
    type: 'button',
    role: 'tab',
    'aria-selected': String(mode === 'upload'),
    'data-mode': mode,
    onclick: () => {
      imageMode = mode;
      tabBtns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
      imgDrop.hidden = mode !== 'upload';
      urlPane.hidden = mode !== 'url';
      updateUnlocks();
    },
  }, label));

  // 3. sound
  const soundPrompt = h('span', {}, entry?.sound ? 'Drop a new sound to replace it' : 'Drop a sound or click to choose');
  const soundInput = h('input', { type: 'file', accept: 'audio/*,.mp3,.wav,.ogg,.m4a,.flac,.webm', 'aria-label': 'Sound file' });
  const soundDrop = h('div', { class: 'drop small' }, soundPrompt, soundInput);
  const soundAudio = h('audio', { controls: true, preload: 'none', src: entry?.soundUrl || null });
  const trimmer = createTrimmer();
  let trimExisting = false;
  const trimBtn = entry?.sound && h('button', {
    type: 'button',
    class: 'btn ghost small',
    onclick: () => {
      trimExisting = true;
      soundPreview.hidden = true;
      trimmer.load(entry.soundUrl);
    },
  }, '✂ Trim this sound');
  const soundPreview = h('div', { class: 'sound-preview', hidden: !entry?.sound }, soundAudio, trimBtn);
  const removeSound = h('input', { type: 'checkbox' });
  const removeRow = entry?.sound && h('label', { class: 'check' }, removeSound, 'Remove sound effect');
  removeSound.addEventListener('change', () => {
    soundPreview.style.opacity = removeSound.checked ? 0.35 : 1;
    trimmer.el.style.opacity = removeSound.checked ? 0.35 : 1;
    updateUnlocks();
  });

  const setSoundFile = (file) => {
    if (!file) return;
    soundFile = file;
    trimExisting = false;
    soundPreview.hidden = true;
    trimmer.load(file);
    soundPrompt.textContent = file.name;
    if (removeRow) { removeSound.checked = false; trimmer.el.style.opacity = 1; }
    updateUnlocks();
  };
  soundInput.addEventListener('change', () => setSoundFile(soundInput.files[0]));
  wireDrop(soundDrop, setSoundFile);

  // 4. stats
  const statInputs = state.statTypes.map((t) => {
    const input = h('input', {
      type: 'number',
      step: 'any',
      inputmode: 'decimal',
      'aria-label': t.name,
      value: Number.isFinite(entry?.stats?.[t.id]) ? String(entry.stats[t.id]) : null,
      oninput: () => updateUnlocks(),
    });
    return { t, input, row: h('label', { class: 'stat-field' }, h('span', {}, t.name), input, h('span', { class: 'unit' }, t.unit || '')) };
  });
  const readStats = () => Object.fromEntries(statInputs.filter(({ input }) => input.value.trim() !== '').map(({ t, input }) => [t.id, Number(input.value)]));

  // which games this will appear in
  const unlocks = h('div', { class: 'unlocks' });
  function updateUnlocks() {
    const hasImage = Boolean(entry?.image || imageFile || (imageMode === 'url' && urlInput.value.trim()));
    const hasSound = Boolean(soundFile || (entry?.sound && !removeSound.checked));
    const hasStats = Object.keys(readStats?.() || {}).length > 0;
    unlocks.replaceChildren('Appears in: ', ...gameChips({ image: hasImage, sound: hasSound, stats: hasStats }));
  }
  updateUnlocks();

  // submit
  const error = h('div', { class: 'form-error', role: 'alert' });
  const submitLabel = entry ? 'Save changes' : 'Add to archive';
  const submit = h('button', { class: 'btn', type: 'submit' }, submitLabel);

  async function collectImage() {
    if (imageMode === 'upload') return imageFile ? { media: await readMedia(imageFile, 'image') } : null;
    const url = urlInput.value.trim();
    if (!url) return null;
    if (linkOnly.checked) {
      if (!/^https:\/\//i.test(url)) throw new StoreError('Linked images must use https://');
      return { link: url };
    }
    try {
      return { media: await downloadImage(url) };
    } catch (err) {
      if (err.message !== 'BLOCKED') throw err;
      linkOnly.focus();
      throw new StoreError('That site blocks copying its images. Tick "Link to it instead of copying", or save the image and upload it.');
    }
  }

  const form = h('form', {
    class: 'entry-form',
    onsubmit: async (e) => {
      e.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      submit.textContent = 'Saving…';
      try {
        const image = await collectImage();
        if (!entry && !image) throw new StoreError('Add an image (upload a file or paste an image address).');
        let sound = null;
        if (soundFile) {
          sound = { media: await readMedia(trimmer.isTrimmed() ? trimmer.toWav() : soundFile, 'sound') };
        } else if (trimExisting && trimmer.isTrimmed() && !removeSound.checked) {
          sound = { media: await readMedia(trimmer.toWav(), 'sound') };
        }
        trimmer.stop();
        submit.textContent = 'Committing to GitHub…';
        const archive = entry
          ? await updateEntry(gh, entry.id, { name: name.value, image, sound, removeSound: removeSound.checked, stats: readStats() })
          : await addEntry(gh, { name: name.value, image, sound, stats: readStats() });
        if (!entry) reset();
        onSaved?.(archive);
      } catch (err) {
        if (handleAuthError(err)) return lock();
        error.textContent = err.message;
      } finally {
        submit.disabled = false;
        submit.textContent = submitLabel;
      }
    },
  },
    h('div', {}, h('label', { for: `name-${uid}` }, '1. Name'), name, nameHint),
    h('div', {},
      h('label', {}, '2. Image', entry ? h('span', { class: 'label-note' }, ' (replace, optional)') : null),
      h('div', { class: 'tabs', role: 'tablist' }, tabBtns),
      imgDrop,
      urlPane,
    ),
    h('div', {},
      h('label', {}, '3. Sound effect ', h('span', { class: 'label-note' }, '(optional)')),
      soundDrop,
      soundPreview,
      trimmer.el,
      removeRow,
    ),
    h('div', {},
      h('label', {}, '4. Stats ', h('span', { class: 'label-note' }, '(optional, for Higher or Lower)')),
      statInputs.length
        ? h('div', { class: 'stat-fields' }, statInputs.map(({ row }) => row))
        : h('div', { class: 'hint' }, 'Add stat types in the Stats section below to use Higher or Lower.'),
    ),
    unlocks,
    error,
    h('div', { class: 'form-actions' },
      onCancel && h('button', { class: 'btn ghost', type: 'button', onclick: onCancel }, 'Cancel'),
      submit,
    ),
  );

  function reset() {
    form.reset();
    imageFile = null;
    soundFile = null;
    calledAs.textContent = '…';
    imgPreview.hidden = true;
    imgPrompt.hidden = false;
    urlPreview.hidden = true;
    soundPreview.hidden = true;
    trimmer.clear();
    trimExisting = false;
    soundPrompt.textContent = 'Drop a sound or click to choose';
    updateUnlocks();
    name.focus();
  }

  return form;
}

function wireDrop(zone, onFile) {
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    onFile(e.dataTransfer.files[0]);
  });
}

boot();
