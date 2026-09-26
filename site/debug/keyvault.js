// Locks your GitHub token behind a physical security key.
//
// The key's PRF extension (FIDO2 "hmac-secret") turns a stored random salt
// into a secret that only that physical key can produce. That secret
// encrypts the token (AES-256-GCM), and only the encrypted copy is saved
// in this browser. Without touching the key, the token can't be read, so
// nothing can be written to the archive.
const STORE = 'scarif.vault.v1';
const INFO = new TextEncoder().encode('scarif-vault-v1');

export class VaultError extends Error {}

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

export const supported = () => Boolean(window.PublicKeyCredential && navigator.credentials && window.crypto?.subtle);

export function listKeys() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '[]');
  } catch {
    return [];
  }
}

function saveKeys(keys) {
  localStorage.setItem(STORE, JSON.stringify(keys));
}

export function removeKey(credId) {
  saveKeys(listKeys().filter((k) => k.credId !== credId));
}

export function forgetDevice() {
  localStorage.removeItem(STORE);
}

async function aesKey(secret) {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: INFO },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function friendly(err) {
  if (err instanceof VaultError) return err;
  if (err.name === 'NotAllowedError') return new VaultError('Cancelled, or the key timed out. Try again.');
  if (err.name === 'InvalidStateError') return new VaultError('That key is already registered on this device.');
  if (err.name === 'SecurityError') return new VaultError('Security keys need HTTPS (or localhost).');
  return new VaultError(err.message || String(err));
}

const NO_PRF = "This key or browser doesn't support key secrets (PRF). Use Chrome or Edge with a FIDO2 key such as a YubiKey 5.";

// Ask the key(s) for their PRF secret. Returns { credId, secret }.
async function prf(keys) {
  const evalByCredential = Object.fromEntries(keys.map((k) => [k.credId, { first: unb64u(k.salt) }]));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      allowCredentials: keys.map((k) => ({ type: 'public-key', id: unb64u(k.credId) })),
      userVerification: 'discouraged',
      timeout: 120000,
      extensions: { prf: { evalByCredential } },
    },
  });
  const first = assertion.getClientExtensionResults().prf?.results?.first;
  if (!first) throw new VaultError(NO_PRF);
  return { credId: b64u(assertion.rawId), secret: first };
}

// Register a new key and store the token encrypted with it.
// May ask you to touch the key twice (once to register, once to derive the secret).
export async function addKey(token, label) {
  try {
    const salt = random(32);
    const cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'Scarif Debug' },
        user: { id: random(16), name: 'scarif-admin', displayName: 'Scarif Admin' },
        challenge: random(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -8 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: 'cross-platform', residentKey: 'discouraged', userVerification: 'discouraged' },
        hints: ['security-key'],
        excludeCredentials: listKeys().map((k) => ({ type: 'public-key', id: unb64u(k.credId) })),
        timeout: 120000,
        attestation: 'none',
        extensions: { prf: { eval: { first: salt } } },
      },
    });
    const ext = cred.getClientExtensionResults().prf;
    if (!ext?.enabled) throw new VaultError(NO_PRF);
    const record = {
      credId: b64u(cred.rawId),
      salt: b64u(salt),
      label: label || `Key ${listKeys().length + 1}`,
      createdAt: new Date().toISOString(),
    };
    // Some keys return the secret at registration; most need a second touch.
    const secret = ext.results?.first || (await prf([record])).secret;
    const iv = random(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), new TextEncoder().encode(token));
    record.iv = b64u(iv);
    record.ct = b64u(ct);
    saveKeys([...listKeys(), record]);
    return record;
  } catch (err) {
    throw friendly(err);
  }
}

// Touch any registered key to get the token back.
export async function unlock() {
  const keys = listKeys();
  if (!keys.length) throw new VaultError('No security key is set up on this device.');
  try {
    const { credId, secret } = await prf(keys);
    const record = keys.find((k) => k.credId === credId);
    if (!record) throw new VaultError("That key isn't registered on this device.");
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(record.iv) }, await aesKey(secret), unb64u(record.ct));
    record.lastUsedAt = new Date().toISOString();
    saveKeys(keys);
    return new TextDecoder().decode(plain);
  } catch (err) {
    if (err.name === 'OperationError') throw new VaultError("That key couldn't unlock the vault.");
    throw friendly(err);
  }
}
