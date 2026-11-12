// $nihala holder-perk tests with a mocked Solana RPC (read-only getTokenAccountsByOwner only).
// Usage:
//   node test-nihala-holder.mjs                     # local server + mock RPC: holder, non-holder, balance -> 0, guest
//   node test-nihala-holder.mjs https://host        # live: non-holder path with a fresh test wallet (real public RPC)
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { WebSocket } from "ws";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { createHolderChecker, TOKEN_PROGRAM, TOKEN_2022_PROGRAM, NIHALA_DECIMALS, wholeTokenBalance, holdsAtLeast, rawAmountFromWhole } = require("./holders.js");
const { HOLDER_SHOP, ITEMS } = require("./world.js");
const NIHALA = "FNkoLTsBFEMjhM6qwUhnRwAzJcSCURfgeEmC1hGcsHao";
const OTHER_MINT = "So11111111111111111111111111111111111111112";
const LIVE = process.argv[2] || "";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(c, m) { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m); }
function testName() { return "Scout" + String(Math.floor(Math.random() * 1e6)).padStart(6, "0"); }
function keypair() { const kp = nacl.sign.keyPair(); return { pub: bs58.encode(Buffer.from(kp.publicKey)), secret: kp.secretKey }; }
function signIn(pub, nonce) { return "Ni Hao Lands sign-in\nWallet: " + pub + "\nNonce: " + nonce + "\nThis signature only logs you in. It is not a transaction and costs nothing."; }
async function walletLogin(base, kp, name) {
  const { nonce } = await fetch(base + "/api/auth/nonce").then((r) => r.json());
  const signature = Buffer.from(nacl.sign.detached(Buffer.from(signIn(kp.pub, nonce), "utf8"), kp.secret)).toString("base64");
  const r = await fetch(base + "/api/auth/wallet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pubkey: kp.pub, nonce, signature, name }) });
  const j = await r.json();
  if (!r.ok || !j.token) throw new Error("wallet login failed: " + JSON.stringify(j));
  return j;
}
function client(base, name, token) {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws");
  const c = { ws, me: null, toasts: [], players: [], welcome: null, waiters: [] };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") { c.welcome = m; c.me = m.me; c.players = m.players; }
    if (m.type === "me") c.me = Object.assign(c.me || {}, m.me);
    if (m.type === "state") c.players = m.players;
    if (m.type === "toast") c.toasts.push(m.text);
    for (const w of c.waiters.slice()) if (w.pred(c)) { c.waiters.splice(c.waiters.indexOf(w), 1); w.res(c); }
  });
  c.open = new Promise((res, rej) => { ws.on("open", () => { const h = { type: "hello", name }; if (token) h.token = token; ws.send(JSON.stringify(h)); res(); }); ws.on("error", rej); });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.until = (pred, ms = 15000, label = "condition") => pred(c) ? Promise.resolve(c) : new Promise((res, rej) => {
    const w = { pred, res }; c.waiters.push(w);
    setTimeout(() => { const i = c.waiters.indexOf(w); if (i >= 0) { c.waiters.splice(i, 1); rej(new Error("timeout waiting for " + label)); } }, ms);
  });
  c.close = () => ws.close();
  return c;
}
async function freePort(start) {
  for (let p = start; p < start + 200; p++) {
    const ok = await new Promise((res) => { const s = net.createServer(); s.once("error", () => res(false)); s.listen(p, "127.0.0.1", () => s.close(() => res(true))); });
    if (ok) return p;
  }
  throw new Error("no free port");
}

// ---------- mock RPC ----------
const balances = new Map(); // owner -> { token: ui, token2022: ui }
const methods = new Set();
let rpcCalls = 0, rpcFail = false, mintFilterFail = false;
function tokenAcc(mint, ui, decimals = 6, amount) {
  if (amount == null) amount = String(Math.round(Number(ui) * 10 ** decimals));
  const uiNum = typeof ui === "number" ? ui : Number(ui);
  return { pubkey: "acc" + Math.random().toString(36).slice(2), account: { data: { parsed: { info: { mint, tokenAmount: { amount: String(amount), decimals, uiAmount: uiNum, uiAmountString: String(ui) } } } } } };
}
function accFor(entry, program) {
  if (entry && typeof entry === "object") return { ...tokenAcc(NIHALA, entry.ui, entry.decimals || 6, entry.amount), program };
  if (entry) return { ...tokenAcc(NIHALA, entry), program };
  return null;
}
function rpcHandler(body) {
  rpcCalls++;
  methods.add(body.method);
  if (rpcFail) return { jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "mock outage" } };
  if (body.method !== "getTokenAccountsByOwner") return { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "unexpected method" } };
  const [owner, filter] = body.params;
  const b = balances.get(owner) || {};
  const value = [];
  if (filter.mint) {
    if (mintFilterFail) return { jsonrpc: "2.0", id: body.id, error: { code: 429, message: "mock rate limit" } };
    if (filter.mint === NIHALA) {
      const a = accFor(b.token, TOKEN_PROGRAM); if (a) value.push(a);
      const b22 = accFor(b.token2022, TOKEN_2022_PROGRAM); if (b22) value.push(b22);
    }
    return { jsonrpc: "2.0", id: body.id, result: { context: { slot: 1 }, value } };
  }
  if (filter.programId === TOKEN_PROGRAM) { const a = accFor(b.token); if (a) value.push(a); value.push(tokenAcc(OTHER_MINT, 5, 9)); }
  else if (filter.programId === TOKEN_2022_PROGRAM) { const a = accFor(b.token2022); if (a) value.push(a); }
  return { jsonrpc: "2.0", id: body.id, result: { context: { slot: 1 }, value } };
}
function startMockRpc() {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      let data = ""; req.on("data", (d) => (data += d));
      req.on("end", () => { const out = rpcHandler(JSON.parse(data)); resp.setHeader("content-type", "application/json"); resp.end(JSON.stringify(out)); });
    });
    srv.listen(0, "127.0.0.1", () => res(srv));
  });
}

function thresholdTests() {
  assert(NIHALA_DECIMALS === 6, "on-chain $nihala decimals are 6");
  assert(rawAmountFromWhole(100000) === "100000000000", "100,000 whole tokens at 6 decimals is 100000000000 raw");
  assert(rawAmountFromWhole(100000, 9) === "100000000000000", "same whole-token threshold converts with a different decimal count");
  const justUnder = { amount: "99999999999", balance: 99999.999999 };
  const exact = { amount: "100000000000", balance: 100000 };
  const aBitOver = { amount: "100000000001", balance: 100000.000001 };
  assert(wholeTokenBalance(justUnder) === 99999n, "floors 99,999.999999 $nihala to 99,999 whole tokens");
  assert(wholeTokenBalance(exact) === 100000n, "100,000 raw-converted units is 100,000 whole tokens");
  assert(wholeTokenBalance(aBitOver) === 100000n, "100,000.000001 still floors to 100,000 whole tokens");
  assert(!holdsAtLeast(justUnder, 100000), "just under 100k does not meet the 100k threshold");
  assert(holdsAtLeast(exact, 100000), "exactly 100k unlocks the 100k tier");
  assert(holdsAtLeast(aBitOver, 100000), "slightly over 100k still unlocks");
  assert(!holdsAtLeast(exact, 250000), "100k does not unlock a 250k item");
  assert(holdsAtLeast({ amount: rawAmountFromWhole(250000) }, 250000), "250k raw meets the 250k tier");
  // ui fallback when raw amount is missing
  assert(wholeTokenBalance({ balance: 100000.9 }) === 100000n, "ui balance fallback floors to whole tokens");
  assert(!holdsAtLeast({ balance: 99999.9 }, 100000), "ui fallback rejects a fractional amount under the threshold");
  // any-balance holder perks (holdMin 0) need a positive balance, not merely >= 0
  assert(!holdsAtLeast({ amount: "0", balance: 0, holder: false }, 0), "zero balance is not a holder");
  assert(holdsAtLeast({ amount: "1", balance: 0.000001, holder: true }, 0), "any positive balance still counts as a holder");
  const holds = new Set(HOLDER_SHOP.map((o) => o.hold));
  assert(HOLDER_SHOP[0].hold === 100000, "cheapest holder shop item starts at 100,000 $nihala");
  assert(HOLDER_SHOP.every((o, i) => i === 0 || o.hold > HOLDER_SHOP[i - 1].hold), "shop hold prices step up");
  assert(holds.size === HOLDER_SHOP.length, "each shop item has a distinct hold price");
  assert(HOLDER_SHOP.every((o) => ITEMS[o.itemId] && ITEMS[o.itemId].holderOnly && ITEMS[o.itemId].holdMin === o.hold && ITEMS[o.itemId].sell === 0), "shop items are holder-only, unsellable, and carry holdMin");
  assert(HOLDER_SHOP.every((o) => (ITEMS[o.itemId].toolSpeed || 1) >= 0.68), "shop tools are no faster than crafted jade (0.68), so they don't quietly outpace gathering ranks");
}

async function unitTests(rpcUrl) {
  thresholdTests();
  const a = keypair().pub, b = keypair().pub;
  balances.set(a, { token: 10, token2022: 2.5 });
  const chk = createHolderChecker({ rpc: rpcUrl, mint: NIHALA, minBalance: 0, cacheMs: 400 });
  const before = rpcCalls;
  const s1 = await chk.check(a);
  assert(s1.holder && Math.abs(s1.balance - 12.5) < 1e-9 && s1.via === "mint", "mint-filter read sums Token + Token-2022 accounts (12.5)");
  assert(rpcCalls - before === 1, "one RPC read per check");
  await chk.check(a);
  assert(rpcCalls - before === 1, "second check within cache window hits no RPC");
  mintFilterFail = true;
  const sp = await chk.check(a, { force: true });
  assert(sp.holder && Math.abs(sp.balance - 12.5) < 1e-9 && sp.via === "programs", "fallback scans Token and Token-2022 programs explicitly (12.5)");
  mintFilterFail = false;
  const s2 = await chk.check(b);
  assert(!s2.holder && s2.balance === 0, "other-mint accounts are ignored (non-holder)");
  await sleep(450);
  rpcFail = true;
  const s3 = await chk.check(a);
  rpcFail = false;
  assert(s3.holder && s3.error, "RPC outage keeps the last known status");
  const s4 = await chk.check("not-a-wallet");
  assert(!s4.holder, "invalid address is never a holder");
}

async function localTests() {
  const rpc = await startMockRpc();
  const rpcUrl = "http://127.0.0.1:" + rpc.address().port;
  await unitTests(rpcUrl);

  const port = await freePort(Number(process.env.TEST_PORT || 3170));
  const dataDir = await mkdtemp(path.join(tmpdir(), "nhl-nihala-"));
  const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "", SOLANA_RPC: rpcUrl,
    NIHALA_RECHECK_MS: "1500", NIHALA_CACHE_MS: "500", NIHALA_RARE_CHANCE: "1" };
  const srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  const base = "http://127.0.0.1:" + port;
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/health")).ok) break; } catch {} await sleep(150); }
    const cfg = await fetch(base + "/api/config").then((r) => r.json());
    assert(cfg.nihalaMint === NIHALA && /dexscreener\.com\/solana\/8fytcqt1/.test(cfg.nihalaChart) && /Not financial advice/.test(cfg.nihalaDisclaimer), "config exposes $nihala CA, chart link and disclaimer");

    // holder
    const A = keypair(); balances.set(A.pub, { token2022: 1234.5 });
    const la = await walletLogin(base, A, testName());
    const ca = client(base, la.name, la.token); await ca.open;
    await ca.until((c) => c.me && c.me.nihalaStatus && c.me.nihalaStatus.holder, 8000, "holder status");
    assert(ca.me.nihala === true && Math.abs(ca.me.nihalaStatus.balance - 1234.5) < 1e-9, "wallet holder gets perks (balance 1234.5 via Token-2022)");
    await ca.until((c) => c.players.some((p) => p.id === c.me.id && p.nihala), 5000, "public nihala flag");
    assert(true, "other players see the nihala holder badge flag");
    ca.send({ type: "holderClaim", itemId: "golden_cat_rod" });
    await ca.until((c) => c.me.inventory.some((i) => i.id === "golden_cat_rod"), 4000, "claim rod");
    assert(true, "holder claims Golden Cat Rod for free");
    ca.send({ type: "holderClaim", itemId: "golden_cat_rod" });
    await sleep(400);
    assert(ca.me.inventory.filter((i) => i.id === "golden_cat_rod").length === 1, "a holder tool can only be claimed once");
    ca.send({ type: "holderClaim", itemId: "jade_sword" });
    await sleep(300);
    assert(!ca.me.inventory.some((i) => i.id === "jade_sword"), "only holder tools are claimable");
    const golds = ca.me.gold;
    ca.send({ type: "shopSell", itemId: "golden_cat_rod", qty: 1 });
    await sleep(300);
    assert(ca.me.gold === golds && ca.me.inventory.some((i) => i.id === "golden_cat_rod"), "holder tools can't be sold for gold");
    ca.send({ type: "chat", text: "ni hao" });
    // rare drop: fish once with chance forced to 1
    const fishNode = ca.welcome.nodes.filter((n) => n.type === "fish" && n.level <= 1).sort((p, q) => Math.hypot(p.x - ca.me.x, p.y - ca.me.y) - Math.hypot(q.x - ca.me.x, q.y - ca.me.y))[0];
    ca.send({ type: "interact", id: fishNode.id });
    await ca.until((c) => c.me.inventory.some((i) => i.id === "raw_lucky_koi"), 30000, "rare drop");
    assert(ca.toasts.some((t) => /Lucky Golden Koi/.test(t)), "holder rare find: bigger Lucky Golden Koi");
    ca.send({ type: "stop" });

    // balance goes to 0 -> perks pause on the periodic re-check
    balances.set(A.pub, {});
    await ca.until((c) => c.me.nihalaStatus && !c.me.nihalaStatus.holder && c.me.nihalaStatus.signedIn, 10000, "pause");
    assert(ca.me.nihala === false && ca.toasts.some((t) => /paused/.test(t)), "balance 0 pauses perks after periodic re-check");
    ca.send({ type: "holderClaim", itemId: "lucky_pickaxe" });
    await sleep(400);
    assert(!ca.me.inventory.some((i) => i.id === "lucky_pickaxe"), "paused holder can't claim more tools");
    ca.send({ type: "equip", itemId: "golden_cat_rod" });
    await sleep(400);
    assert(!Object.values(ca.me.equipped || {}).includes("golden_cat_rod"), "paused holder can't equip holder tools");
    // balance back -> perks resume
    balances.set(A.pub, { token: 1 });
    await ca.until((c) => c.me.nihalaStatus && c.me.nihalaStatus.holder, 10000, "resume");
    assert(true, "perks resume when the balance is back above 0");
    ca.close();

    // non-holder wallet
    const B = keypair();
    const lb = await walletLogin(base, B, testName());
    const cb = client(base, lb.name, lb.token); await cb.open;
    await cb.until((c) => c.me && c.me.nihalaStatus && c.me.nihalaStatus.checkedAt, 8000, "non-holder check");
    assert(!cb.me.nihalaStatus.holder && cb.me.nihala === false, "wallet with 0 $nihala (only other mints) is not a holder");
    cb.send({ type: "holderClaim", itemId: "lucky_pickaxe" });
    await sleep(400);
    assert(!cb.me.inventory.some((i) => i.id === "lucky_pickaxe") && cb.toasts.some((t) => /holding \$nihala/.test(t)), "non-holder claim is politely refused");
    cb.close();

    // guest: no wallet, never checked, client claims ignored
    const cg = client(base, testName()); await cg.open;
    await cg.until((c) => c.me, 5000, "guest welcome");
    cg.send({ type: "wallet", address: A.pub, holder: true });
    await sleep(600);
    assert(!cg.me.nihalaStatus.signedIn && cg.me.nihala === false, "guest claiming someone else's wallet gets no $nihala perks");
    cg.close();

    // ---- holder shop: unlock by holding, live access, no transfers ----
    assert(cfg.nihalaDecimals === 6 && cfg.purchasesEnabled === false, "config exposes $nihala decimals and keeps purchases disabled");
    assert(Array.isArray(cfg.holderShop) && cfg.holderShop[0].hold === 100000 && cfg.holderShop.every((o, i) => i === 0 || o.hold > cfg.holderShop[i - 1].hold), "config lists the holder shop starting at 100k, prices stepping up");

    const C = keypair();
    balances.set(C.pub, { token2022: { ui: 99999.999999, amount: "99999999999" } });
    const lc = await walletLogin(base, C, testName());
    const cc = client(base, lc.name, lc.token); await cc.open;
    await cc.until((c) => c.welcome && c.me && c.me.nihalaStatus && c.me.nihalaStatus.checkedAt, 8000, "shop wallet check");
    assert(Array.isArray(cc.welcome.holderShop) && cc.welcome.holderShop[0].itemId === "harbor_charm_rod", "welcome carries the holder shop catalog");
    assert(cc.me.nihalaStatus.shop.every((o) => o.unlocked === false), "99,999.999999 $nihala leaves every shop tier locked");
    cc.send({ type: "holderShopUnlock", itemId: "harbor_charm_rod" });
    await sleep(400);
    assert(!cc.me.inventory.some((i) => i.id === "harbor_charm_rod") && cc.toasts.some((t) => /Hold 100,000 \$nihala to unlock/.test(t)), "server rejects an unlock below the 100k threshold");
    cc.send({ type: "holderShopUnlock", itemId: "harbor_charm_rod", unlocked: true, balance: 5000000 });
    await sleep(400);
    assert(!cc.me.inventory.some((i) => i.id === "harbor_charm_rod"), "client-spoofed unlock fields are ignored");

    balances.set(C.pub, { token2022: 100000 });
    cc.send({ type: "holderCheck" });
    await cc.until((c) => c.me.nihalaStatus && c.me.nihalaStatus.shop.some((o) => o.itemId === "harbor_charm_rod" && o.unlocked), 8000, "100k unlocks first tier");
    assert(cc.me.nihalaStatus.shop.find((o) => o.itemId === "shrine_charm_axe").unlocked === false, "100k does not unlock the 250k axe");
    cc.send({ type: "holderShopUnlock", itemId: "harbor_charm_rod" });
    await cc.until((c) => c.me.inventory.some((i) => i.id === "harbor_charm_rod"), 4000, "unlock harbor rod");
    assert(cc.toasts.some((t) => /unlock the Harbor Charm Rod by holding 100,000 \$nihala/.test(t) && /Nothing was spent/.test(t)), "unlock copy is hold-based and says nothing was spent");
    cc.send({ type: "holderShopUnlock", itemId: "shrine_charm_axe" });
    await sleep(400);
    assert(!cc.me.inventory.some((i) => i.id === "shrine_charm_axe"), "250k axe stays locked at a 100k balance");
    cc.send({ type: "holderShopUnlock", itemId: "harbor_charm_rod" });
    await sleep(300);
    assert(cc.me.inventory.filter((i) => i.id === "harbor_charm_rod").length === 1, "already-unlocked shop items are not granted again");
    cc.send({ type: "shopBuy", itemId: "harbor_charm_rod" });
    await sleep(300);
    assert(cc.toasts.some((t) => /doesn't sell that/.test(t)), "gold shop will not sell holder shop tools");
    cc.send({ type: "equip", itemId: "harbor_charm_rod" });
    await cc.until((c) => Object.values(c.me.equipped || {}).includes("harbor_charm_rod"), 4000, "equip shop rod");
    assert(true, "100k holder can equip the Harbor Charm Rod");

    // drop below 100k but stay a holder (>0): shop item is unequipped and unusable; free holder tools still work
    balances.set(C.pub, { token: 50 });
    await cc.until((c) => c.me.nihalaStatus && !Object.values(c.me.equipped || {}).includes("harbor_charm_rod") && c.me.nihalaStatus.holder, 10000, "shop unequip");
    assert(cc.me.inventory.some((i) => i.id === "harbor_charm_rod"), "dropping below 100k does not delete the unlocked item");
    assert(cc.toasts.some((t) => /unequipped/.test(t) && /100,000 \$nihala/.test(t)), "dropping below the tier unequips the shop tool");
    cc.send({ type: "equip", itemId: "harbor_charm_rod" });
    await sleep(400);
    assert(!Object.values(cc.me.equipped || {}).includes("harbor_charm_rod"), "shop tool cannot be equipped under its hold threshold");
    cc.send({ type: "holderClaim", itemId: "lucky_pickaxe" });
    await cc.until((c) => c.me.inventory.some((i) => i.id === "lucky_pickaxe"), 4000, "free holder pick");
    assert(true, "any-balance holder perks still work at 50 $nihala");

    balances.set(C.pub, { token2022: 250000 });
    await cc.until((c) => c.me.nihalaStatus && c.me.nihalaStatus.shop.find((o) => o.itemId === "shrine_charm_axe").unlocked, 10000, "250k resume");
    cc.send({ type: "equip", itemId: "harbor_charm_rod" });
    await cc.until((c) => Object.values(c.me.equipped || {}).includes("harbor_charm_rod"), 4000, "re-equip after hold returns");
    assert(true, "shop tool can be equipped again once the wallet holds enough");
    cc.send({ type: "holderShopUnlock", itemId: "shrine_charm_axe" });
    await cc.until((c) => c.me.inventory.some((i) => i.id === "shrine_charm_axe"), 4000, "unlock shrine axe");
    assert(true, "250k holder unlocks the Shrine Charm Axe");
    cc.send({ type: "premiumBuy", itemId: "harbor_charm_rod" });
    await sleep(300);
    assert(cc.toasts.some((t) => /not enabled/.test(t)), "premiumBuy remains a disabled stub");
    cc.close();

    const api = await fetch(base + "/api/holder/" + A.pub).then((r) => r.json());
    assert(api.nihala && api.nihala.holder === true, "/api/holder reports the $nihala balance (read-only)");
    assert([...methods].every((m) => m === "getTokenAccountsByOwner"), "server only ever called getTokenAccountsByOwner (no transactions): " + [...methods].join(","));
    const src = await Promise.all(["holders.js", "server.js", "world.js", "public/game.js"].map((f) => import("node:fs/promises").then((fs) => fs.readFile(path.join(ROOT, f), "utf8"))));
    const joined = src.join("\n");
    assert(!/sendTransaction|createTransfer|transferChecked|burnChecked/.test(joined), "no token transfer, burn or sendTransaction path in holder/shop code");
    console.log("\nALL NIHALA HOLDER TESTS PASSED (mock RPC)");
  } catch (e) {
    console.error(log.slice(-3000));
    throw e;
  } finally {
    srv.kill("SIGTERM");
    rpc.close();
    await sleep(300);
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function liveTests(base) {
  base = base.replace(/\/$/, "");
  const cfg = await fetch(base + "/api/config").then((r) => r.json());
  assert(cfg.nihalaMint === NIHALA, "live config has the $nihala CA");
  const K = keypair();
  const l = await walletLogin(base, K, testName());
  console.log("live test wallet", K.pub, "character", l.name);
  const c = client(base, l.name, l.token); await c.open;
  await c.until((x) => x.me && x.me.nihalaStatus && x.me.nihalaStatus.checkedAt, 20000, "live check");
  assert(c.me.nihalaStatus.signedIn && !c.me.nihalaStatus.holder && c.me.nihala === false, "fresh wallet is a non-holder on live (error: " + (c.me.nihalaStatus.error || "none") + ")");
  c.send({ type: "holderClaim", itemId: "golden_cat_rod" });
  await sleep(800);
  assert(!c.me.inventory.some((i) => i.id === "golden_cat_rod"), "live non-holder can't claim holder tools");
  const api = await fetch(base + "/api/holder/" + K.pub).then((r) => r.json());
  assert(api.nihala && api.nihala.holder === false, "live /api/holder: nihala balance " + (api.nihala && api.nihala.uiAmount));
  c.close();
  console.log("\nLIVE NIHALA NON-HOLDER PATH PASSED");
}

(LIVE ? liveTests(LIVE) : localTests()).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
