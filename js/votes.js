// Vote split for a "Who Would Win?" matchup.
//
// Until a vote backend is configured (VOTES.endpoint in config.js), the split
// is an estimate from each character's fan power: the bigger the power gap,
// the more one-sided, with a little randomness so repeat matchups vary.
// These are labelled as estimates on screen, never as real votes.
import { VOTES } from '../config.js';

// Logistic curve on the fan-power gap: equal powers split 50/50, and the
// split grows with the gap but levels off (see VOTES.estimate in config.js).
export function estimateShare(gap, { spread = 12, min = 8, max = 92 } = {}) {
  const share = 100 / (1 + Math.exp(-gap / spread));
  return Math.min(max, Math.max(min, share));
}

function estimate(a, b) {
  const opts = VOTES.estimate || {};
  const gap = (Number(a.power) || 50) - (Number(b.power) || 50);
  const jitter = (Math.random() * 2 - 1) * (opts.jitter ?? 3);
  const pctA = Math.round(estimateShare(gap, opts) + jitter);
  const clamped = Math.min(opts.max ?? 92, Math.max(opts.min ?? 8, pctA));
  return { a: clamped, b: 100 - clamped, source: 'estimate' };
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
