// Debug mode → Characters → "Import from Wookieepedia".
// Lists Jedi and Sith from Wookieepedia categories (or a pasted list of names)
// with each article's main picture, lets you pick, then saves the picked ones
// to the archive in small batches, pictures included.
import { h } from '../js/ui.js';
import { addCharacters } from './character-store.js';
import { downloadImage } from './store.js';
import { categoryPages, fillMissingImages, findCategories, lookupTitles, pageUrl, WikiError } from './wookieepedia.js';

const STORE = 'scarif.debug.wiki.v1';
const BATCH = 8; // characters per commit
const DEFAULT_SOURCES = [
  { category: 'Jedi Grand Masters', side: 'jedi' },
  { category: 'Jedi Masters', side: 'jedi' },
  { category: 'Jedi Knights', side: 'jedi' },
  { category: 'Sith Lords', side: 'sith' },
  { category: 'Dark Lords of the Sith', side: 'sith' },
  { category: 'Inquisitorius members', side: 'sith' },
];

function loadPrefs() {
  const defaults = { sources: DEFAULT_SOURCES, legends: false, top: 40 };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { return defaults; }
}
function savePrefs(prefs) {
  try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch {}
}

// "Kanan Jarrus" stays; "Maul (Zabrak)" → "Maul"; "Revan/Legends" → "Revan".
const cleanName = (title) => title.replace(/\/Legends$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim().slice(0, 60);
const nameKey = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SKIP = /^(Unidentified|List of|Jedi Order|Sith Order|Order of)\b/i;

const sideBtn = (side) => h('span', { class: `side-badge ${side}` }, side === 'jedi' ? 'Jedi' : 'Sith');

export function openWikiImport({ gh, entries, toast, onAuthError, onSaved }) {
  const prefs = loadPrefs();
  const results = new Map(); // pageid → result
  let filter = 'all';
  let busy = false;
  let importing = false;

  const dialog = h('dialog', { class: 'wiki-dialog' });
  const close = () => {
    if (importing && !confirm('Characters are still being saved. Stop after the current batch?')) return;
    importing = false;
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });

  // --- where to look ---------------------------------------------------------------

  const sourcesEl = h('div', { class: 'wiki-sources' });
  function renderSources() {
    sourcesEl.replaceChildren(...prefs.sources.map((s, i) => h('div', { class: 'wiki-source' },
      h('button', {
        class: 'side-toggle', type: 'button', title: 'Switch side',
        onclick: () => { s.side = s.side === 'jedi' ? 'sith' : 'jedi'; savePrefs(prefs); renderSources(); },
      }, sideBtn(s.side)),
      h('a', { href: pageUrl(`Category:${s.category}`), target: '_blank', rel: 'noopener' }, s.category),
      h('button', {
        class: 'btn ghost small', type: 'button', 'aria-label': `Remove ${s.category}`,
        onclick: () => { prefs.sources.splice(i, 1); savePrefs(prefs); renderSources(); },
      }, '✕'),
    )));
    if (!prefs.sources.length) sourcesEl.append(h('div', { class: 'hint' }, 'No categories. Add one below, or paste names.'));
  }

  let newSide = 'jedi';
  const newSideBtns = ['jedi', 'sith'].map((side) => h('button', {
    type: 'button', class: `side-btn ${side}`, 'aria-pressed': String(side === newSide),
    onclick: () => { newSide = side; newSideBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['jedi', 'sith'][i] === side))); },
  }, side === 'jedi' ? 'Jedi' : 'Sith'));
  const catInput = h('input', { type: 'text', placeholder: 'Category name, e.g. Jedi Masters', spellcheck: 'false' });
  const suggestEl = h('div', { class: 'wiki-suggest' });
  const addCategory = () => {
    const category = catInput.value.trim().replace(/^category:/i, '');
    if (!category) return;
    if (!prefs.sources.some((s) => s.category.toLowerCase() === category.toLowerCase())) prefs.sources.push({ category, side: newSide });
    savePrefs(prefs);
    catInput.value = '';
    suggestEl.replaceChildren();
    renderSources();
  };
  const findBtn = h('button', {
    class: 'btn ghost small', type: 'button',
    onclick: async () => {
      if (!catInput.value.trim()) { catInput.focus(); return; }
      findBtn.disabled = true;
      suggestEl.replaceChildren(h('span', { class: 'hint' }, 'Looking…'));
      try {
        const cats = await findCategories(catInput.value);
        suggestEl.replaceChildren(...(cats.length
          ? cats.slice(0, 24).map((c) => h('button', {
            class: 'chip-btn', type: 'button',
            onclick: () => { catInput.value = c.title; addCategory(); },
          }, `${c.title} · ${c.size}`))
          : [h('span', { class: 'hint' }, 'No categories start with that. Try a shorter word, like "Jedi" or "Sith".')]));
      } catch (err) {
        suggestEl.replaceChildren(h('span', { class: 'form-error' }, err.message));
      } finally {
        findBtn.disabled = false;
      }
    },
  }, 'Find');
  catInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } });

  let pasteSide = 'jedi';
  const pasteSideBtns = ['jedi', 'sith'].map((side) => h('button', {
    type: 'button', class: `side-btn ${side}`, 'aria-pressed': String(side === pasteSide),
    onclick: () => { pasteSide = side; pasteSideBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['jedi', 'sith'][i] === side))); },
  }, side === 'jedi' ? 'Jedi' : 'Sith'));
  const pasteBox = h('textarea', { rows: '4', placeholder: 'Darth Revan\nKit Fisto\nhttps://starwars.fandom.com/wiki/Plo_Koon', spellcheck: 'false' });
  const legends = h('input', { type: 'checkbox', checked: prefs.legends || null, onchange: () => { prefs.legends = legends.checked; savePrefs(prefs); } });

  const status = h('div', { class: 'wiki-status' });
  const setStatus = (text, kind = '') => { status.className = `wiki-status ${kind}`; status.textContent = text; };
  const searchBtn = h('button', { class: 'btn', type: 'button', onclick: () => search() }, 'Search Wookieepedia');

  // --- results --------------------------------------------------------------------------

  const summaryEl = h('div', { class: 'wiki-summary' });
  const gridEl = h('div', { class: 'grid wiki-grid' });
  const topInput = h('input', { type: 'number', min: '1', max: '500', value: String(prefs.top), class: 'wiki-top', 'aria-label': 'How many' });
  const filterBtns = [['all', 'All'], ['jedi', 'Jedi'], ['sith', 'Sith']].map(([key, label]) => h('button', {
    type: 'button', 'aria-pressed': String(filter === key),
    onclick: () => { filter = key; filterBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['all', 'jedi', 'sith'][i] === key))); renderResults(); },
  }, label));
  const toolbar = h('div', { class: 'wiki-toolbar', hidden: true },
    h('div', { class: 'filter' }, filterBtns),
    h('div', { class: 'wiki-select' },
      h('button', {
        class: 'btn ghost small', type: 'button',
        onclick: () => {
          const n = Math.max(1, Math.min(500, Number(topInput.value) || 40));
          prefs.top = n;
          savePrefs(prefs);
          // Count only new ones towards N.
          let left = n;
          for (const r of visible()) { r.selected = !r.inArchive && left-- > 0; }
          renderResults();
        },
      }, 'Pick the top'), topInput, h('span', { class: 'hint' }, 'most famous'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => { results.forEach((r) => { r.selected = false; }); renderResults(); } }, 'Pick none'),
    ),
  );
  const importBtn = h('button', { class: 'btn', type: 'button', disabled: true, onclick: () => importPicked() }, 'Add 0 characters');
  const progress = h('div', { class: 'wiki-progress' });
  const footer = h('div', { class: 'wiki-footer', hidden: true }, progress, importBtn);

  const visible = () => [...results.values()]
    .filter((r) => filter === 'all' || r.side === filter)
    .sort((a, b) => b.length - a.length);

  function renderSummary() {
    const all = [...results.values()];
    const picked = all.filter((r) => r.selected && !r.inArchive);
    const inArchive = all.filter((r) => r.inArchive).length;
    summaryEl.textContent = `${all.length} found · ${all.length - inArchive} new · ${inArchive} already in your archive · ${picked.length} picked`;
    importBtn.textContent = `Add ${picked.length} character${picked.length === 1 ? '' : 's'}`;
    importBtn.disabled = importing || !picked.length;
  }

  function renderResults() {
    const list = visible();
    gridEl.replaceChildren(...(list.length ? list.map(resultCard) : [h('div', { class: 'empty' }, 'Nothing here.')]));
    renderSummary();
  }

  function resultCard(r) {
    const check = h('input', {
      type: 'checkbox', checked: (r.selected && !r.inArchive) || null, disabled: r.inArchive || importing || null,
      'aria-label': `Pick ${r.name}`,
      onchange: () => { r.selected = check.checked; el.classList.toggle('picked', r.selected); renderSummary(); },
    });
    const name = h('input', {
      type: 'text', value: r.name, maxlength: '60', disabled: r.inArchive || null, 'aria-label': 'Name',
      oninput: () => { r.name = name.value; },
    });
    const power = h('input', {
      type: 'number', min: '1', max: '100', value: String(r.power), disabled: r.inArchive || null, 'aria-label': 'Fan power',
      oninput: () => { r.power = Math.max(1, Math.min(100, Math.round(Number(power.value) || 50))); },
    });
    const side = h('button', {
      class: 'side-toggle', type: 'button', title: 'Switch side', disabled: r.inArchive || null,
      onclick: () => { r.side = r.side === 'jedi' ? 'sith' : 'jedi'; side.replaceChildren(sideBtn(r.side)); },
    }, sideBtn(r.side));
    const el = h('article', { class: `entry wiki-card ${r.selected && !r.inArchive ? 'picked' : ''} ${r.inArchive ? 'in-archive' : ''}` },
      h('label', { class: 'thumb' },
        h('img', { src: r.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
        check,
        r.inArchive ? h('span', { class: 'wiki-flag' }, 'In archive') : null,
        r.both ? h('span', { class: 'wiki-flag warn', title: 'Listed as both Jedi and Sith. Check the side.' }, 'Jedi & Sith') : null,
      ),
      h('div', { class: 'body' },
        name,
        h('div', { class: 'char-top' }, side, h('label', { class: 'wiki-power', title: 'Fan power (1–100), estimated from how long the article is' }, '⚡', power)),
        h('a', { class: 'wiki-link', href: pageUrl(r.title), target: '_blank', rel: 'noopener' }, `${r.title} ↗`),
      ),
    );
    return el;
  }

  // --- search ------------------------------------------------------------------------------

  async function search() {
    if (busy) return;
    const pasted = pasteBox.value.split(/\n|,/).map((line) => {
      const t = line.trim();
      const m = t.match(/\/wiki\/([^?#]+)/);
      return m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : t;
    }).filter(Boolean);
    if (!prefs.sources.length && !pasted.length) { setStatus('Add a category or paste some names first.', 'err'); return; }
    busy = true;
    searchBtn.disabled = true;
    results.clear();
    const found = new Map(); // pageid → { result, sides:Set }
    const note = (result, side) => {
      const item = found.get(result.pageid) || { result, sides: new Set() };
      item.sides.add(side);
      found.set(result.pageid, item);
    };
    const problems = [];
    try {
      for (const s of prefs.sources) {
        setStatus(`Reading "${s.category}"…`);
        try {
          const pages = await categoryPages(s.category, { onProgress: (n) => setStatus(`Reading "${s.category}"… ${n}`) });
          pages.forEach((p) => note(p, s.side));
        } catch (err) {
          if (!(err instanceof WikiError) || /reach|replied/.test(err.message)) throw err;
          problems.push(err.message);
        }
      }
      if (pasted.length) {
        setStatus(`Looking up ${pasted.length} pasted name${pasted.length === 1 ? '' : 's'}…`);
        const { found: pages, missing } = await lookupTitles(pasted);
        pages.forEach((p) => note(p, pasteSide));
        if (missing.length) problems.push(`Not found on Wookieepedia: ${missing.join(', ')}`);
      }

      let list = [...found.values()].filter(({ result }) => !SKIP.test(result.title) && (prefs.legends || !result.title.endsWith('/Legends')));
      const noPic = list.filter(({ result }) => !result.image);
      if (noPic.length) {
        setStatus(`Finding pictures for ${noPic.length} articles…`);
        await fillMissingImages(noPic.map((x) => x.result), { onProgress: (d, t) => setStatus(`Finding pictures… ${d} / ${t}`) });
      }
      const withoutPicture = list.filter(({ result }) => !result.image).length;
      list = list.filter(({ result }) => result.image);

      // Who's already in the archive: match by article (following redirects, so
      // "Darth Vader" in the archive matches the "Anakin Skywalker" article) or by name.
      setStatus('Checking your archive…');
      const known = new Set(entries.map((e) => e.wiki).filter(Boolean));
      const { from } = await lookupTitles(entries.map((e) => e.wiki || e.name));
      from.forEach((r) => known.add(r.title));
      const names = new Set(entries.map((e) => nameKey(e.name)));

      // Fan power from article length: the longest articles are the best-known characters.
      const byLength = [...list].sort((a, b) => a.result.length - b.result.length);
      const rank = new Map(byLength.map(({ result }, i) => [result.pageid, byLength.length > 1 ? i / (byLength.length - 1) : 1]));

      for (const { result, sides } of list) {
        const name = cleanName(result.title);
        const inArchive = known.has(result.title) || names.has(nameKey(name));
        results.set(result.pageid, {
          ...result,
          name,
          side: sides.has('sith') ? 'sith' : 'jedi',
          both: sides.size > 1,
          power: Math.round(35 + 57 * rank.get(result.pageid) ** 1.4),
          inArchive,
          selected: false,
        });
      }
      // Start with the most famous new ones picked.
      let left = prefs.top;
      for (const r of visible()) r.selected = !r.inArchive && left-- > 0;

      const extra = [withoutPicture && `${withoutPicture} skipped (no picture)`, ...problems].filter(Boolean);
      setStatus(results.size ? `Done.${extra.length ? ` ${extra.join(' · ')}` : ''}` : `Nothing found.${extra.length ? ` ${extra.join(' · ')}` : ''}`, problems.length ? 'warn' : 'ok');
      toolbar.hidden = !results.size;
      footer.hidden = !results.size;
      renderResults();
    } catch (err) {
      setStatus(err.message, 'err');
    } finally {
      busy = false;
      searchBtn.disabled = false;
    }
  }

  // --- import ------------------------------------------------------------------------------

  async function picture(url) {
    try {
      return { media: await downloadImage(url) };
    } catch (err) {
      // Wookieepedia blocked the copy: link the picture instead.
      if (err.message === 'BLOCKED') return { link: url };
      throw err;
    }
  }

  async function importPicked() {
    const picked = visible().filter((r) => r.selected && !r.inArchive);
    if (!picked.length || importing) return;
    importing = true;
    searchBtn.disabled = true;
    renderResults();
    let done = 0;
    let linked = 0;
    const skipped = [];
    const failed = [];
    try {
      for (let i = 0; i < picked.length && importing; i += BATCH) {
        const batch = picked.slice(i, i + BATCH);
        progress.textContent = `Copying pictures… ${done} / ${picked.length} saved`;
        const items = [];
        for (const r of batch) {
          try {
            const image = await picture(r.image);
            if (image.link) linked++;
            items.push({ r, item: { name: r.name, side: r.side, power: r.power, image, wiki: r.title } });
          } catch (err) {
            failed.push(`${r.name} (${err.message})`);
          }
        }
        if (!items.length) continue;
        progress.textContent = `Saving to GitHub… ${done} / ${picked.length} saved`;
        const res = await addCharacters(gh, items.map((x) => x.item));
        skipped.push(...res.skipped);
        for (const { r } of items) {
          r.inArchive = true;
          r.selected = false;
        }
        entries = res.archive.entries;
        done += items.length - res.skipped.length;
        onSaved(res.archive);
        renderResults();
      }
      const parts = [`Added ${done} character${done === 1 ? '' : 's'}.`];
      if (linked) parts.push(`${linked} picture${linked === 1 ? ' is' : 's are'} linked to Wookieepedia instead of copied (the site blocked copying).`);
      if (skipped.length) parts.push(`Skipped (name already in the archive): ${skipped.join(', ')}.`);
      if (failed.length) parts.push(`Couldn't get the picture for: ${failed.join(', ')}.`);
      progress.textContent = parts.join(' ');
      toast(parts[0], 'ok');
    } catch (err) {
      if (onAuthError(err)) { close(); return; }
      progress.textContent = `Stopped: ${err.message} ${done} saved so far. Press Add again to continue.`;
      toast(err.message, 'err');
    } finally {
      importing = false;
      searchBtn.disabled = false;
      renderResults();
    }
  }

  // --- layout ------------------------------------------------------------------------------

  dialog.append(
    h('div', { class: 'card-head' },
      h('h2', {}, '🌐 Import from Wookieepedia'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: close }, 'Close'),
    ),
    h('p', { class: 'hint' }, 'Lists characters from Wookieepedia categories with each article’s main picture. Pick who to add, check names, sides and fan power, then add them. Pictures are copied into the site.'),
    h('div', { class: 'wiki-setup' },
      h('div', {},
        h('label', {}, 'Categories to read'),
        sourcesEl,
        h('div', { class: 'wiki-add' }, catInput, h('div', { class: 'filter side-pick' }, newSideBtns), h('button', { class: 'btn ghost small', type: 'button', onclick: addCategory }, 'Add'), findBtn),
        suggestEl,
      ),
      h('div', {},
        h('label', {}, 'Or paste names ', h('span', { class: 'label-note' }, '(one per line, or Wookieepedia links)')),
        pasteBox,
        h('div', { class: 'wiki-add' }, h('span', { class: 'hint' }, 'Pasted names are'), h('div', { class: 'filter side-pick' }, pasteSideBtns)),
        h('label', { class: 'check' }, legends, 'Include Legends articles'),
      ),
    ),
    h('div', { class: 'wiki-go' }, searchBtn, status),
    toolbar,
    summaryEl,
    gridEl,
    footer,
  );
  renderSources();
  document.body.append(dialog);
  dialog.showModal();
}
