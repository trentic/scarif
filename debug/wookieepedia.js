// Read-only client for Wookieepedia's public MediaWiki API (starwars.fandom.com).
// Runs in the browser: MediaWiki allows anonymous cross-site reads with origin=*.
export const WIKI = 'https://starwars.fandom.com';
const API = `${WIKI}/api.php`;
const THUMB = 600; // picture width to import (px)

export class WikiError extends Error {}

export const pageUrl = (title) => `${WIKI}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

async function call(params) {
  const url = new URL(API);
  Object.entries({ format: 'json', formatversion: '2', origin: '*', ...params }).forEach(([k, v]) => url.searchParams.set(k, v));
  let res;
  try {
    res = await fetch(url, { credentials: 'omit' });
  } catch {
    throw new WikiError("Couldn't reach Wookieepedia. Check your connection, and that an ad or privacy blocker isn't blocking fandom.com.");
  }
  if (!res.ok) throw new WikiError(`Wookieepedia replied ${res.status}. Try again in a minute.`);
  const data = await res.json().catch(() => null);
  if (!data) throw new WikiError('Wookieepedia sent something unexpected. Try again in a minute.');
  if (data.error) throw new WikiError(`Wookieepedia: ${data.error.info || data.error.code}`);
  return data;
}

// Runs a query and follows "continue" until done (or `max` pages are collected).
async function queryAll(params, { max = Infinity, onPage } = {}) {
  const pages = new Map();
  const redirects = [];
  let cont = {};
  for (;;) {
    const data = await call({ action: 'query', ...params, ...cont });
    // "normalized" (darth_vader → Darth vader) and "redirects" (→ Anakin Skywalker) both map from → to.
    for (const r of [...(data.query?.normalized || []), ...(data.query?.redirects || [])]) redirects.push(r);
    for (const p of data.query?.pages || []) {
      // The same page can come back in several batches with more props filled in.
      pages.set(p.pageid ?? p.title, { ...pages.get(p.pageid ?? p.title), ...p });
    }
    onPage?.(pages.size);
    if (!data.continue || pages.size >= max) break;
    cont = data.continue;
  }
  return { pages: [...pages.values()], redirects };
}

// Follows from → to links (normalised name, then redirect) to the final title.
function resolver(redirects) {
  const map = new Map(redirects.map((r) => [r.from, r.to]));
  return (title) => {
    for (let i = 0; i < 4 && map.has(title); i++) title = map.get(title);
    return title;
  };
}

const chunk = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// Category names that start with `prefix`, biggest first: [{ title, size }].
export async function findCategories(prefix) {
  const clean = prefix.trim().replace(/^category:/i, '');
  if (!clean) return [];
  const data = await call({ action: 'query', list: 'allcategories', acprefix: clean[0].toUpperCase() + clean.slice(1), acprop: 'size', aclimit: '50' });
  return (data.query?.allcategories || [])
    .map((c) => ({ title: c.category, size: c.pages ?? c.size ?? 0 }))
    .filter((c) => c.size > 0)
    .sort((a, b) => b.size - a.size);
}

// Wookieepedia files every Legends article under this category. Legends-only
// characters have plain titles; "/Legends" is only added when a canon article
// with the same name exists.
const LEGENDS = 'Category:Legends articles';
const PAGE_PROPS = {
  prop: 'pageimages|info|categories', piprop: 'thumbnail', pithumbsize: String(THUMB), pilimit: '50', clcategories: LEGENDS, cllimit: 'max',
};

function toResult(p) {
  return {
    pageid: p.pageid,
    title: p.title,
    length: p.length || 0,
    image: p.thumbnail?.source || null,
    legends: p.title.endsWith('/Legends') || (p.categories || []).some((c) => c.title === LEGENDS),
  };
}

// Article pages in a category, with their main picture.
export async function categoryPages(category, { onProgress } = {}) {
  const title = `Category:${category.replace(/^category:/i, '').trim()}`;
  const { pages } = await queryAll({
    generator: 'categorymembers', gcmtitle: title, gcmnamespace: '0', gcmtype: 'page', gcmlimit: '50', ...PAGE_PROPS,
  }, { max: 3000, onPage: onProgress });
  if (!pages.length) {
    const info = await call({ action: 'query', titles: title, prop: 'categoryinfo' });
    const page = info.query?.pages?.[0];
    if (!page || page.missing) throw new WikiError(`There's no "${title}" on Wookieepedia. Use Find to look up the right name.`);
  }
  return pages.map(toResult);
}

// Looks up article names (following redirects, e.g. "Darth Vader" → "Anakin Skywalker").
// Returns { found: [result], missing: [name], from: Map(lookup name → result) }.
export async function lookupTitles(names) {
  const found = new Map();
  const from = new Map();
  const missing = [];
  for (const batch of chunk([...new Set(names.map((n) => n.trim()).filter(Boolean))], 50)) {
    const { pages, redirects } = await queryAll({ titles: batch.join('|'), redirects: '1', ...PAGE_PROPS });
    const byTitle = new Map(pages.map((p) => [p.title, p]));
    const resolve = resolver(redirects);
    for (const name of batch) {
      const page = byTitle.get(resolve(name));
      if (!page || page.missing || page.invalid) { missing.push(name); continue; }
      const result = toResult(page);
      found.set(result.pageid, result);
      from.set(name, result);
    }
  }
  return { found: [...found.values()], missing, from };
}

// For pages with no main picture: read the infobox's "image=" line and look that file up.
export async function fillMissingImages(results, { onProgress } = {}) {
  const todo = results.filter((r) => !r.image);
  let done = 0;
  for (const batch of chunk(todo, 50)) {
    const { pages } = await queryAll({ titles: batch.map((r) => r.title).join('|'), prop: 'revisions', rvprop: 'content', rvslots: 'main' });
    const files = new Map();
    for (const p of pages) {
      const text = p.revisions?.[0]?.slots?.main?.content || '';
      const m = text.match(/\|\s*image\s*=\s*\[\[\s*(?:File|Image)\s*:\s*([^|\]]+)/i);
      if (m) files.set(p.title, `File:${m[1].trim()}`);
    }
    if (files.size) {
      const { pages: filePages, redirects } = await queryAll({ titles: [...new Set(files.values())].join('|'), prop: 'imageinfo', iiprop: 'url', iiurlwidth: String(THUMB), redirects: '1' });
      const resolve = resolver(redirects);
      const urls = new Map(filePages.map((f) => [f.title, f.imageinfo?.[0]?.thumburl || f.imageinfo?.[0]?.url]));
      for (const r of batch) {
        const file = files.get(r.title);
        if (file) r.image = urls.get(resolve(file)) || null;
      }
    }
    done += batch.length;
    onProgress?.(done, todo.length);
  }
  return results;
}
