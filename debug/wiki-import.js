// Debug mode → "Import from Wookieepedia" (Characters and Blasters tabs).
// Lists articles from Wookieepedia categories (or a pasted list of names)
// with each article's main picture, lets you pick, then saves the picked ones
// to the archive in small batches, pictures included.
// For characters it can also find pictures for ones already in the archive.
import { h } from '../js/ui.js';
import { addCharacters, setCharacterImages } from './character-store.js';
import { addEntries, downloadImage } from './store.js';
import { categoryPages, fillMissingImages, findCategories, lookupTitles, pageUrl, WikiError } from './wookieepedia.js';

const BATCH = 8; // items per commit

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
function nameKey(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
const sideBadge = (side) => h('span', { class: `side-badge ${side}` }, side === 'jedi' ? 'Jedi' : 'Sith');
const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;

function sidePicker(initial, onPick) {
  let value = initial;
  const btns = ['jedi', 'sith'].map((side) => h('button', {
    type: 'button', class: `side-btn ${side}`, 'aria-pressed': String(side === value),
    onclick: () => { value = side; btns.forEach((b, i) => b.setAttribute('aria-pressed', String(['jedi', 'sith'][i] === side))); onPick?.(side); },
  }, side === 'jedi' ? 'Jedi' : 'Sith'));
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
    const defaults = { sources: structuredClone(K.sources), legends: false, top: 40 };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(K.store) || '{}') }; } catch { return defaults; }
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
        class: 'side-toggle', type: 'button', title: 'Switch side',
        onclick: () => { s.side = s.side === 'jedi' ? 'sith' : 'jedi'; savePrefs(); renderSources(); },
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
  const filterBtns = [['all', 'All'], ['jedi', 'Jedi'], ['sith', 'Sith']].map(([key, label]) => h('button', {
    type: 'button', 'aria-pressed': String(filter === key),
    onclick: () => { filter = key; filterBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['all', 'jedi', 'sith'][i] === key))); renderResults(); },
  }, label));
  const pickTop = h('div', { class: 'wiki-select' },
    h('button', {
      class: 'btn ghost small', type: 'button',
      onclick: () => {
        prefs.top = Math.max(1, Math.min(500, Number(topInput.value) || 40));
        savePrefs();
        let left = prefs.top; // only new ones count towards N
        for (const r of visible()) r.selected = !r.inArchive && left-- > 0;
        renderResults();
      },
    }, 'Pick the top'), topInput, h('span', { class: 'hint' }, 'best known'),
  );
  const toolbar = h('div', { class: 'wiki-toolbar', hidden: true },
    K.sides ? h('div', { class: 'filter wiki-filter' }, filterBtns) : h('span'),
    h('div', { class: 'wiki-select' },
      pickTop,
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => { results.forEach((r) => { r.selected = !r.inArchive; }); renderResults(); } }, 'Pick all'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => { results.forEach((r) => { r.selected = false; }); renderResults(); } }, 'Pick none'),
    ),
  );
  const saveBtn = h('button', { class: 'btn', type: 'button', disabled: true, onclick: () => (mode === 'fix' ? savePictures() : importPicked()) });
  const progress = h('div', { class: 'wiki-progress' });
  const footer = h('div', { class: 'wiki-footer', hidden: true }, progress, saveBtn);

  const visible = () => [...results.values()]
    .filter((r) => mode === 'fix' || filter === 'all' || r.side === filter)
    .sort((a, b) => (mode === 'fix' ? a.name.localeCompare(b.name) : b.length - a.length));
  const picked = () => visible().filter((r) => r.selected && !r.inArchive);

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
      summaryEl.textContent = `${all.length} found · ${all.length - inArchive} new · ${inArchive} already in your archive · ${n} picked`;
      saveBtn.textContent = `Add ${plural(n, K.noun)}`;
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
    const locked = r.inArchive || saving;
    const check = h('input', {
      type: 'checkbox', checked: (r.selected && !r.inArchive) || null, disabled: locked || null,
      'aria-label': `Pick ${r.name}`,
      onchange: () => { r.selected = check.checked; el.classList.toggle('picked', r.selected); renderSummary(); },
    });
    let fields;
    if (mode === 'fix') {
      fields = [h('div', { class: 'name' }, r.name)];
    } else {
      const name = h('input', { type: 'text', value: r.name, maxlength: kind === 'blasters' ? '80' : '60', disabled: locked || null, 'aria-label': 'Name', oninput: () => { r.name = name.value; } });
      fields = [name];
      if (K.sides) {
        const power = h('input', {
          type: 'number', min: '1', max: '100', value: String(r.power), disabled: locked || null, 'aria-label': 'Fan power',
          oninput: () => { r.power = Math.max(1, Math.min(100, Math.round(Number(power.value) || 50))); },
        });
        const side = h('button', {
          class: 'side-toggle', type: 'button', title: 'Switch side', disabled: locked || null,
          onclick: () => { r.side = r.side === 'jedi' ? 'sith' : 'jedi'; side.replaceChildren(sideBadge(r.side)); },
        }, sideBadge(r.side));
        fields.push(h('div', { class: 'char-top' }, side, h('label', { class: 'wiki-power', title: 'Fan power (1–100), estimated from how long the article is' }, '⚡', power)));
      }
    }
    const el = h('article', { class: `entry wiki-card ${kind} ${r.selected && !r.inArchive ? 'picked' : ''} ${r.inArchive ? 'in-archive' : ''}` },
      h('label', { class: 'thumb' },
        h('img', { src: r.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
        check,
        r.inArchive ? h('span', { class: 'wiki-flag' }, 'In archive') : null,
        r.both ? h('span', { class: 'wiki-flag warn', title: 'Listed as both Jedi and Sith. Check the side.' }, 'Jedi & Sith') : null,
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
        pages.forEach((p) => note(p, K.sides ? pasteSide.get() : undefined));
        if (missing.length) problems.push(`Not found on Wookieepedia: ${missing.join(', ')}`);
      }

      let list = [...found.values()].filter(({ result }) => !K.skip.test(result.title) && (prefs.legends || !result.legends));
      const noPic = list.filter(({ result }) => !result.image);
      if (noPic.length) {
        setStatus(`Finding pictures for ${noPic.length} articles…`);
        await fillMissingImages(noPic.map((x) => x.result), { onProgress: (d, t) => setStatus(`Finding pictures… ${d} / ${t}`) });
      }
      const legendsSkipped = prefs.legends ? 0 : [...found.values()].filter(({ result }) => result.legends).length;
      const withoutPicture = list.filter(({ result }) => !result.image).length;
      list = list.filter(({ result }) => result.image);

      // What's already in the archive: match by article (following redirects, so
      // "Darth Vader" in the archive matches the "Anakin Skywalker" article) or by name.
      setStatus('Checking your archive…');
      const known = new Set(entries.map((e) => e.wiki).filter(Boolean));
      const { from } = await lookupTitles(entries.map((e) => e.wiki || e.name));
      from.forEach((r) => known.add(r.title));

      // Fan power from article length: the longest articles are the best-known characters.
      const byLength = [...list].sort((a, b) => a.result.length - b.result.length);
      const rank = new Map(byLength.map(({ result }, i) => [result.pageid, byLength.length > 1 ? i / (byLength.length - 1) : 1]));

      for (const { result, sides } of list) {
        const name = K.name(result.title);
        results.set(result.pageid, {
          ...result,
          name,
          side: sides.has('sith') ? 'sith' : 'jedi',
          both: K.sides && sides.size > 1,
          power: Math.round(35 + 57 * rank.get(result.pageid) ** 1.4),
          inArchive: known.has(result.title) || entries.some((e) => K.same(e.name, name)),
          selected: false,
        });
      }
      // Start with the best-known new ones picked.
      let left = prefs.top;
      for (const r of visible()) r.selected = !r.inArchive && left-- > 0;

      const extra = [legendsSkipped && `${legendsSkipped} Legends articles left out`, withoutPicture && `${withoutPicture} skipped (no picture)`, ...problems].filter(Boolean);
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
          else r.inArchive = true;
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

  const importPicked = () => {
    const list = picked();
    if (list.length && !saving) saveInBatches(list, (ready) => K.add(gh, ready), 'Added');
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
