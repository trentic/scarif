// Debug mode → Blasters → "Match sound files".
// Drop a pile of sound files at once; each is matched to a blaster by its file
// name ("dl44_heavy.mp3" → DL-44 Heavy Blaster Pistol). Check the matches,
// then save them all in a few commits.
import { h } from '../js/ui.js';
import { readMedia, setSounds } from './store.js';
import { createYouTubeRecorder } from './yt-recorder.js';

const BATCH = 8;
const AUDIO = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i;
// Words that say nothing about which blaster it is.
const GENERIC = new Set(['sound', 'sounds', 'sfx', 'fx', 'effect', 'effects', 'shot', 'shots', 'fire', 'firing', 'fires', 'blast', 'blaster', 'blasters',
  'star', 'wars', 'sw', 'hq', 'audio', 'the', 'a', 'of', 'and', 'clip', 'final', 'edit', 'copy', 'trimmed', 'new', 'pew']);

// "DL-44 Heavy Blaster (2).mp3" → ['dl44', 'heavy']
function tokens(text) {
  return String(text).toLowerCase().replace(AUDIO, '')
    .split(/[\s_.,()[\]{}+]+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t && !GENERIC.has(t) && !/^\d$/.test(t));
}
const squash = (text) => String(text).toLowerCase().replace(AUDIO, '').replace(/[^a-z0-9]/g, '');

// How well a file name matches a blaster. Model codes (tokens with digits,
// like "dl44" or "e11") count most.
function score(fileName, entry) {
  const fileToks = new Set(tokens(fileName));
  const fileFlat = squash(fileName);
  let s = 0;
  for (const t of new Set([...tokens(entry.name), ...tokens(entry.id.replace(/-/g, ' '))])) {
    const code = /\d/.test(t) && /[a-z]/.test(t);
    if (fileToks.has(t)) s += code ? 6 : 1;
    else if (code && fileFlat.includes(t)) s += 5;
  }
  if (fileFlat.includes(squash(entry.name))) s += 4;
  return s;
}

// Best unique blaster per file: strongest pairs first, each blaster used once.
export function guessMatches(files, entries) {
  const pairs = [];
  files.forEach((f, i) => entries.forEach((e) => {
    const s = score(f.name, e);
    if (s >= 2) pairs.push({ i, id: e.id, s });
  }));
  pairs.sort((a, b) => b.s - a.s);
  const out = new Array(files.length).fill('');
  const used = new Set();
  for (const p of pairs) {
    if (out[p.i] || used.has(p.id)) continue;
    // A tie for this file between two blasters → don't guess.
    const tie = pairs.some((q) => q.i === p.i && q.id !== p.id && q.s === p.s && !used.has(q.id));
    if (tie) continue;
    out[p.i] = p.id;
    used.add(p.id);
  }
  return out;
}

export function openSoundMatch({ gh, entries, toast, onAuthError, onSaved, files: initial = [] }) {
  let rows = []; // { file, url, id }
  let saving = false;

  const dialog = h('dialog', { class: 'wiki-dialog sound-dialog' });
  const close = () => {
    if (saving && !confirm('Still saving. Stop after the current batch?')) return;
    saving = false;
    dialog.querySelectorAll('audio').forEach((a) => a.pause());
    recorder.stop();
    rows.forEach((r) => URL.revokeObjectURL(r.url));
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });

  const input = h('input', { type: 'file', multiple: true, accept: 'audio/*,.mp3,.wav,.ogg,.m4a,.flac,.webm', 'aria-label': 'Sound files', onchange: () => addFiles([...input.files]) });
  const drop = h('label', { class: 'drop sound-drop' },
    h('b', {}, 'Drop sound files here, or click to choose several'),
    h('span', { class: 'hint' }, 'Name each file after its blaster (e.g. dl-44.mp3, E-11 blaster.wav) and it’s matched for you.'),
    input,
  );
  // Record clips from YouTube; each finished clip becomes a row to match.
  const recorder = createYouTubeRecorder({ trim: true, clipLabel: 'Add clip to the list', onClip: (file) => addFiles([file]) });
  const ytSection = h('details', { class: 'yt-section' }, h('summary', {}, '🎬 Record clips from YouTube'), recorder.el);
  const onlyMissing = h('input', { type: 'checkbox', checked: true, onchange: () => { regroup(); } });
  const listEl = h('div', { class: 'sound-rows' });
  const summary = h('div', { class: 'wiki-summary' });
  const progress = h('div', { class: 'wiki-progress' });
  const saveBtn = h('button', { class: 'btn', type: 'button', disabled: true, onclick: () => save() }, 'Save 0 sounds');
  const footer = h('div', { class: 'wiki-footer' }, progress, saveBtn);

  const byId = () => new Map(entries.map((e) => [e.id, e]));
  const candidates = () => (onlyMissing.checked ? entries.filter((e) => !e.sound) : entries);

  function addFiles(list) {
    const audio = list.filter((f) => f.type.startsWith('audio/') || AUDIO.test(f.name));
    const ignored = list.length - audio.length;
    for (const file of audio) {
      if (rows.some((r) => r.file.name === file.name && r.file.size === file.size)) continue;
      rows.push({ file, url: URL.createObjectURL(file), id: '' });
    }
    input.value = '';
    regroup();
    if (ignored) toast(`${ignored} file${ignored === 1 ? ' isn’t' : 's aren’t'} audio and ${ignored === 1 ? 'was' : 'were'} skipped.`, 'err');
  }

  // Re-guess every row the user hasn't set by hand.
  function regroup() {
    const free = rows.filter((r) => !r.manual);
    const taken = new Set(rows.filter((r) => r.manual && r.id).map((r) => r.id));
    const guesses = guessMatches(free.map((r) => r.file), candidates().filter((e) => !taken.has(e.id)));
    free.forEach((r, i) => { r.id = guesses[i]; });
    render();
  }

  function render() {
    const entriesById = byId();
    const counts = new Map();
    rows.forEach((r) => r.id && counts.set(r.id, (counts.get(r.id) || 0) + 1));
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    listEl.replaceChildren(...rows.map((r, i) => {
      const select = h('select', {
        'aria-label': `Blaster for ${r.file.name}`,
        onchange: () => { r.id = select.value; r.manual = true; render(); },
      },
      h('option', { value: '' }, '— not matched (skip) —'),
      sorted.map((e) => h('option', { value: e.id, selected: e.id === r.id || null }, `${e.name}${e.sound ? ' (has a sound)' : ''}`)));
      const e = entriesById.get(r.id);
      const note = !r.id ? h('span', { class: 'hint' }, 'Pick a blaster or leave it to skip')
        : counts.get(r.id) > 1 ? h('span', { class: 'warn-text' }, 'Two files for this blaster: only the first is saved')
          : e?.sound ? h('span', { class: 'warn-text' }, 'Replaces its current sound')
            : h('span', { class: 'ok-text' }, r.manual ? 'Set by you' : 'Matched by file name');
      return h('div', { class: `sound-row ${r.id ? 'matched' : ''}` },
        h('div', { class: 'sound-file' }, h('b', {}, r.file.name), h('audio', { controls: true, preload: 'none', src: r.url })),
        h('div', { class: 'sound-pick' }, select, note),
        h('button', {
          class: 'btn ghost small', type: 'button', 'aria-label': `Remove ${r.file.name}`, disabled: saving || null,
          onclick: () => { URL.revokeObjectURL(r.url); rows.splice(i, 1); render(); },
        }, '✕'),
      );
    }));
    const matched = toSave().length;
    summary.textContent = rows.length ? `${rows.length} file${rows.length === 1 ? '' : 's'} · ${matched} matched · ${rows.length - matched} to skip` : '';
    saveBtn.textContent = `Save ${matched} sound${matched === 1 ? '' : 's'}`;
    saveBtn.disabled = saving || !matched;
  }

  // One file per blaster (the first wins).
  function toSave() {
    const seen = new Set();
    return rows.filter((r) => r.id && !seen.has(r.id) && seen.add(r.id));
  }

  async function save() {
    const list = toSave();
    if (!list.length || saving) return;
    saving = true;
    render();
    let done = 0;
    const failed = [];
    try {
      for (let i = 0; i < list.length && saving; i += BATCH) {
        progress.textContent = `Saving… ${done} / ${list.length}`;
        const ready = [];
        for (const r of list.slice(i, i + BATCH)) {
          try {
            ready.push({ r, item: { id: r.id, sound: { media: await readMedia(r.file, 'sound') } } });
          } catch (err) {
            failed.push(`${r.file.name} (${err.message})`);
          }
        }
        if (!ready.length) continue;
        const archive = await setSounds(gh, ready.map((x) => x.item));
        entries = archive.entries;
        onSaved(archive);
        for (const { r } of ready) {
          URL.revokeObjectURL(r.url);
          rows = rows.filter((x) => x !== r);
        }
        done += ready.length;
        render();
      }
      progress.textContent = `Saved ${done} sound${done === 1 ? '' : 's'}.${failed.length ? ` Couldn't use: ${failed.join(', ')}.` : ''}`;
      toast(`Saved ${done} sound${done === 1 ? '' : 's'}.`, 'ok');
    } catch (err) {
      if (onAuthError(err)) { saving = false; close(); return; }
      progress.textContent = `Stopped: ${err.message} ${done} saved so far. Press Save again to continue.`;
      toast(err.message, 'err');
    } finally {
      saving = false;
      render();
    }
  }

  dialog.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  dialog.addEventListener('dragleave', (e) => { if (e.target === dialog) drop.classList.remove('over'); });
  dialog.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });

  const missing = entries.filter((e) => !e.sound).length;
  dialog.append(
    h('div', { class: 'card-head' },
      h('h2', {}, '🔊 Match sound files'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: close }, 'Close'),
    ),
    h('p', { class: 'hint' }, `${missing} of ${entries.length} blasters have no sound yet. Add sound files in bulk: each is matched to a blaster by its file name, and you can fix any match before saving. To trim a sound, use Edit on the blaster afterwards (or drop the file on its card).`),
    drop,
    ytSection,
    h('label', { class: 'check' }, onlyMissing, 'Only match to blasters that have no sound yet'),
    summary,
    listEl,
    footer,
  );
  document.body.append(dialog);
  dialog.showModal();
  if (initial.length) addFiles(initial);
  else render();
}
