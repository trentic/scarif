# Scarif — Blaster Archives

A hub of Star Wars mini-games built for recording vertical (9:16) content for TikTok, Reels and Shorts.

**Games**

| Game | What players do | Needs per entry |
| --- | --- | --- |
| 🔊 **Guess the Blaster** | Hear a blaster sound, pick its name | image + sound |
| 🎯 **Name That Blaster** | See a hidden blaster (blur / silhouette / zoom), pick its name | image |

Both games draw from one shared **archive**. You manage it in **debug mode**, which unlocks only with your physical security key.

## Running it

Requires Node 20+.

```bash
npm install
npm start          # http://localhost:3000
```

### First-time setup: register your security key

1. Start the server. While no key is registered, the console prints a **one-time setup code**.
2. Open `http://localhost:3000/debug` (or tap the **SCARIF** logo on the hub five times).
3. Enter the setup code, press **Register security key**, and touch your key.

After that, debug mode opens only when you touch a registered key. The setup code stops working once the first key is registered. From the dashboard you can:

- add a backup key (recommended, so you never get locked out)
- remove keys
- lock the dashboard again

Any FIDO2/WebAuthn key works (YubiKey, Titan, SoloKey, …). Browsers only allow security keys on **HTTPS** or on `localhost`.

## Debug mode: adding blasters

Each entry has three parts:

1. **Name**, e.g. `DL-44 Heavy Blaster Pistol`. It becomes an ID (`dl-44-heavy-blaster-pistol`) that code can refer to. The ID stays the same if you rename the entry later.
2. **Image** (required). Upload a file, or paste an image address (right-click an image → *Copy image address*). The server downloads pasted images and stores them itself, so they keep working if the original link dies.
3. **Sound effect** (optional). Adding one unlocks the entry for sound-based games.

As you fill the form, it shows which games the entry will appear in.

Accepted formats:

- Images: PNG, JPG, GIF, WebP, AVIF (transparent PNGs look best, especially with the silhouette reveal)
- Sounds: MP3, WAV, OGG, FLAC, M4A, WebM
- Maximum size: 10 MB per file

Files are checked by their actual contents, not their file extension.

## How games choose entries (requirements)

Games are defined in [`shared/games.js`](shared/games.js). The server and the browser both use this file:

```js
{
  id: 'blaster-sounds',
  title: 'Guess the Blaster',
  module: 'sound',                         // public/js/games/sound.js
  requires: { image: true, sound: true },  // only entries with both
  minEntries: 4,                           // 4 answer choices per round
}
```

`GET /api/games/:id/pool` returns only the entries that meet a game's `requires`. The hub shows a game as locked until it has `minEntries` eligible entries.

### Adding a new game

1. Add an entry to `GAMES` in `shared/games.js` with its `requires`.
2. Create `public/js/games/<module>.js` exporting a `renderer` with `mount(promptEl, entry, ctx)`. It returns `{ reveal(), replay?(), destroy() }`.
3. Register the module in the `renderers` map in `public/js/app.js`.

The shared engine (`public/js/engine.js`) already handles the countdown, answers, timer, scoring, streaks and results screen.

## Recording features

- **Fixed 9:16 stage.** The game always renders at 1080×1920, scaled to fit the screen, so recordings look the same on any device.
- **Settings** (gear icon):
  - number of rounds and answer timer
  - **Auto** or **Host** flow (in Host mode you tap Reveal, then Next)
  - picture reveal style
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

## Deploying

The app is a single Node server. It needs a host with a **persistent disk** for the `data/` folder (Railway, Render with a disk, Fly.io with a volume, a VPS, …) and **HTTPS**.

| Env var | Purpose | Default |
| --- | --- | --- |
| `PORT` | Port to listen on | `3000` |
| `DATA_DIR` | Where the database and media live | `./data` |
| `ORIGIN` | Public URL, e.g. `https://scarif.example.com` (strongly recommended in production) | from the request |
| `RP_ID` | Security-key domain, e.g. `scarif.example.com` | hostname of `ORIGIN` |
| `TRUST_PROXY` | Set to `1` behind a reverse proxy / load balancer | unset |
| `SETUP_CODE` | Use a fixed setup code instead of a random one | random |

Security keys are bound to the domain (`RP_ID`). If you move to a new domain, register your keys again: delete `credentials` from `data/db.json`, restart, and use the new setup code.

**Backups:** everything lives in `DATA_DIR` (`db.json` plus the `media/` folder). Copy that folder to back up.

Star Wars and related names are trademarks of Lucasfilm Ltd. Upload only media you have the rights to use.
