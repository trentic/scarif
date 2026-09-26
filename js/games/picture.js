// "Name That Blaster": shows the entry's image, either clearly or hidden by a
// blur, silhouette or zoom effect until the answer is revealed.
import { h } from '../ui.js';

export const renderer = {
  preload(entry) {
    new Image().src = entry.image;
  },

  mount(el, entry, { settings }) {
    const fx = settings.pictureMode || 'clear';
    const img = h('img', { src: entry.image, alt: '', draggable: 'false' });
    if (fx === 'zoom') {
      img.style.transformOrigin = `${20 + Math.random() * 60}% ${25 + Math.random() * 50}%`;
    }
    const frame = h('div', { class: `picture-frame fx-${fx}` },
      img,
      h('div', { class: 'corner-tag' }, 'Identify'),
    );
    el.append(frame);

    return {
      reveal() {
        frame.classList.add('revealed');
        frame.append(h('div', { class: 'picture-name' }, entry.name));
      },
      destroy() {},
    };
  },
};
