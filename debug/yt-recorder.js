// Record a sound effect from a YouTube video.
//
// Browsers can't download YouTube audio, but Chrome and Edge can record a tab's
// sound while it plays. The video plays here, you press Record, Chrome asks to
// share this tab (tick "Share tab audio"), and the clip comes back as a File.
// Only use clips you're allowed to reuse.
import { parseVideoId } from '../js/chat.js';
import { h } from '../js/ui.js';
import { createTrimmer } from './trimmer.js';

const MAX_SECONDS = 30;

export const canRecord = () => Boolean(navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder);

// "1m23s", "83", "1:23" → 83
export function parseTime(text) {
  const s = String(text ?? '').trim();
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const colon = s.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (colon) return Number(colon[1] || 0) * 3600 + Number(colon[2]) * 60 + Number(colon[3]);
  const units = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (units && s) return Number(units[1] || 0) * 3600 + Number(units[2] || 0) * 60 + Number(units[3] || 0);
  return 0;
}
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// Start time from a link's ?t= / ?start= (e.g. youtu.be/abc?t=83 or ...&t=1m23s).
function linkStart(link) {
  try {
    const u = new URL(link.trim());
    return parseTime(u.searchParams.get('t') || u.searchParams.get('start') || '');
  } catch {
    return 0;
  }
}

// Decodes any recorded audio and re-encodes it as WAV (plays everywhere, Safari too).
async function toWavFile(blob, name) {
  const trimmer = createTrimmer();
  const ok = await trimmer.load(blob);
  if (!ok) return new File([blob], name.replace(/\.wav$/, '.webm'), { type: blob.type });
  return new File([trimmer.toWav()], name, { type: 'audio/wav' });
}

// onClip(file): called with each finished recording.
// trim: show a trimmer here before handing the clip over (for places with no trimmer of their own).
export function createYouTubeRecorder({ onClip, trim = false, clipLabel = 'Use this clip' }) {
  let videoId = null;
  let start = 0;
  let session = null; // { stream, recorder, chunks, timer, meter }

  const linkInput = h('input', { type: 'url', class: 'yt-link', placeholder: 'YouTube link, e.g. https://youtu.be/…?t=83', spellcheck: 'false' });
  const startInput = h('input', { type: 'text', class: 'yt-start', placeholder: '0:00', 'aria-label': 'Start at (m:ss)', inputmode: 'numeric' });
  const loadBtn = h('button', { class: 'btn ghost small', type: 'button', onclick: () => loadVideo() }, 'Load');
  const playerBox = h('div', { class: 'yt-player', hidden: true });
  const recordBtn = h('button', { class: 'btn small yt-rec', type: 'button', disabled: true, onclick: () => (session ? finish() : begin()) }, '● Record');
  const meterFill = h('div', { class: 'yt-meter-fill' });
  const meter = h('div', { class: 'yt-meter', 'aria-hidden': 'true' }, meterFill);
  const status = h('div', { class: 'yt-status' });
  const say = (text, kind = '') => { status.className = `yt-status ${kind}`; status.textContent = text; };
  const trimmer = trim ? createTrimmer() : null;
  let clip = null;
  const useBtn = h('button', {
    class: 'btn small', type: 'button', hidden: true,
    onclick: async () => {
      if (!clip) return;
      const file = trimmer?.isTrimmed() ? new File([trimmer.toWav()], clip.name, { type: 'audio/wav' }) : clip;
      onClip(file);
      useBtn.hidden = true;
      trimmer?.clear();
      say(`Added "${file.name}". Record another, or load a different video.`, 'ok');
      clip = null;
    },
  }, clipLabel);

  linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); loadVideo(); } });
  linkInput.addEventListener('paste', () => setTimeout(loadVideo, 0));

  function command(func, args = []) {
    playerBox.querySelector('iframe')?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  }

  function loadVideo() {
    const link = linkInput.value.trim();
    if (!link) return;
    const id = parseVideoId(link);
    if (!id) { say('That doesn’t look like a YouTube link.', 'err'); return; }
    const t = linkStart(link);
    if (t && !startInput.value) startInput.value = fmtTime(t);
    if (id === videoId) return;
    videoId = id;
    start = parseTime(startInput.value);
    const src = `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&playsinline=1&rel=0&start=${Math.floor(start)}&origin=${encodeURIComponent(location.origin)}`;
    playerBox.replaceChildren(h('iframe', { src, title: 'YouTube video', allow: 'autoplay; encrypted-media', allowfullscreen: true }));
    playerBox.hidden = false;
    recordBtn.disabled = false;
    say('Find the sound in the video (set "Start at" a second or two before it), then press ● Record. It plays from there and records until you press ■ Stop.');
  }

  async function begin() {
    if (!canRecord()) { say('Recording needs desktop Chrome or Edge.', 'err'); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // required by Chrome, never recorded
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        systemAudio: 'include',
      });
    } catch (err) {
      say(err?.name === 'NotAllowedError' ? 'Recording was cancelled. Press ● Record and choose "this tab", with "Share tab audio" ticked.' : `Couldn't start recording: ${err.message}`, 'err');
      return;
    }
    const audio = stream.getAudioTracks();
    if (!audio.length) {
      stream.getTracks().forEach((t) => t.stop());
      say('No sound was shared. Press ● Record again and tick "Share tab audio" (or "Also share tab audio") at the bottom of Chrome’s box.', 'err');
      return;
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const recorder = new MediaRecorder(new MediaStream(audio), type ? { mimeType: type } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    session = { stream, recorder, chunks, startedAt: Date.now(), heard: false };
    // If the user stops sharing from Chrome's bar, finish up.
    stream.getTracks().forEach((t) => t.addEventListener('ended', () => session?.stream === stream && finish()));
    startMeter(audio);
    recorder.start(250);
    start = parseTime(startInput.value);
    command('seekTo', [start, true]);
    command('playVideo');
    recordBtn.textContent = '■ Stop';
    recordBtn.classList.add('recording');
    tick();
  }

  function tick() {
    if (!session) return;
    const secs = (Date.now() - session.startedAt) / 1000;
    if (secs >= MAX_SECONDS) { finish(); return; }
    say(`Recording… ${secs.toFixed(1)}s (stops by itself at ${MAX_SECONDS}s)${secs > 3 && !session.heard ? ' · No sound coming in yet. Is the video playing, and was "Share tab audio" ticked?' : ''}`, 'rec');
    session.timer = setTimeout(tick, 100);
  }

  function startMeter(tracks) {
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(new MediaStream(tracks));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      const loop = () => {
        if (!session) return;
        analyser.getFloatTimeDomainData(data);
        const peak = data.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
        if (peak > 0.02) session.heard = true;
        meterFill.style.width = `${Math.min(100, peak * 140)}%`;
        session.raf = requestAnimationFrame(loop);
      };
      session.meterCtx = ctx;
      loop();
    } catch {}
  }

  function finish() {
    if (!session) return;
    const { stream, recorder, chunks, timer, raf, meterCtx } = session;
    session = null;
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    meterCtx?.close().catch(() => {});
    meterFill.style.width = '0';
    command('pauseVideo');
    recordBtn.textContent = '● Record';
    recordBtn.classList.remove('recording');
    recordBtn.disabled = true;
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recordBtn.disabled = false;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < 200) { say('Nothing was recorded. Try again.', 'err'); return; }
      say('Preparing the clip…');
      const name = `youtube-${videoId}-${fmtTime(start).replace(':', 'm')}s.wav`;
      const file = await toWavFile(blob, name);
      if (trimmer) {
        clip = file;
        await trimmer.load(file);
        useBtn.hidden = false;
        say('Trim it to just the shot, then press the button below. Or record again.', 'ok');
      } else {
        onClip(file);
        say('Recorded. Trim it below, then save. Record again to replace it.', 'ok');
      }
    };
    if (recorder.state !== 'inactive') recorder.stop();
    else recorder.onstop();
  }

  const el = h('div', { class: 'yt-recorder' },
    h('div', { class: 'yt-row' }, linkInput, h('label', { class: 'yt-start-label' }, 'Start at', startInput), loadBtn),
    playerBox,
    h('div', { class: 'yt-row' }, recordBtn, meter),
    status,
    trimmer?.el,
    useBtn,
    h('div', { class: 'hint' }, 'Desktop Chrome or Edge. When Chrome asks, pick this tab and keep “Share tab audio” on. Only use clips you’re allowed to reuse.'),
  );
  if (!canRecord()) say('Recording from YouTube needs desktop Chrome or Edge.', 'err');

  return {
    el,
    // Stop everything (when the form or dialog closes).
    stop() {
      if (session) {
        const { stream, timer, raf, meterCtx, recorder } = session;
        session = null;
        clearTimeout(timer);
        cancelAnimationFrame(raf);
        meterCtx?.close().catch(() => {});
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
      }
      trimmer?.stop();
      playerBox.replaceChildren();
      playerBox.hidden = true;
      videoId = null;
    },
  };
}
