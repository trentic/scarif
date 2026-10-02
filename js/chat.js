// Live chat for games: YouTube Live (official API, API key only) or a built-in
// test chat with fake viewers for rehearsing.
//
// Chat is only read while a game is running (startGame → endGame) to save the
// YouTube API daily allowance: each chat check costs 5 units of the free
// 10,000/day, finding the stream's chat costs 1.
//
// Settings (API key, stream link) are stored only in this browser.
const STORE = 'scarif.chat.v1';
const QUOTA_STORE = 'scarif.chat.quota.v1';
const API = 'https://www.googleapis.com/youtube/v3';
const MIN_INTERVAL = 5000; // never check chat more often than this
export const DAILY_QUOTA = 10000;

const listeners = { message: new Set(), status: new Set() };
const emit = (type, data) => listeners[type].forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });

export function on(type, fn) {
  listeners[type].add(fn);
  return () => listeners[type].delete(fn);
}

// --- config ---------------------------------------------------------------------------

function load() {
  const defaults = { source: 'off', apiKey: '', stream: '', leaderboard: true, membersOnly: false };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { return defaults; }
}
export const config = load();
export function saveConfig(patch) {
  Object.assign(config, patch);
  try { localStorage.setItem(STORE, JSON.stringify(config)); } catch {}
  if ('source' in patch || 'apiKey' in patch || 'stream' in patch) reset();
}

export const isOn = () => config.source === 'youtube' || config.source === 'test';

// --- quota tracking (an estimate kept in this browser) --------------------------------------

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // YouTube resets at midnight Pacific
export function quotaUsed() {
  try {
    const q = JSON.parse(localStorage.getItem(QUOTA_STORE) || '{}');
    return q.day === today() ? q.used : 0;
  } catch { return 0; }
}
function spend(units) {
  const used = quotaUsed() + units;
  try { localStorage.setItem(QUOTA_STORE, JSON.stringify({ day: today(), used })); } catch {}
}
// Minutes of chat reading left today at the minimum check interval.
export const minutesLeft = () => Math.max(0, Math.floor(((DAILY_QUOTA - quotaUsed()) / 5) * (MIN_INTERVAL / 60000)));

// --- status --------------------------------------------------------------------------------

export const state = { status: 'off', detail: '' };
function setStatus(status, detail = '') {
  state.status = status;
  state.detail = detail;
  emit('status', { ...state });
}

// Accepts a watch link, youtu.be link, /live/ link, Studio link or a bare video ID.
export function parseVideoId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(?:live|shorts|embed|video)\/([\w-]{11})/) || (u.hostname === 'youtu.be' && u.pathname.match(/^\/([\w-]{11})/));
    if (m) return m[1];
  } catch {}
  return null;
}

// --- YouTube --------------------------------------------------------------------------------

let liveChatId = null;
let pageToken = null;
let timer = 0;
let running = false;
let since = 0; // ignore messages published before the game started
const seen = new Set();

async function api(path, params, cost) {
  const url = new URL(`${API}/${path}`);
  Object.entries({ ...params, key: config.apiKey }).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url, { cache: 'no-store' });
  spend(cost);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data?.error?.errors?.[0]?.reason || '';
    const err = new Error(data?.error?.message || `YouTube error ${res.status}`);
    err.reason = reason;
    err.status = res.status;
    throw err;
  }
  return data;
}

function explain(err) {
  if (err.reason === 'quotaExceeded' || err.reason === 'dailyLimitExceeded') return ['quota', "Today's YouTube API allowance is used up. It resets at midnight Pacific time."];
  if (err.reason === 'keyInvalid' || /API key not valid/i.test(err.message)) return ['error', 'That API key was rejected. Check it in the Chat panel.'];
  if (err.reason === 'liveChatEnded') return ['error', 'The stream’s live chat has ended.'];
  if (err.reason === 'liveChatNotFound' || err.status === 404) return ['error', 'Couldn’t find that stream’s live chat.'];
  if (err.status === 403) return ['error', `YouTube refused the request (${err.reason || err.message}). Is the YouTube Data API enabled for this key, and is the key allowed on this site?`];
  return ['error', err.message || 'Couldn’t reach YouTube.'];
}

export async function connect() {
  if (config.source !== 'youtube') return false;
  const id = parseVideoId(config.stream);
  if (!config.apiKey) { setStatus('error', 'Add your YouTube API key in the Chat panel.'); return false; }
  if (!id) { setStatus('error', 'Paste your live stream’s link in the Chat panel.'); return false; }
  setStatus('connecting', 'Finding your stream’s chat…');
  try {
    const data = await api('videos', { part: 'liveStreamingDetails,snippet', id }, 1);
    const video = data.items?.[0];
    if (!video) throw Object.assign(new Error('That video wasn’t found. Check the link.'), { status: 404 });
    liveChatId = video.liveStreamingDetails?.activeLiveChatId || null;
    if (!liveChatId) {
      setStatus('error', 'That video isn’t live right now (no active chat). Start the stream, then connect.');
      return false;
    }
    pageToken = null;
    setStatus('ready', video.snippet?.title || 'Stream found');
    return true;
  } catch (err) {
    setStatus(...explain(err));
    return false;
  }
}

async function poll() {
  if (!running) return;
  let wait = MIN_INTERVAL;
  try {
    const data = await api('liveChat/messages', { liveChatId, part: 'snippet,authorDetails', pageToken, maxResults: 2000 }, 5);
    const first = pageToken === null;
    pageToken = data.nextPageToken || pageToken;
    wait = Math.max(MIN_INTERVAL, data.pollingIntervalMillis || 0);
    for (const item of data.items || []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const at = Date.parse(item.snippet?.publishedAt) || Date.now();
      // The first fetch returns recent history; only count messages sent
      // since the game started.
      if (first && at < since) continue;
      if (item.snippet?.type && item.snippet.type !== 'textMessageEvent') continue;
      emit('message', {
        id: item.id,
        userId: item.authorDetails?.channelId || item.id,
        user: item.authorDetails?.displayName || 'viewer',
        text: item.snippet?.displayMessage || '',
        isMod: Boolean(item.authorDetails?.isChatModerator || item.authorDetails?.isChatOwner),
        isMember: Boolean(item.authorDetails?.isChatSponsor),
        at,
      });
    }
    if (state.status !== 'live') setStatus('live', '');
  } catch (err) {
    const [status, detail] = explain(err);
    setStatus(status, detail);
    if (status === 'quota' || err.reason === 'liveChatEnded') { running = false; return; }
    wait = 15000; // back off on errors
  }
  if (running) timer = setTimeout(poll, wait);
}

// --- test chat (fake viewers) ------------------------------------------------------------------

const FAKE_MEMBERS = new Set(['kyber_kid', 'TatooineTina', 'ObiWanKenoBro', 'Ahsoka4Life', 'MandoMom', 'HelloThere77']);
const FAKE_USERS = ['kyber_kid', 'DinDjarinFan', 'rogue_one_42', 'TatooineTina', 'Grievous_Gamer', 'ObiWanKenoBro', 'sith_happens', 'PadawanPete', 'BB8_Lover', 'ClankerHater99', 'Ahsoka4Life', 'NerfHerder', 'TheChosenWon', 'MandoMom', 'blue_milk', 'HelloThere77'];
let testHint = () => [];
// Games tell the test chat what a sensible vote looks like right now.
export function setTestHint(fn) { testHint = fn || (() => []); }

function testTick() {
  if (!running) return;
  const choices = testHint();
  const user = FAKE_USERS[Math.floor(Math.random() * FAKE_USERS.length)];
  const junk = ['lol', 'this is hard', 'GG', 'hello from 🇬🇧', 'easy', '👀'];
  const text = choices.length && Math.random() < 0.85
    ? choices[Math.floor(Math.random() ** 1.6 * choices.length)] // skewed: first choices more popular
    : junk[Math.floor(Math.random() * junk.length)];
  emit('message', { id: `t${Date.now()}${Math.random()}`, userId: user, user, text, isMod: false, isMember: FAKE_MEMBERS.has(user), at: Date.now() });
  timer = setTimeout(testTick, 250 + Math.random() * 700);
}

// --- lifecycle ---------------------------------------------------------------------------------

function reset() {
  stopReading();
  liveChatId = null;
  pageToken = null;
  setStatus(isOn() ? 'idle' : 'off', '');
}

function stopReading() {
  running = false;
  clearTimeout(timer);
}

// Called when a game starts / ends, so chat is only read during play.
export async function startGame() {
  if (!isOn() || running) return;
  since = Date.now() - 3000;
  if (config.source === 'test') {
    running = true;
    setStatus('live', 'Test chat');
    testTick();
    return;
  }
  if (!liveChatId && !(await connect())) return;
  running = true;
  poll();
}

export function endGame() {
  stopReading();
  if (isOn() && state.status === 'live') setStatus('idle', '');
}

setStatus(isOn() ? 'idle' : 'off', '');
