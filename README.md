# Scarif — Blaster Archives

A hub of Star Wars mini-games built for recording vertical (9:16) content for TikTok, Reels and Shorts. It runs entirely on **GitHub Pages**: there's no server to host or pay for.

**Live site:** `https://trentic.github.io/scarif/` · **Debug mode:** `https://trentic.github.io/scarif/debug/`

| Game | What players do | Needs per entry |
| --- | --- | --- |
| 🔊 **Guess the Blaster** | Hear a blaster sound, pick its name | image + sound |
| 🎯 **Name That Blaster** | See a blaster (clear, or hidden by blur / silhouette / zoom), pick its name | image |

Both games draw from one shared **archive**, which you manage in password-protected debug mode.

## One-time setup

1. **GitHub Pages** serves this `gh-pages` branch: **Settings → Pages → Deploy from a branch → `gh-pages` / (root)**. Everything lives on this one branch, and every commit (including saves from debug mode) goes live in about a minute.
2. **Make a GitHub token for debug mode.** [Create a fine-grained token](https://github.com/settings/personal-access-tokens/new) with:
   - **Repository access:** *Only select repositories* → `trentic/scarif`
   - **Permissions → Repository → Contents:** *Read and write*
3. **Set the debug-mode password.**
   - Open `…/scarif/debug/` (or tap the **SCARIF** logo five times on the hub).
   - Paste the token and choose a password.

   After that, any device only needs the password.

### How the password protects it

The site is public and static, so the lock works like this:

- Your GitHub token is the only thing that can change the archive.
- The token is **encrypted with your password** (PBKDF2-SHA256, 600k rounds → AES-256-GCM).
- The encrypted copy is stored in the repo at `data/vault.json`, which is why any device works with just the password.
- Unlocking decrypts the token into memory only. Reloading the page or pressing **Lock** forgets it.

The encrypted file is publicly downloadable, so someone could try to guess the password offline. **Use a long password** (a phrase of 4+ random words is good; the minimum is 10 characters).

- **Change the password:** use the dashboard. Other devices pick it up after the next publish (about a minute).
- **Forgot it, or the token expired:** use **Set up again** on the unlock screen with a new token.
- **Suspect a leak:** revoke the token on GitHub. That instantly stops anyone from editing.

## Debug mode: adding blasters

Each entry has three parts:

1. **Name**, e.g. `DL-44 Heavy Blaster Pistol`. It becomes an ID (`dl-44-heavy-blaster-pistol`) that code can refer to. The ID stays the same if you rename the entry later.
2. **Image** (required). Upload a file, or paste an image address.
   - A pasted address is **copied into the repo** when the site allows it.
   - Some sites block that. You can then tick *Link to it instead of copying*, or save the image and upload it.
3. **Sound effect** (optional). Adding one unlocks the entry for sound-based games.
   - **Trimming:** after picking a sound, a waveform appears. Drag the handles or type start/end times, and use **Auto-trim silence** to cut the quiet parts before and after the shot.
   - To trim a sound that's already saved, use **Edit → ✂ Trim this sound**.
   - A trimmed clip is saved as a WAV. Untrimmed files are saved unchanged.

As you fill the form, it shows which games the entry will appear in.

Every save is a commit to this repo:

- `data/archive.json` holds the entries.
- `media/` holds the images and sounds.

Pages republishes automatically, and the dashboard shows **Live on the site ✓** when it's done (usually about a minute).

Accepted formats:

- Images: PNG, JPG, GIF, WebP, AVIF (transparent PNGs look best)
- Sounds: MP3, WAV, OGG, FLAC, M4A, WebM
- Maximum size: 10 MB per file

Files are checked by their actual contents, not their extension.

> The repository must be **public** for free GitHub Pages, so uploaded media is publicly visible in the repo. Upload only media you're allowed to share.

## How games choose entries (requirements)

Games are defined in [`js/registry.js`](js/registry.js):

```js
{
  id: 'blaster-sounds',
  title: 'Guess the Blaster',
  module: 'sound',                         // js/games/sound.js
  requires: { image: true, sound: true },  // only entries with both
  minEntries: 4,                           // 4 answer choices per round
}
```

Each game gets only the archive entries that meet its `requires`. The hub shows a game as locked until it has `minEntries` of them.

### Adding a new game

1. Add an entry to `GAMES` in `js/registry.js` with its `requires`.
2. Create `js/games/<module>.js` exporting a `renderer` with `mount(promptEl, entry, ctx)`. It returns `{ reveal(), replay?(), destroy() }`.
3. Register the module in the `renderers` map in `js/app.js`.

The shared engine (`js/engine.js`) already handles the countdown, answers, timer, scoring, streaks and results screen.

## Recording features

- **Fixed 9:16 stage.** The game always renders at 1080×1920, scaled to fit the screen, so recordings look the same on any device.
- **Settings** (gear icon):
  - number of rounds and answer timer
  - **Auto** or **Host** flow (in Host mode you tap Reveal, then Next)
  - picture mode (Clear, or Blur / Silhouette / Zoom to hide it until the reveal)
  - game sound effects on/off
- **Safe-zone overlay.** Shades the areas TikTok, Reels and Shorts cover. Turn it off before recording.
- **Clean recording mode.** Hides on-screen buttons during play.

Keyboard shortcuts:

| Key | Action |
| --- | --- |
| `1`–`4` / `A`–`D` | Answer |
| `Space` | Reveal / next (Host mode) |
| `R` | Replay sound |
| `Z` | Toggle safe zones |
| `C` | Toggle clean mode |
| `Esc` | Back to menu |

## Local preview

```bash
npm start   # http://localhost:8080 — no install needed (Node 20+)
```

Debug mode works on `localhost` too, and it commits to the real repository set in [`config.js`](config.js).
