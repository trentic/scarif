import { GAMES, meetsRequirements } from '/shared/games.js';
import { h, icons } from '/js/ui.js';
import { createCredential, getAssertion, supported } from './webauthn.js';

const app = document.getElementById('app');
const topActions = document.getElementById('top-actions');

const keySvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M16 7l3 3M18.5 4.5l2 2"/></svg>';

const state = { entries: [], keys: [], query: '', filter: 'all' };

// --- helpers --------------------------------------------------------------------------

async function api(path, { method = 'GET', json, form } = {}) {
  const res = await fetch(path, {
    method,
    headers: json ? { 'Content-Type': 'application/json' } : undefined,
    body: json ? JSON.stringify(json) : form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(message, kind = '') {
  const el = h('div', { class: `toast ${kind}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 4000);
}

function keyError(err) {
  if (err.name === 'NotAllowedError') return 'Cancelled, or the key timed out. Try again.';
  if (err.name === 'InvalidStateError') return 'That key is already registered.';
  if (err.name === 'SecurityError') return 'Security keys need HTTPS (or localhost). Check the site address.';
  return err.message;
}

// Mirror of the server's slugify, for the "called as" preview.
const slugify = (name) =>
  name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'never');

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

// --- boot / gate -----------------------------------------------------------------------

async function boot() {
  topActions.replaceChildren();
  const status = await api('/api/auth/status').catch(() => null);
  if (!status) {
    app.replaceChildren(h('div', { class: 'gate' }, h('h1', {}, 'Server unreachable')));
    return;
  }
  if (!status.loggedIn) return renderGate(status.hasKeys);
  state.keys = status.keys;
  await loadDashboard();
}

function renderGate(hasKeys) {
  const error = h('div', { class: 'form-error' });
  const warn = !supported() && h('p', {}, "This browser doesn't support security keys.");

  if (!hasKeys) {
    const code = h('input', { type: 'text', id: 'setup-code', autocomplete: 'off', spellcheck: 'false', placeholder: 'e.g. 3F9A1C2B', required: true });
    const label = h('input', { type: 'text', id: 'key-label', placeholder: 'e.g. YubiKey 5C', maxlength: '40' });
    const btn = h('button', { class: 'btn big', type: 'submit' }, 'Register security key');
    app.replaceChildren(h('div', { class: 'gate' },
      h('div', { class: 'key-icon', html: keySvg }),
      h('h1', {}, 'First-time setup'),
      h('p', {}, 'Enter the one-time setup code printed in the server console, then tap your security key.'),
      warn,
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = '';
          btn.disabled = true;
          try {
            await registerKey({ setupCode: code.value, label: label.value });
            toast('Security key registered. Welcome to debug mode.', 'ok');
            boot();
          } catch (err) {
            error.textContent = keyError(err);
          } finally {
            btn.disabled = false;
          }
        },
      },
        h('div', {}, h('label', { for: 'setup-code' }, 'Setup code'), code),
        h('div', {}, h('label', { for: 'key-label' }, 'Key name ', h('span', { class: 'label-note' }, '(optional)')), label),
        error,
        btn,
      ),
    ));
    code.focus();
    return;
  }

  const btn = h('button', { class: 'btn big', onclick: unlock }, 'Tap security key to unlock');
  app.replaceChildren(h('div', { class: 'gate' },
    h('div', { class: 'key-icon', html: keySvg }),
    h('h1', {}, 'Debug mode'),
    h('p', {}, 'Insert your security key, press the button below, then touch the key.'),
    warn,
    btn,
    h('div', { class: 'form-error', style: { marginTop: '12px' } }, error),
  ));

  async function unlock() {
    error.textContent = '';
    btn.disabled = true;
    try {
      const options = await api('/api/auth/login/options', { method: 'POST', json: {} });
      const assertion = await getAssertion(options);
      await api('/api/auth/login/verify', { method: 'POST', json: assertion });
      boot();
    } catch (err) {
      error.textContent = keyError(err);
    } finally {
      btn.disabled = false;
    }
  }
}

async function registerKey({ setupCode, label }) {
  const options = await api('/api/auth/register/options', { method: 'POST', json: { setupCode, label } });
  const credential = await createCredential(options);
  await api('/api/auth/register/verify', { method: 'POST', json: credential });
}

// --- dashboard --------------------------------------------------------------------------

async function loadDashboard() {
  try {
    const data = await api('/api/entries');
    state.entries = data.entries;
  } catch (err) {
    if (err.status === 401) return boot();
    toast(err.message, 'err');
  }
  renderDashboard();
}

async function refresh() {
  const [entries, status] = await Promise.all([api('/api/entries'), api('/api/auth/status')]);
  state.entries = entries.entries;
  state.keys = status.keys || [];
  renderStats();
  renderLibrary();
  renderKeys();
}

const statsEl = h('div', { class: 'stats' });
const libraryGrid = h('div');
const keysList = h('div');

function renderDashboard() {
  topActions.replaceChildren(
    h('a', { class: 'btn ghost small', href: '/', target: '_blank', rel: 'noopener' }, 'Open games ↗'),
    h('button', {
      class: 'btn ghost small',
      onclick: async () => { await api('/api/auth/logout', { method: 'POST' }); boot(); },
    }, 'Lock'),
  );

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

  const keyLabel = h('input', { type: 'text', placeholder: 'New key name, e.g. Backup key', maxlength: '40' });

  app.replaceChildren(
    statsEl,
    h('div', { class: 'layout' },
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Add to archive')),
        entryForm({ onSaved: () => { toast('Added to the archive.', 'ok'); refresh(); } }),
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
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Security keys')),
      keysList,
      h('div', { class: 'add-key' },
        keyLabel,
        h('button', {
          class: 'btn ghost',
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await registerKey({ label: keyLabel.value });
              keyLabel.value = '';
              toast('Key added.', 'ok');
              refresh();
            } catch (err) {
              toast(keyError(err), 'err');
            } finally {
              e.target.disabled = false;
            }
          },
        }, 'Register another key'),
      ),
      h('p', { class: 'hint' }, 'Register a backup key so you are never locked out.'),
    ),
  );
  renderStats();
  renderLibrary();
  renderKeys();
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
      h('img', { src: e.image, alt: '', loading: 'lazy' }),
      e.sound && h('button', { class: 'play', 'aria-label': `Play ${e.name}`, html: icons.play, onclick: () => playSound(e.sound) }),
    ),
    h('div', { class: 'body' },
      h('div', { class: 'name' }, e.name),
      h('div', {}, h('code', {}, e.id)),
      e.sound ? null : h('div', { class: 'no-sound' }, 'No sound effect'),
      h('div', { class: 'chips' }, gameChips(e)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost small', onclick: () => openEdit(e) }, 'Edit'),
        h('button', {
          class: 'btn danger small',
          onclick: async () => {
            if (!confirm(`Delete "${e.name}"? This removes its image and sound too.`)) return;
            try {
              await api(`/api/entries/${e.id}`, { method: 'DELETE' });
              toast(`Deleted ${e.name}.`);
              refresh();
            } catch (err) {
              toast(err.message, 'err');
            }
          },
        }, 'Delete'),
      ),
    ),
  ))));
}

function renderKeys() {
  keysList.replaceChildren(...state.keys.map((k) => h('div', { class: 'key-row' },
    h('div', {},
      h('b', {}, k.label),
      h('small', {}, `Added ${fmtDate(k.createdAt)} · last used ${fmtDate(k.lastUsedAt)}`),
    ),
    h('button', {
      class: 'btn danger small',
      disabled: state.keys.length <= 1,
      title: state.keys.length <= 1 ? "You can't remove your only key" : null,
      onclick: async () => {
        if (!confirm(`Remove "${k.label}"? It will no longer unlock debug mode.`)) return;
        try {
          await api(`/api/auth/keys/${encodeURIComponent(k.id)}`, { method: 'DELETE' });
          refresh();
        } catch (err) {
          toast(err.message, 'err');
        }
      },
    }, 'Remove'),
  )));
}

function openEdit(entry) {
  const dialog = h('dialog', {});
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.append(
    h('div', { class: 'card-head' }, h('h2', {}, 'Edit entry')),
    entryForm({
      entry,
      onSaved: () => { close(); toast('Saved.', 'ok'); refresh(); },
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

  // name
  const name = h('input', { type: 'text', id: `name-${uid}`, required: true, maxlength: '80', placeholder: 'e.g. DL-44 Heavy Blaster Pistol', value: entry?.name || '' });
  const calledAs = h('code', {}, entry?.id || '…');
  const nameHint = h('div', { class: 'hint' }, 'Called as ', calledAs, entry ? ' (stays the same if you rename)' : '');
  name.addEventListener('input', () => {
    if (!entry) calledAs.textContent = slugify(name.value) || '…';
  });

  // image
  const imgPreview = h('img', { alt: '', hidden: !entry, src: entry?.image || null });
  const imgPrompt = h('span', { hidden: Boolean(entry) }, 'Drop an image or click to choose');
  const imgInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/avif', 'aria-label': 'Image file' });
  const imgDrop = h('div', { class: 'drop' }, imgPreview, imgPrompt, imgInput);
  const urlInput = h('input', { type: 'url', placeholder: 'https://… (right-click an image → Copy image address)' });
  const urlPreview = h('img', { alt: '', hidden: true, style: { maxHeight: '160px', maxWidth: '100%', marginTop: '10px', objectFit: 'contain' } });
  const urlPane = h('div', { hidden: true }, urlInput, urlPreview,
    h('div', { class: 'hint' }, 'The image is downloaded and stored on your server, so it keeps working if the original disappears.'));

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
    onclick: () => {
      imageMode = mode;
      tabBtns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
      imgDrop.hidden = mode !== 'upload';
      urlPane.hidden = mode !== 'url';
      updateUnlocks();
    },
    'data-mode': mode,
  }, label));

  // sound
  const soundPrompt = h('span', {}, entry?.sound ? 'Drop a new sound to replace it' : 'Drop a sound or click to choose');
  const soundInput = h('input', { type: 'file', accept: 'audio/*,.mp3,.wav,.ogg,.m4a,.flac,.webm', 'aria-label': 'Sound file' });
  const soundDrop = h('div', { class: 'drop small' }, soundPrompt, soundInput);
  const soundAudio = h('audio', { controls: true, preload: 'none', src: entry?.sound || null });
  const soundPreview = h('div', { class: 'sound-preview', hidden: !entry?.sound }, soundAudio);
  const removeSound = h('input', { type: 'checkbox' });
  const removeRow = entry?.sound && h('label', { class: 'check' }, removeSound, 'Remove sound effect');
  removeSound.addEventListener('change', () => {
    soundPreview.style.opacity = removeSound.checked ? 0.35 : 1;
    updateUnlocks();
  });

  const setSoundFile = (file) => {
    if (!file) return;
    soundFile = file;
    soundAudio.src = URL.createObjectURL(file);
    soundPreview.hidden = false;
    soundPrompt.textContent = file.name;
    if (removeRow) { removeSound.checked = false; soundPreview.style.opacity = 1; }
    updateUnlocks();
  };
  soundInput.addEventListener('change', () => setSoundFile(soundInput.files[0]));
  wireDrop(soundDrop, setSoundFile);

  // unlocks
  const unlocks = h('div', { class: 'unlocks' });
  function updateUnlocks() {
    const hasImage = Boolean(entry?.image || imageFile || (imageMode === 'url' && urlInput.value.trim()));
    const hasSound = Boolean(soundFile || (entry?.sound && !removeSound.checked));
    unlocks.replaceChildren('Appears in: ', ...gameChips({ image: hasImage, sound: hasSound }));
  }
  updateUnlocks();

  // submit
  const error = h('div', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn', type: 'submit' }, entry ? 'Save changes' : 'Add to archive');

  const form = h('form', {
    class: 'entry-form',
    onsubmit: async (e) => {
      e.preventDefault();
      error.textContent = '';
      const fd = new FormData();
      fd.append('name', name.value);
      if (imageMode === 'upload' && imageFile) fd.append('image', imageFile);
      if (imageMode === 'url' && urlInput.value.trim()) fd.append('imageUrl', urlInput.value.trim());
      if (soundFile) fd.append('sound', soundFile);
      else if (removeSound.checked) fd.append('removeSound', 'true');

      if (!entry && !fd.has('image') && !fd.has('imageUrl')) {
        error.textContent = 'Add an image (upload a file or paste an image address).';
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Saving…';
      try {
        await api(entry ? `/api/entries/${entry.id}` : '/api/entries', { method: entry ? 'PATCH' : 'POST', form: fd });
        if (!entry) reset();
        onSaved?.();
      } catch (err) {
        if (err.status === 401) return boot();
        error.textContent = err.message;
      } finally {
        submit.disabled = false;
        submit.textContent = entry ? 'Save changes' : 'Add to archive';
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
      removeRow,
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
