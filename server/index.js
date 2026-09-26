import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { GAMES, gamesForEntry, getGame, meetsRequirements } from '../shared/games.js';
import { authRouter, initSetupCode, requireAuth } from './auth.js';
import * as db from './db.js';
import { deleteMedia, fetchImage, MAX_BYTES, MediaError, saveMedia } from './media.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  });
  next();
});
app.use(express.json({ limit: '100kb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 2 },
}).fields([
  { name: 'image', maxCount: 1 },
  { name: 'sound', maxCount: 1 },
]);

const publicEntry = (e) => ({ id: e.id, name: e.name, image: e.image, sound: e.sound });
const adminEntry = (e) => ({ ...e, games: gamesForEntry(e) });

// --- public game API -----------------------------------------------------------

app.get('/api/games', (req, res) => {
  const entries = db.listEntries();
  res.json(
    GAMES.map((g) => ({
      ...g,
      eligible: entries.filter((e) => meetsRequirements(e, g.requires)).length,
    })),
  );
});

app.get('/api/games/:id/pool', (req, res) => {
  const game = getGame(req.params.id);
  if (!game) return res.status(404).json({ error: 'Unknown game.' });
  const pool = db.listEntries().filter((e) => meetsRequirements(e, game.requires));
  res.set('Cache-Control', 'no-store').json({ game, entries: pool.map(publicEntry) });
});

// --- debug-mode API (security key required) --------------------------------------

app.use('/api/auth', authRouter);

app.get('/api/entries', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store').json({ games: GAMES, entries: db.listEntries().map(adminEntry) });
});

function readName(raw, currentId) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new MediaError('Give it a name.');
  if (name.length > 80) throw new MediaError('Name must be 80 characters or fewer.');
  const clash = db.findByName(name);
  if (clash && clash.id !== currentId) throw new MediaError(`"${clash.name}" already exists.`);
  return name;
}

async function readImage(req, prefix) {
  const file = req.files?.image?.[0];
  if (file) return saveMedia(file.buffer, 'image', prefix);
  const url = String(req.body.imageUrl || '').trim();
  if (url) return saveMedia(await fetchImage(url), 'image', prefix);
  return null;
}

function readSound(req, prefix) {
  const file = req.files?.sound?.[0];
  return file ? saveMedia(file.buffer, 'sound', prefix) : null;
}

app.post('/api/entries', requireAuth, upload, async (req, res, next) => {
  const saved = [];
  try {
    const name = readName(req.body.name);
    const prefix = db.slugify(name) || 'entry';
    const image = await readImage(req, prefix);
    if (!image) throw new MediaError('Add an image (upload a file or paste an image address).');
    saved.push(image);
    const sound = readSound(req, prefix);
    if (sound) saved.push(sound);
    const entry = db.createEntry({ name, image, sound });
    res.status(201).json(adminEntry(entry));
  } catch (err) {
    saved.forEach(deleteMedia);
    next(err);
  }
});

app.patch('/api/entries/:id', requireAuth, upload, async (req, res, next) => {
  const entry = db.getEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found.' });
  const saved = [];
  try {
    const patch = {};
    if (req.body.name !== undefined) patch.name = readName(req.body.name, entry.id);
    const image = await readImage(req, entry.id);
    if (image) saved.push((patch.image = image));
    const sound = readSound(req, entry.id);
    if (sound) saved.push((patch.sound = sound));
    else if (req.body.removeSound === 'true') patch.sound = null;

    const old = { image: entry.image, sound: entry.sound };
    const updated = db.updateEntry(entry.id, patch);
    if ('image' in patch && old.image !== patch.image) deleteMedia(old.image);
    if ('sound' in patch && old.sound !== patch.sound) deleteMedia(old.sound);
    res.json(adminEntry(updated));
  } catch (err) {
    saved.forEach(deleteMedia);
    next(err);
  }
});

app.delete('/api/entries/:id', requireAuth, (req, res) => {
  const entry = db.deleteEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found.' });
  deleteMedia(entry.image);
  deleteMedia(entry.sound);
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// --- static files ----------------------------------------------------------------

app.use('/media', express.static(db.MEDIA_DIR, { maxAge: '7d', immutable: true }));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.get('/debug', (req, res) => res.sendFile(path.join(ROOT, 'public/debug/index.html')));
app.use(express.static(path.join(ROOT, 'public')));

// --- errors ------------------------------------------------------------------------

app.use((err, req, res, _next) => {
  if (err instanceof MediaError) return res.status(400).json({ error: err.message });
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Files must be 10 MB or smaller.' : err.message;
    return res.status(400).json({ error: msg });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => {
  console.log(`Scarif running on http://localhost:${PORT}`);
  console.log(`Debug mode:       http://localhost:${PORT}/debug`);
  const code = initSetupCode();
  if (code) {
    console.log('');
    console.log('  No security key enrolled yet.');
    console.log(`  One-time setup code: ${code}`);
    console.log('  Open /debug and enter this code to register your key.');
    console.log('');
  }
});
