// Debug mode → Characters tab: the Jedi & Sith archive for character games.
//
// Quick pictures: hover a character card and press Ctrl+V (or click
// "📋 Paste") to use whatever you last copied: an image address, or the
// image itself. Dropping an image file on a card works too.
import { SIDES } from '../js/registry.js';
import { h } from '../js/ui.js';
import { addCharacter, CHAR_FILE, deleteCharacter, setCharacterImage, updateCharacter } from './character-store.js';
import { downloadImage, readMedia, StoreError } from './store.js';
import { openWikiImport } from './wiki-import.js';

const FILTERS = [['all', 'All'], ['jedi', 'Jedi'], ['sith', 'Sith'], ['missing', 'No picture']];

const view = {
  ctx: null,
  root: null,
  entries: [],
  filter: 'all',
  query: '',
  busy: new Set(),
  hovered: null, // id of the card under the mouse
  active: false,
};

// One global paste listener; it only acts while this tab is showing and the
// mouse is over a card (and you're not typing in a field).
document.addEventListener('paste', (e) => {
  if (!view.active || !view.hovered) return;
  if (e.target.closest?.('input, textarea, [contenteditable]')) return;
  const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
  const text = e.clipboardData?.getData('text/uri-list') || e.clipboardData?.getData('text/plain') || '';
  if (!file && !text.trim()) return;
  e.preventDefault();
  setPicture(view.hovered, file || text);
});

export async function renderCharacters(root, ctx) {
  view.ctx = ctx;
  view.root = root;
  view.active = true;
  root.replaceChildren(h('div', { class: 'gate' }, h('p', {}, 'Loading characters…')));
  try {
    const head = await ctx.gh.head();
    view.entries = (await ctx.gh.readArchive(head.sha, CHAR_FILE)).entries;
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    root.replaceChildren(h('div', { class: 'gate' },
      h('h1', {}, "Couldn't load the characters"),
      h('p', {}, err.message),
      h('button', { class: 'btn big', onclick: () => location.reload() }, 'Reload'),
    ));
    return;
  }
  render();
}

export function leaveCharacters() {
  view.active = false;
  view.hovered = null;
}

// --- rendering -----------------------------------------------------------------------

const statsEl = h('div', { class: 'stats' });
const gridEl = h('div');

function render() {
  const search = h('input', {
    type: 'search',
    placeholder: 'Search characters…',
    value: view.query,
    oninput: (e) => { view.query = e.target.value; renderGrid(); },
  });
  const filterBtns = FILTERS.map(([key, label]) => h('button', {
    'aria-pressed': String(view.filter === key),
    onclick: () => {
      view.filter = key;
      filterBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(FILTERS[i][0] === key)));
      renderGrid();
    },
  }, label));

  view.root.replaceChildren(
    statsEl,
    h('div', { class: 'tip' },
      h('b', {}, '⚡ Quick pictures: '),
      'hover a character and press ', h('kbd', {}, 'Ctrl'), '+', h('kbd', {}, 'V'),
      ' (or click 📋 Paste) to use what you last copied: an image address or the image itself. You can also drop an image file on a card.',
    ),
    h('div', { class: 'layout' },
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Add character')),
        characterForm({ onSaved: (archive) => { view.ctx.toast('Character added.', 'ok'); saved(archive); } }),
      ),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h2', {}, 'Characters'),
          h('div', { class: 'head-btns' },
            h('button', { class: 'btn small', onclick: () => openWikiImport(wikiCtx()) }, '🌐 Import from Wookieepedia'),
            missingBtn,
          ),
        ),
        h('div', { class: 'filter' }, filterBtns),
        h('div', { class: 'library-tools' }, search),
        gridEl,
      ),
    ),
  );
  renderStats();
  renderGrid();
}

const wikiCtx = (extra = {}) => ({
  kind: 'characters',
  gh: view.ctx.gh,
  entries: view.entries,
  toast: view.ctx.toast,
  onAuthError: view.ctx.onAuthError,
  onSaved: saved,
  ...extra,
});
const missingBtn = h('button', { class: 'btn ghost small', onclick: () => openWikiImport(wikiCtx({ findMissing: true })) });

function renderStats() {
  const n = (fn) => view.entries.filter(fn).length;
  const missing = n((e) => !e.image);
  missingBtn.hidden = !missing;
  missingBtn.textContent = `🖼 Find ${missing} missing picture${missing === 1 ? '' : 's'}`;
  statsEl.replaceChildren(
    h('div', { class: 'stat' }, h('b', {}, view.entries.length), h('span', {}, 'Characters')),
    h('div', { class: 'stat' }, h('b', {}, n((e) => e.side === 'jedi')), h('span', {}, 'Jedi')),
    h('div', { class: 'stat' }, h('b', {}, n((e) => e.side === 'sith')), h('span', {}, 'Sith')),
    h('div', { class: `stat ${missing ? 'warn' : ''}` }, h('b', {}, view.entries.length - missing), h('span', {}, `With a picture${missing ? ` · ${missing} to go` : ''}`)),
  );
}

function renderGrid() {
  const q = view.query.trim().toLowerCase();
  const list = view.entries.filter((e) =>
    (!q || e.name.toLowerCase().includes(q)) &&
    (view.filter === 'all' || (view.filter === 'missing' ? !e.image : e.side === view.filter)),
  );
  if (!list.length) {
    gridEl.replaceChildren(h('div', { class: 'empty' }, view.entries.length ? 'Nothing matches.' : 'No characters yet. Add one on the left.'));
    return;
  }
  gridEl.replaceChildren(h('div', { class: 'grid' }, list.map(card)));
}

function card(e) {
  const busy = view.busy.has(e.id);
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/gif,image/webp,image/avif',
    hidden: true,
    onchange: () => fileInput.files[0] && setPicture(e.id, fileInput.files[0]),
  });
  const el = h('article', { class: `entry char-card ${e.image ? '' : 'missing'} ${busy ? 'busy' : ''}`, 'data-id': e.id },
    h('div', { class: 'thumb' },
      e.image
        ? h('img', { src: view.ctx.gh.rawUrl(e.image), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
        : h('div', { class: 'no-pic' }, h('span', {}, '?'), 'No picture'),
      h('div', { class: 'char-actions' },
        h('button', { class: 'btn small', onclick: () => pasteFromClipboard(e.id) }, '📋 Paste'),
        h('button', { class: 'btn ghost small', onclick: () => fileInput.click() }, '⬆ Upload'),
        h('div', { class: 'char-hint' }, 'or Ctrl+V · drop a file'),
      ),
      busy ? h('div', { class: 'char-busy' }, 'Saving…') : null,
      fileInput,
    ),
    h('div', { class: 'body' },
      h('div', { class: 'char-top' },
        h('span', { class: `side-badge ${e.side}` }, SIDES[e.side]?.label || e.side),
        h('span', { class: 'char-power', title: 'Fan power (1–100)' }, `⚡ ${e.power}`),
      ),
      h('div', { class: 'name' }, e.name),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost small', onclick: () => openEdit(e) }, 'Edit'),
        h('button', {
          class: 'btn danger small',
          onclick: async (ev) => {
            if (!confirm(`Delete "${e.name}"?`)) return;
            ev.target.disabled = true;
            await save(e.id, () => deleteCharacter(view.ctx.gh, e.id), `Deleted ${e.name}.`);
          },
        }, 'Delete'),
      ),
    ),
  );
  el.addEventListener('mouseenter', () => { view.hovered = e.id; });
  el.addEventListener('mouseleave', () => { if (view.hovered === e.id) view.hovered = null; });
  el.addEventListener('dragover', (ev) => { ev.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (ev) => {
    ev.preventDefault();
    el.classList.remove('over');
    const file = [...ev.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    const url = ev.dataTransfer.getData('text/uri-list') || ev.dataTransfer.getData('text/plain');
    if (file || url) setPicture(e.id, file || url);
  });
  return el;
}

// --- saving ----------------------------------------------------------------------------

function saved(archive) {
  view.entries = archive.entries;
  renderStats();
  renderGrid();
  view.ctx.watchPublish(archive.updatedAt, 'characters');
}

async function save(id, work, message) {
  if (id) {
    view.busy.add(id);
    renderGrid();
  }
  try {
    const archive = await work();
    if (message) view.ctx.toast(message, 'ok');
    saved(archive);
    return true;
  } catch (err) {
    if (view.ctx.onAuthError(err)) return false;
    view.ctx.toast(err.message, 'err');
    return false;
  } finally {
    if (id) {
      view.busy.delete(id);
      renderGrid();
    }
  }
}

// Turns a pasted/dropped File or text into { media } or { link }.
async function toImage(source) {
  if (source instanceof Blob) return { image: { media: await readMedia(source, 'image') }, note: 'Picture saved' };
  const text = String(source).trim().split(/\s+/)[0];
  if (!/^https?:\/\//i.test(text)) throw new StoreError("The clipboard doesn't have an image address. Right-click an image → Copy image address, then try again.");
  try {
    return { image: { media: await downloadImage(text) }, note: 'Picture saved' };
  } catch (err) {
    if (err.message !== 'BLOCKED') throw err;
    // The site won't let us copy it; link to it instead so pasting still works.
    return { image: { link: text }, note: 'Picture linked (that site blocks copying)' };
  }
}

async function setPicture(id, source) {
  const entry = view.entries.find((e) => e.id === id);
  if (!entry || view.busy.has(id)) return;
  view.busy.add(id);
  renderGrid();
  let prepared;
  try {
    prepared = await toImage(source);
  } catch (err) {
    view.busy.delete(id);
    renderGrid();
    view.ctx.toast(err.message, 'err');
    return;
  }
  view.busy.delete(id);
  await save(id, () => setCharacterImage(view.ctx.gh, id, prepared.image), `${prepared.note}: ${entry.name}`);
}

async function pasteFromClipboard(id) {
  try {
    if (navigator.clipboard?.read) {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) return setPicture(id, await item.getType(type));
      }
    }
    const text = await navigator.clipboard.readText();
    return setPicture(id, text);
  } catch {
    view.ctx.toast('The browser blocked clipboard access. Allow it when asked, or hover the card and press Ctrl+V.', 'err');
  }
}

// --- forms -----------------------------------------------------------------------------

function sideField(initial) {
  let side = initial;
  const btns = Object.entries(SIDES).map(([key, { label }]) => h('button', {
    type: 'button',
    class: `side-btn ${key}`,
    'aria-pressed': String(key === side),
    onclick: () => {
      side = key;
      btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.side === side)));
    },
    'data-side': key,
  }, label));
  return { el: h('div', { class: 'filter side-pick' }, btns), get: () => side };
}

function powerField(initial) {
  const out = h('b', {}, initial);
  const range = h('input', { type: 'range', min: '1', max: '100', value: String(initial), 'aria-label': 'Fan power', oninput: () => { out.textContent = range.value; } });
  return {
    el: h('div', { class: 'power-field' }, range, out),
    get: () => Number(range.value),
    set: (v) => { range.value = String(v); out.textContent = String(v); },
  };
}

function characterForm({ entry = null, onSaved, onCancel }) {
  const uid = Math.random().toString(36).slice(2, 8);
  const name = h('input', { type: 'text', id: `cname-${uid}`, required: true, maxlength: '60', placeholder: 'e.g. Ahsoka Tano', value: entry?.name || '' });
  const side = sideField(entry?.side || 'jedi');
  const power = powerField(entry?.power ?? 50);
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/avif', 'aria-label': 'Picture file' });
  const url = h('input', { type: 'url', placeholder: '…or paste an image address' });
  const removePic = h('input', { type: 'checkbox' });
  const error = h('div', { class: 'form-error', role: 'alert' });
  const idle = entry ? 'Save changes' : 'Add character';
  const submit = h('button', { class: 'btn', type: 'submit' }, idle);

  const form = h('form', {
    class: 'entry-form',
    onsubmit: async (ev) => {
      ev.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      submit.textContent = 'Saving…';
      try {
        const source = file.files[0] || url.value.trim();
        const picture = source ? (await toImage(source)).image : null;
        let archive;
        if (entry) {
          archive = await updateCharacter(view.ctx.gh, entry.id, { name: name.value, side: side.get(), power: power.get() });
          if (picture || removePic.checked) archive = await setCharacterImage(view.ctx.gh, entry.id, picture);
        } else {
          archive = await addCharacter(view.ctx.gh, { name: name.value, side: side.get(), power: power.get(), image: picture });
          form.reset();
          power.set(50);
        }
        onSaved?.(archive);
      } catch (err) {
        if (view.ctx.onAuthError(err)) return;
        error.textContent = err.message;
      } finally {
        submit.disabled = false;
        submit.textContent = idle;
      }
    },
  },
    h('div', {}, h('label', { for: `cname-${uid}` }, 'Name'), name),
    h('div', {}, h('label', {}, 'Side'), side.el),
    h('div', {},
      h('label', {}, 'Fan power ', h('span', { class: 'label-note' }, '(1–100)')),
      power.el,
      h('div', { class: 'hint' }, 'How strong fans think they are. Used to estimate who fans favour in Who Would Win?'),
    ),
    h('div', {},
      h('label', {}, entry ? 'Replace picture ' : 'Picture ', h('span', { class: 'label-note' }, '(optional; you can paste it on the card later)')),
      file,
      url,
      entry?.image ? h('label', { class: 'check' }, removePic, 'Remove picture') : null,
    ),
    error,
    h('div', { class: 'form-actions' },
      onCancel && h('button', { class: 'btn ghost', type: 'button', onclick: onCancel }, 'Cancel'),
      submit,
    ),
  );
  return form;
}

function openEdit(entry) {
  const dialog = h('dialog', {});
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.append(
    h('div', { class: 'card-head' }, h('h2', {}, `Edit ${entry.name}`)),
    characterForm({ entry, onSaved: (archive) => { close(); view.ctx.toast('Saved.', 'ok'); saved(archive); }, onCancel: close }),
  );
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dialog);
  dialog.showModal();
}
