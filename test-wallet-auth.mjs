// Wallet sign-in tests for Ni Hao Lands (tweetnacl keypair, no real wallet).
// Usage:
//   node test-wallet-auth.mjs
//   node test-wallet-auth.mjs http://127.0.0.1:3100
//   node test-wallet-auth.mjs https://ni-hao-lands.onrender.com

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { WebSocket } from "ws";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ARG = process.argv[2] || "";

function signInMessage(pubkey, nonce) {
  return (
    "Ni Hao Lands sign-in\n" +
    "Wallet: " + pubkey + "\n" +
    "Nonce: " + nonce + "\n" +
    "This signature only logs you in. It is not a transaction and costs nothing."
  );
}

function keypair() {
  const kp = nacl.sign.keyPair();
  return {
    publicKey: bs58.encode(Buffer.from(kp.publicKey)),
    secretKey: kp.secretKey,
  };
}

function sign(kp, pubkey, nonce) {
  const msg = Buffer.from(signInMessage(pubkey, nonce), "utf8");
  return Buffer.from(nacl.sign.detached(msg, kp.secretKey)).toString("base64");
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(base, timeout = 20000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try {
      const r = await fetch(base + "/health");
      const j = await r.json();
      if (j && j.ok) return j;
      last = j;
    } catch (e) {
      last = e;
    }
    await sleep(250);
  }
  throw new Error("Server not healthy at " + base + "/health: " + last);
}

async function post(base, urlPath, body) {
  const r = await fetch(base + urlPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

async function getNonce(base) {
  const r = await fetch(base + "/api/auth/nonce");
  const json = await r.json();
  if (!json.nonce) throw new Error("no nonce: " + JSON.stringify(json));
  return json.nonce;
}

function join(base, name, token) {
  const wsUrl = base.replace(/^http/, "ws") + "/ws";
  const ws = new WebSocket(wsUrl);
  let resolveWelcome, rejectWelcome;
  const welcome = new Promise((res, rej) => {
    resolveWelcome = res;
    rejectWelcome = rej;
  });
  const timer = setTimeout(() => rejectWelcome(new Error("welcome timeout")), 15000);
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type === "welcome") { clearTimeout(timer); resolveWelcome(msg); }
    if (msg.type === "error") { clearTimeout(timer); rejectWelcome(new Error(msg.text || "hello error")); }
  });
  const ready = new Promise((res, rej) => {
    ws.on("open", res);
    ws.on("error", rej);
  });
  return {
    ws,
    async hello() {
      await ready;
      const msg = { type: "hello", name };
      if (token) msg.token = token;
      ws.send(JSON.stringify(msg));
      return welcome;
    },
    close() { try { ws.close(); } catch {} },
  };
}

async function startLocalServer() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "nhl-wallet-"));
  const port = process.env.TEST_PORT || "3101";
  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(d));
  child.stderr.on("data", (d) => process.stderr.write(d));
  return {
    base: "http://127.0.0.1:" + port,
    dataDir,
    async stop() {
      child.kill("SIGTERM");
      await sleep(500);
      if (!child.killed) child.kill("SIGKILL");
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function run(base, { local }) {
  const health = await waitHealth(base);
  console.log("health", health);
  const kp = keypair();
  const pub = kp.publicKey;
  console.log("test wallet", pub);

  const nonce1 = await getNonce(base);
  const bad = await post(base, "/api/auth/wallet", {
    pubkey: pub,
    nonce: nonce1,
    signature: Buffer.alloc(64).toString("base64"),
  });
  if (bad.status !== 400) throw new Error("expected 400 for bad signature, got " + bad.status + " " + JSON.stringify(bad.json));
  console.log("rejected bad signature:", bad.json.error);

  const ok = await post(base, "/api/auth/wallet", {
    pubkey: pub,
    nonce: nonce1,
    signature: sign(kp, pub, nonce1),
    name: "WalletCat",
  });
  if (ok.status !== 200 || !ok.json.token || !ok.json.wallet) {
    throw new Error("expected login, got " + ok.status + " " + JSON.stringify(ok.json));
  }
  if (ok.json.wallet !== pub) throw new Error("wallet mismatch");
  console.log("signed in as", ok.json.name, "token ok, label", ok.json.walletLabel);

  const replay = await post(base, "/api/auth/wallet", {
    pubkey: pub,
    nonce: nonce1,
    signature: sign(kp, pub, nonce1),
  });
  if (replay.status !== 400) throw new Error("expected 400 replay, got " + replay.status + " " + JSON.stringify(replay.json));
  console.log("rejected replayed nonce:", replay.json.error);

  const missing = await post(base, "/api/auth/wallet", {
    pubkey: pub,
    nonce: "deadbeefdeadbeefdeadbeefdeadbeef",
    signature: sign(kp, pub, "deadbeefdeadbeefdeadbeefdeadbeef"),
  });
  if (missing.status !== 400) throw new Error("expected 400 unknown nonce, got " + missing.status);
  console.log("rejected unknown nonce:", missing.json.error);

  const nonce2 = await getNonce(base);
  const again = await post(base, "/api/auth/wallet", {
    pubkey: pub,
    nonce: nonce2,
    signature: sign(kp, pub, nonce2),
  });
  if (again.status !== 200) throw new Error("second login failed " + again.status + " " + JSON.stringify(again.json));
  if (again.json.name !== ok.json.name) throw new Error("same wallet produced a different character: " + again.json.name + " vs " + ok.json.name);
  if (again.json.token === ok.json.token) throw new Error("expected a fresh session token on re-sign");
  console.log("same wallet returned character", again.json.name, "with a new session token");

  const client = join(base, again.json.name, again.json.token);
  const welcome = await client.hello();
  if (!welcome.me || welcome.me.name !== again.json.name) throw new Error("ws hello with wallet token failed");
  if (welcome.me.wallet !== pub) throw new Error("welcome missing wallet");
  client.close();
  console.log("websocket hello with wallet session succeeded");

  // Guest link: new guest, then a new wallet with the guest token.
  const stamp = String(Date.now()).slice(-5);
  const guestName = "Guest" + stamp;
  const guest = join(base, guestName);
  const guestWelcome = await guest.hello();
  const guestToken = guestWelcome.me.token;
  guest.close();
  const kp2 = keypair();
  const nonce3 = await getNonce(base);
  const linked = await post(base, "/api/auth/wallet", {
    pubkey: kp2.publicKey,
    nonce: nonce3,
    signature: sign(kp2, kp2.publicKey, nonce3),
    token: guestToken,
  });
  if (linked.status !== 200 || !linked.json.linked) {
    throw new Error("expected guest link, got " + linked.status + " " + JSON.stringify(linked.json));
  }
  if (linked.json.name !== guestName) throw new Error("link changed the guest name: " + linked.json.name);
  console.log("linked guest", guestName, "to a new wallet");

  return { name: ok.json.name, wallet: pub };
}

async function main() {
  let handle = null;
  let base = ARG.replace(/\/$/, "");
  let local = false;
  if (!base) {
    handle = await startLocalServer();
    base = handle.base;
    local = true;
    console.log("started local server", base);
  } else {
    console.log("testing existing server", base);
  }
  try {
    await waitHealth(base, local ? 20000 : 90000);
    const result = await run(base, { local });
    console.log("TEST PASSED", result);
  } finally {
    if (handle) await handle.stop();
  }
}

main().catch((err) => {
  console.error("TEST FAILED", err);
  process.exit(1);
});
