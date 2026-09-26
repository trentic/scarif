// Audio trimmer: waveform with draggable start/end handles.
// The trimmed clip is re-encoded as a 16-bit WAV with tiny fades so the
// cut points don't click.
import { h, icons } from '../js/ui.js';

const MIN_LENGTH = 0.05; // seconds
const FADE = 0.004; // seconds
const SILENCE = 0.02; // amplitude treated as silence by auto-trim
const PAD = 0.01; // seconds of breathing room left by auto-trim
const HEIGHT = 96;

let ctx = null;
const audioContext = () => {
  ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};

const fmt = (s) => s.toFixed(2);

export function createTrimmer({ onChange } = {}) {
  let buffer = null;
  let start = 0;
  let end = 0;
  let peaks = [];
  let playing = null;
  let raf = 0;
  let playhead = null;

  const canvas = h('canvas', { class: 'trim-wave', height: HEIGHT * 2, 'aria-label': 'Waveform. Drag the handles to trim.' });
  const startIn = h('input', { type: 'number', min: '0', step: '0.01', 'aria-label': 'Start (seconds)' });
  const endIn = h('input', { type: 'number', min: '0', step: '0.01', 'aria-label': 'End (seconds)' });
  const length = h('span', { class: 'trim-len' });
  const playBtn = h('button', { type: 'button', class: 'btn ghost small', onclick: () => (playing ? stop() : play()) });
  const status = h('div', { class: 'hint' });

  const el = h('div', { class: 'trimmer', hidden: true },
    h('div', { class: 'trim-head' },
      h('span', { class: 'trim-title' }, '✂ Trim'),
      length,
    ),
    canvas,
    h('div', { class: 'trim-controls' },
      h('label', { class: 'trim-field' }, 'Start', startIn, 's'),
      h('label', { class: 'trim-field' }, 'End', endIn, 's'),
      playBtn,
      h('button', { type: 'button', class: 'btn ghost small', onclick: autoTrim, title: 'Cut the quiet parts before and after the sound' }, 'Auto-trim silence'),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => setRange(0, buffer.duration) }, 'Reset'),
    ),
    status,
  );

  // --- loading -------------------------------------------------------------------

  async function load(source) {
    stop();
    buffer = null;
    el.hidden = false;
    status.textContent = 'Loading waveform…';
    draw();
    try {
      const data = source instanceof Blob
        ? await source.arrayBuffer()
        : await (await fetch(source, { cache: 'no-store' })).arrayBuffer();
      buffer = await audioContext().decodeAudioData(data);
      computePeaks();
      status.textContent = 'Drag the handles or type times. Only the highlighted part is saved.';
      setRange(0, buffer.duration);
      return true;
    } catch {
      status.textContent = "This file can't be trimmed in the browser. It will be saved as is.";
      draw();
      return false;
    }
  }

  function clear() {
    stop();
    buffer = null;
    el.hidden = true;
  }

  function computePeaks() {
    const cols = 600;
    const chans = [...Array(buffer.numberOfChannels)].map((_, c) => buffer.getChannelData(c));
    const per = Math.max(1, Math.floor(buffer.length / cols));
    peaks = [];
    for (let i = 0; i < cols; i++) {
      let max = 0;
      const from = i * per;
      const to = Math.min(buffer.length, from + per);
      for (let j = from; j < to; j += 4) {
        for (const ch of chans) max = Math.max(max, Math.abs(ch[j]));
      }
      peaks.push(max);
    }
  }

  // --- range ---------------------------------------------------------------------------

  function setRange(s, e) {
    if (!buffer) return;
    const d = buffer.duration;
    s = Math.max(0, Math.min(s, d - MIN_LENGTH));
    e = Math.min(d, Math.max(e, s + MIN_LENGTH));
    start = s;
    end = e;
    startIn.value = fmt(start);
    endIn.value = fmt(end);
    startIn.max = endIn.max = fmt(d);
    length.textContent = `${fmt(end - start)}s of ${fmt(d)}s`;
    draw();
    onChange?.();
  }

  startIn.addEventListener('change', () => setRange(Number(startIn.value) || 0, end));
  endIn.addEventListener('change', () => setRange(start, Number(endIn.value) || 0));

  function autoTrim() {
    if (!buffer) return;
    const chans = [...Array(buffer.numberOfChannels)].map((_, c) => buffer.getChannelData(c));
    const loud = (i) => chans.some((ch) => Math.abs(ch[i]) > SILENCE);
    let first = 0;
    while (first < buffer.length && !loud(first)) first++;
    let last = buffer.length - 1;
    while (last > first && !loud(last)) last--;
    if (first >= last) {
      status.textContent = 'No sound found above the silence level.';
      return;
    }
    setRange(first / buffer.sampleRate - PAD, last / buffer.sampleRate + PAD);
  }

  // --- dragging --------------------------------------------------------------------------

  const timeAt = (clientX) => {
    const r = canvas.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * buffer.duration;
  };

  let dragging = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!buffer) return;
    const t = timeAt(e.clientX);
    dragging = Math.abs(t - start) <= Math.abs(t - end) ? 'start' : 'end';
    canvas.setPointerCapture(e.pointerId);
    move(e);
  });
  canvas.addEventListener('pointermove', (e) => dragging && move(e));
  canvas.addEventListener('pointerup', () => { dragging = null; });
  canvas.addEventListener('pointercancel', () => { dragging = null; });
  function move(e) {
    const t = timeAt(e.clientX);
    if (dragging === 'start') setRange(t, end);
    else setRange(start, t);
  }

  // --- playback --------------------------------------------------------------------------

  function play() {
    if (!buffer) return;
    stop();
    const ac = audioContext();
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.connect(ac.destination);
    const began = ac.currentTime;
    src.start(0, start, end - start);
    src.onended = () => { if (playing === src) stop(); };
    playing = src;
    playBtn.textContent = '■ Stop';
    const tick = () => {
      playhead = start + (ac.currentTime - began);
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    cancelAnimationFrame(raf);
    try { playing?.stop(); } catch {}
    playing = null;
    playhead = null;
    playBtn.textContent = '▶ Play selection';
    draw();
  }

  // --- drawing -------------------------------------------------------------------------------

  function draw() {
    const w = (canvas.width = Math.max(300, Math.round(canvas.clientWidth * 2 || 600)));
    const hgt = canvas.height;
    const g = canvas.getContext('2d');
    const css = getComputedStyle(el);
    const accent = css.getPropertyValue('--red').trim() || '#ff3b3b';
    const dim = css.getPropertyValue('--dim').trim() || '#4f5d6f';
    g.clearRect(0, 0, w, hgt);
    if (!buffer) return;
    const d = buffer.duration;
    const x0 = (start / d) * w;
    const x1 = (end / d) * w;

    g.fillStyle = 'rgba(255, 59, 59, 0.10)';
    g.fillRect(x0, 0, x1 - x0, hgt);

    const colW = w / peaks.length;
    peaks.forEach((p, i) => {
      const x = i * colW;
      const bar = Math.max(2, p * (hgt - 8));
      g.fillStyle = x >= x0 && x <= x1 ? accent : dim;
      g.fillRect(x, (hgt - bar) / 2, Math.max(1, colW - 1), bar);
    });

    for (const x of [x0, x1]) {
      g.fillStyle = '#e9f0f8';
      g.fillRect(x - 2, 0, 4, hgt);
      g.fillRect(x - 8, hgt / 2 - 16, 16, 32);
    }
    if (playhead != null) {
      g.fillStyle = '#ffc940';
      g.fillRect((playhead / d) * w - 1, 0, 3, hgt);
    }
  }
  new ResizeObserver(() => draw()).observe(canvas);

  // --- export --------------------------------------------------------------------------------

  const isTrimmed = () => Boolean(buffer) && (start > 0.001 || end < buffer.duration - 0.001);

  function toWav() {
    const rate = buffer.sampleRate;
    const from = Math.floor(start * rate);
    const to = Math.ceil(end * rate);
    const frames = to - from;
    const chans = Math.min(2, buffer.numberOfChannels);
    const data = [...Array(chans)].map((_, c) => buffer.getChannelData(c).subarray(from, to));
    const fade = Math.min(Math.floor(FADE * rate), Math.floor(frames / 2));

    const out = new DataView(new ArrayBuffer(44 + frames * chans * 2));
    const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); out.setUint32(4, 36 + frames * chans * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, chans, true);
    out.setUint32(24, rate, true); out.setUint32(28, rate * chans * 2, true); out.setUint16(32, chans * 2, true); out.setUint16(34, 16, true);
    str(36, 'data'); out.setUint32(40, frames * chans * 2, true);
    let o = 44;
    for (let i = 0; i < frames; i++) {
      const gain = i < fade ? i / fade : i >= frames - fade ? (frames - 1 - i) / fade : 1;
      for (let c = 0; c < chans; c++) {
        const v = Math.max(-1, Math.min(1, data[c][i] * gain));
        out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
        o += 2;
      }
    }
    return new Blob([out.buffer], { type: 'audio/wav' });
  }

  return { el, load, clear, isTrimmed, toWav, stop };
}
