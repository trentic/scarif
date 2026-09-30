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

// A short burst of filtered noise: the crackle of a lightsaber clash.
function crackle({ dur = 0.25, vol = 0.12, freq = 2400 } = {}) {
  if (!settings.sfx) return;
  const ac = audioContext();
  const t = ac.currentTime;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 0.8;
  const gain = ac.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start(t);
}

export const sfx = {
  clash: () => {
    crackle({ dur: 0.35, vol: 0.18, freq: 1800 });
    tone(140, { dur: 0.45, type: 'sawtooth', vol: 0.07, slideTo: 90 });
    tone(620, { dur: 0.18, type: 'square', vol: 0.04, slideTo: 300 });
  },
  tick: () => tone(1400, { dur: 0.05, vol: 0.06 }),
  beep: () => tone(520, { dur: 0.18, vol: 0.1 }),
  pew: () => {
    tone(1900, { dur: 0.3, type: 'sawtooth', vol: 0.09, slideTo: 110 });
    tone(950, { dur: 0.25, type: 'square', vol: 0.05, slideTo: 80 });
  },
  correct: () => {
    tone(660, { dur: 0.12, vol: 0.09 });
    tone(990, { at: 0.1, dur: 0.25, vol: 0.09 });
  },
  wrong: () => tone(200, { dur: 0.4, type: 'sawtooth', vol: 0.1, slideTo: 70 }),
  lock: () => tone(880, { dur: 0.08, vol: 0.07 }),
  fanfare: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.12, dur: 0.3, vol: 0.08 })),
};
