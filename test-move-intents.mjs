// Keyboard / joystick move intents: server validates walls, corners, gates and speed.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { WebSocket } from "ws";
import { buildWorld, isWalkable, pathfind, zoneAt } from "./world.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WALK_SPEED = 4.2;

function hidden(prefix = "Scout") {
  return prefix + String(100000 + Math.floor(Math.random() * 900000));
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitHealth(base, timeout = 20000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try {
      const r = await fetch(base + "/health");
      const j = await r.json();
      if (j && j.ok) return j;
      last = j;
    } catch (e) { last = e; }
    await sleep(250);
  }
  throw new Error("Server not healthy: " + last);
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
  throw new Error("no free port");
}

function openClient(base) {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws");
  const inbox = [];
  const waiters = [];
  let settleWelcome, failWelcome;
  const welcome = new Promise((res, rej) => { settleWelcome = res; failWelcome = rej; });
  const timer = setTimeout(() => failWelcome(new Error("welcome timeout")), 20000);
  ws.on("message", (raw) => {
    let msg; try { msg = JSON.parse(String(raw)); } catch { return; }
    inbox.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(msg)) {
        const w = waiters.splice(i, 1)[0];
        clearTimeout(w.timer);
        w.resolve(msg);
      }
    }
    if (msg.type === "welcome") { clearTimeout(timer); settleWelcome(msg); }
    if (msg.type === "error" && !ws._welcomed) { clearTimeout(timer); failWelcome(new Error(msg.text || "hello error")); }
  });
  const ready = new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  return {
    ws, inbox, welcome,
    async hello(name, token) {
      await ready;
      const msg = { type: "hello", name };
      if (token) msg.token = token;
      ws.send(JSON.stringify(msg));
      const w = await welcome;
      ws._welcomed = true;
      return w;
    },
    send(msg) { ws.send(JSON.stringify(msg)); },
    wait(match, timeout = 15000, label = "message") {
      const found = inbox.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const w = { match, resolve, timer: setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) waiters.splice(i, 1);
          const recent = inbox.slice(-8).map((m) => m.type + (m.text ? ":" + m.text : "") + (m.panel ? ":" + m.panel : "")).join(" | ");
          reject(new Error("timeout waiting for " + label + " (recent: " + recent + ")"));
        }, timeout) };
        waiters.push(w);
      });
    },
    close() { try { ws.close(); } catch {} },
  };
}

async function startServer({ dataDir, port } = {}) {
  dataDir = dataDir || await mkdtemp(path.join(tmpdir(), "nhl-world-"));
  port = String(port || await freePort(Number(process.env.TEST_PORT || 3130)));
  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: port, HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(d));
  child.stderr.on("data", (d) => process.stderr.write(d));
  const base = "http://127.0.0.1:" + port;
  await waitHealth(base);
  return {
    base, dataDir,
    async stop() {
      child.kill("SIGTERM");
      await sleep(400);
      try { child.kill("SIGKILL"); } catch {}
    },
  };
}


function myPos(client, id) {
  for (let i = client.inbox.length - 1; i >= 0; i--) {
    const m = client.inbox[i];
    if (m.type === "state") {
      const p = (m.players || []).find((q) => q.id === id);
      if (p) return p;
    }
  }
  return null;
}

async function settle(client, id, ms = 350) {
  // wait until position stops changing
  let last = null;
  for (let i = 0; i < 40; i++) {
    await sleep(ms);
    const p = myPos(client, id);
    if (p && last && p.x === last.x && p.y === last.y) return p;
    last = p;
  }
  return last;
}

function findWallTarget(tiles, from) {
  // a reachable walkable tile with a non-walkable west neighbour and walkable east neighbour
  const cands = [];
  for (let y = 18; y < 40; y++) {
    for (let x = 18; x < 46; x++) {
      if (!isWalkable(tiles, x, y) || isWalkable(tiles, x - 1, y) || !isWalkable(tiles, x + 1, y) || !isWalkable(tiles, x + 2, y)) continue;
      if (zoneAt(x, y).require) continue;
      const p = pathfind(tiles, from.x, from.y, x, y);
      if (p.length) cands.push({ x, y, d: p.length });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  return cands[0];
}

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("ok -", msg);
}

export async function runMoveIntents(base, { live = false } = {}) {
  const world = buildWorld();
  const tiles = world.tiles;
  const name = hidden("Scout");
  const c = openClient(base);
  const w = await c.hello(name);
  const id = w.me.id;
  console.log("joined", name, "at", w.me.x, w.me.y);
  const start = await settle(c, id, 200) || { x: w.me.x, y: w.me.y };
  const target = findWallTarget(tiles, { x: Math.round(start.x), y: Math.round(start.y) });
  assert(!!target, "found a tile next to a wall: " + JSON.stringify(target));

  c.send({ type: "move", x: target.x, y: target.y });
  let p = await settle(c, id);
  assert(Math.round(p.x) === target.x && Math.round(p.y) === target.y, "click-to-walk reached " + target.x + "," + target.y);

  // 1) walking into a wall is rejected and the player doesn't move
  c.inbox.length = 0;
  c.send({ type: "step", dx: -1, dy: 0 });
  const rej = await c.wait((m) => m.type === "stepReject", 3000, "stepReject");
  assert(rej.reason === "blocked", "server rejects stepping into a wall (" + rej.reason + ")");
  await sleep(500);
  p = myPos(c, id) || p;
  assert(Math.round(p.x) === target.x && Math.round(p.y) === target.y, "position unchanged after wall step");
  const facingMsg = c.inbox.filter((m) => m.type === "stepReject").pop();
  assert(facingMsg.facing === "left", "facing updates to left even when blocked");

  // 2) a valid step moves exactly one tile
  c.send({ type: "step", dx: 1, dy: 0 });
  p = await settle(c, id, 300);
  assert(Math.round(p.x) === target.x + 1 && Math.round(p.y) === target.y, "valid step moved one tile east");
  assert(p.facing === "right", "facing broadcast as right");

  // 3) oversized deltas are clamped to one tile
  const before = { x: Math.round(p.x), y: Math.round(p.y) };
  c.send({ type: "step", dx: 25, dy: 0 });
  p = await settle(c, id, 300);
  assert(Math.abs(Math.round(p.x) - before.x) <= 1, "dx=25 is clamped to a single tile (moved " + (Math.round(p.x) - before.x) + ")");

  // 4) flooding intents can't exceed walk speed
  const go = await (async () => {
    // walk back to target, then flood east along the row
    c.send({ type: "move", x: target.x, y: target.y });
    return settle(c, id);
  })();
  const t0 = Date.now();
  c.inbox.length = 0;
  for (let i = 0; i < 60; i++) c.send({ type: "step", dx: 1, dy: 0 });
  await sleep(600);
  const dt = (Date.now() - t0) / 1000;
  p = myPos(c, id) || go;
  const moved = Math.hypot(p.x - go.x, p.y - go.y);
  assert(moved <= WALK_SPEED * dt + 1.05, `60 intents in a burst moved ${moved.toFixed(2)} tiles in ${dt.toFixed(2)}s (max ${(WALK_SPEED * dt + 1.05).toFixed(2)})`);
  assert(c.inbox.some((m) => m.type === "stepReject" && m.reason === "rate"), "server reports rate-limited intents");
  await settle(c, id);

  // 5) legacy move to a far tile does not teleport
  const far = { x: 32, y: 45 };
  c.send({ type: "move", x: far.x, y: far.y });
  const q0 = myPos(c, id);
  const t1 = Date.now();
  await sleep(300);
  const q1 = myPos(c, id);
  const dt1 = (Date.now() - t1) / 1000 + 0.15;
  assert(Math.hypot(q1.x - q0.x, q1.y - q0.y) <= WALK_SPEED * dt1 + 0.6, "far move walks at normal speed (no teleport)");
  await settle(c, id);

  // 6) manual step cancels a skilling action
  const node = (await c.wait((m) => m.type === "state" && m.nodes && m.nodes.length, 3000, "state with nodes")).nodes
    .filter((n) => n.type === "yarn" || n.type === "fish" || n.type === "range")[0];
  if (node && !live) {
    c.send({ type: "interact", id: node.id });
    await sleep(200);
    c.send({ type: "step", dx: 0, dy: 1 });
    await sleep(400);
    const me = myPos(c, id);
    assert(!me.action, "a manual step cancels the walk/action (action=" + me.action + ")");
  }

  // 7) diagonal corner cutting is rejected
  let corner = null;
  for (let y = 18; y < 40 && !corner; y++) for (let x = 18; x < 46 && !corner; x++) {
    if (isWalkable(tiles, x, y) && isWalkable(tiles, x + 1, y + 1) && !isWalkable(tiles, x + 1, y) && isWalkable(tiles, x, y + 1) && !zoneAt(x, y).require && pathfind(tiles, 32, 28, x, y).length) corner = { x, y };
  }
  if (corner) {
    c.send({ type: "move", x: corner.x, y: corner.y });
    await settle(c, id);
    c.inbox.length = 0;
    c.send({ type: "step", dx: 1, dy: 1 });
    const r2 = await c.wait((m) => m.type === "stepReject", 3000, "corner reject");
    assert(r2.reason === "corner", "diagonal corner-cut rejected");
  }
  c.close();
  return true;
}

async function main() {
  const liveBase = process.argv[2];
  if (liveBase) {
    await runMoveIntents(liveBase, { live: true });
    console.log("LIVE MOVE INTENT TESTS PASSED");
    return;
  }
  const srv = await startServer();
  try {
    await runMoveIntents(srv.base);
    console.log("MOVE INTENT TESTS PASSED");
  } finally {
    await srv.stop();
    await rm(srv.dataDir, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
