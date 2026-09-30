// Vote split for a "Who Would Win?" matchup.
//
// Until a vote backend is configured (VOTES.endpoint in config.js), the split
// is an estimate from each character's fan power: the bigger the power gap,
// the more one-sided, with a little randomness so repeat matchups vary.
// These are labelled as estimates on screen, never as real votes.
import { VOTES } from '../config.js';

const SPREAD = 8; // power points per logistic step; lower = more one-sided
const JITTER = 4; // ± percentage points of randomness

function estimate(a, b) {
  const pa = Number(a.power) || 50;
  const pb = Number(b.power) || 50;
  const share = 1 / (1 + Math.exp(-(pa - pb) / SPREAD));
  const jitter = (Math.random() * 2 - 1) * JITTER;
  const pctA = Math.round(Math.min(94, Math.max(6, share * 100 + jitter)));
  return { a: pctA, b: 100 - pctA, source: 'estimate' };
}

export async function split(a, b) {
  if (VOTES.endpoint) {
    try {
      const url = `${VOTES.endpoint.replace(/\/$/, '')}/split?a=${encodeURIComponent(a.id)}&b=${encodeURIComponent(b.id)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        const data = await res.json();
        if (data.total >= VOTES.minVotes) return { a: Math.round(data.a), b: 100 - Math.round(data.a), source: 'votes', total: data.total };
      }
    } catch {}
  }
  return estimate(a, b);
}

export function record(a, b, winner) {
  if (!VOTES.endpoint) return;
  fetch(`${VOTES.endpoint.replace(/\/$/, '')}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ a: a.id, b: b.id, winner: winner.id }),
    keepalive: true,
  }).catch(() => {});
}

export const splitLabel = (source) => (source === 'votes' ? 'of players picked' : 'Fan estimate');
