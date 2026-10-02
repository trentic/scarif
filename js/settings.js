// Per-device game settings, remembered in localStorage.
const KEY = 'scarif.settings.v1';

export const DEFAULTS = {
  rounds: 10,
  timer: 10,
  mode: 'auto', // 'auto' advances by itself, 'host' waits for a tap to reveal / continue
  pictureMode: 'clear',
  speedSeconds: 60,
  layout: 'vertical', // 'vertical' (9:16) or '43' (4:3 landscape)
  stagePos: 'center', // 4:3 position: 'left' | 'center' | 'right'
  sideFill: 'dark', // 4:3 empty space: 'dark' | 'green'
  sfx: true,
  safeZones: false,
  clean: false,
};

export const OPTIONS = [
  {
    key: 'layout', title: 'Screen format', choices: [['vertical', '9:16 Vertical'], ['43', '4:3 Landscape']],
    help: 'Vertical for Shorts / TikTok / Reels. 4:3 for long-form videos and streams.',
  },
  {
    key: 'stagePos', title: '4:3 position', choices: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], when: (s) => s.layout === '43',
    help: 'Put the game on one side to leave room for your webcam. Shortcut: P.',
  },
  {
    key: 'sideFill', title: '4:3 empty space', choices: [['dark', 'Dark'], ['green', 'Green screen']], when: (s) => s.layout === '43',
    help: 'Green screen lets you key out the empty area in OBS.',
  },
  {
    key: 'rounds', title: 'Rounds', choices: [[3, '3'], [5, '5'], [10, '10'], [15, '15'], [20, '20'], [0, 'All']],
    help: 'All = every entry once. In Who Would Win? it means unlimited matchups (tap Finish to end).',
  },
  { key: 'timer', title: 'Answer timer', choices: [[0, 'Off'], [5, '5s'], [10, '10s'], [15, '15s']] },
  {
    key: 'mode', title: 'Flow', choices: [['auto', 'Auto'], ['host', 'Host']],
    help: 'Host mode waits for you to tap Reveal and Next (or press Space). Good for "pause and guess" videos.',
  },
  {
    key: 'pictureMode', title: 'Picture mode', choices: [['clear', 'Clear'], ['blur', 'Blur'], ['silhouette', 'Silhouette'], ['zoom', 'Zoom']],
    help: 'Clear shows the picture as-is. Blur, Silhouette and Zoom hide it until the answer is revealed (silhouette works best with transparent PNGs).',
  },
  { key: 'speedSeconds', title: 'Speed Round length', choices: [[30, '30s'], [60, '60s'], [90, '90s']] },
  { key: 'sfx', title: 'Game sound effects', choices: [[true, 'On'], [false, 'Off']] },
  {
    key: 'safeZones', title: 'Safe-zone overlay', choices: [[true, 'Show'], [false, 'Hide']],
    help: 'Shades where TikTok / Reels / Shorts cover the video. Turn off before recording.',
  },
  {
    key: 'clean', title: 'Clean recording mode', choices: [[true, 'On'], [false, 'Off']],
    help: 'Hides the home/settings buttons during play. Tap the picture/sound area or press Space to reveal in host mode.',
  },
];

let current = { ...DEFAULTS };
try {
  current = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
} catch {}

const listeners = new Set();

export const settings = new Proxy(current, {
  set(target, key, value) {
    target[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(target)); } catch {}
    listeners.forEach((fn) => fn(key, value));
    return true;
  },
});

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
