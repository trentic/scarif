// Stores uploaded images and sounds on disk. File types are checked by their
// actual bytes, not by the name or the browser's claimed MIME type.
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { MEDIA_DIR } from './db.js';

export const MAX_BYTES = 10 * 1024 * 1024;

function startsWith(buf, bytes, offset = 0) {
  return bytes.every((b, i) => buf[offset + i] === b);
}
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

export class MediaError extends Error {}

export function saveMedia(buf, kind, entryId) {
  if (!buf?.length) throw new MediaError(`The ${kind} file is empty.`);
  if (buf.length > MAX_BYTES) throw new MediaError(`The ${kind} file is over 10 MB.`);
  const ext = kind === 'image' ? sniffImage(buf) : sniffSound(buf);
  if (!ext) {
    throw new MediaError(
      kind === 'image'
        ? 'Image must be PNG, JPG, GIF, WebP or AVIF.'
        : 'Sound must be MP3, WAV, OGG, FLAC, M4A or WebM.',
    );
  }
  const file = `${entryId}-${kind}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, file), buf);
  return `/media/${file}`;
}

export function deleteMedia(url) {
  if (!url?.startsWith('/media/')) return;
  const file = path.join(MEDIA_DIR, path.basename(url));
  fs.rm(file, { force: true }, () => {});
}

// --- fetching an image from a URL ------------------------------------------

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new MediaError('That image address is not a valid URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new MediaError('Image address must start with http or https.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new MediaError(`Couldn't find the server "${url.hostname}".`);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new MediaError('That image address points at a private network.');
  return url;
}

export async function fetchImage(raw) {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Scarif image fetcher)', Accept: 'image/*' },
    }).catch((err) => {
      throw new MediaError(`Couldn't download the image (${err.cause?.code || err.name}).`);
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await assertPublicUrl(new URL(res.headers.get('location'), url).href);
      continue;
    }
    if (!res.ok) throw new MediaError(`The image server replied ${res.status}.`);
    if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new MediaError('That image is over 10 MB.');

    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new MediaError('That image is over 10 MB.');
      chunks.push(chunk);
    }
    const buf = Buffer.concat(chunks);
    if (!sniffImage(buf)) {
      throw new MediaError("That address didn't return an image. Right-click the image and use \"Copy image address\".");
    }
    return buf;
  }
  throw new MediaError('Too many redirects.');
}
