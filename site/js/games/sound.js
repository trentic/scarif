// "Guess the Blaster": plays the entry's sound with a live visualiser.
import { audioContext } from '../sfx.js';
import { h, icons } from '../ui.js';

export const renderer = {
  preload(entry) {
    const a = new Audio();
    a.preload = 'auto';
    a.src = entry.sound;
    new Image().src = entry.image;
  },

  mount(el, entry) {
    const canvas = h('canvas', { width: 1080, height: 1080 });
    const orb = h('div', { class: 'sound-orb' },
      canvas,
      h('button', { class: 'play', 'aria-label': 'Play sound', html: icons.play, onclick: (e) => { e.stopPropagation(); play(); } }),
      h('div', { class: 'hint' }, 'Tap to replay'),
    );
    el.append(orb);

    const audio = new Audio(entry.sound);
    const ac = audioContext();
    const source = ac.createMediaElementSource(audio);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser).connect(ac.destination);
    const bins = new Uint8Array(analyser.frequencyBinCount);

    audio.addEventListener('play', () => orb.classList.add('playing'));
    audio.addEventListener('ended', () => orb.classList.remove('playing'));
    audio.addEventListener('pause', () => orb.classList.remove('playing'));

    const g = canvas.getContext('2d');
    const accent = getComputedStyle(el).getPropertyValue('--accent').trim() || '#ff3b3b';
    let raf = 0;
    const draw = () => {
      analyser.getByteFrequencyData(bins);
      g.clearRect(0, 0, 1080, 1080);
      const bars = 72;
      const inner = 290;
      g.save();
      g.translate(540, 540);
      g.lineCap = 'round';
      g.strokeStyle = accent;
      g.shadowColor = accent;
      g.shadowBlur = 24;
      for (let i = 0; i < bars; i++) {
        // Mirror the spectrum so the ring is symmetrical.
        const bin = Math.floor((i < bars / 2 ? i : bars - i) * (bins.length * 0.7) / (bars / 2));
        const v = bins[bin] / 255;
        const len = 14 + v * 210;
        const a = (i / bars) * Math.PI * 2 - Math.PI / 2;
        g.globalAlpha = 0.35 + v * 0.65;
        g.lineWidth = 14;
        g.beginPath();
        g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
        g.lineTo(Math.cos(a) * (inner + len), Math.sin(a) * (inner + len));
        g.stroke();
      }
      g.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    function play() {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
    const autoplay = setTimeout(play, 350);

    return {
      replay: play,
      reveal() {
        orb.replaceWith(h('div', { class: 'reveal-card' },
          h('img', { src: entry.image, alt: '' }),
          h('div', { class: 'name' }, entry.name),
        ));
        cancelAnimationFrame(raf);
        play();
      },
      destroy() {
        clearTimeout(autoplay);
        cancelAnimationFrame(raf);
        audio.pause();
        source.disconnect();
        analyser.disconnect();
      },
    };
  },
};
