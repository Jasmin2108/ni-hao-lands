// World expansion, gathering, smithing, combat, quests, and save migration tests.
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { WebSocket } from "ws";
import { buildWorld, pathfind, zoneAt } from "./world.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ARG = process.argv[2] || "";

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
  port = String(port || await freePort(Number(process.env.TEST_PORT || 3122)));
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

function invHas(me, id) {
  return (me.inventory || []).some((it) => it && it.id === id && (it.qty || 1) > 0);
}

async function runGameplay(base) {
  const aName = hidden("Scout");
  const bName = hidden("Scout");
  const a = openClient(base);
  const welcome = await a.hello(aName);
  if (welcome.world.W < 100 || welcome.world.H < 80) throw new Error("world not expanded: " + welcome.world.W + "x" + welcome.world.H);
  if (!welcome.me.skills.woodcutting || !welcome.me.skills.smithing) throw new Error("new skills missing: " + JSON.stringify(Object.keys(welcome.me.skills)));
  if (!welcome.quests || welcome.quests.length < 2) throw new Error("quests missing from welcome");
  if (!welcome.smeltRecipes || !welcome.smithRecipes) throw new Error("smithing recipes missing");
  const token = welcome.me.token;
  console.log("joined", aName, "world", welcome.world.W + "x" + welcome.world.H, "skills", Object.keys(welcome.me.skills).join(","));

  const b = openClient(base);
  await b.hello(bName);
  b.send({ type: "chat", text: "ni hao from the plains" });
  const chat = await a.wait((m) => m.type === "chat" && !m.system && m.text && m.text.includes("ni hao"));
  console.log("two-client chat ok:", chat.from);

  // Zone gate: Jade Quarry requires Mining 15
  a.inbox.length = 0;
  a.send({ type: "move", x: 80, y: 16 });
  const gate = await a.wait((m) => m.type === "toast" && /Jade Quarry|Mining/i.test(m.text));
  console.log("quarry gate:", gate.text);

  // Gather carp at the pond
  const fish = (welcome.nodes || []).find((n) => n.type === "fish" && (n.resource === "carp" || n.label && /Carp/i.test(n.label)));
  if (!fish) throw new Error("no carp node in welcome");
  a.send({ type: "interact", id: fish.id });
  const caught = await a.wait((m) => m.type === "me" && invHas(m.me, "raw_fish"), 20000, "raw_fish");
  console.log("caught carp, inv", (caught.me.inventory || []).map((i) => i.id).join(","));

  const range = (welcome.nodes || []).find((n) => n.type === "range");
  a.send({ type: "interact", id: range.id });
  const cooked = await a.wait((m) => m.type === "me" && invHas(m.me, "cooked_fish"), 15000, "cooked_fish");
  console.log("cooked carp, cooking lvl", cooked.me.skills.cooking.level);

  // Quest: talk to Old Maneki
  a.send({ type: "interact", id: "npc-greeter" });
  await a.wait((m) => m.type === "me" && m.me.quests && m.me.quests.maneki_yarn && m.me.quests.maneki_yarn.step >= 1, 15000, "maneki quest start");
  console.log("started Old Maneki's Lost Yarn");

  // Combat a nearby forest dog
  const dog = (welcome.mobs || []).find((m) => m.id === "dog-1") || (welcome.mobs || []).find((m) => m.kind === "dog" || /Dog/i.test(m.name));
  if (!dog) throw new Error("no dog in welcome");
  a.send({ type: "interact", id: dog.id });
  const fight = await a.wait((m) => m.type === "toast" && /hit|defeated/i.test(m.text), 20000, "combat");
  console.log("combat started:", fight.text);

  // Walk to merchant and buy a bronze axe, then chop, mine, and smelt.
  a.send({ type: "interact", id: "npc-merchant" });
  await a.wait((m) => m.type === "open" && m.panel === "shop", 20000, "shop open");
  a.send({ type: "shopBuy", itemId: "bronze_axe" });
  const bought = await a.wait((m) => m.type === "me" && invHas(m.me, "bronze_axe"), 8000, "bronze_axe");
  console.log("bought bronze axe, gold", bought.me.gold);

  const tree = (welcome.nodes || []).find((n) => n.type === "tree" && (n.resource === "bamboo" || /Bamboo/i.test(n.label || "")));
  if (!tree) throw new Error("no bamboo tree in welcome");
  a.send({ type: "interact", id: tree.id });
  const chopped = await a.wait((m) => m.type === "me" && invHas(m.me, "bamboo"), 20000, "bamboo");
  console.log("chopped bamboo, woodcutting lvl", chopped.me.skills.woodcutting.level);

  const copper = (welcome.nodes || []).find((n) => n.type === "ore" || n.resource === "copper" || /Copper/i.test(n.label || ""));
  if (!copper) throw new Error("no copper rock in welcome");
  a.send({ type: "interact", id: copper.id });
  const mined = await a.wait((m) => m.type === "me" && invHas(m.me, "ore"), 20000, "copper ore");
  console.log("mined copper, mining lvl", mined.me.skills.mining.level);

  const furnace = (welcome.nodes || []).find((n) => n.type === "furnace");
  if (!furnace) throw new Error("no furnace in welcome");
  a.send({ type: "interact", id: furnace.id, recipe: "copper" });
  const smelted = await a.wait((m) => m.type === "me" && invHas(m.me, "copper_bar"), 20000, "copper bar");
  console.log("smelted copper bar, smithing lvl", smelted.me.skills.smithing.level);

  a.close();
  b.close();
  return { token, name: aName };
}

async function runMigration() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "nhl-migrate-"));
  const old = {
    savedAt: Date.now(),
    players: [{
      token: "oldtoken_persist_migration_01_abc",
      name: "PersistTestOld",
      skills: { fishing: 200, yarn: 40, mining: 10, cooking: 30, combat: 5 },
      gold: 12,
      inventory: [{ id: "raw_fish", qty: 3 }, { id: "ore", qty: 2 }],
      biggestFish: 1.5,
      kills: 1,
      x: 32,
      y: 28,
      avatar: "classic-paw",
      hp: 20,
      created: Date.now() - 86400000,
    }],
  };
  await writeFile(path.join(dataDir, "players.json"), JSON.stringify(old, null, 2));
  const srv = await startServer({ dataDir, port: await freePort(3130) });
  try {
    const c = openClient(srv.base);
    const w = await c.hello("PersistTestOld", "oldtoken_persist_migration_01_abc");
    if (w.me.name !== "PersistTestOld") throw new Error("migration did not load account, got " + w.me.name);
    if ((w.me.skills.fishing && w.me.skills.fishing.xp) !== 200) throw new Error("old fishing xp lost: " + JSON.stringify(w.me.skills.fishing));
    if (!w.me.skills.woodcutting || w.me.skills.woodcutting.xp !== 0) throw new Error("woodcutting should default to 0");
    if (!w.me.skills.smithing || w.me.skills.smithing.xp !== 0) throw new Error("smithing should default to 0");
    if (!invHas(w.me, "raw_fish") || !invHas(w.me, "ore")) throw new Error("old items not preserved: " + JSON.stringify(w.me.inventory));
    if (Math.round(w.me.x) !== 32 || Math.round(w.me.y) !== 28) throw new Error("position not preserved: " + w.me.x + "," + w.me.y);
    if (w.me.gold !== 12) throw new Error("gold changed: " + w.me.gold);
    if (!w.me.quests || !w.me.quests.maneki_yarn) throw new Error("quests not defaulted");
    c.close();
    console.log("migration from old JSON preserved items, gold, position, and added new skills/quests");
  } finally {
    await srv.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
}


async function runPaths() {
  const w = buildWorld();
  const routes = [
    ["harbor", 16, 62],
    ["bamboo", 32, 57],
    ["shrine plains", 80, 40],
    ["quarry edge", 62, 16],
  ];
  for (const [label, x, y] of routes) {
    const p = pathfind(w.tiles, 32, 28, x, y);
    if (!p.length) throw new Error("no path from village to " + label);
    const gated = p.filter((s) => zoneAt(s.x, s.y).require);
    if (gated.length) throw new Error("starter path to " + label + " crosses a gated zone at " + gated[0].x + "," + gated[0].y);
    console.log("path village ->", label, p.length, "steps");
  }
  const intoQuarry = pathfind(w.tiles, 32, 28, 80, 16);
  const gated = intoQuarry.filter((s) => zoneAt(s.x, s.y).require);
  if (!gated.length) throw new Error("expected the quarry interior path to be level-gated");
  console.log("quarry interior remains gated");
}

async function main() {
  if (ARG) {
    const base = ARG.replace(/\/$/, "");
    await waitHealth(base, 90000);
    const result = await runGameplay(base);
    console.log("TEST PASSED (remote)", result);
    return;
  }
  await runPaths();
  await runMigration();
  const srv = await startServer();
  try {
    const result = await runGameplay(srv.base);
    console.log("TEST PASSED", result);
  } finally {
    await srv.stop();
    await rm(srv.dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("TEST FAILED", err);
  process.exit(1);
});
