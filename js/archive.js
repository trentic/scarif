// Loads the archives published with the site: data/archive.json (blasters)
// and data/characters.json (Jedi & Sith).
import { ARCHIVES, meetsRequirements } from './registry.js';

export const SITE_ROOT = new URL('../', import.meta.url);

// Media paths in the archive are relative to the site root ("media/dl-44.png"),
// or full URLs for hotlinked images.
export function mediaUrl(path, root = SITE_ROOT) {
  return path ? new URL(path, root).href : null;
}

export async function loadArchive(name = 'blasters') {
  const { file } = ARCHIVES[name];
  // Cache-bust so a freshly published archive shows up straight away.
  const res = await fetch(new URL(`data/${file}.json?v=${Date.now()}`, SITE_ROOT), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Couldn't load the ${name} archive (${res.status}).`);
  return res.json();
}

// The entries a game can use, with media paths turned into full URLs.
export function poolFor(game, archive) {
  return archive.entries
    .filter((e) => meetsRequirements(e, game.requires))
    .map((e) => ({
      ...e,
      image: mediaUrl(e.image),
      sound: mediaUrl(e.sound),
      stats: e.stats || {},
    }));
}

// Drops entries whose picture doesn't actually load (e.g. a linked image from
// a site that went down), so a game never shows a blank card.
export async function keepLoadable(pool, timeoutMs = 6000) {
  const loads = (src) => new Promise((resolve) => {
    if (!src) return resolve(false);
    const img = new Image();
    const timer = setTimeout(() => resolve(false), timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 0); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = src;
  });
  const ok = await Promise.all(pool.map((e) => loads(e.image)));
  return pool.filter((_, i) => ok[i]);
}
