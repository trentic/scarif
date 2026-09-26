// Add / edit / delete archive entries by committing to the repository.
// File types are checked by their actual bytes, not by name.
import { bytesToBase64 } from './github.js';

export const MAX_BYTES = 10 * 1024 * 1024;

export class StoreError extends Error {}

// Turns "DL-44 Heavy Blaster Pistol" into "dl-44-heavy-blaster-pistol".
export function slugify(name) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const startsWith = (buf, bytes, offset = 0) => bytes.every((b, i) => buf[offset + i] === b);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

function sniffImage(buf) {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(buf, ascii('GIF8'))) return 'gif';
  if (startsWith(buf, ascii('RIFF')) && startsWith(buf, ascii('WEBP'), 8)) return 'webp';
  if (startsWith(buf, ascii('ftyp'), 4) && (startsWith(buf, ascii('avif'), 8) || startsWith(buf, ascii('avis'), 8))) return 'avif';
  return null;
}

function sniffSound(buf) {
  if (startsWith(buf, ascii('ID3'))) return 'mp3';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3';
  if (startsWith(buf, ascii('RIFF')) && startsWith(buf, ascii('WAVE'), 8)) return 'wav';
  if (startsWith(buf, ascii('OggS'))) return 'ogg';
  if (startsWith(buf, ascii('fLaC'))) return 'flac';
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  if (startsWith(buf, ascii('ftyp'), 4)) return 'm4a';
  return null;
}

// Turns a File/Blob into { ext, base64 }, validating type and size.
export async function readMedia(blob, kind) {
  if (!blob?.size) throw new StoreError(`The ${kind} file is empty.`);
  if (blob.size > MAX_BYTES) throw new StoreError(`The ${kind} file is over 10 MB.`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ext = kind === 'image' ? sniffImage(bytes) : sniffSound(bytes);
  if (!ext) {
    throw new StoreError(kind === 'image'
      ? 'Image must be PNG, JPG, GIF, WebP or AVIF.'
      : 'Sound must be MP3, WAV, OGG, FLAC, M4A or WebM.');
  }
  return { ext, base64: bytesToBase64(bytes) };
}

// Downloads an image from its address. Many sites block this (CORS);
// the caller can fall back to linking the image instead.
export async function downloadImage(url) {
  if (!/^https?:\/\//i.test(url)) throw new StoreError('Image address must start with http:// or https://');
  let res;
  try {
    res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch {
    throw new StoreError('BLOCKED');
  }
  if (!res.ok) throw new StoreError(`That address replied ${res.status}.`);
  const blob = await res.blob();
  const media = await readMedia(blob, 'image').catch(() => {
    throw new StoreError("That address didn't return an image. Right-click the image and use \"Copy image address\".");
  });
  return media;
}

const rand = () => Math.random().toString(16).slice(2, 10);

function checkName(archive, raw, selfId) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new StoreError('Give it a name.');
  if (name.length > 80) throw new StoreError('Name must be 80 characters or fewer.');
  const clash = archive.entries.find((e) => e.name.toLowerCase() === name.toLowerCase() && e.id !== selfId);
  if (clash) throw new StoreError(`"${clash.name}" already exists.`);
  return name;
}

const isLocal = (path) => typeof path === 'string' && path.startsWith('media/');

// image: { media: {ext, base64} } | { link: 'https://…' } | null
// sound: { media } | null
export function addEntry(gh, { name, image, sound }) {
  return gh.commitArchive((archive) => {
    const clean = checkName(archive, name);
    const base = slugify(clean) || 'entry';
    let id = base;
    for (let n = 2; archive.entries.some((e) => e.id === id); n++) id = `${base}-${n}`;

    const add = [];
    const place = (media, kind) => {
      const path = `media/${id}-${kind}-${rand()}.${media.ext}`;
      add.push({ path, base64: media.base64 });
      return path;
    };
    if (!image) throw new StoreError('Add an image (upload a file or paste an image address).');
    const now = new Date().toISOString();
    archive.entries.push({
      id,
      name: clean,
      image: image.link || place(image.media, 'image'),
      sound: sound ? place(sound.media, 'sound') : null,
      createdAt: now,
      updatedAt: now,
    });
    archive.entries.sort((a, b) => a.name.localeCompare(b.name));
    return { archive, add, message: `Archive: add ${clean}` };
  });
}

export function updateEntry(gh, id, { name, image, sound, removeSound }) {
  return gh.commitArchive((archive) => {
    const entry = archive.entries.find((e) => e.id === id);
    if (!entry) throw new StoreError('That entry no longer exists. Reload the page.');
    const add = [];
    const remove = [];
    const place = (media, kind) => {
      const path = `media/${id}-${kind}-${rand()}.${media.ext}`;
      add.push({ path, base64: media.base64 });
      return path;
    };
    if (name !== undefined) entry.name = checkName(archive, name, id);
    if (image) {
      if (isLocal(entry.image)) remove.push(entry.image);
      entry.image = image.link || place(image.media, 'image');
    }
    if (sound || removeSound) {
      if (isLocal(entry.sound)) remove.push(entry.sound);
      entry.sound = sound ? place(sound.media, 'sound') : null;
    }
    entry.updatedAt = new Date().toISOString();
    archive.entries.sort((a, b) => a.name.localeCompare(b.name));
    return { archive, add, remove, message: `Archive: update ${entry.name}` };
  });
}

export function deleteEntry(gh, id) {
  return gh.commitArchive((archive) => {
    const entry = archive.entries.find((e) => e.id === id);
    if (!entry) throw new StoreError('That entry no longer exists. Reload the page.');
    archive.entries = archive.entries.filter((e) => e.id !== id);
    const remove = [entry.image, entry.sound].filter(isLocal);
    return { archive, remove, message: `Archive: remove ${entry.name}` };
  });
}
