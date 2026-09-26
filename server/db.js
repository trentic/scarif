// Tiny JSON-file database. The whole thing is kept in memory and written
// back atomically on every change, which is plenty for a few hundred entries.
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(MEDIA_DIR, { recursive: true });

const empty = () => ({ entries: [], credentials: [], adminUserId: null });

let state = empty();
if (fs.existsSync(DB_FILE)) {
  state = { ...empty(), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
}

function save() {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

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

// --- entries ---------------------------------------------------------------

export function listEntries() {
  return [...state.entries].sort((a, b) => a.name.localeCompare(b.name));
}

export function getEntry(id) {
  return state.entries.find((e) => e.id === id) || null;
}

export function findByName(name) {
  const lower = name.trim().toLowerCase();
  return state.entries.find((e) => e.name.toLowerCase() === lower) || null;
}

export function createEntry({ name, image, sound }) {
  const base = slugify(name) || 'entry';
  let id = base;
  for (let n = 2; getEntry(id); n++) id = `${base}-${n}`;
  const now = new Date().toISOString();
  const entry = { id, name: name.trim(), image, sound: sound || null, createdAt: now, updatedAt: now };
  state.entries.push(entry);
  save();
  return entry;
}

export function updateEntry(id, patch) {
  const entry = getEntry(id);
  if (!entry) return null;
  Object.assign(entry, patch, { updatedAt: new Date().toISOString() });
  save();
  return entry;
}

export function deleteEntry(id) {
  const entry = getEntry(id);
  if (!entry) return null;
  state.entries = state.entries.filter((e) => e.id !== id);
  save();
  return entry;
}

// --- security keys -----------------------------------------------------------

export function getAdminUserId() {
  return state.adminUserId;
}

export function setAdminUserId(id) {
  state.adminUserId = id;
  save();
}

export function listCredentials() {
  return state.credentials;
}

export function getCredential(id) {
  return state.credentials.find((c) => c.id === id) || null;
}

export function addCredential(cred) {
  state.credentials.push(cred);
  save();
}

export function updateCredential(id, patch) {
  const cred = getCredential(id);
  if (!cred) return null;
  Object.assign(cred, patch);
  save();
  return cred;
}

export function removeCredential(id) {
  state.credentials = state.credentials.filter((c) => c.id !== id);
  save();
}
