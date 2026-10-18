// Scales the fixed-size stage to fit the window.
//   9:16 vertical  → 1080×1920, centred (Shorts / TikTok / Reels)
//   4:3 landscape → 1440×1080, placed left, centre or right so a webcam can
//                   sit in the free space (long-form / streaming)
import { onSettingsChange, settings } from './settings.js';

const SIZES = { vertical: [1080, 1920], '43': [1440, 1080] };

export function fitStage(stage) {
  const fit = () => {
    const layout = SIZES[settings.layout] ? settings.layout : 'vertical';
    const [w, h] = SIZES[layout];
    stage.classList.toggle('layout-43', layout === '43');
    document.body.classList.toggle('side-green', layout === '43' && settings.sideFill === 'green');

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(vw / w, vh / h);
    const align = layout === '43' ? settings.stagePos : 'center';
    const x = align === 'left' ? 0 : align === 'right' ? vw - w * scale : (vw - w * scale) / 2;
    const y = (vh - h * scale) / 2;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    // Where the stage sits, so the window background's glow can follow it.
    const root = document.documentElement.style;
    root.setProperty('--stage-cx', `${x + (w * scale) / 2}px`);
    root.setProperty('--stage-cy', `${y + (h * scale) / 2}px`);
    root.setProperty('--stage-w', `${w * scale}px`);
    root.setProperty('--stage-h', `${h * scale}px`);
  };
  window.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
  onSettingsChange((key) => ['layout', 'stagePos', 'sideFill'].includes(key) && fit());
  fit();
}
