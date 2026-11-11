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
- Accounts persist in `data/players.json` (chosen name + a random token stored in the browser). Progress is tied to that browser; clearing site data or switching devices starts a new character.
- Players can upload their own 128×128 picture from the login screen (cropped and resized in the browser). Keep it mihao and keep it clean — offensive pictures get removed. Click another player's custom picture in the world to report it.
- Premium shop tab: catalogue stub and a read-only Phantom connect / $mihao balance check. **Purchases are disabled.** See `TOKEN-PURCHASE-FLOW.md`.

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
   - `COMPANION_MINT` — leave unset until a companion token exists.
   - `DATA_DIR` — folder for `players.json` and uploaded pictures (default `./data`).
   - `ADMIN_KEY` — required to reset a reported custom picture (see below). If unset, the admin endpoint refuses every request.
7. Do **not** put private keys, Phantom seeds, or a treasury key in env. This app has no signing code.

**Render:** new Web Service, Node, `npm install` + `npm start`, persistent disk mounted at `/opt/render/project/src/data` (or set `DATA_DIR`). On the **free** plan the disk is ephemeral: `data/players.json` and uploaded pictures both reset on every restart or redeploy, just like the in-game saves. Attach a persistent disk if you want them to last.

## Custom pictures (admin)

Players upload from the login screen. The browser crops to a center square, downscales to 128×128, and re-encodes to PNG or WebP (that step also strips EXIF / metadata). The server checks magic bytes, size (60KB max), and 128×128 dimensions, then stores the file under `data/avatars/`. Uploads are limited to one per 30 seconds per account and per IP.

To remove a picture, set `ADMIN_KEY` on the host and call:

```bash
curl -X POST https://your-host/api/admin/reset-avatar \
  -H 'Content-Type: application/json' \
  -d '{"adminKey":"YOUR_KEY","name":"PlayerName"}'
```

That sets the player back to the classic paw wave and deletes their uploaded file.

**Railway:** new service from the repo, start `npm start`, add a volume on `/data` and point a future `DATA_DIR` at it if you customize the server.

**Fly:** `fly launch` with a `fly.toml` that sets `internal_port = 3000` and a volume for `/app/data`.

The prototype stores everyone in one JSON file and one Node process. It is fine for a few dozen friends, not for a real launch shard.

## Controls

- Click the ground to walk. Click a fishing spot, yarn bush, ore, range, NPC, or dog to interact.
- Chat is the box at the bottom of the screen.
- Inventory: click cooked fish to eat, cosmetics to wear; right-click to deposit at the bank (you must be standing next to Banker Bao).
- Escape cancels an action.

## Disclaimer

Unofficial fan game. Not affiliated with the $mihao team, @iamnihaocat, mihao.fun, or the real cat's owner. Not financial advice. Community art is used without a formal license in this prototype — ask before a public or paid launch.
