# Ni Hao Lands

An unofficial, non-commercial fan MMO prototype for the $mihao ("ni hao cat") community. It is a small RuneScape-style browser world: click-to-move, four zones, grindable skills, a bank and gold shop, and a global chat.

This is **not** an official $mihao product, **not** financial advice, and it **cannot** create tokens, move funds, or sell items for SOL or any token.

Art for player and NPC avatars comes from the public [mihao pfps Meme Depot](https://memedepot.com/d/mihao-pfps) community. Credit stays in the footer. Ni hao cat is a real cat with an owner — get the owner and the $mihao team's OK before you host this publicly or try to monetize it.

## What you can do in the prototype

- Walk a tile map by clicking (or arrow / WASD keys).
- Zones: **Ni Hao Village**, **Fish Pond**, **Yarn Forest**, **The Mine**.
- Skills: Fishing, Yarn-gathering, Mining, Cooking, plus optional Combat against wandering rival dogs.
- Resource nodes deplete and respawn. Raw fish can be cooked at the village range. Cooked fish heals.
- 28-slot inventory, a bank (Banker Bao, west building), a gold shop (Merchant Mao, east building) for cosmetics.
- Multiplayer: positions, names, avatars, and a rate-limited global chat (length + basic profanity filter).
- **Ranks** tab: leaderboards for each skill, total level, gold, biggest fish, and dogs defeated, each with Weekly, Monthly, and All-time views. Weekly and monthly boards rank gains in that period (XP, gold earned, biggest catch, kills) and reset Monday 00:00 Helsinki or on the 1st. Fish catches get a light random weight, and each player keeps a personal best. `GET /api/leaderboard?board=fishing&period=week|month|all&limit=25`.
- Accounts persist in `data/players.json` (or Postgres when `DATABASE_URL` is set). A random session token is stored in the browser. Guest play (name only) still works on one browser.
- **Sign in with a Solana wallet** (Phantom, Solflare, Backpack, or any injected `window.solana`-compatible wallet). The game only calls `signMessage` on a login text — it never calls `signTransaction` and never sends a transaction. The same wallet on another device loads the same character. A guest can link their current character to a wallet that does not have a character yet. Wallet sessions last 30 days, then you sign the login message again. If no wallet is injected (typical on mobile), the login screen offers Open in Phantom / Open in Solflare deep links.
- Players can upload their own 128×128 picture from the login screen (cropped and resized in the browser). Keep it mihao and keep it clean — offensive pictures get removed. Click another player's custom picture in the world to report it.
- Premium shop tab: catalogue stub and a read-only $mihao balance check that reuses a signed-in wallet. **Purchases are disabled.** See `TOKEN-PURCHASE-FLOW.md`.

## Run locally

Needs Node.js 18+.

```bash
cd /workspace/mihao-game
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). The HTTP server and the WebSocket (`/ws`) share port **3000** (or `PORT` if you set it).

Two-browser smoke test (headless):

```bash
npm start          # in one terminal
node test-two-clients.mjs
```

Avatar upload test (starts its own server if you pass nothing; or pass a base URL):

```bash
node test-avatar-upload.mjs
node test-wallet-auth.mjs
node test-leaderboard.mjs
```

Health check: `GET /health`.

## Deploy (Render / Railway / Fly)

This is a single Node process that serves `public/` and accepts WebSockets on the same port. Any host that supports a long-lived Node web process works.

1. Put this folder in a Git repo. Do not commit `data/players.json` if it has real players; persist it with a volume or a disk.
2. Start command: `npm start` (or `node server.js`).
3. Set `PORT` to what the host injects (Render and Railway do this; Fly should map the internal port).
4. Listen on `0.0.0.0` (already the default).
5. Use HTTPS on the public URL so wallets and secure WebSockets (`wss`) work.
6. Optional env:
   - `SOLANA_RPC` — public RPC for the read-only holder check (default mainnet-beta).
   - (no token env needed) — the $nihala CA, holder threshold and cache times are constants in `server.js` (`NIHALA_MINT`, `NIHALA_HOLDER_MIN`, `NIHALA_CACHE_MS`, `NIHALA_RECHECK_MS`).
   - `DATA_DIR` — folder for `players.json` and uploaded pictures when Postgres is not used (default `./data`).
   - `DATABASE_URL` — optional Postgres connection string. When set, accounts (keyed by session token, unique wallet address) and uploaded pictures (bytea, served from `/avatars/<id>`) are stored in Postgres. Tables are created on boot if they are missing. When unset, the game falls back to `data/players.json` and `data/avatars`.
   - `ADMIN_KEY` — required to reset a reported custom picture (see below). If unset, the admin endpoint refuses every request.
7. Do **not** put private keys, Phantom seeds, or a treasury key in env. This app has no signing code and never sends a transaction.

**Render:** new Web Service, Node, `npm install` + `npm start`. Set `DATABASE_URL` to the **internal** Postgres URL if you attached a Render Postgres instance in the same region. That is how wallet logins and pictures survive a restart or redeploy.

On the **free** web plan, the local disk is still ephemeral: without `DATABASE_URL`, `data/players.json` and uploaded pictures reset on every restart or redeploy. A **free Render Postgres** database expires **30 days after creation**. After it expires it is inaccessible unless you upgrade to a paid compute plan. There is then a **14-day grace period** to upgrade; after that, Render permanently deletes the database and its data. Free Postgres is also limited to 1 GB, one free database per workspace, no backups, and may restart for maintenance. [Render free-plan docs](https://render.com/docs/free).

## $nihala holder perks (read-only)

$nihala (lowercase ticker) is live on pump.fun, paired with $mihao. CA `FNkoLTsBFEMjhM6qwUhnRwAzJcSCURfgeEmC1hGcsHao` · [chart](https://dexscreener.com/solana/8fytcqt1hzjyh2zv26qw6mhkqzasxeugu7i1hzuyutna).

- Only for players signed in with a wallet (the existing signMessage login). The server reads the SPL balance with `getTokenAccountsByOwner` on a public RPC (mint filter, which covers Token and Token-2022; per-program scan as a fallback). Nothing is ever signed, built or sent.
- Holder = balance above `NIHALA_HOLDER_MIN` (0). Results are cached ~7 minutes; online players are re-checked on login and every ~8 minutes. Perks pause when the balance reads 0, and resume when it is back.
- Holders get a **nihala holder** badge by their name (nametag, HUD, chat), free one-time claims of three holder tools (Golden Cat Rod, Lucky Jade Axe, Lucky Pickaxe: iron-tier, a little quicker than iron, can't be sold) and a ~3% chance at rare finds while gathering (Lucky Golden Koi, Lucky Cat Gem, Golden Bamboo, Golden Yarn). The bigger koi is kept off the fish leaderboard so ranks stay fair.
- Non-holders see a polite line with the CA and: *Holder perks are in-game only. Not financial advice. $mihao rewards for holders are planned, not promised.*
- There are no buy buttons, swaps or fund-moving links. The only token link is the plain DexScreener chart.
- Tests: `npm run test:nihala` (mock RPC: holder, non-holder, balance to 0, guest, Token + Token-2022). `node test-nihala-holder.mjs https://host` checks the non-holder path on a live host with a fresh test wallet.

## Smooth movement and network

- Remote players and mobs are drawn ~110 ms behind the server clock and interpolated between snapshots (no snapping between ticks). Your own keyboard/joystick moves are predicted locally and reconciled with the server (rejected steps glide back).
- Clients that send `hello {proto: 2}` get `delta` messages: only changed entities within 26 tiles, positions as compact arrays, removals when someone leaves range. Older clients still get the full `state` message. Updates are coalesced to one flush per 100 ms tick. `npm run test:delta` covers this.

## Custom pictures (admin)

Players upload from the login screen. The browser crops to a center square, downscales to 128×128, and re-encodes to PNG or WebP (that step also strips EXIF / metadata). The server checks magic bytes, size (60KB max), and 128×128 dimensions, then stores the file under `data/avatars/` (or in Postgres as bytea when `DATABASE_URL` is set). Uploads are limited to one per 30 seconds per account and per IP.

To remove a picture, set `ADMIN_KEY` on the host and call:

```bash
curl -X POST https://your-host/api/admin/reset-avatar \
  -H 'Content-Type: application/json' \
  -d '{"adminKey":"YOUR_KEY","name":"PlayerName"}'
```

That sets the player back to the classic paw wave and deletes their uploaded file.

**Railway:** new service from the repo, start `npm start`, add a volume on `/data` and point a future `DATA_DIR` at it if you customize the server.

**Fly:** `fly launch` with a `fly.toml` that sets `internal_port = 3000` and a volume for `/app/data`.

The prototype keeps the live world in one Node process and writes periodically (and on disconnect). It is fine for a few dozen friends, not for a real launch shard.

## Controls

- Click the ground to walk. Click a fishing spot, yarn bush, ore, range, NPC, or dog to interact.
- Chat is the box at the bottom of the screen.
- Inventory: click cooked fish to eat, cosmetics to wear; right-click to deposit at the bank (you must be standing next to Banker Bao).
- Escape cancels an action.

## Disclaimer

Unofficial fan game. Not affiliated with the $mihao team, @iamnihaocat, mihao.fun, or the real cat's owner. Not financial advice. Community art is used without a formal license in this prototype — ask before a public or paid launch.
