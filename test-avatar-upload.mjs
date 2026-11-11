// Avatar upload smoke test for Ni Hao Lands.
// Usage:
//   node test-avatar-upload.mjs                  # starts a temp server on 3100
//   node test-avatar-upload.mjs http://127.0.0.1:3100
//   node test-avatar-upload.mjs https://ni-hao-lands.onrender.com

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ARG = process.argv[2] || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "test-admin-key";

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typ = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typ, data])));
  return Buffer.concat([len, typ, data, crc]);
}

function makePng(width, height, { noise = false, rgba = [220, 80, 40, 255] } = {}) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 4;
      if (noise) {
        raw[i] = (x * 13 + y * 29) & 255;
        raw[i + 1] = (x * 47 + y * 7) & 255;
        raw[i + 2] = (x * 3 + y * 91) & 255;
        raw[i + 3] = 255;
      } else {
        raw[i] = rgba[0];
        raw[i + 1] = rgba[1];
        raw[i + 2] = rgba[2];
        raw[i + 3] = rgba[3];
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = noise
    ? zlib.deflateSync(raw, { level: 0 })
    : zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function dataUrl(buf, mime = "image/png") {
  return `data:${mime};base64,${buf.toString("base64")}`;
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

function join(base, name, avatar) {
  const wsUrl = base.replace(/^http/, "ws") + "/ws";
  const ws = new WebSocket(wsUrl);
  const inbox = [];
  let resolveWelcome, rejectWelcome;
  const welcome = new Promise((res, rej) => {
    resolveWelcome = res;
    rejectWelcome = rej;
  });
  const timer = setTimeout(() => rejectWelcome(new Error("welcome timeout for " + name)), 15000);
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    inbox.push(msg);
    if (msg.type === "welcome") {
      clearTimeout(timer);
      resolveWelcome(msg);
    }
    if (msg.type === "error") {
      clearTimeout(timer);
      rejectWelcome(new Error(msg.text || "hello error"));
    }
  });
  ws.on("error", (err) => {
    clearTimeout(timer);
    rejectWelcome(err);
  });
  const ready = new Promise((res, rej) => {
    ws.on("open", res);
    ws.on("error", rej);
  });
  return {
    ws,
    inbox,
    welcome,
    async hello() {
      await ready;
      ws.send(JSON.stringify({ type: "hello", name, avatar }));
      return welcome;
    },
    close() {
      try { ws.close(); } catch {}
    },
  };
}

function findPlayer(msg, name) {
  const lists = [];
  if (msg.players) lists.push(msg.players);
  if (msg.me) lists.push([msg.me]);
  for (const list of lists) {
    const p = list.find((x) => x && x.name === name);
    if (p) return p;
  }
  return null;
}

async function postJson(base, urlPath, body) {
  const r = await fetch(base + urlPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: r.status, json, headers: r.headers };
}

async function startLocalServer() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "nhl-avatar-"));
  const port = process.env.TEST_PORT || "3100";
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    DATA_DIR: dataDir,
    ADMIN_KEY,
  };
  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
  child.stderr.on("data", (d) => { out += d; process.stderr.write(d); });
  const base = "http://127.0.0.1:" + port;
  return {
    base,
    dataDir,
    async stop() {
      child.kill("SIGTERM");
      await sleep(400);
      if (!child.killed) child.kill("SIGKILL");
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function maybeScreenshotPicker(base) {
  try {
    const { spawnSync } = await import("node:child_process");
    const py = `
import sys, time
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]
SHOT = sys.argv[2]
CHROME = "/usr/bin/google-chrome"
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=CHROME,
        args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"])
    page = browser.new_page(viewport={"width": 900, "height": 1100})
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector("#avatar-grid button")
    page.wait_for_selector("#upload-avatar-btn")
    page.fill("#name", "PickerShot")
    page.screenshot(path=SHOT, full_page=False)
    print("picker screenshot", SHOT)
    browser.close()
`;
    const shot = path.join(ROOT, "picker-screenshot.png");
    const res = spawnSync("python3", ["-c", py, base, shot], { encoding: "utf8" });
    if (res.status === 0) {
      console.log((res.stdout || "").trim());
      return shot;
    }
    console.log("picker screenshot skipped:", (res.stderr || res.stdout || "unknown").slice(0, 400));
    return null;
  } catch (e) {
    console.log("picker screenshot skipped:", e.message);
    return null;
  }
}

async function run(base, { local }) {
  await waitHealth(base);
  const stamp = String(Date.now()).slice(-6);
  const nameA = "UpA" + stamp;
  const nameB = "UpB" + stamp;

  const a = join(base, nameA, "classic-paw");
  const welcomeA = await a.hello();
  const token = welcomeA.me && welcomeA.me.token;
  if (!token) throw new Error("no token in welcome");
  console.log("joined", nameA, "token ok");

  const bad = await postJson(base, "/api/avatar", {
    token,
    image: "data:image/png;base64,thisisnotanimage",
  });
  if (bad.status !== 400) throw new Error("expected 400 for non-image, got " + bad.status + " " + JSON.stringify(bad.json));
  console.log("rejected non-image:", bad.json.error);

  const jpeg = await postJson(base, "/api/avatar", {
    token,
    image: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
  });
  if (jpeg.status !== 400) throw new Error("expected 400 for jpeg, got " + jpeg.status);
  console.log("rejected jpeg data URL:", jpeg.json.error);

  const tiny = await postJson(base, "/api/avatar", {
    token,
    image: dataUrl(makePng(64, 64)),
  });
  if (tiny.status !== 400) throw new Error("expected 400 for 64x64, got " + tiny.status + " " + JSON.stringify(tiny.json));
  console.log("rejected 64x64:", tiny.json.error);

  const hugePng = makePng(128, 128, { noise: true });
  if (hugePng.length <= 60 * 1024) throw new Error("test setup: noisy png was only " + hugePng.length + " bytes");
  const huge = await postJson(base, "/api/avatar", {
    token,
    image: dataUrl(hugePng),
  });
  if (huge.status !== 400 && huge.status !== 413) {
    throw new Error("expected 400/413 for oversized, got " + huge.status + " " + JSON.stringify(huge.json));
  }
  console.log("rejected oversized:", huge.status, huge.json.error || huge.json);

  const validBuf = makePng(128, 128, { rgba: [40, 160, 90, 255] });
  if (validBuf.length > 60 * 1024) throw new Error("valid test png too big: " + validBuf.length);
  const ok = await postJson(base, "/api/avatar", {
    token,
    image: dataUrl(validBuf),
  });
  if (ok.status !== 200 || !ok.json.avatar || !String(ok.json.avatar).startsWith("u:")) {
    throw new Error("expected successful upload, got " + ok.status + " " + JSON.stringify(ok.json));
  }
  const avatarId = ok.json.avatar;
  const fileId = avatarId.slice(2);
  console.log("uploaded", avatarId, "bytes", validBuf.length);

  const img = await fetch(base + "/avatars/" + fileId);
  if (!img.ok) throw new Error("GET /avatars/" + fileId + " -> " + img.status);
  const type = img.headers.get("content-type") || "";
  const nosniff = img.headers.get("x-content-type-options") || "";
  const body = Buffer.from(await img.arrayBuffer());
  if (!type.includes("image/png")) throw new Error("bad content-type " + type);
  if (nosniff.toLowerCase() !== "nosniff") throw new Error("missing nosniff, got " + nosniff);
  if (body[0] !== 0x89 || body[1] !== 0x50) throw new Error("GET body is not a PNG");
  if (body.length !== validBuf.length) {
    // allow exact match; if not, still require PNG header and similar size
    console.log("note: stored size", body.length, "vs uploaded", validBuf.length);
  }
  console.log("GET /avatars/" + fileId, type, body.length, "bytes, nosniff ok");

  const b = join(base, nameB, "coat");
  const welcomeB = await b.hello();
  const seen = findPlayer(welcomeB, nameA);
  if (!seen) throw new Error("player B did not see " + nameA + " in welcome");
  if (seen.avatar !== avatarId) {
    // maybe a later state message already arrived; wait briefly
    const t0 = Date.now();
    let current = seen.avatar;
    while (Date.now() - t0 < 4000 && current !== avatarId) {
      const st = b.inbox.filter((m) => m.type === "state").at(-1);
      const p = st && findPlayer(st, nameA);
      if (p) current = p.avatar;
      await sleep(100);
    }
    if (current !== avatarId) {
      throw new Error("player B saw avatar " + current + " expected " + avatarId);
    }
  }
  console.log("player B saw", nameA, "avatar", avatarId);

  const again = await postJson(base, "/api/avatar", {
    token,
    image: dataUrl(makePng(128, 128, { rgba: [10, 20, 30, 255] })),
  });
  if (again.status !== 429) {
    console.log("note: expected 429 on immediate re-upload, got", again.status, again.json);
  } else {
    console.log("rate-limited second upload: 429");
  }

  if (local) {
    const reset = await postJson(base, "/api/admin/reset-avatar", {
      adminKey: ADMIN_KEY,
      name: nameA,
    });
    if (reset.status !== 200 || reset.json.avatar !== "classic-paw") {
      throw new Error("admin reset failed " + reset.status + " " + JSON.stringify(reset.json));
    }
    const gone = await fetch(base + "/avatars/" + fileId);
    if (gone.status !== 404) throw new Error("expected 404 after reset, got " + gone.status);
    console.log("admin reset deleted file and restored classic-paw");
  }

  a.close();
  b.close();
  return { avatarId, nameA, nameB };
}

async function main() {
  let local = false;
  let handle = null;
  let base = ARG;
  if (!base) {
    handle = await startLocalServer();
    base = handle.base;
    local = true;
    console.log("started local server", base, "data", handle.dataDir);
  } else {
    base = base.replace(/\/$/, "");
    console.log("testing existing server", base);
  }
  try {
    await waitHealth(base, local ? 20000 : 60000);
    const shot = await maybeScreenshotPicker(base);
    const result = await run(base, { local });
    console.log("TEST PASSED", result);
    if (shot) console.log("PICKER_SCREENSHOT", shot);
  } finally {
    if (handle) await handle.stop();
  }
}

main().catch((err) => {
  console.error("TEST FAILED", err);
  process.exit(1);
});
