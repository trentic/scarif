// Turns chat messages into votes for the current round, plus a leaderboard
// that lasts for the streaming session (this browser tab).
import * as chat from './chat.js';

const BOARD_KEY = 'scarif.chat.board.v1';
// Votes that arrive shortly after a reveal still count: viewers see the stream
// a few seconds late, so they typed before they saw the answer.
export const GRACE_MS = 4000;

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// options: [{ id, keys: ['a', '1'], names: ['DL-44'] }]
export function voteRound(options, { onUpdate } = {}) {
  const votes = new Map(); // userId → { option, user, at }
  let open = true;

  const prepared = options.map((o) => ({ ...o, keys: (o.keys || []).map(norm), names: (o.names || []).map(norm).filter(Boolean) }));
  function match(text) {
    const t = norm(text);
    if (!t) return null;
    const byKey = prepared.find((o) => o.keys.includes(t));
    if (byKey) return byKey;
    // "dl 44", "i think dl-44", "DL44!" → match by name if exactly one option's name is in the message.
    const squash = t.replace(/ /g, '');
    const hits = prepared.filter((o) => o.names.some((n) => ` ${t} `.includes(` ${n} `) || squash === n.replace(/ /g, '')));
    return hits.length === 1 ? hits[0] : null;
  }

  function tally() {
    const counts = Object.fromEntries(options.map((o) => [o.id, 0]));
    for (const v of votes.values()) counts[v.option]++;
    return { counts, total: votes.size };
  }

  const off = chat.on('message', (m) => {
    if (!open) return;
    const o = match(m.text);
    if (!o) return;
    votes.set(m.userId, { option: o.id, user: m.user, userId: m.userId, at: m.at });
    onUpdate?.(tally());
  });

  return {
    tally,
    // Earliest current voter for an option.
    firstFor(id) {
      return [...votes.values()].filter((v) => v.option === id).sort((a, b) => a.at - b.at)[0] || null;
    },
    // Stop accepting votes after `grace` ms and resolve with the final result.
    close(grace = GRACE_MS) {
      return new Promise((resolve) => {
        setTimeout(() => {
          open = false;
          off();
          resolve({ ...tally(), votes: [...votes.values()].sort((a, b) => a.at - b.at) });
        }, grace);
      });
    },
    cancel() {
      open = false;
      off();
    },
  };
}

// --- leaderboard ---------------------------------------------------------------------------

function loadBoard() {
  try { return JSON.parse(sessionStorage.getItem(BOARD_KEY) || '{}'); } catch { return {}; }
}
function saveBoard(board) {
  try { sessionStorage.setItem(BOARD_KEY, JSON.stringify(board)); } catch {}
}

// Everyone who voted for `correctId` gets a point; the first of them gets a bonus.
// Returns the first correct voter (or null).
export function award(result, correctId) {
  const board = loadBoard();
  const right = result.votes.filter((v) => v.option === correctId);
  right.forEach((v, i) => {
    const row = (board[v.userId] ||= { user: v.user, points: 0, firsts: 0 });
    row.user = v.user;
    row.points += i === 0 ? 2 : 1;
    if (i === 0) row.firsts++;
  });
  saveBoard(board);
  return right[0] || null;
}

export function top(n = 5) {
  return Object.values(loadBoard()).sort((a, b) => b.points - a.points || b.firsts - a.firsts).slice(0, n);
}

export function resetBoard() {
  saveBoard({});
}
