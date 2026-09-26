import { REPO } from '../config.js';
import { GAMES, meetsRequirements } from '../js/registry.js';
import { h, icons } from '../js/ui.js';
import { GitHub } from './github.js';
import { addKey, forgetDevice, listKeys, removeKey, supported, unlock } from './keyvault.js';
import { addEntry, deleteEntry, downloadImage, readMedia, slugify, StoreError, updateEntry } from './store.js';

const app = document.getElementById('app');
const topActions = document.getElementById('top-actions');

const keySvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M16 7l3 3M18.5 4.5l2 2"/></svg>';
const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

// The unlocked GitHub client only ever lives in memory.
let gh = null;
const state = { entries: [], query: '', filter: 'all', publishing: null };

// --- helpers --------------------------------------------------------------------------

function toast(message, kind = '') {
  const el = h('div', { class: `toast ${kind}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 5000);
}

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

function lock() {
  gh = null;
  boot();
}

function handleAuthError(err) {
  if (err.status === 401) {
    toast('GitHub rejected the saved token. Set this device up again with a new token.', 'err');
    return true;
  }
  return false;
}

// --- boot / gate -----------------------------------------------------------------------

function boot() {
  topActions.replaceChildren();
  if (!supported()) {
    app.replaceChildren(h('div', { class: 'gate' },
      h('div', { class: 'key-icon', html: keySvg }),
      h('h1', {}, 'Unsupported browser'),
      h('p', {}, "This browser can't use security keys. Use Chrome or Edge."),
    ));
    return;
  }
  if (gh) return loadDashboard();
  if (listKeys().length) return renderGate();
  renderSetup();
}

function renderSetup() {
  const error = h('div', { class: 'form-error', role: 'alert' });
  const token = h('input', { type: 'password', id: 'gh-token', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…', required: true });
  const label = h('input', { type: 'text', id: 'key-label', placeholder: 'e.g. YubiKey 5C', maxlength: '40' });
  const btn = h('button', { class: 'btn big', type: 'submit' }, 'Lock token to my security key');

  app.replaceChildren(h('div', { class: 'gate wide' },
    h('div', { class: 'key-icon', html: keySvg }),
    h('h1', {}, 'Set up debug mode'),
    h('p', {}, 'Once per device. After this, only your security key can unlock the dashboard.'),
    h('ol', { class: 'steps' },
      h('li', {},
        h('a', { href: TOKEN_URL, target: '_blank', rel: 'noopener' }, 'Create a fine-grained GitHub token ↗'),
        ' with:',
        h('ul', {},
          h('li', {}, 'Repository access: ', h('b', {}, 'Only select repositories'), ' → ', h('code', {}, `${REPO.owner}/${REPO.repo}`)),
          h('li', {}, 'Permissions → Repository → ', h('b', {}, 'Contents: Read and write')),
        ),
      ),
      h('li', {}, 'Paste it below, name your key, and touch the key when asked (usually twice).'),
    ),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = '';
        btn.disabled = true;
        btn.textContent = 'Checking token…';
        try {
          const client = new GitHub(token.value.trim(), REPO);
          await client.checkAccess();
          btn.textContent = 'Touch your security key…';
          await addKey(token.value.trim(), label.value.trim());
          gh = client;
          toast('Security key set up. Welcome to debug mode.', 'ok');
          boot();
        } catch (err) {
          error.textContent = err.message;
        } finally {
          btn.disabled = false;
          btn.textContent = 'Lock token to my security key';
        }
      },
    },
      h('div', {}, h('label', { for: 'gh-token' }, 'GitHub token'), token,
        h('div', { class: 'hint' }, 'The token is encrypted with your key and never stored in plain text.')),
      h('div', {}, h('label', { for: 'key-label' }, 'Key name ', h('span', { class: 'label-note' }, '(optional)')), label),
      error,
      btn,
    ),
  ));
  token.focus();
}

function renderGate() {
  const error = h('div', { class: 'form-error', role: 'alert', style: { marginTop: '12px' } });
  const btn = h('button', { class: 'btn big', onclick: go }, 'Tap security key to unlock');
  app.replaceChildren(h('div', { class: 'gate' },
    h('div', { class: 'key-icon', html: keySvg }),
    h('h1', {}, 'Debug mode'),
    h('p', {}, 'Insert your security key, press the button, then touch the key.'),
    btn,
    error,
    h('p', { class: 'hint', style: { marginTop: '32px' } },
      'Lost your key or need a new token? ',
      h('a', {
        href: '#',
        onclick: (e) => {
          e.preventDefault();
          if (confirm('Remove the saved keys and token from this browser? You can set it up again with a new token.')) {
            forgetDevice();
            boot();
          }
        },
      }, 'Reset this device'),
    ),
  ));

  async function go() {
    error.textContent = '';
    btn.disabled = true;
    try {
      const token = await unlock();
      const client = new GitHub(token, REPO);
      await client.checkAccess();
      gh = client;
      boot();
    } catch (err) {
      error.textContent = err.status === 401
        ? 'Your key worked, but GitHub rejected the saved token (expired?). Use "Reset this device" and set up with a new token.'
        : err.message;
    } finally {
      btn.disabled = false;
    }
  }
}

// --- dashboard --------------------------------------------------------------------------

async function loadDashboard() {
  app.replaceChildren(h('div', { class: 'gate' }, h('p', {}, 'Loading archive…')));
  try {
    const head = await gh.head();
    setEntries((await gh.readArchive(head.sha)).entries);
  } catch (err) {
    if (handleAuthError(err)) return lock();
    toast(err.message, 'err');
  }
  renderDashboard();
}

function setEntries(entries) {
  state.entries = entries.map((e) => ({ ...e, imageUrl: gh.rawUrl(e.image), soundUrl: gh.rawUrl(e.sound) }));
}

// Called after every commit: update the view, then watch for the site to go live.
function committed(archive) {
  setEntries(archive.entries);
  renderStats();
  renderLibrary();
  watchPublish(archive.updatedAt);
}

async function watchPublish(stamp) {
  state.publishing = stamp;
  renderPublish('Publishing to the site…');
  const started = Date.now();
  while (state.publishing === stamp && Date.now() - started < 10 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 8000));
    try {
      const res = await fetch(`../data/archive.json?v=${Date.now()}`, { cache: 'no-store' });
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
  if (state.publishing === stamp) renderPublish('Saved to GitHub. The site is taking a while to update. Check the repo’s Actions tab.', 'warn');
}

const publishEl = h('span', { class: 'publish' });
function renderPublish(text, kind = '') {
  publishEl.className = `publish ${kind}`;
  publishEl.textContent = text;
}

const statsEl = h('div', { class: 'stats' });
const libraryGrid = h('div');
const keysList = h('div');

function renderDashboard() {
  topActions.replaceChildren(
    publishEl,
    h('a', { class: 'btn ghost small', href: '../', target: '_blank', rel: 'noopener' }, 'Open games ↗'),
    h('button', { class: 'btn ghost small', onclick: lock }, 'Lock'),
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
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Security keys on this device')),
      keysList,
      h('div', { class: 'add-key' },
        keyLabel,
        h('button', {
          class: 'btn ghost',
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await addKey(gh.token, keyLabel.value.trim());
              keyLabel.value = '';
              toast('Key added.', 'ok');
              renderKeys();
            } catch (err) {
              toast(err.message, 'err');
            } finally {
              e.target.disabled = false;
            }
          },
        }, 'Register another key'),
      ),
      h('p', { class: 'hint' }, 'Register a backup key so you are never locked out. On another computer or phone, open this page and set it up with a token there.'),
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
      h('img', { src: e.imageUrl, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
      e.sound && h('button', { class: 'play', 'aria-label': `Play ${e.name}`, html: icons.play, onclick: () => playSound(e.soundUrl) }),
    ),
    h('div', { class: 'body' },
      h('div', { class: 'name' }, e.name),
      h('div', {}, h('code', {}, e.id)),
      e.sound ? null : h('div', { class: 'no-sound' }, 'No sound effect'),
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

function renderKeys() {
  const keys = listKeys();
  keysList.replaceChildren(...keys.map((k) => h('div', { class: 'key-row' },
    h('div', {},
      h('b', {}, k.label),
      h('small', {}, `Added ${fmtDate(k.createdAt)} · last used ${fmtDate(k.lastUsedAt)}`),
    ),
    h('button', {
      class: 'btn danger small',
      disabled: keys.length <= 1,
      title: keys.length <= 1 ? "You can't remove your only key" : null,
      onclick: () => {
        if (!confirm(`Remove "${k.label}"? It will no longer unlock debug mode on this device.`)) return;
        removeKey(k.credId);
        renderKeys();
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

  // which games this will appear in
  const unlocks = h('div', { class: 'unlocks' });
  function updateUnlocks() {
    const hasImage = Boolean(entry?.image || imageFile || (imageMode === 'url' && urlInput.value.trim()));
    const hasSound = Boolean(soundFile || (entry?.sound && !removeSound.checked));
    unlocks.replaceChildren('Appears in: ', ...gameChips({ image: hasImage, sound: hasSound }));
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
        const sound = soundFile ? { media: await readMedia(soundFile, 'sound') } : null;
        submit.textContent = 'Committing to GitHub…';
        const archive = entry
          ? await updateEntry(gh, entry.id, { name: name.value, image, sound, removeSound: removeSound.checked })
          : await addEntry(gh, { name: name.value, image, sound });
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
