// "Zoom Out": starts on an extreme close-up of the blaster and zooms out in
// steps. The sooner you answer, the more points you get.
import { h } from '../ui.js';

const STAGES = [6, 3.6, 2.1, 1]; // zoom factor per step
const STEP_MS = 2500; // per step when the answer timer is off

// Picks a spot that's actually on the blaster (not empty background) so the
// close-up isn't just a blank patch. Falls back to the middle if the image
// can't be inspected (e.g. a linked image from another site).
function focusPoint(img) {
  const fallback = { x: 50, y: 50 };
  try {
    const n = 48;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, n, n);
    const px = g.getImageData(0, 0, n, n).data;
    const at = (x, y) => px.subarray((y * n + x) * 4, (y * n + x) * 4 + 4);
    const bg = at(0, 0);
    const solidBg = bg[3] > 200;
    const spots = [];
    for (let y = Math.floor(n * 0.15); y < n * 0.85; y++) {
      for (let x = Math.floor(n * 0.15); x < n * 0.85; x++) {
        const [r, gr, b, a] = at(x, y);
        if (a < 200) continue;
        if (solidBg && Math.abs(r - bg[0]) + Math.abs(gr - bg[1]) + Math.abs(b - bg[2]) < 60) continue;
        spots.push([x / n, y / n]);
      }
    }
    if (!spots.length) return fallback;
    const [u, v] = spots[Math.floor(Math.random() * spots.length)];
    // Map from picture coordinates to the letterboxed <img> box (its layout
    // size in stage px, which differs between 9:16 and 4:3).
    const BOX_W = img.offsetWidth || 760;
    const BOX_H = img.offsetHeight || 460;
    const scale = Math.min(BOX_W / img.naturalWidth, BOX_H / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    return {
      x: (((BOX_W - dw) / 2 + u * dw) / BOX_W) * 100,
      y: (((BOX_H - dh) / 2 + v * dh) / BOX_H) * 100,
    };
  } catch {
    return fallback;
  }
}

export const renderer = {
  maxPoints: STAGES.length,

  preload(entry) {
    new Image().src = entry.image;
  },

  mount(el, entry, { settings }) {
    let step = 0;
    let timer = 0;
    let done = false;

    const img = h('img', { alt: '', draggable: 'false' });
    const pts = h('div', { class: 'zoom-pts' });
    const dots = h('div', { class: 'zoom-steps' }, STAGES.map(() => h('span')));
    const frame = h('div', { class: 'picture-frame zoom-frame loading' }, img, pts, dots);
    el.append(frame);

    const stepMs = settings.timer ? (settings.timer * 1000) / STAGES.length : STEP_MS;

    function show() {
      img.style.transform = `scale(${STAGES[step]})`;
      pts.textContent = `🔍 ${STAGES.length - step} pts`;
      [...dots.children].forEach((d, i) => d.classList.toggle('on', i <= step));
    }

    function advance() {
      if (done || step >= STAGES.length - 1) return;
      step++;
      show();
      if (step < STAGES.length - 1) timer = setTimeout(advance, stepMs);
    }

    img.addEventListener('load', () => {
      const { x, y } = focusPoint(img);
      img.style.transformOrigin = `${x}% ${y}%`;
      show();
      // Let the zoomed-in state apply before revealing, so the full picture
      // never flashes on screen.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        frame.classList.remove('loading');
        timer = setTimeout(advance, stepMs);
      }));
    }, { once: true });
    img.src = entry.image;

    return {
      points: () => STAGES.length - step,
      reveal() {
        done = true;
        clearTimeout(timer);
        step = STAGES.length - 1;
        show();
        frame.classList.add('revealed');
        frame.append(h('div', { class: 'picture-name' }, entry.name));
      },
      destroy() {
        done = true;
        clearTimeout(timer);
      },
    };
  },
};
