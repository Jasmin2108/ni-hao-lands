# $nihala companion token plan (research only)

> **Status 2026-11-11:** $nihala (lowercase ticker) is live on pump.fun, paired with $mihao. CA `FNkoLTsBFEMjhM6qwUhnRwAzJcSCURfgeEmC1hGcsHao`, chart: https://dexscreener.com/solana/8fytcqt1hzjyh2zv26qw6mhkqzasxeugu7i1hzuyutna. The game now has read-only **$nihala holder perks** (badge, free holder tools, small rare-find chance). Holder perks are in-game only. Not financial advice. $mihao rewards for holders are planned, not promised. There are still no purchases, swaps or fund-moving links in the game.

This is a practical plan for Jasmin, not a recommendation to launch, and not financial advice. Nobody here will create or deploy a token, touch a wallet, or move funds. If a token is launched, **Jasmin does it from her own wallet.**

Context checked 2026-11-11: $mihao (ni hao cat) CA `4CxjZyMNoF1p6eXHXHv1TWpS2X47CuUmLwtGe18spump`, about $21.8M market cap on DexScreener, official site [mihao.fun](https://mihao.fun/), X [@iamnihaocat](https://x.com/iamnihaocat), art/memes at [memedepot.com/d/mihao-pfps](https://memedepot.com/d/mihao-pfps). The official site already has an **Ecosystem** section for "tokens trading in pools paired with $MIHAO." Many such tokens already exist (CHAIHAO, MBGA, Sasha, and others). Copycats of the $mihao name and picture are common. The vibe is "你好，朋友," "The world of Ni Hao Cat," and "you met me at a very chinese time in my life." Ni hao cat is a **real cat with an owner** (Instagram @imnihaocat).

## Name and ticker ideas

Stay original. Do **not** use `$mihao`, `$NIHAO`, or "ni hao cat" as the token name. Do not impersonate the official team, @iamnihaocat, or mihao.fun.

Better direction: the *game* and the greeting, clearly marked unofficial.

| Name | Ticker | Why |
| --- | --- | --- |
| Hao Friend | `$HAOFRIEND` | Echoes 你好，朋友 without taking the official name |
| Good Luck Lands | `$HAOYUN` | 好运常伴, the site's luck line |
| Yarn Lands | `$YARN` / `$YARNHAO` | Named after a game skill, not the cat |
| Say Hao | `$SAYHAO` | About the greeting, easy to say |
| Pond Friend | `$PONDFR` | Tied to the Fish Pond zone |

Pick one after a search for existing tickers and after talking to the $mihao team. Put "unofficial fan game token" in the description and link this game plus the official $mihao CA so people can tell them apart.

## What "paired to $mihao" can actually mean

Three different things get called "paired." They are not the same, and only some of them belong in a fan project.

1. **A liquidity pool quoted against $mihao** (PumpSwap after a pump.fun-style launch, or later Meteora / Raydium). This is what mihao.fun already lists as its ecosystem. Buying the new token then spends $mihao. That can look like an extraction play, especially if you hide a large dev bag. If you ever do this, say so plainly, keep the bag small or at zero, and get the official team on board first.
2. **Game utility, no pool required.** The world already uses *in-game gold* for the normal shop. $nihala could later unlock cosmetics in the Premium shop, but only after the flow in `TOKEN-PURCHASE-FLOW.md` is legally reviewed and actually built. Today there are no buy buttons at all; the old disabled stubs were removed from the UI.
3. **Holder perks via a read-only wallet check.** The prototype can already connect Phantom (if present) and read an SPL balance on a public RPC. A $mihao holder can get a badge. $nihala holders now get a badge, free holder tools and a small rare-find chance (in-game only). This does **not** require a swap or a transfer.

A sensible order: ship the fan game first, ask the team and the cat's owner, *then* decide whether a token is even wanted. A game that already works is a cleaner "pair" than another ticker riding $mihao's pool list.

## How the in-game economy is designed

- **Gold** comes from fishing, yarn, mining, cooking, selling, and rival dogs. It buys the ordinary shop (scarves, bells, cooked fish). This is play money.
- **Bank** is storage, not a vault for real assets.
- **$nihala holder perks** replace the old Premium stubs: read-only balance check, no purchases, no treasury, no signing.
- **$mihao holder badge** is a read-only perk. It should never look like a dividend, revenue share, or investment return.
- Do not add loot boxes, chance buys, or tradable item cash-out for tokens. That is how these projects start looking like gambling or like a security.

## If you still launch a token (you do this yourself)

Only after talking to the $mihao team and the cat's owner. Steps are the usual public pump.fun flow, done in *your* wallet, in *your* browser:

1. Open pump.fun on a machine you control. Use a wallet you control. Nobody else (including this bot) should handle the keys.
2. Create a token with the chosen **original** name/ticker, a clearly unofficial description, links to the game, to [mihao.fun](https://mihao.fun/), and to the official CA so people can verify you are not $mihao.
3. Use **original or licensed art** — or official permission to use depot PFPs. Do not lift the owner's photographs or official brand as if they were yours.
4. Prefer **no large dev allocation**. If you keep any, say the exact amount and lock or publish the wallet. Hidden bags are why these get called rugs.
5. If you want it "paired" to $mihao, that usually means the launch quote or a later pool is $mihao rather than SOL. Understand that sells of your token dump $mihao into the pool and can annoy the same community you want as players.
6. Done for $nihala: the CA is in the game footer, the $nihala tab and `NIHALA_MINT` in `server.js`. Still do not turn on purchases without a legal pass.
7. Announce it as an unofficial fan-game token. Do not pose as the official team. Do not promise price, listings, or profit.

## How the game would connect later

- Footer, the $nihala tab and `/api/config` show the $nihala CA and chart link.
- Holder status: `GET /api/holder/:address` (read-only RPC) returns $mihao and $nihala balances.
- Optional later: more cosmetics gated on a $mihao or $nihala balance.
- Optional later: Premium fulfilment only by verifying a player-signed transfer, as written in `TOKEN-PURCHASE-FLOW.md` — never by the server sending funds.

## Risks (read these before doing anything public)

- **IP and likeness.** The avatars are community images of a real cat, hosted on the mihao pfps Meme Depot. There is no formal license in this prototype. Get the **owner's and the team's OK** before a public host, merch, or any monetization (gold is fine; token sales or paid access are not, until they say yes).
- **Copycat / extraction optics.** The official ecosystem already lists tokens paired to $mihao. A new ticker plus a fan game can still be read as cashing in. Lead with the game, credit the depot, and ask first.
- **Rug perception.** No big dev bag, no stealth wallets, no "trust me" liquidity. Mint/freeze should be as hard to abuse as you can make them on the launcher you use.
- **Securities and gambling.** Selling cosmetics or access for a token, especially with resale, profit talk, or chance, can be treated as an offering or as gambling depending on the jurisdiction. This plan does not say it is legal. Get advice. Until then, keep purchases **off**.
- **Official confusion.** State "unofficial fan game" everywhere. Link the real $mihao CA. Do not use their X or site as if it were yours.

## Short checklist

- [ ] Message the $mihao team / @iamnihaocat and the cat's owner; wait for a clear yes or no.
- [ ] Keep the game playable with **gold only** until that conversation happens.
- [ ] Credit the Meme Depot in the footer (already done).
- [ ] Search tickers so you are not colliding with a copycat.
- [ ] If launching: you do it from your wallet; no hidden allocation; unofficial description; official CA in the bio.
- [x] $nihala CA is in the game (footer + $nihala tab); token checkout stays off.
- [ ] Legal review before any token-priced item or paid access.
- [ ] Never present this as financial advice or as an official $mihao product.
