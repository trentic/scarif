// Game sound effects, synthesised with Web Audio so no files are needed.
import { settings } from './settings.js';

let ctx = null;

export function audioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, { at = 0, dur = 0.15, type = 'square', vol = 0.12, slideTo = null } = {}) {
  if (!settings.sfx) return;
  const ac = audioContext();
  const t = ac.currentTime + at;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

// Every sound is a soft chime: sine notes (with a quiet triangle an octave
// below for warmth) and gentle decays, so nothing is harsh on a recording.
function chime(notes, { gap = 0.07, dur = 0.4, vol = 0.08, warm = true } = {}) {
  notes.forEach((f, i) => tone(f, { at: i * gap, dur: dur + i * 0.05, type: 'sine', vol: vol * (i ? 0.8 : 1) }));
  if (warm) tone(notes[0] / 2, { dur: dur * 0.8, type: 'triangle', vol: vol * 0.45 });
}

export const sfx = {
  // Pick a fighter (Who Would Win?).
  choose: () => chime([784, 1175]),
  // Last seconds of a timer.
  tick: () => tone(1568, { dur: 0.09, type: 'sine', vol: 0.04 }),
  // 3-2-1 countdown, then "go".
  beep: () => chime([659], { dur: 0.3, vol: 0.07 }),
  pew: () => chime([784, 988, 1319], { gap: 0.06, dur: 0.35, vol: 0.07 }),
  // Right / wrong answers: rising vs. gently falling.
  correct: () => chime([784, 1175]),
  wrong: () => chime([523, 392], { gap: 0.12, dur: 0.45, vol: 0.06 }),
  // Locking in an answer (host mode).
  lock: () => chime([880], { dur: 0.25, vol: 0.06, warm: false }),
  // Results screen.
  fanfare: () => chime([523, 659, 784, 1047], { gap: 0.12, dur: 0.5, vol: 0.07 }),
};
