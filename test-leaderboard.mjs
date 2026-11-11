// Leaderboard tests for Ni Hao Lands (JSON persistence, local server).
// Usage:
//   node test-leaderboard.mjs
//   node test-leaderboard.mjs http://127.0.0.1:3110
//   node test-leaderboard.mjs https://ni-hao-lands.onrender.com

import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const lb = require("./leaderboard.js");

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ARG = process.argv[2] || "";

const BOARDS = ["fishing", "yarn", "mining", "cooking", "combat", "total", "gold", "fish", "kills"];
const HIDDEN = ["PersistTest1", "PickerShotX", "WalletCat", "Scout123456", "Jasmin654321"];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function freePort(start = 3110) {
  for (let p = start; p < start + 30; p++) {
    const ok = await new Promise((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(false));
      s.listen(p, "127.0.0.1", () => s.close(() => resolve(true)));
    });
    if (ok) return p;
  }
  throw new Error("no free port");
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

function player(p) {
  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar || "classic-paw",
    wallet: p.wallet || null,
    x: 32,
    y: 24,
    gold: p.gold || 0,
    hp: 20,
    skills: {
      fishing: 0,
      yarn: 0,
      mining: 0,
      cooking: 0,
      combat: 0,
      ...(p.skills || {}),
    },
    inventory: [],
    bank: {},
    equipped: {},
    biggestFish: p.biggestFish || 0,
    kills: p.kills || 0,
    periods: p.periods || undefined,
    created: Date.now(),
  };
}

function periods(which, w, m) {
  const curW = lb.isoWeekId();
  const curM = lb.monthId();
  return {
    week: which.includes("w") ? curW : "2020-W01",
    month: which.includes("m") ? curM : "2020-01",
    w: { ...lb.emptyPeriodStats(), ...(w || {}) },
    m: { ...lb.emptyPeriodStats(), ...(m || {}) },
  };
}

async function seed(dataDir) {
  const players = [
    player({ id: "a_ann", name: "AnglerAnn", skills: { fishing: 5000 }, gold: 10, biggestFish: 4.2, periods: periods("wm", { fishing: 100, xp: 100, fish: 1.0 }, { fishing: 400, xp: 400, fish: 2.0 }) }),
    player({ id: "a_fay", name: "FisherFay", skills: { fishing: 4000 }, gold: 8, biggestFish: 3.1 }),
    player({ id: "a_hank", name: "HookHank", skills: { fishing: 3000 }, gold: 7, biggestFish: 2.0 }),
    player({ id: "a_mia", name: "MidMia", skills: { fishing: 200 }, gold: 20, biggestFish: 1.1, avatar: "coat", periods: periods("wm", { fishing: 40, xp: 40, fish: 2.5 }, { fishing: 40, xp: 40, fish: 2.5 }) }),
    player({ id: "a_sam", name: "SmallSam", skills: { fishing: 22 }, gold: 15, biggestFish: 0.4 }),
    player({ id: "a_yuri", name: "YarnYuri", skills: { yarn: 2200 }, gold: 11, periods: periods("wm", { fishing: 900, yarn: 400, xp: 1300 }, { fishing: 200, yarn: 400, xp: 600 }) }),
    player({ id: "a_max", name: "MinerMax", skills: { mining: 1800 }, gold: 50, periods: periods("wm", { gold: 80, mining: 50, xp: 50 }, { gold: 80, mining: 200, xp: 200 }) }),
    player({ id: "a_chen", name: "ChefChen", skills: { cooking: 1600 }, gold: 9 }),
    player({ id: "a_fay2", name: "FighterFay", skills: { combat: 1400 }, gold: 30, kills: 12, periods: periods("wm", { kills: 2, combat: 60, xp: 60 }, { kills: 8, combat: 200, xp: 200 }) }),
    player({ id: "a_tom", name: "TotalTom", skills: { fishing: 800, yarn: 800, mining: 800, cooking: 800, combat: 800 }, gold: 40, kills: 3, biggestFish: 1.8, periods: periods("wm", { kills: 5, xp: 100, fishing: 20, yarn: 20, mining: 20, cooking: 20, combat: 20 }, { kills: 5, xp: 300, fishing: 60, yarn: 60, mining: 60, cooking: 60, combat: 60 }) }),
    player({ id: "a_gus", name: "GoldieGus", gold: 999, wallet: "Gh7kLmNpQrStUvWxYzAbCdEfGhIjKlMnOpQrStUvWx", periods: periods("wm", { gold: 20 }, { gold: 40 }) }),
    player({ id: "a_ghost", name: "WeekGhost", skills: { fishing: 10 }, periods: periods("", { fishing: 99999, xp: 99999 }, { fishing: 99999, xp: 99999 }) }),
    player({ id: "a_pt", name: "PersistTest1", skills: { fishing: 99999 }, gold: 99999, biggestFish: 99, kills: 99 }),
    player({ id: "a_ps", name: "PickerShotX", skills: { fishing: 88888 } }),
    player({ id: "a_wc", name: "WalletCat", skills: { fishing: 77777 } }),
    player({ id: "a_sc", name: "Scout123456", skills: { fishing: 66666 } }),
    player({ id: "a_ja", name: "Jasmin654321", skills: { fishing: 55555 } }),
  ];
  const sessions = [
    { token: "mia_test_token_leaderboard_01", accountId: "a_mia", expires: null },
    { token: "gus_test_token_leaderboard_01", accountId: "a_gus", expires: null },
  ];
  await mkdir(path.join(dataDir, "avatars"), { recursive: true });
  await writeFile(path.join(dataDir, "players.json"), JSON.stringify({ savedAt: Date.now(), players, sessions }, null, 2));
}

async function startLocalServer() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "nhl-lb-"));
  await seed(dataDir);
  const port = process.env.TEST_PORT || String(await freePort(3110));
  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "" },
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
      await sleep(400);
      try { child.kill("SIGKILL"); } catch {}
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

function names(entries) {
  return (entries || []).map((e) => e.name);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function getBoard(base, board, extra = "") {
  const r = await fetch(base + "/api/leaderboard?board=" + encodeURIComponent(board) + extra);
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

async function getPeriod(base, board, period, extra = "") {
  return getBoard(base, board, "&period=" + encodeURIComponent(period) + extra);
}

async function run(base, { seeded }) {
  const health = await waitHealth(base);
  console.log("health", health);
  if (seeded && health.persist !== "json") {
    throw new Error("expected json persistence, got " + health.persist);
  }

  const bad = await getBoard(base, "nope");
  assert(bad.status === 400 && bad.json.error, "expected 400 for unknown board, got " + bad.status + " " + JSON.stringify(bad.json));
  assert(Array.isArray(bad.json.boards) && bad.json.boards.length >= 9, "400 should list boards");
  console.log("unknown board rejected");

  const results = {};
  for (const id of BOARDS) {
    const { status, json } = await getBoard(base, id, "&limit=25");
    assert(status === 200, id + " status " + status + " " + JSON.stringify(json));
    assert(json.board === id, id + " board id mismatch");
    assert(Array.isArray(json.entries), id + " missing entries");
    const hiddenHit = names(json.entries).find((n) => HIDDEN.includes(n) || /^(PersistTest|PickerShot|WalletCat)/.test(n) || /^(Scout|Jasmin)\d{6}$/.test(n));
    assert(!hiddenHit, id + " included hidden test account " + hiddenHit);
    for (let i = 1; i < json.entries.length; i++) {
      assert(json.entries[i].rank === i + 1, id + " rank gap at " + i);
      const a = json.entries[i - 1], b = json.entries[i];
      assert(typeof a.value === "number" && typeof b.value === "number", id + " value not numeric");
      assert(a.value > b.value || a.value === b.value, id + " not sorted: " + a.name + " " + a.value + " vs " + b.name + " " + b.value);
      assert(a.name && a.avatar && a.display, id + " entry missing fields " + JSON.stringify(a));
    }
    results[id] = json;
    console.log(id, "top:", json.entries.slice(0, 3).map((e) => e.rank + " " + e.name + " " + e.display).join(" | "), "total", json.total);
  }

  if (seeded) {
    assert(results.fishing.entries[0].name === "AnglerAnn", "fishing #1 should be AnglerAnn, got " + results.fishing.entries[0]?.name);
    assert(results.yarn.entries[0].name === "YarnYuri", "yarn #1 should be YarnYuri");
    assert(results.mining.entries[0].name === "MinerMax", "mining #1 should be MinerMax");
    assert(results.cooking.entries[0].name === "ChefChen", "cooking #1 should be ChefChen");
    assert(results.combat.entries[0].name === "FighterFay", "combat #1 should be FighterFay");
    assert(results.total.entries[0].name === "TotalTom", "total #1 should be TotalTom, got " + results.total.entries[0]?.name);
    assert(results.gold.entries[0].name === "GoldieGus", "gold #1 should be GoldieGus");
    assert(results.gold.entries[0].walletLabel && results.gold.entries[0].walletLabel.includes("…"), "gold #1 should show wallet short label, got " + results.gold.entries[0].walletLabel);
    assert(results.fish.entries[0].name === "AnglerAnn" && results.fish.entries[0].value === 4.2, "biggest fish should be AnglerAnn 4.2");
    assert(results.fish.entries.every((e) => e.value > 0), "fish board should omit 0 kg");
    assert(results.kills.entries[0].name === "FighterFay" && results.kills.entries[0].value === 12, "kills #1 should be FighterFay 12");

    const you = await getBoard(base, "fishing", "&limit=3&token=mia_test_token_leaderboard_01");
    assert(you.status === 200, "you-rank request failed");
    assert(you.json.entries.length === 3, "limit=3 should return 3, got " + you.json.entries.length);
    assert(!names(you.json.entries).includes("MidMia"), "MidMia should be outside top 3");
    assert(you.json.you && you.json.you.name === "MidMia", "you should be MidMia");
    assert(you.json.you.rank === 5, "MidMia should be fishing rank 5 (behind Ann, Fay, Hank, Tom), got " + you.json.you.rank);
    assert(you.json.you.avatar === "coat", "MidMia avatar should pass through");
    console.log("you-rank outside top 3:", you.json.you);

    const gus = await getBoard(base, "gold", "&limit=25&token=gus_test_token_leaderboard_01");
    assert(gus.json.you && gus.json.you.name === "GoldieGus" && gus.json.you.rank === 1, "GoldieGus should see own #1 gold rank");
    console.log("highlighted in-top you-rank ok");

    const badPeriod = await getPeriod(base, "fishing", "nope");
    assert(badPeriod.status === 400 && badPeriod.json.error, "expected 400 for unknown period");
    console.log("unknown period rejected");

    const weekFish = await getPeriod(base, "fishing", "week");
    assert(weekFish.status === 200, "weekly fishing failed");
    assert(weekFish.json.period === "week" && weekFish.json.periodId === lb.isoWeekId(), "week id should be " + lb.isoWeekId() + ", got " + weekFish.json.periodId);
    assert(weekFish.json.reset && /Monday 00:00 Helsinki/.test(weekFish.json.reset), "weekly reset text missing: " + weekFish.json.reset);
    assert(weekFish.json.entries[0].name === "YarnYuri" && weekFish.json.entries[0].value === 900, "weekly fishing #1 should be YarnYuri 900 xp, got " + JSON.stringify(weekFish.json.entries[0]));
    assert(!names(weekFish.json.entries).includes("WeekGhost"), "stale week counters must not appear");
    assert(!names(weekFish.json.entries).includes("AnglerAnn") || weekFish.json.entries.find((e) => e.name === "AnglerAnn").rank > 1, "AnglerAnn should not lead weekly fishing");
    console.log("weekly fishing", weekFish.json.entries.map((e) => e.name + " " + e.display).join(" | "));

    const weekGold = await getPeriod(base, "gold", "week");
    assert(weekGold.json.entries[0].name === "MinerMax" && weekGold.json.entries[0].value === 80, "weekly gold should rank earned gold, #1 MinerMax 80, got " + JSON.stringify(weekGold.json.entries[0]));
    assert(weekGold.json.entries.find((e) => e.name === "GoldieGus").value === 20, "GoldieGus weekly earned gold should be 20, not 999 balance");
    console.log("weekly gold", weekGold.json.entries.map((e) => e.name + " " + e.display).join(" | "));

    const weekTotal = await getPeriod(base, "total", "week");
    assert(weekTotal.json.entries[0].name === "YarnYuri" && weekTotal.json.entries[0].value === 1300, "weekly total XP #1 YarnYuri 1300");
    assert(weekTotal.json.name === "Total XP", "weekly total board name should be Total XP");

    const weekCatch = await getPeriod(base, "fish", "week");
    assert(weekCatch.json.entries[0].name === "MidMia" && weekCatch.json.entries[0].value === 2.5, "weekly biggest fish should be MidMia 2.5, not all-time 4.2");

    const weekKills = await getPeriod(base, "kills", "week");
    assert(weekKills.json.entries[0].name === "TotalTom" && weekKills.json.entries[0].value === 5, "weekly kills #1 should be TotalTom 5");

    const monthFish = await getPeriod(base, "fishing", "month");
    assert(monthFish.status === 200 && monthFish.json.periodId === lb.monthId(), "month id mismatch");
    assert(/1st/.test(monthFish.json.reset || ""), "monthly reset text missing");
    assert(monthFish.json.entries[0].name === "AnglerAnn" && monthFish.json.entries[0].value === 400, "monthly fishing #1 should be AnglerAnn 400, got " + JSON.stringify(monthFish.json.entries[0]));
    assert(!names(monthFish.json.entries).includes("WeekGhost"), "stale month counters must not appear");
    console.log("monthly fishing", monthFish.json.entries.map((e) => e.name + " " + e.display).join(" | "));
  }

  const first = await getBoard(base, "gold");
  const second = await getBoard(base, "gold");
  assert(first.json.cachedAt && first.json.cachedAt === second.json.cachedAt, "expected ~30s cache to reuse cachedAt");
  console.log("cache reuse ok, cachedAt", first.json.cachedAt);

  return { boards: BOARDS, persist: health.persist };
}

async function main() {
  let handle = null;
  let base = ARG.replace(/\/$/, "");
  let seeded = false;
  if (!base) {
    handle = await startLocalServer();
    base = handle.base;
    seeded = true;
    console.log("started local server", base);
  } else {
    console.log("testing existing server", base);
  }
  try {
    await waitHealth(base, seeded ? 20000 : 90000);
    const result = await run(base, { seeded });
    console.log("TEST PASSED", result);
  } finally {
    if (handle) await handle.stop();
  }
}

main().catch((e) => {
  console.error("TEST FAILED", e);
  process.exit(1);
});
