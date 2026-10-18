// Debug mode → "Import from Wookieepedia" (Characters and Blasters tabs).
// Lists articles from Wookieepedia categories (or a pasted list of names)
// with each article's main picture, lets you pick, then saves the picked ones
// to the archive in small batches, pictures included.
// For characters it can also find pictures for ones already in the archive.
import { SIDE_IDS, SIDES } from '../js/registry.js';
import { h } from '../js/ui.js';
import { addCharacters, setCharacterImages } from './character-store.js';
import { addEntries, downloadImage } from './store.js';
import {
  addPictures, categoryPages, fillMissingImages, findCategories, lookupTitles, nicknames, pageUrl, subcategories, WikiError,
} from './wookieepedia.js';

const BATCH = 8; // items per commit
const SHOW = 300; // most articles shown after a search (the best-known ones)
// Subcategories that aren't worth reading.
const SKIP_SUBCAT = /^(Unidentified|Images of|Individuals? (?:who|with)|Legends|Non-canon)\b/i;

// "Maul (Zabrak)" → "Maul"; "Revan/Legends" → "Revan".
const baseTitle = (title) => title.replace(/\/Legends$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
// "DL-44 heavy blaster pistol" → "DL-44 Heavy Blaster Pistol"
const titleCase = (s) => s.replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

const KINDS = {
  characters: {
    store: 'scarif.debug.wiki.v1',
    noun: ['character', 'characters'],
    sides: true,
    intro: 'Lists characters from Wookieepedia categories with each article’s main picture. Pick who to add, check names, sides and fan power, then add them. Pictures are copied into the site.',
    paste: 'Darth Revan\nKit Fisto\nhttps://starwars.fandom.com/wiki/Plo_Koon',
    sources: [
      { category: 'Jedi Grand Masters', side: 'jedi' },
      { category: 'Jedi Masters', side: 'jedi' },
      { category: 'Jedi Knights', side: 'jedi' },
      { category: 'Sith Lords', side: 'sith' },
      { category: 'Dark Lords of the Sith', side: 'sith' },
      { category: 'Inquisitorius members', side: 'sith' },
      { category: 'Bounty hunters', side: 'hunter' },
      { category: 'Clone troopers', side: 'clone' },
      { category: 'Battle droid models', side: 'droid' },
    ],
    skip: /^(Unidentified|List of|Jedi Order|Sith Order|Order of)\b/i,
    name: (title) => baseTitle(title).slice(0, 60),
    same: (a, b) => nameKey(a) === nameKey(b),
    add: (gh, list) => addCharacters(gh, list.map(({ r, image }) => ({ name: r.name, side: r.side, power: r.power, image, wiki: r.title }))),
    fixPictures: true,
  },
  blasters: {
    store: 'scarif.debug.wiki.blasters.v1',
    noun: ['blaster', 'blasters'],
    sides: false,
    intro: 'Lists weapons from Wookieepedia categories with each article’s main picture. Pick which to add and check the names, then add them. Pictures are copied into the site; add sounds afterwards with 🔊 Match sound files.',
    paste: 'DL-44 heavy blaster pistol\nE-11 blaster rifle\nhttps://starwars.fandom.com/wiki/A280_blaster_rifle',
    sources: [
      { category: 'Blaster pistols' },
      { category: 'Heavy blaster pistols' },
      { category: 'Blaster rifles' },
      { category: 'Blaster carbines' },
    ],
    skip: /^(Unidentified|List of)\b/i,
    name: (title) => titleCase(baseTitle(title)).slice(0, 80),
    // "DL-44" in the archive is the same blaster as "DL-44 Heavy Blaster Pistol".
    same: (a, b) => nameKey(a) === nameKey(b) || modelCodes(a).some((c) => modelCodes(b).includes(c)),
    add: (gh, list) => addEntries(gh, list.map(({ r, image }) => ({ name: r.name, image, wiki: r.title }))),
    fixPictures: false,
  },
};

// Model codes in a name: "DL-44 Heavy Blaster Pistol" → ['dl44'], "A280C" → ['a280c'].
function modelCodes(name) {
  return String(name).toLowerCase().split(/[\s_/]+/).map((t) => t.replace(/[^a-z0-9]/g, '')).filter((t) => /[a-z]/.test(t) && /\d/.test(t));
}
// Fan power from article length (bytes), the same in every search: each
// doubling adds 10 points. ~3 KB stub → 30 · 12 KB → 50 · 50 KB → 70 · 200 KB → 90.
const fanPower = (length) => Math.round(Math.max(25, Math.min(95, 30 + 10 * Math.log2(Math.max(length, 1) / 3000))));
function nameKey(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
const sideBadge = (side) => h('span', { class: `side-badge ${side}` }, SIDES[side]?.label || side);
// Next group when a badge is clicked: Jedi → Sith → Bounty Hunter → Jedi…
const nextSide = (side) => SIDE_IDS[(SIDE_IDS.indexOf(side) + 1) % SIDE_IDS.length];
const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;

function sidePicker(initial, onPick) {
  let value = initial;
  const btns = SIDE_IDS.map((side) => h('button', {
    type: 'button', class: `side-btn ${side}`, 'aria-pressed': String(side === value),
    onclick: () => { value = side; btns.forEach((b, i) => b.setAttribute('aria-pressed', String(SIDE_IDS[i] === side))); onPick?.(side); },
  }, SIDES[side].label));
  return { el: h('div', { class: 'filter side-pick' }, btns), get: () => value };
}

// Downloads a picture; if Wookieepedia blocks copying, links it instead.
async function picture(url) {
  try {
    return { media: await downloadImage(url) };
  } catch (err) {
    if (err.message === 'BLOCKED') return { link: url };
    throw err;
  }
}

export function openWikiImport({ kind = 'characters', gh, entries, toast, onAuthError, onSaved, findMissing: autoFind = false }) {
  const K = KINDS[kind];
  const prefs = (() => {
    const defaults = { sources: structuredClone(K.sources), legends: false, subcats: true, top: 40 };
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(K.store) || '{}'); } catch {}
    const merged = { ...defaults, ...saved };
    // Categories added to the defaults since these preferences were saved.
    const seen = new Set(saved.seenDefaults || (saved.sources ? ['Jedi Grand Masters', 'Jedi Masters', 'Jedi Knights', 'Sith Lords', 'Dark Lords of the Sith', 'Inquisitorius members', 'Blaster pistols', 'Heavy blaster pistols', 'Blaster rifles', 'Blaster carbines'] : []));
    for (const src of K.sources) {
      if (!seen.has(src.category) && !merged.sources.some((x) => x.category === src.category)) merged.sources.push(structuredClone(src));
    }
    merged.seenDefaults = K.sources.map((x) => x.category);
    return merged;
  })();
  const savePrefs = () => { try { localStorage.setItem(K.store, JSON.stringify(prefs)); } catch {} };

  // mode 'new': articles to add · mode 'fix': pictures for archive entries without one
  let mode = 'new';
  const results = new Map();
  let notFound = []; // fix mode: [{ entry, tried }]
  let filter = 'all';
  let busy = false;
  let saving = false;

  const dialog = h('dialog', { class: 'wiki-dialog' });
  const close = () => {
    if (saving && !confirm('Still saving. Stop after the current batch?')) return;
    saving = false;
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });

  // --- where to look ---------------------------------------------------------------

  const sourcesEl = h('div', { class: 'wiki-sources' });
  function renderSources() {
    sourcesEl.replaceChildren(...prefs.sources.map((s, i) => h('div', { class: 'wiki-source' },
      K.sides ? h('button', {
        class: 'side-toggle', type: 'button', title: 'Switch group',
        onclick: () => { s.side = nextSide(s.side); savePrefs(); renderSources(); },
      }, sideBadge(s.side)) : null,
      h('a', { href: pageUrl(`Category:${s.category}`), target: '_blank', rel: 'noopener' }, s.category),
      h('button', {
        class: 'btn ghost small', type: 'button', 'aria-label': `Remove ${s.category}`,
        onclick: () => { prefs.sources.splice(i, 1); savePrefs(); renderSources(); },
      }, '✕'),
    )));
    if (!prefs.sources.length) sourcesEl.append(h('div', { class: 'hint' }, 'No categories. Add one below, or paste names.'));
  }

  const newSide = sidePicker('jedi');
  const catInput = h('input', { type: 'text', placeholder: kind === 'blasters' ? 'Category name, e.g. Blaster rifles' : 'Category name, e.g. Jedi Masters', spellcheck: 'false' });
  const suggestEl = h('div', { class: 'wiki-suggest' });
  const addCategory = () => {
    const category = catInput.value.trim().replace(/^category:/i, '');
    if (!category) return;
    if (!prefs.sources.some((s) => s.category.toLowerCase() === category.toLowerCase())) {
      prefs.sources.push(K.sides ? { category, side: newSide.get() } : { category });
    }
    savePrefs();
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
          : [h('span', { class: 'hint' }, `No categories start with that. Try a shorter word, like "${kind === 'blasters' ? 'Blaster' : 'Jedi'}".`)]));
      } catch (err) {
        suggestEl.replaceChildren(h('span', { class: 'form-error' }, err.message));
      } finally {
        findBtn.disabled = false;
      }
    },
  }, 'Find');
  catInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } });

  const pasteSide = sidePicker('jedi');
  const pasteBox = h('textarea', { rows: '4', placeholder: K.paste, spellcheck: 'false' });
  const legends = h('input', { type: 'checkbox', checked: prefs.legends || null, onchange: () => { prefs.legends = legends.checked; savePrefs(); } });
  const subcats = h('input', { type: 'checkbox', checked: prefs.subcats || null, onchange: () => { prefs.subcats = subcats.checked; savePrefs(); } });

  const status = h('div', { class: 'wiki-status' });
  const setStatus = (text, kindClass = '') => { status.className = `wiki-status ${kindClass}`; status.textContent = text; };
  const searchBtn = h('button', { class: 'btn', type: 'button', onclick: () => search() }, 'Search Wookieepedia');

  // --- missing pictures (characters) ----------------------------------------------------

  const fixBar = h('div', { class: 'wiki-fix' });
  function renderFixBar() {
    const missing = K.fixPictures ? entries.filter((e) => !e.image) : [];
    fixBar.hidden = !missing.length;
    fixBar.replaceChildren(
      h('div', {}, h('b', {}, `${plural(missing.length, K.noun)} in your archive ${missing.length === 1 ? 'has' : 'have'} no picture.`), ' Look them up on Wookieepedia and use each article’s main picture.'),
      h('button', { class: 'btn small', type: 'button', disabled: busy || saving || null, onclick: () => findMissing() }, '🖼 Find their pictures'),
    );
  }

  async function findMissing(retry = null) {
    if (busy) return;
    busy = true;
    searchBtn.disabled = true;
    renderFixBar();
    if (!retry) {
      mode = 'new';
      results.clear();
      notFound = [];
    }
    const todo = retry || entries.filter((e) => !e.image).map((entry) => ({ entry, tried: entry.wiki || entry.name }));
    try {
      setStatus(`Looking up ${plural(todo.length, K.noun)}…`);
      const { from } = await lookupTitles(todo.map((t) => t.tried));
      const found = todo.filter((t) => from.has(t.tried)).map((t) => ({ ...t, result: { ...from.get(t.tried) } }));
      const noPic = found.filter((f) => !f.result.image).map((f) => f.result);
      if (noPic.length) {
        setStatus('Finding pictures…');
        await fillMissingImages(noPic);
      }
      mode = 'fix';
      notFound = notFound.filter((n) => !todo.some((t) => t.entry.id === n.entry.id));
      for (const t of todo) {
        const f = found.find((x) => x.entry.id === t.entry.id);
        if (f?.result.image) {
          results.set(t.entry.id, { ...f.result, key: t.entry.id, entry: t.entry, name: t.entry.name, selected: true, inArchive: false });
        } else {
          notFound.push({ entry: t.entry, tried: t.tried, why: f ? 'that article has no picture' : 'no article with that name' });
        }
      }
      setStatus(`Found pictures for ${results.size} of ${results.size + notFound.length}.${notFound.length ? ' Fix the names below to try the rest again.' : ''}`, notFound.length ? 'warn' : 'ok');
      showResults();
    } catch (err) {
      setStatus(err.message, 'err');
    } finally {
      busy = false;
      searchBtn.disabled = false;
      renderFixBar();
    }
  }

  const notFoundEl = h('div', { class: 'wiki-notfound' });
  function renderNotFound() {
    notFoundEl.hidden = mode !== 'fix' || !notFound.length;
    if (notFoundEl.hidden) return;
    notFoundEl.replaceChildren(
      h('h3', {}, `No picture found for ${plural(notFound.length, K.noun)}`),
      h('p', { class: 'hint' }, 'Type the Wookieepedia article name (or paste its link) and press Look up. Leave the rest for the 📋 Paste button on their cards.'),
      ...notFound.map((n) => {
        const input = h('input', { type: 'text', value: n.tried, spellcheck: 'false', 'aria-label': `Wookieepedia name for ${n.entry.name}` });
        const go = () => {
          const name = articleName(input.value);
          if (name) findMissing([{ entry: n.entry, tried: name }]);
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
        return h('div', { class: 'wiki-retry' },
          h('b', {}, n.entry.name),
          h('span', { class: 'hint' }, n.why),
          input,
          h('button', { class: 'btn ghost small', type: 'button', onclick: go }, 'Look up'),
        );
      }),
    );
  }

  // --- results --------------------------------------------------------------------------

  const summaryEl = h('div', { class: 'wiki-summary' });
  const gridEl = h('div', { class: 'grid wiki-grid' });
  const topInput = h('input', { type: 'number', min: '1', max: '500', value: String(prefs.top), class: 'wiki-top', 'aria-label': 'How many' });
  const filterKeys = [['all', 'All'], ...SIDE_IDS.map((id) => [id, SIDES[id].plural])];
  const filterBtns = filterKeys.map(([key, label]) => h('button', {
    type: 'button', 'aria-pressed': String(filter === key),
    onclick: () => { filter = key; filterBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(filterKeys[i][0] === key))); renderResults(); },
  }, label));
  const pickTop = h('div', { class: 'wiki-select' },
    h('button', {
      class: 'btn ghost small', type: 'button',
      onclick: () => {
        prefs.top = Math.max(1, Math.min(500, Number(topInput.value) || 40));
        savePrefs();
        let left = prefs.top; // only new ones count towards N
        for (const r of visible()) r.selected = r.fillFor ? true : !r.inArchive && left-- > 0;
        renderResults();
      },
    }, 'Pick the top'), topInput, h('span', { class: 'hint' }, 'best known'),
  );
  const toolbar = h('div', { class: 'wiki-toolbar', hidden: true },
    K.sides ? h('div', { class: 'filter wiki-filter' }, filterBtns) : h('span'),
    h('div', { class: 'wiki-select' },
      pickTop,
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => { results.forEach((r) => { r.selected = pickable(r); }); renderResults(); } }, 'Pick all'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => { results.forEach((r) => { r.selected = false; }); renderResults(); } }, 'Pick none'),
    ),
  );
  const saveBtn = h('button', { class: 'btn', type: 'button', disabled: true, onclick: () => (mode === 'fix' ? savePictures() : importPicked()) });
  const progress = h('div', { class: 'wiki-progress' });
  const footer = h('div', { class: 'wiki-footer', hidden: true }, progress, saveBtn);

  const visible = () => [...results.values()]
    .filter((r) => mode === 'fix' || filter === 'all' || r.side === filter)
    .sort((a, b) => (mode === 'fix' ? a.name.localeCompare(b.name) : b.length - a.length));
  // New articles, or archive entries that are missing a picture.
  const pickable = (r) => !r.inArchive || Boolean(r.fillFor);
  const picked = () => visible().filter((r) => r.selected && pickable(r));

  function showResults() {
    toolbar.hidden = !results.size;
    pickTop.hidden = mode === 'fix';
    toolbar.querySelector('.wiki-filter')?.toggleAttribute('hidden', mode === 'fix');
    footer.hidden = !results.size && mode !== 'fix';
    renderResults();
  }

  function renderSummary() {
    const all = [...results.values()];
    const n = picked().length;
    if (mode === 'fix') {
      summaryEl.textContent = results.size ? `${all.length} picture${all.length === 1 ? '' : 's'} found · ${n} picked` : '';
      saveBtn.textContent = `Save ${n} picture${n === 1 ? '' : 's'}`;
    } else {
      const inArchive = all.filter((r) => r.inArchive).length;
      const fills = all.filter((r) => r.fillFor).length;
      const pickedFills = picked().filter((r) => r.fillFor).length;
      summaryEl.textContent = `${all.length} found · ${all.length - inArchive} new · ${inArchive} already in your archive${fills ? ` (${fills} without a picture)` : ''} · ${n} picked`;
      saveBtn.textContent = [n - pickedFills && `Add ${plural(n - pickedFills, K.noun)}`, pickedFills && `save ${pickedFills} missing picture${pickedFills === 1 ? '' : 's'}`]
        .filter(Boolean).join(' + ').replace(/^s/, 'S') || `Add 0 ${K.noun[1]}`;
    }
    saveBtn.disabled = saving || !n;
  }

  function renderResults() {
    const list = visible();
    gridEl.replaceChildren(...(list.length ? list.map(resultCard) : results.size ? [h('div', { class: 'empty' }, 'Nothing here.')] : []));
    renderSummary();
    renderNotFound();
  }

  function resultCard(r) {
    const locked = !pickable(r) || saving;
    const check = h('input', {
      type: 'checkbox', checked: (r.selected && pickable(r)) || null, disabled: locked || null,
      'aria-label': `Pick ${r.name}`,
      onchange: () => { r.selected = check.checked; el.classList.toggle('picked', r.selected); renderSummary(); },
    });
    let fields;
    if (mode === 'fix' || r.fillFor) {
      fields = [h('div', { class: 'name' }, r.fillFor ? r.fillFor.name : r.name)];
    } else {
      const name = h('input', { type: 'text', value: r.name, maxlength: kind === 'blasters' ? '80' : '60', disabled: locked || null, 'aria-label': 'Name', oninput: () => { r.name = name.value; } });
      fields = [name];
      if (K.sides) {
        const power = h('input', {
          type: 'number', min: '1', max: '100', value: String(r.power), disabled: locked || null, 'aria-label': 'Fan power',
          oninput: () => { r.power = Math.max(1, Math.min(100, Math.round(Number(power.value) || 50))); },
        });
        const side = h('button', {
          class: 'side-toggle', type: 'button', title: 'Switch group', disabled: locked || null,
          onclick: () => { r.side = nextSide(r.side); side.replaceChildren(sideBadge(r.side)); },
        }, sideBadge(r.side));
        fields.push(h('div', { class: 'char-top' }, side, h('label', { class: 'wiki-power', title: 'Fan power (1–100), estimated from how long the article is' }, '⚡', power)));
      }
    }
    const el = h('article', { class: `entry wiki-card ${kind} ${r.selected && pickable(r) ? 'picked' : ''} ${r.inArchive && !r.fillFor ? 'in-archive' : ''}` },
      h('label', { class: 'thumb' },
        h('img', { src: r.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
        check,
        r.fillFor ? h('span', { class: 'wiki-flag fill' }, 'In archive · no picture')
          : r.inArchive ? h('span', { class: 'wiki-flag' }, 'In archive') : null,
        r.both ? h('span', { class: 'wiki-flag warn', title: 'Listed in more than one group. Check the group.' }, r.groups.map((g) => SIDES[g]?.plural || g).join(' & ')) : null,
        r.legends ? h('span', { class: 'wiki-flag legends' }, 'Legends') : null,
      ),
      h('div', { class: 'body' },
        ...fields,
        h('a', { class: 'wiki-link', href: pageUrl(r.title), target: '_blank', rel: 'noopener' }, `${r.title} ↗`),
      ),
    );
    return el;
  }

  // --- search ------------------------------------------------------------------------------

  const articleName = (line) => {
    const t = line.trim();
    const m = t.match(/\/wiki\/([^?#]+)/);
    return m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : t;
  };

  async function search() {
    if (busy) return;
    const pasted = pasteBox.value.split(/\n|,/).map(articleName).filter(Boolean);
    if (!prefs.sources.length && !pasted.length) { setStatus('Add a category or paste some names first.', 'err'); return; }
    busy = true;
    searchBtn.disabled = true;
    renderFixBar();
    mode = 'new';
    results.clear();
    notFound = [];
    const found = new Map(); // pageid → { result, sides:Set }
    const note = (result, side) => {
      const item = found.get(result.pageid) || { result, sides: new Set() };
      item.sides.add(side);
      found.set(result.pageid, item);
    };
    const problems = [];
    const pastedIds = new Set();
    try {
      for (const s of prefs.sources) {
        setStatus(`Reading "${s.category}"…`);
        try {
          let cats = [s.category];
          if (prefs.subcats) cats = [...cats, ...(await subcategories(s.category)).filter((c) => !SKIP_SUBCAT.test(c))];
          for (const cat of cats) {
            const where = cat === s.category ? `"${cat}"` : `"${s.category}" → "${cat}"`;
            const pages = await categoryPages(cat, { onProgress: (n) => setStatus(`Reading ${where}… ${n}`) });
            pages.forEach((p) => note(p, s.side));
          }
        } catch (err) {
          if (!(err instanceof WikiError) || /reach|replied/.test(err.message)) throw err;
          problems.push(err.message);
        }
      }
      if (pasted.length) {
        setStatus(`Looking up ${pasted.length} pasted name${pasted.length === 1 ? '' : 's'}…`);
        const { found: pages, missing } = await lookupTitles(pasted);
        pages.forEach((p) => { note(p, K.sides ? pasteSide.get() : undefined); pastedIds.add(p.pageid); });
        if (missing.length) problems.push(`Not found on Wookieepedia: ${missing.join(', ')}`);
      }

      // Best-known first (longest articles). Big categories have thousands of
      // articles, so only the top SHOW (plus anything pasted) get pictures.
      let list = [...found.values()]
        .filter(({ result }) => !K.skip.test(result.title) && (prefs.legends || !result.legends))
        .sort((a, b) => b.result.length - a.result.length);
      const total = list.length;
      list = list.filter(({ result }, i) => i < SHOW || pastedIds.has(result.pageid));
      const hidden = total - list.length;
      const shown = list.map((x) => x.result);
      setStatus(`Finding pictures for ${shown.length} articles…`);
      await addPictures(shown, { onProgress: (d) => setStatus(`Finding pictures… ${d} / ${shown.length}`) });
      const noPic = shown.filter((r) => !r.image);
      if (noPic.length) await fillMissingImages(noPic, { onProgress: (d, t) => setStatus(`Looking for more pictures… ${d} / ${t}`) });
      const legendsSkipped = prefs.legends ? 0 : [...found.values()].filter(({ result }) => result.legends).length;
      const withoutPicture = list.filter(({ result }) => !result.image).length;
      list = list.filter(({ result }) => result.image);
      // Numbered clone troopers → their nickname (CT-7567 → Rex).
      const nick = K.sides ? await nicknames(list.map((x) => x.result)) : new Map();

      // What's already in the archive: match by article (following redirects, so
      // "Darth Vader" in the archive matches the "Anakin Skywalker" article) or by name.
      setStatus('Checking your archive…');
      const known = new Set(entries.map((e) => e.wiki).filter(Boolean));
      const { from } = await lookupTitles(entries.map((e) => e.wiki || e.name));
      from.forEach((r) => known.add(r.title));
      // Which archive entry an article is, so ones with no picture can get one.
      const entryFor = new Map();
      for (const e of entries) {
        if (e.wiki) entryFor.set(e.wiki, e);
        const found = from.get(e.wiki || e.name);
        if (found) entryFor.set(found.title, e);
      }

      for (const { result, sides } of list) {
        const name = nick.get(result.title) || K.name(result.title);
        const existing = entryFor.get(result.title) || entries.find((e) => K.same(e.name, name) || K.same(e.name, result.title));
        results.set(result.pageid, {
          // Already in the archive but without a picture: picking it saves this picture.
          fillFor: K.fixPictures && existing && !existing.image ? existing : null,
          ...result,
          name,
          // Listed in several groups (e.g. a fallen Jedi) → the highest-ranked one.
          side: [...sides].filter((x) => SIDES[x]).sort((x, y) => SIDES[y].rank - SIDES[x].rank)[0] || 'jedi',
          both: K.sides && sides.size > 1,
          groups: [...sides],
          power: fanPower(result.length),
          inArchive: known.has(result.title) || entries.some((e) => K.same(e.name, name) || K.same(e.name, result.title)),
          selected: false,
        });
      }
      // Start with the best-known new ones picked, plus every missing picture.
      let left = prefs.top;
      for (const r of visible()) r.selected = r.fillFor ? true : !r.inArchive && left-- > 0;

      const extra = [
        hidden && `Showing the ${SHOW} best-known of ${total} (paste a name to get anyone else)`,
        legendsSkipped && `${legendsSkipped} Legends articles left out`,
        withoutPicture && `${withoutPicture} skipped (no picture)`,
        ...problems,
      ].filter(Boolean);
      setStatus(`${results.size ? 'Done.' : 'Nothing found.'}${extra.length ? ` ${extra.join(' · ')}` : ''}`, problems.length ? 'warn' : 'ok');
      progress.textContent = '';
      showResults();
    } catch (err) {
      setStatus(err.message, 'err');
    } finally {
      busy = false;
      searchBtn.disabled = false;
      renderFixBar();
    }
  }

  // --- saving -------------------------------------------------------------------------------

  // Copies pictures and commits `list` in batches with `commit(batch) → archive`.
  async function saveInBatches(list, commit, verb) {
    saving = true;
    searchBtn.disabled = true;
    renderFixBar();
    renderResults();
    let done = 0;
    let linked = 0;
    const skipped = [];
    const failed = [];
    try {
      for (let i = 0; i < list.length && saving; i += BATCH) {
        progress.textContent = `Copying pictures… ${done} / ${list.length} saved`;
        const ready = [];
        for (const r of list.slice(i, i + BATCH)) {
          try {
            const image = await picture(r.image);
            if (image.link) linked++;
            ready.push({ r, image });
          } catch (err) {
            failed.push(`${r.name} (${err.message})`);
          }
        }
        if (!ready.length) continue;
        progress.textContent = `Saving to GitHub… ${done} / ${list.length} saved`;
        const res = await commit(ready);
        const archive = res.archive || res;
        skipped.push(...(res.skipped || []));
        for (const { r } of ready) {
          r.selected = false;
          if (mode === 'fix') results.delete(r.key);
          else { r.inArchive = true; r.fillFor = null; }
        }
        entries = archive.entries;
        done += ready.length - (res.skipped?.length || 0);
        onSaved(archive);
        renderResults();
      }
      const parts = [`${verb} ${done}.`];
      if (linked) parts.push(`${linked} picture${linked === 1 ? ' is' : 's are'} linked to Wookieepedia instead of copied (copying was blocked).`);
      if (skipped.length) parts.push(`Skipped (name already in the archive): ${skipped.join(', ')}.`);
      if (failed.length) parts.push(`Couldn't get the picture for: ${failed.join(', ')}.`);
      progress.textContent = parts.join(' ');
      toast(parts[0], 'ok');
    } catch (err) {
      if (onAuthError(err)) { saving = false; close(); return; }
      progress.textContent = `Stopped: ${err.message} ${done} saved so far. Press the button again to continue.`;
      toast(err.message, 'err');
    } finally {
      saving = false;
      searchBtn.disabled = false;
      renderFixBar();
      renderResults();
    }
  }

  // New ones are added; archive entries without a picture get this one.
  const importPicked = () => {
    const list = picked();
    if (!list.length || saving) return;
    saveInBatches(list, async (ready) => {
      const fills = ready.filter(({ r }) => r.fillFor);
      const fresh = ready.filter(({ r }) => !r.fillFor);
      let archive = null;
      if (fills.length) archive = await setCharacterImages(gh, fills.map(({ r, image }) => ({ id: r.fillFor.id, image, wiki: r.title })));
      return fresh.length ? K.add(gh, fresh) : archive;
    }, 'Saved');
  };

  const savePictures = () => {
    const list = picked();
    if (list.length && !saving) {
      saveInBatches(list, (ready) => setCharacterImages(gh, ready.map(({ r, image }) => ({ id: r.entry.id, image, wiki: r.title }))), 'Pictures saved:');
    }
  };

  // --- layout ------------------------------------------------------------------------------

  dialog.append(
    h('div', { class: 'card-head' },
      h('h2', {}, `🌐 Import ${K.noun[1]} from Wookieepedia`),
      h('button', { class: 'btn ghost small', type: 'button', onclick: close }, 'Close'),
    ),
    h('p', { class: 'hint' }, K.intro),
    fixBar,
    h('div', { class: 'wiki-setup' },
      h('div', {},
        h('label', {}, 'Categories to read'),
        sourcesEl,
        h('div', { class: 'wiki-add' }, catInput, K.sides ? newSide.el : null, h('button', { class: 'btn ghost small', type: 'button', onclick: addCategory }, 'Add'), findBtn),
        suggestEl,
      ),
      h('div', {},
        h('label', {}, 'Or paste names ', h('span', { class: 'label-note' }, '(one per line, or Wookieepedia links)')),
        pasteBox,
        K.sides ? h('div', { class: 'wiki-add' }, h('span', { class: 'hint' }, 'Pasted names are'), pasteSide.el) : null,
        h('label', { class: 'check' }, legends, 'Include Legends articles'),
        h('label', { class: 'check' }, subcats, 'Also read subcategories (e.g. Clone troopers → Clone commanders)'),
      ),
    ),
    h('div', { class: 'wiki-go' }, searchBtn, status),
    notFoundEl,
    toolbar,
    summaryEl,
    gridEl,
    footer,
  );
  renderSources();
  renderFixBar();
  renderNotFound();
  document.body.append(dialog);
  dialog.showModal();
  if (autoFind && K.fixPictures) findMissing();
}
