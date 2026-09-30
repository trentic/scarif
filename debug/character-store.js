// Characters archive (data/characters.json): Jedi & Sith for character games.
// Pictures live in media/characters/.
import { slugify, StoreError } from './store.js';

export const CHAR_FILE = 'data/characters.json';
const SIDES = ['jedi', 'sith'];
const rand = () => Math.random().toString(16).slice(2, 10);
const isLocal = (path) => typeof path === 'string' && path.startsWith('media/');

function checkName(archive, raw, selfId) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new StoreError('Give the character a name.');
  if (name.length > 60) throw new StoreError('Names must be 60 characters or fewer.');
  const clash = archive.entries.find((e) => e.name.toLowerCase() === name.toLowerCase() && e.id !== selfId);
  if (clash) throw new StoreError(`"${clash.name}" is already in the archive.`);
  return name;
}

function checkSide(side) {
  if (!SIDES.includes(side)) throw new StoreError('Pick a side: Jedi or Sith.');
  return side;
}

function checkPower(power) {
  const n = Math.round(Number(power));
  if (!Number.isFinite(n) || n < 1 || n > 100) throw new StoreError('Fan power must be between 1 and 100.');
  return n;
}

// image: { media: { ext, base64 } } | { link: 'https://…' }
function placeImage(entry, image, add, remove) {
  if (isLocal(entry.image)) remove.push(entry.image);
  if (image.link) {
    entry.image = image.link;
  } else {
    const path = `media/characters/${entry.id}-${rand()}.${image.media.ext}`;
    add.push({ path, base64: image.media.base64 });
    entry.image = path;
  }
}

const sortEntries = (archive) => archive.entries.sort((a, b) => a.name.localeCompare(b.name));

export function addCharacter(gh, { name, side, power, image }) {
  return gh.commitArchive((archive) => {
    const clean = checkName(archive, name);
    const base = slugify(clean) || 'character';
    let id = base;
    for (let n = 2; archive.entries.some((e) => e.id === id); n++) id = `${base}-${n}`;
    const now = new Date().toISOString();
    const entry = { id, name: clean, side: checkSide(side), power: checkPower(power), image: null, createdAt: now, updatedAt: now };
    const add = [];
    if (image) placeImage(entry, image, add, []);
    archive.entries.push(entry);
    sortEntries(archive);
    return { archive, add, message: `Characters: add ${clean}` };
  }, CHAR_FILE);
}

export function updateCharacter(gh, id, { name, side, power }) {
  return gh.commitArchive((archive) => {
    const entry = archive.entries.find((e) => e.id === id);
    if (!entry) throw new StoreError('That character no longer exists. Reload the page.');
    if (name !== undefined) entry.name = checkName(archive, name, id);
    if (side !== undefined) entry.side = checkSide(side);
    if (power !== undefined) entry.power = checkPower(power);
    entry.updatedAt = new Date().toISOString();
    sortEntries(archive);
    return { archive, message: `Characters: update ${entry.name}` };
  }, CHAR_FILE);
}

export function setCharacterImage(gh, id, image) {
  return gh.commitArchive((archive) => {
    const entry = archive.entries.find((e) => e.id === id);
    if (!entry) throw new StoreError('That character no longer exists. Reload the page.');
    const add = [];
    const remove = [];
    if (image) placeImage(entry, image, add, remove);
    else {
      if (isLocal(entry.image)) remove.push(entry.image);
      entry.image = null;
    }
    entry.updatedAt = new Date().toISOString();
    return { archive, add, remove, message: `Characters: ${image ? 'set' : 'remove'} picture for ${entry.name}` };
  }, CHAR_FILE);
}

export function deleteCharacter(gh, id) {
  return gh.commitArchive((archive) => {
    const entry = archive.entries.find((e) => e.id === id);
    if (!entry) throw new StoreError('That character no longer exists. Reload the page.');
    archive.entries = archive.entries.filter((e) => e.id !== id);
    return { archive, remove: [entry.image].filter(isLocal), message: `Characters: remove ${entry.name}` };
  }, CHAR_FILE);
}
