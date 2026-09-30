# Scarif — Blaster Archives

A hub of Star Wars mini-games built for recording vertical (9:16) content for TikTok, Reels and Shorts. It runs entirely on **GitHub Pages**: there's no server to host or pay for.

**Live site:** `https://trentic.github.io/scarif/` · **Debug mode:** `https://trentic.github.io/scarif/debug/`

| Game | What players do | Needs per entry |
| --- | --- | --- |
| 🔊 **Guess the Blaster** | Hear a blaster sound, pick its name | image + sound |
| 🎯 **Name That Blaster** | See a blaster (clear, or hidden by blur / silhouette / zoom), pick its name | image |
| 🔍 **Zoom Out** | Starts on an extreme close-up and zooms out in 4 steps. Answer early for more points (4 → 1) | image |
| ⚡ **Speed Round** | Name as many blasters as you can before the clock runs out (30 / 60 / 90s) | image |
| 📊 **Higher or Lower** | Is the next blaster's stat (e.g. price) higher or lower? One wrong answer ends the run | image + a stat value |

**Character games** (Jedi & Sith archive):

| Game | What players do | Needs per character |
| --- | --- | --- |
| ⚔️ **Who Would Win?** | Two random characters (any side vs any side) — tap who you think wins, then see the fan split. Opinion only; the end screen shows how many picks matched the fan favourite | picture |

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

## Characters (Jedi & Sith)

Debug mode has two tabs: **Blasters** and **Characters**. Characters live in their own archive (`data/characters.json`, pictures in `media/characters/`) with a name, side (Jedi or Sith), a **fan power** (1–100) and a picture. It starts with 20 Jedi and 20 Sith; characters appear in games once they have a picture.

**Quick pictures:** hover a character card and press **Ctrl+V** (or click **📋 Paste**). It uses whatever you last copied — an image address (right-click → *Copy image address*) or the image itself (right-click → *Copy image*). You can also drop an image file on a card. If a site blocks copying its images, the address is linked instead.

### Who Would Win? percentages

Until real voting is set up, the split is a **fan estimate** worked out from each character's fan power (a bigger gap = more one-sided, with a little randomness), and it's labelled *Fan estimate* on screen. Starting fan powers come from popular power rankings (e.g. [SlashFilm](https://www.slashfilm.com/1984100/most-powerful-sith-star-wars-ranked/), [Collider](https://collider.com/strongest-jedi-star-wars-ranked/), [CCSabers](https://www.ccsabers.com/blogs/ccsabers-blog/who-is-the-most-powerful-jedi-definitive-ranking-2026)) — adjust them any time in debug mode.

To switch to real votes later, set `VOTES.endpoint` in [`config.js`](config.js) to a service that implements `GET /split?a=&b=` → `{ a, b, total }` and `POST /vote { a, b, winner }` (see [`js/votes.js`](js/votes.js)). Once a matchup has enough votes the label changes to *of players picked*.

## Stats (for Higher or Lower)

In debug mode, the **Stats** card lets you create stat types, such as *Price* in *credits*, *Length* in *cm*, or *Year* of first appearance. Every blaster form then gets a number box for each stat type.

- Higher or Lower needs at least **3 blasters with a value for the same stat**.
- With more than one playable stat, the lobby lets you choose one, or pick **Random**.
- Deleting a stat type also removes its values from every blaster.

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
| `↑` / `↓` | Higher / Lower |
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
