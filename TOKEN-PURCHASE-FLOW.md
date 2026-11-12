# Planned on-chain purchase flow (design only)

This document describes how a future Premium-shop purchase *could* work. **It is not implemented.** The game server never builds, sends, or asks anyone to sign a token transfer. There is no treasury send path in the code.

Do not turn this into running purchase code until:

- the $mihao team and the real cat's owner have clearly said yes,
- the token is chosen ($nihala now exists: `FNkoLTsBFEMjhM6qwUhnRwAzJcSCURfgeEmC1hGcsHao`),
- a lawyer has reviewed whether selling cosmetics for a token creates securities, gambling, or consumer-risk issues in the places you operate.

## Intended shape (when, and if, it is ever built)

1. The player connects a wallet with a **read-only** connection (public key only), the same way the current Phantom button is meant to work.
2. A future shop would show a price in $nihala. Today there is **no Buy button** anywhere in the game.
3. On click, the *player's own wallet* would build an SPL / Token-2022 transfer of `price` tokens to a published treasury address. The player would see the destination and amount in Phantom (or another wallet) and would have to approve it themselves.
4. After the wallet reports a signature, the **client would send only that signature string** to the server (for example `POST /api/premium/verify` with `{ signature, itemId, wallet }`). No private keys, no unsigned transaction built by the server, no "send on behalf of the user."
5. The server would fetch the transaction from a public RPC (`getTransaction`), and accept it only if all of these match:
   - `success` (no error)
   - a transfer instruction of the **$nihala mint only**
   - destination is the published treasury
   - amount is exactly the catalogue price
   - the source owner is the same wallet the player connected
   - the signature has not already been credited (store used signatures)
   - the slot/block time is recent (reject replays and ancient txs)
6. Only then would the server grant a **cosmetic entitlement** on the player's game account (nametag, cape, pet). It would not send tokens back, credit tradable value, or offer withdrawals.
7. If RPC cannot confirm the tx, the server would leave the item uncredited and tell the player to wait or open a support path — never "retry send."

## What this prototype actually does

- The $nihala tab shows holder perks, the holder shop, the $nihala CA, a plain chart link and the disclaimer. No Buy buttons, no swaps.
- For wallet-signed-in players the server runs a **read-only** `getTokenAccountsByOwner` check for $nihala (and the client asks for $mihao). Holders get a badge, free holder tools and a small rare-find chance. The holder shop unlocks better tools if you currently hold enough $nihala (starting at 100,000); those tools are unequipped if the balance drops. Those are perks, not purchases, and nothing is transferred.
- `premiumBuy` on the websocket only returns a toast: purchases are not enabled. `holderShopUnlock` never moves funds.

## Environment (for a future build, not used to move funds now)

- `NIHALA_MINT` is a constant in `server.js`; no env var is needed.
- `SOLANA_RPC` — public or your own RPC, read-only is enough today.
- A treasury address should be published later and should not be a personal hot wallet if this ever ships.
