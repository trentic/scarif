// Debug-mode access via a physical security key (WebAuthn / FIDO2).
//
// The first key is enrolled with a one-time setup code that the server prints
// to its console on start-up (or that you set with SETUP_CODE). After that,
// only someone already signed in with a key can enrol more keys.
import crypto from 'node:crypto';
import express from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import * as db from './db.js';

const RP_NAME = 'Scarif Debug';
const SESSION_COOKIE = 'scarif_session';
const PENDING_COOKIE = 'scarif_pending';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PENDING_TTL_MS = 5 * 60 * 1000;

const sessions = new Map(); // token -> expiresAt
const pending = new Map(); // token -> { challenge, kind, label, expiresAt }

let setupCode = null;
let failedSetupAttempts = 0;

export function initSetupCode() {
  if (db.listCredentials().length > 0) return null;
  setupCode = process.env.SETUP_CODE || crypto.randomBytes(4).toString('hex').toUpperCase();
  return setupCode;
}

// --- helpers -------------------------------------------------------------------

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(req, res, name, value, maxAgeMs) {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (req.secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function rpFor(req) {
  const origin = process.env.ORIGIN || `${req.protocol}://${req.get('host')}`;
  const rpID = process.env.RP_ID || new URL(origin).hostname;
  return { origin, rpID };
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function sweep(map) {
  const now = Date.now();
  for (const [k, v] of map) {
    const exp = typeof v === 'number' ? v : v.expiresAt;
    if (exp < now) map.delete(k);
  }
}

function isLoggedIn(req) {
  sweep(sessions);
  const token = parseCookies(req)[SESSION_COOKIE];
  return Boolean(token && sessions.has(token));
}

function startSession(req, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  setCookie(req, res, SESSION_COOKIE, token, SESSION_TTL_MS);
}

function stashChallenge(req, res, data) {
  const token = crypto.randomBytes(24).toString('base64url');
  pending.set(token, { ...data, expiresAt: Date.now() + PENDING_TTL_MS });
  setCookie(req, res, PENDING_COOKIE, token, PENDING_TTL_MS);
}

function takeChallenge(req, res, kind) {
  sweep(pending);
  const token = parseCookies(req)[PENDING_COOKIE];
  const item = token && pending.get(token);
  if (token) pending.delete(token);
  setCookie(req, res, PENDING_COOKIE, '', 0);
  return item && item.kind === kind ? item : null;
}

function publicKeyInfo(c) {
  return { id: c.id, label: c.label, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt || null };
}

export function requireAuth(req, res, next) {
  if (isLoggedIn(req)) return next();
  res.status(401).json({ error: 'Security key sign-in required.' });
}

// --- routes --------------------------------------------------------------------

export const authRouter = express.Router();

authRouter.get('/status', (req, res) => {
  const loggedIn = isLoggedIn(req);
  res.json({
    loggedIn,
    hasKeys: db.listCredentials().length > 0,
    keys: loggedIn ? db.listCredentials().map(publicKeyInfo) : undefined,
  });
});

authRouter.post('/register/options', async (req, res) => {
  const hasKeys = db.listCredentials().length > 0;
  if (hasKeys && !isLoggedIn(req)) {
    return res.status(401).json({ error: 'Sign in with an existing key to add another one.' });
  }
  if (!hasKeys) {
    if (failedSetupAttempts >= 10) {
      return res.status(429).json({ error: 'Too many wrong setup codes. Restart the server for a new code.' });
    }
    if (!setupCode || !safeEqual(String(req.body?.setupCode || '').trim().toUpperCase(), setupCode.toUpperCase())) {
      failedSetupAttempts++;
      return res.status(403).json({ error: 'Wrong setup code. Check the server console.' });
    }
  }

  let userId = db.getAdminUserId();
  if (!userId) {
    userId = crypto.randomBytes(16).toString('base64url');
    db.setAdminUserId(userId);
  }

  const { rpID } = rpFor(req);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: 'scarif-admin',
    userDisplayName: 'Scarif Admin',
    userID: Buffer.from(userId, 'base64url'),
    attestationType: 'none',
    preferredAuthenticatorType: 'securityKey',
    authenticatorSelection: { residentKey: 'discouraged', userVerification: 'discouraged' },
    excludeCredentials: db.listCredentials().map((c) => ({ id: c.id, transports: c.transports })),
  });

  const label = String(req.body?.label || '').trim().slice(0, 40) || `Key ${db.listCredentials().length + 1}`;
  stashChallenge(req, res, { kind: 'register', challenge: options.challenge, label });
  res.json(options);
});

authRouter.post('/register/verify', async (req, res) => {
  const item = takeChallenge(req, res, 'register');
  if (!item) return res.status(400).json({ error: 'Registration expired. Try again.' });

  // Re-check permission: the state may have changed since options were issued.
  if (db.listCredentials().length > 0 && !isLoggedIn(req)) {
    return res.status(401).json({ error: 'Sign-in required.' });
  }

  const { origin, rpID } = rpFor(req);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: item.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!verification.verified) return res.status(400).json({ error: 'Key could not be verified.' });

  const { credential } = verification.registrationInfo;
  db.addCredential({
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports || req.body?.response?.transports || [],
    label: item.label,
    createdAt: new Date().toISOString(),
  });
  setupCode = null; // one-time use
  startSession(req, res);
  res.json({ ok: true });
});

authRouter.post('/login/options', async (req, res) => {
  const creds = db.listCredentials();
  if (creds.length === 0) return res.status(400).json({ error: 'No security keys enrolled yet.' });
  const { rpID } = rpFor(req);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'discouraged',
    allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports })),
  });
  stashChallenge(req, res, { kind: 'login', challenge: options.challenge });
  res.json(options);
});

authRouter.post('/login/verify', async (req, res) => {
  const item = takeChallenge(req, res, 'login');
  if (!item) return res.status(400).json({ error: 'Sign-in expired. Try again.' });

  const cred = db.getCredential(req.body?.id);
  if (!cred) return res.status(400).json({ error: 'That key is not enrolled.' });

  const { origin, rpID } = rpFor(req);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: item.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: cred.id,
        publicKey: Buffer.from(cred.publicKey, 'base64url'),
        counter: cred.counter,
        transports: cred.transports,
      },
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!verification.verified) return res.status(401).json({ error: 'Key could not be verified.' });

  db.updateCredential(cred.id, {
    counter: verification.authenticationInfo.newCounter,
    lastUsedAt: new Date().toISOString(),
  });
  startSession(req, res);
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) sessions.delete(token);
  setCookie(req, res, SESSION_COOKIE, '', 0);
  res.json({ ok: true });
});

authRouter.delete('/keys/:id', requireAuth, (req, res) => {
  const creds = db.listCredentials();
  if (!db.getCredential(req.params.id)) return res.status(404).json({ error: 'Key not found.' });
  if (creds.length <= 1) return res.status(400).json({ error: "You can't remove your only key." });
  db.removeCredential(req.params.id);
  res.json({ ok: true });
});
