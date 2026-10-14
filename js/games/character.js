// "Who's That?": a character's picture (clear, or hidden by the Picture mode
// setting) and two names to choose from. Two big answers leave room for a
// tall picture and keep everything inside the Shorts / TikTok safe zone.
import { renderer as picture } from './picture.js';

const RANKS = [
  [100, 'Holocron Keeper', 'You know every face in the galaxy.'],
  [80, 'Jedi Archivist', 'If it’s not in your memory, it doesn’t exist.'],
  [60, 'Rebel Spy', 'Good eye. Most faces checked out.'],
  [40, 'Cantina Regular', 'You’ve seen them around, at least.'],
  [20, 'Moisture Farmer', 'Out on Tatooine, who knows anybody?'],
  [0, 'Jawa', 'Utinni! Who are all these people?'],
];

export const renderer = {
  choices: 2,
  ranks: RANKS,
  screenClass: 'who-screen',

  preload: picture.preload,

  mount(el, entry, ctx) {
    const view = picture.mount(el, entry, ctx);
    const tag = el.querySelector('.corner-tag');
    if (tag) tag.textContent = 'Who is it?';
    return view;
  },

  // The wrong answer should be a believable mix-up: someone from the same
  // group with similar fan power (with a little randomness so pairs vary).
  distractors(target, pool, n) {
    const score = (c) => (c.side === target.side ? 0 : 25) + Math.abs((c.power || 50) - (target.power || 50)) + Math.random() * 18;
    return pool
      .filter((c) => c.id !== target.id && c.name.toLowerCase() !== target.name.toLowerCase())
      .map((c) => [score(c), c])
      .sort((a, b) => a[0] - b[0])
      .slice(0, n)
      .map(([, c]) => c);
  },
};
