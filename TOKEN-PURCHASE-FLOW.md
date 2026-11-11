# Planned on-chain purchase flow (design only)

This document describes how a future Premium-shop purchase *could* work. **It is not implemented.** The game server never builds, sends, or asks anyone to sign a token transfer. There is no treasury send path in the code.

Do not turn this into running purchase code until:

- the $mihao team and the real cat's owner have clearly said yes,
- a companion token actually exists and its contract is public,
- a lawyer has reviewed whether selling cosmetics for a token creates securities, gambling, or consumer-risk issues in the places you operate.

## Intended shape (when, and if, it is ever built)

1. The player connects a wallet with a **read-only** connection (public key only), the same way the current Phantom button is meant to work.
2. The Premium shop shows a price in the companion token and a **Buy** button that is disabled today.
3. On click, the *player's own wallet* would build an SPL / Token-2022 transfer of `price` tokens to a published treasury address. The player would see the destination and amount in Phantom (or another wallet) and would have to approve it themselves.
4. After the wallet reports a signature, the **client would send only that signature string** to the server (for example `POST /api/premium/verify` with `{ signature, itemId, wallet }`). No private keys, no unsigned transaction built by the server, no "send on behalf of the user."
5. The server would fetch the transaction from a public RPC (`getTransaction`), and accept it only if all of these match:
   - `success` (no error)
   - a transfer instruction of the **companion mint only**
   - destination is the published treasury
   - amount is exactly the catalogue price
   - the source owner is the same wallet the player connected
   - the signature has not already been credited (store used signatures)
   - the slot/block time is recent (reject replays and ancient txs)
6. Only then would the server grant a **cosmetic entitlement** on the player's game account (nametag, cape, pet). It would not send tokens back, credit tradable value, or offer withdrawals.
7. If RPC cannot confirm the tx, the server would leave the item uncredited and tell the player to wait or open a support path — never "retry send."

## What this prototype actually does

- Lists stub Premium items and shows "Connect wallet (coming soon)."
- If Phantom is present, can connect and run a **read-only** `getTokenAccountsByOwner` check for `$mihao` (and a companion mint if `COMPANION_MINT` is set in the environment).
- A successful $mihao balance can show a "holder" badge. That is a perk, not a purchase.
- The Buy buttons stay disabled. `premiumBuy` on the websocket only returns a toast: purchases are not enabled.

## Environment (for a future build, not used to move funds now)

- `COMPANION_MINT` — leave empty until a real contract exists.
- `SOLANA_RPC` — public or your own RPC, read-only is enough today.
- A treasury address should be published later and should not be a personal hot wallet if this ever ships.
