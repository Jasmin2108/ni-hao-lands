// Rename tests for Ni Hao Lands.
// Usage:
//   node test-rename.mjs
//   node test-rename.mjs http://127.0.0.1:3120
//   node test-rename.mjs https://ni-hao-lands.onrender.com

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { WebSocket } from "ws";
import net from "node:net";

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

function hiddenPair(prefix) {
  const n = String(100000 + Math.floor(Math.random() * 900000));
  return prefix + n;
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

async function get(base, urlPath) {
  const r = await fetch(base + urlPath);
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

function openClient(base) {
  const wsUrl = base.replace(/^http/, "ws") + "/ws";
  const ws = new WebSocket(wsUrl);
  const inbox = [];
  const waiters = [];
  let settleWelcome, failWelcome;
  const welcome = new Promise((res, rej) => {
    settleWelcome = res;
    failWelcome = rej;
  });
  const timer = setTimeout(() => failWelcome(new Error("welcome timeout")), 15000);
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    inbox.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(msg)) {
        const w = waiters[i];
        waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(msg);
      }
    }
    if (msg.type === "welcome") { clearTimeout(timer); settleWelcome(msg); }
    if (msg.type === "error" && !ws._welcomed) { clearTimeout(timer); failWelcome(new Error(msg.text || "hello error")); }
  });
  ws.on("error", (e) => failWelcome(e));
  const ready = new Promise((res, rej) => {
    ws.on("open", res);
    ws.on("error", rej);
  });
  return {
    ws,
    inbox,
    welcome,
    async hello(name, token) {
      await ready;
      const msg = { type: "hello", name };
      if (token) msg.token = token;
      ws.send(JSON.stringify(msg));
      const w = await welcome;
      ws._welcomed = true;
      return w;
    },
    send(msg) {
      ws.send(JSON.stringify(msg));
    },
    wait(match, timeout = 8000) {
      const found = inbox.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const w = { match, resolve, timer: setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error("timeout waiting for message"));
        }, timeout) };
        waiters.push(w);
      });
    },
    close() { try { ws.close(); } catch {} },
  };
}

async function freePort(start) {
  for (let port = start; port < start + 20; port++) {
    const ok = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.unref();
      srv.on("error", () => resolve(false));
      srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
    });
    if (ok) return port;
  }
  throw new Error("no free port from " + start);
}

async function startLocalServer() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "nhl-rename-"));
  const port = String(await freePort(Number(process.env.TEST_PORT || 3120)));
  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: port, HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
  child.stderr.on("data", (d) => { out += d; process.stderr.write(d); });
  return {
    base: "http://127.0.0.1:" + port,
    dataDir,
    async stop() {
      child.kill("SIGTERM");
      await sleep(500);
      try { child.kill("SIGKILL"); } catch {}
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function run(base) {
  const health = await waitHealth(base);
  console.log("health", health);

  const first = hiddenPair("Scout");
  let second = hiddenPair("Jasmin");
  while (second.toLowerCase() === first.toLowerCase()) second = hiddenPair("Jasmin");

  const a = openClient(base);
  const welcomeA = await a.hello(first);
  if (welcomeA.me.name !== first) throw new Error("expected name " + first + ", got " + welcomeA.me.name);
  const tokenA = welcomeA.me.token;
  if (!tokenA) throw new Error("missing guest token");
  console.log("joined as", first);

  const otherName = hiddenPair("Scout");
  const b = openClient(base);
  const welcomeB = await b.hello(otherName);
  const tokenB = welcomeB.me.token;
  console.log("second client joined as", otherName);

  const ok = await post(base, "/api/rename", { token: tokenA, name: second });
  if (ok.status !== 200 || ok.json.name !== second) {
    throw new Error("rename failed: " + ok.status + " " + JSON.stringify(ok.json));
  }
  if (ok.json.oldName !== first) throw new Error("oldName mismatch: " + ok.json.oldName);
  console.log("renamed", first, "->", second);

  const renamed = await a.wait((m) => m.type === "renamed" && m.name === second);
  if (!renamed.me || renamed.me.name !== second) throw new Error("renamed payload missing me.name");
  const chat = await b.wait((m) => m.type === "chat" && m.system && String(m.text).includes(first + " is now known as " + second));
  console.log("system chat:", chat.text);
  const state = await b.wait((m) => m.type === "state" && (m.players || []).some((p) => p.name === second && p.id === welcomeA.me.id));
  if (!state) throw new Error("other client did not see new nametag");
  console.log("other client saw nametag", second);

  const acc = await get(base, "/api/account?token=" + encodeURIComponent(tokenA));
  if (acc.status !== 200 || acc.json.name !== second) throw new Error("account API still has old name: " + JSON.stringify(acc.json));

  const taken = await post(base, "/api/rename", { token: tokenB, name: second });
  if (taken.status !== 409 && taken.status !== 400) throw new Error("expected duplicate rejection, got " + taken.status + " " + JSON.stringify(taken.json));
  console.log("rejected duplicate:", taken.json.error);

  const cases = [
    ["x", "too short / length"],
    ["has space", "invalid chars"],
    ["bad-name!", "invalid chars"],
    ["shitcat", "profanity"],
    ["OldManeki", "reserved NPC"],
    ["BankerBao", "reserved NPC"],
    ["system", "reserved"],
    [second, "already your name"],
  ];
  for (const [name, label] of cases) {
    const r = await post(base, "/api/rename", { token: tokenA, name });
    if (r.status < 400) throw new Error("expected rejection for " + label + " (" + name + "), got " + r.status + " " + JSON.stringify(r.json));
    console.log("rejected", label + ":", r.json.error);
  }

  const again = await post(base, "/api/rename", { token: tokenA, name: hiddenPair("Jasmin") });
  if (again.status !== 429) throw new Error("expected cooldown 429, got " + again.status + " " + JSON.stringify(again.json));
  console.log("rejected cooldown:", again.json.error);

  a.close();
  await sleep(300);
  const a2 = openClient(base);
  const back = await a2.hello(second, tokenA);
  if (back.me.name !== second) throw new Error("re-login with new name failed, got " + (back.me && back.me.name));
  if (back.me.token !== tokenA && !back.me.token) throw new Error("re-login missing token");
  console.log("guest re-login with new name worked");
  a2.close();

  const a3 = openClient(base);
  const backOld = await a3.hello(first, tokenA);
  if (backOld.me.name !== second) throw new Error("token + old typed name should still load renamed character, got " + (backOld.me && backOld.me.name));
  console.log("token still loads the renamed character even if the typed name is stale");
  a3.close();

  // Wallet account: no requested name -> short/compact label, first rename free, then cooldown.
  const kp = keypair();
  const nonceR = await (await fetch(base + "/api/auth/nonce")).json();
  const created = await post(base, "/api/auth/wallet", {
    pubkey: kp.publicKey,
    nonce: nonceR.nonce,
    signature: sign(kp, kp.publicKey, nonceR.nonce),
  });
  if (created.status !== 200 || !created.json.token) throw new Error("wallet create failed " + JSON.stringify(created.json));
  const compact = kp.publicKey.slice(0, 4) + kp.publicKey.slice(-4);
  if (created.json.name !== compact) {
    throw new Error("expected compact wallet label " + compact + ", got " + created.json.name);
  }
  if (!created.json.needsName) throw new Error("expected needsName for auto-labeled wallet account");
  console.log("wallet character created as", created.json.name, "needsName=true");

  const wName = hiddenPair("WalletCat".startsWith("Wallet") ? "Scout" : "Scout");
  const wOk = await post(base, "/api/rename", { token: created.json.token, name: wName });
  if (wOk.status !== 200 || wOk.json.name !== wName) {
    throw new Error("wallet first rename should be free, got " + wOk.status + " " + JSON.stringify(wOk.json));
  }
  console.log("wallet first rename (free) ->", wName);
  const w2 = await post(base, "/api/rename", { token: created.json.token, name: hiddenPair("Scout") });
  if (w2.status !== 429) throw new Error("expected wallet cooldown, got " + w2.status + " " + JSON.stringify(w2.json));
  console.log("wallet second rename on cooldown:", w2.json.error);

  const wClient = openClient(base);
  const wWelcome = await wClient.hello(wName, created.json.token);
  if (wWelcome.me.name !== wName) throw new Error("wallet hello after rename failed");
  if (wWelcome.me.wallet !== kp.publicKey) throw new Error("wallet missing on welcome");
  if (wWelcome.me.needsName) throw new Error("needsName should be false after rename");
  wClient.close();
  b.close();
  console.log("wallet account rename and re-login worked");

  return { from: first, to: second, walletName: wName };
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
    const result = await run(base);
    console.log("TEST PASSED", result);
  } finally {
    if (handle) await handle.stop();
  }
}

main().catch((err) => {
  console.error("TEST FAILED", err);
  process.exit(1);
});
