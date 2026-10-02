// The 💬 Chat panel: connect YouTube live chat (or a test chat) to the games.
import * as chat from './chat.js';
import { resetBoard, top } from './chatvotes.js';
import { h, iconButton } from './ui.js';

const CONSOLE = 'https://console.cloud.google.com/apis/library/youtube.googleapis.com';
const CREDENTIALS = 'https://console.cloud.google.com/apis/credentials';

export function openChatPanel(stage, onClose) {
  const close = () => { off(); backdrop.remove(); drawer.remove(); onClose?.(); };
  const backdrop = h('div', { class: 'drawer-backdrop', onclick: close });
  const body = h('div');
  const drawer = h('div', { class: 'drawer chat-panel', role: 'dialog', 'aria-label': 'Chat' },
    h('div', { class: 'corner right' }, iconButton('close', 'Close chat panel', close)),
    h('h3', { class: 'display' }, '💬 Chat'),
    body,
  );
  const status = h('div', { class: 'chat-status' });
  const off = chat.on('status', () => renderStatus());

  function renderStatus() {
    const { status: s, detail } = chat.state;
    const text = {
      off: 'Chat is off.',
      idle: chat.config.source === 'test' ? 'Test chat is on. Fake viewers will vote during games.' : 'Ready. Chat is read only while a game is running.',
      connecting: detail,
      ready: `✅ Connected: ${detail}`,
      live: chat.config.source === 'test' ? '🧪 Test chat running' : '🔴 Reading live chat',
      error: `⚠ ${detail}`,
      quota: `⚠ ${detail}`,
    }[s] || detail;
    status.className = `chat-status ${s}`;
    status.textContent = text;
  }

  function seg(title, choices, value, onPick, help) {
    const buttons = choices.map(([v, label]) => h('button', {
      'aria-pressed': String(v === value),
      onclick: () => onPick(v),
    }, label));
    return h('div', { class: 'setting' }, h('div', { class: 'title' }, title), h('div', { class: 'seg' }, buttons), help && h('div', { class: 'help' }, help));
  }

  function render() {
    const c = chat.config;
    const parts = [
      seg('Chat source', [['off', 'Off'], ['youtube', 'YouTube Live'], ['test', '🧪 Test chat']], c.source, (v) => { chat.saveConfig({ source: v }); render(); },
        'Test chat makes fake viewers vote so you can rehearse. A TEST CHAT badge shows on screen while it is on.'),
    ];

    if (c.source === 'youtube') {
      const key = h('input', { type: 'password', class: 'chat-input', placeholder: 'Your YouTube Data API key', value: c.apiKey || '', autocomplete: 'off', spellcheck: 'false' });
      const stream = h('input', { type: 'text', class: 'chat-input', placeholder: 'Live stream link, e.g. https://youtube.com/live/…', value: c.stream || '', spellcheck: 'false' });
      const showKey = h('button', { class: 'btn ghost small-btn', onclick: () => { key.type = key.type === 'password' ? 'text' : 'password'; } }, 'Show');
      const connectBtn = h('button', {
        class: 'btn',
        onclick: async () => {
          chat.saveConfig({ apiKey: key.value.trim(), stream: stream.value.trim() });
          connectBtn.disabled = true;
          await chat.connect();
          connectBtn.disabled = false;
          render();
        },
      }, 'Connect & check');
      const used = chat.quotaUsed();
      parts.push(
        h('div', { class: 'setting' },
          h('div', { class: 'title' }, 'API key'),
          h('div', { class: 'chat-row' }, key, showKey),
          h('div', { class: 'help' }, 'Stored only in this browser. Never saved to your site or repo.'),
        ),
        h('div', { class: 'setting' },
          h('div', { class: 'title' }, 'Stream link'),
          stream,
          h('div', { class: 'help' }, 'Paste the link to your live stream (or its Studio link) each time you go live.'),
        ),
        h('div', { class: 'chat-row' }, connectBtn),
        status,
        h('div', { class: 'chat-quota' },
          `Used today ≈ ${used.toLocaleString()} / ${chat.DAILY_QUOTA.toLocaleString()} API units · about ${Math.floor(chat.minutesLeft() / 60)}h ${chat.minutesLeft() % 60}m of chat reading left`,
          h('br'), 'Chat is only read while a game is being played (not on menus or results).',
        ),
        h('details', { class: 'chat-setup' },
          h('summary', {}, 'How to get a YouTube API key (5 minutes, once)'),
          h('ol', {},
            h('li', {}, 'Go to ', h('a', { href: CONSOLE, target: '_blank', rel: 'noopener' }, 'Google Cloud → YouTube Data API v3'), ', sign in, create a project (any name) and click ', h('b', {}, 'Enable'), '.'),
            h('li', {}, 'Open ', h('a', { href: CREDENTIALS, target: '_blank', rel: 'noopener' }, 'Credentials'), ' → ', h('b', {}, 'Create credentials → API key'), '.'),
            h('li', {}, 'Click the key → ', h('b', {}, 'Application restrictions: Websites'), ' → add ', h('code', {}, `${location.origin}/*`), '. Under ', h('b', {}, 'API restrictions'), ' pick ', h('b', {}, 'YouTube Data API v3'), '. Save.'),
            h('li', {}, 'Copy the key and paste it above. Then start your stream, paste its link and press Connect & check.'),
          ),
        ),
      );
    } else if (c.source === 'test') {
      parts.push(status);
    }

    if (c.source !== 'off') {
      const rows = top(5);
      parts.push(
        seg('Who can vote', [[false, 'Everyone'], [true, 'Members only']], c.membersOnly, (v) => { chat.saveConfig({ membersOnly: v }); render(); },
          'Members only counts votes from your channel members (plus you and your moderators). On screen it says “Members: type 1 or 2”.'),
        seg('Chat leaderboard', [[true, 'Show'], [false, 'Hide']], c.leaderboard, (v) => { chat.saveConfig({ leaderboard: v }); render(); },
          'Correct chat answers in the quiz games score points (the first correct answer gets a bonus). Top 5 shows on the results screen. Resets when you close the tab.'),
        h('div', { class: 'chat-board-preview' },
          rows.length ? h('ol', {}, rows.map((r) => h('li', {}, `${r.user} · ${r.points} pts`))) : h('div', { class: 'help' }, 'No chat points yet this session.'),
          rows.length ? h('button', { class: 'btn ghost', onclick: () => { resetBoard(); render(); } }, 'Reset leaderboard') : null,
        ),
        h('div', { class: 'keys' }, 'How chat plays: quiz games → type A, B, C or D (or 1–4, or the name). Who Would Win? → type 1 or 2 (or red / blue, or the name). One vote per viewer per round, and their first vote is final, so spamming doesn’t add votes.'),
      );
    }
    body.replaceChildren(...parts);
    renderStatus();
  }

  render();
  stage.append(backdrop, drawer);
}
