// Loads the blaster archive (data/archive.json) published with the site.
import { meetsRequirements } from './registry.js';

export const SITE_ROOT = new URL('../', import.meta.url);

// Media paths in the archive are relative to the site root ("media/dl-44.png"),
// or full URLs for hotlinked images.
export function mediaUrl(path, root = SITE_ROOT) {
  return path ? new URL(path, root).href : null;
}

export async function loadArchive() {
  // Cache-bust so a freshly published archive shows up straight away.
  const res = await fetch(new URL(`data/archive.json?v=${Date.now()}`, SITE_ROOT), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Couldn't load the archive (${res.status}).`);
  return res.json();
}

// The entries a game can use, with media paths turned into full URLs.
export function poolFor(game, archive) {
  return archive.entries
    .filter((e) => meetsRequirements(e, game.requires))
    .map((e) => ({ id: e.id, name: e.name, image: mediaUrl(e.image), sound: mediaUrl(e.sound), stats: e.stats || {} }));
}
