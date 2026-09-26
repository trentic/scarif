// Password lock for debug mode.
//
// Saving to the archive needs a GitHub token. That token is encrypted with
// your password (PBKDF2-SHA256 → AES-256-GCM) and the encrypted copy is kept
// in the repo at site/data/vault.json, so any device only needs the password.
// Anyone can download the encrypted file, so use a long password.
export const VAULT_PATH = 'data/vault.json';
export const MIN_PASSWORD = 10;
const ITERATIONS = 600000;
const LOCAL_COPY = 'scarif.vault.pw.v1';

export class VaultError extends Error {}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealToken(token, password) {
  if (password.length < MIN_PASSWORD) throw new VaultError(`Use a password of at least ${MIN_PASSWORD} characters.`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(ct), createdAt: new Date().toISOString() };
}

export async function openToken(vault, password) {
  try {
    const key = await deriveKey(password, unb64(vault.salt), vault.iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) }, key, unb64(vault.ct));
    return new TextDecoder().decode(plain);
  } catch {
    throw new VaultError('Wrong password.');
  }
}

// The published vault, or this browser's copy if it's newer (a fresh setup or
// password change takes about a minute to publish).
export async function loadVault() {
  let published = null;
  let local = null;
  try {
    const res = await fetch(`../${VAULT_PATH}?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) published = await res.json();
  } catch {}
  try {
    local = JSON.parse(localStorage.getItem(LOCAL_COPY));
  } catch {}
  if (published && local) return (local.createdAt || '') > (published.createdAt || '') ? local : published;
  return published || local || null;
}

export function keepLocalCopy(vault) {
  try { localStorage.setItem(LOCAL_COPY, JSON.stringify(vault)); } catch {}
}
