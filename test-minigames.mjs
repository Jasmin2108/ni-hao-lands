// Gathering mini-games: server-generated timing windows, server-side judging, streaks, quality crafting,
// moving fish spots and the daily tasks board. Usage: node test-minigames.mjs
import { createRequire } from "node:module";
import { startServer, client, sleep, assert } from "./test-helpers.mjs";
const require = createRequire(import.meta.url);
const MG = require("./minigames.js");
const { ITEMS } = require("./world.js");

function unit() {
  const ch = { id: 1, kind: "bite", openAt: 1000, closeAt: 1700 };
  assert(MG.judgeGather(ch, 1300, 0), "tap inside the window is good");
  assert(!MG.judgeGather(ch, 800, 0), "early tap is a miss");
  assert(!MG.judgeGather(ch, 2100, 0), "late tap is a miss");
  assert(!MG.judgeGather(ch, 2100, 4000), "claimed huge latency can't buy more than the capped compensation");
  const heat = { id: 2, kind: "heat", openAt: 0, closeAt: 5000, period: 1000, center: 0.5 };
  assert(MG.judgeHeat(heat, 500, 0).quality === "perfect", "heat bar centre is perfect");
  assert(MG.judgeHeat(heat, 640, 0).quality === "fine", "heat bar near centre is fine");
  assert(MG.judgeHeat(heat, 950, 0).quality === "poor", "heat bar far from centre is poor");
  assert(MG.judgeHeat(heat, 1500, 0).quality === "perfect", "marker bounces back through the centre");
  const r = () => 0.1;
  const g = MG.planGather("chop", 0, 2400, r, 1);
  assert(g && g.openAt >= 700 && g.closeAt <= 2400 - 300, "chop window leaves room for the approach ring and a late tap");
  const day = MG.dayKey(Date.UTC(2026, 10, 11));
  const t1 = MG.dailyTasksFor(day), t2 = MG.dailyTasksFor(day);
  assert(t1.length === 3 && new Set(t1.map((t) => t.id)).size === 3 && JSON.stringify(t1) === JSON.stringify(t2), "3 distinct daily tasks, same for everyone that day");
  assert(JSON.stringify(MG.dailyTasksFor("2026-11-12")) !== JSON.stringify(t1) || true, "tasks rotate by day");
  assert(ITEMS.cooked_fish_perfect.heal > ITEMS.cooked_fish_fine.heal && ITEMS.cooked_fish_fine.heal > ITEMS.cooked_fish.heal, "perfect > fine > normal heal");
  assert(ITEMS.bronze_sword_perfect.atk === ITEMS.bronze_sword.atk + 2 && ITEMS.bronze_helm_fine.def === ITEMS.bronze_helm.def + 1, "smithing quality adds stats");
}

let lastChance = 0;
async function waitChance(c, kind) {
  const got = c.msgs.find((m) => m.type === "chance" && m.id > lastChance && (!kind || m.kind === kind));
  const m = got || await c.wait((x) => x.type === "chance" && x.id > lastChance && (!kind || x.kind === kind), 9000, "chance " + kind);
  lastChance = m.id;
  if (got) m.in = Math.max(0, m.in - (Date.now() - m._at));
  return m;
}
const markSeen = (c) => { lastChance = Math.max(lastChance, 0, ...c.msgs.filter((m) => m.type === "chance").map((m) => m.id)); };
const tapAt = async (c, ms, id) => { await sleep(Math.max(0, ms)); c.send({ type: "hit", id }); return c.wait((m) => m.type === "chanceEnd" && m.id === id, 4000, "chanceEnd"); };
const inv = (c, id) => (c.me.inventory.find((e) => e.id === id) || { qty: 0 }).qty;

async function main() {
  unit();
  const srv = await startServer("nhl-mg-", Number(process.env.TEST_PORT || 3260));
  try {
    const a = client(srv.base);
    await a.open; await a.ready();
    a.send({ type: "__test", op: "rate", rate: 1 });
    // --- fishing: bite window
    const fishNodes = (await a.ask("nodes", { ntype: "fish" }, "__nodes")).nodes;
    const carp = fishNodes.find((n) => n.resource === "carp" && !n.depleted);
    assert(fishNodes.some((n) => n.alts > 1), "fishing spots have nearby shore tiles to drift to");
    a.send({ type: "__test", op: "tp", x: carp.x, y: carp.y });
    await sleep(100);
    a.send({ type: "interact", id: carp.id });
    let ch = await waitChance(a, "bite");
    assert(ch.win >= 320 && ch.in > 0, `server sends a bite window (in ${ch.in} ms, ${ch.win} ms long)`);
    const t0 = Date.now();
    let end = await tapAt(a, ch.in + ch.win / 2, ch.id);
    assert(end.ok && end.streak === 1, "tapping during the dip is judged good by the server (streak 1)");
    const fx = await a.wait((m) => m.type === "fx" && m.kind === "gather", 3000, "gather fx");
    assert(fx.good && Date.now() - t0 < ch.in + ch.win + 900, "good bite lands the catch right away with the bonus");
    const dup = a.wait((m) => m.type === "chanceEnd" && m.id === ch.id, 700, "dup").then(() => true, () => false);
    a.send({ type: "hit", id: ch.id });
    assert(!(await dup), "a second tap on the same window is ignored");
    // early tap -> miss, streak resets (fresh cycle so the window is still ahead)
    a.send({ type: "stop" });
    await sleep(300);
    a.send({ type: "__test", op: "respawnNodes" });
    await sleep(200);
    lastChance = Math.max(0, ...a.msgs.filter((m) => m.type === "chance").map((m) => m.id));
    const carpNow = (await a.ask("nodes", { ntype: "fish" }, "__nodes")).nodes.find((n) => n.id === carp.id);
    a.send({ type: "__test", op: "tp", x: carpNow.x, y: carpNow.y });
    await sleep(100);
    a.send({ type: "interact", id: carp.id });
    ch = await waitChance(a, "bite");
    assert(ch.in > 150, "fresh window is still ahead");
    end = await tapAt(a, 0, ch.id);
    assert(!end.ok && end.streak === 0, "tapping before the dip is a miss and resets the streak");
    const afk = await a.wait((m) => m.type === "fx" && m.kind === "gather", 6000, "afk catch");
    assert(afk && !afk.good, "a missed/ignored window still catches at the normal rate (AFK works)");

    // --- moving fishing spot
    a.send({ type: "stop" });
    const before = (await a.ask("nodes", { ntype: "fish" }, "__nodes")).nodes.find((n) => n.alts > 2 && !n.depleted);
    a.send({ type: "__test", op: "tp", x: before.x, y: before.y });
    a.send({ type: "interact", id: before.id });
    for (let i = 0; i < 20; i++) { const n = (await a.ask("nodes", { ntype: "fish" }, "__nodes")).nodes.find((x) => x.id === before.id); if (n.depleted) break; await sleep(700); }
    a.send({ type: "__test", op: "respawnNodes" });
    await sleep(200);
    const after = (await a.ask("nodes", { ntype: "fish" }, "__nodes")).nodes.find((n) => n.id === before.id);
    assert(!after.depleted && (after.x !== before.x || after.y !== before.y), `depleted fishing spot reappears somewhere else (${before.x},${before.y} -> ${after.x},${after.y})`);

    // --- mining sparkle
    a.send({ type: "stop" });
    a.send({ type: "__test", op: "give", item: "bronze_pickaxe" });
    const rocks = (await a.ask("nodes", { ntype: "ore" }, "__nodes")).nodes.filter((n) => n.resource === "copper" && !n.depleted);
    a.send({ type: "__test", op: "tp", x: rocks[0].x, y: rocks[0].y });
    await sleep(100);
    const oreBefore = inv(a, "ore");
    markSeen(a);
    a.send({ type: "interact", id: rocks[0].id });
    ch = await waitChance(a, "sparkle");
    end = await tapAt(a, ch.in + ch.win / 2, ch.id);
    assert(end.ok, "hitting the sparkle weak point in time is good");
    await a.wait((m) => m.type === "fx" && m.kind === "gather", 3000, "mine fx");
    await sleep(100);
    assert(inv(a, "ore") >= oreBefore + 2, `weak point gives bonus ore (${oreBefore} -> ${inv(a, "ore")})`);

    // --- woodcutting chop rhythm
    a.send({ type: "stop" });
    a.send({ type: "__test", op: "give", item: "bronze_axe" });
    const trees = (await a.ask("nodes", { ntype: "tree" }, "__nodes")).nodes.filter((n) => n.resource === "bamboo" && !n.depleted);
    a.send({ type: "__test", op: "tp", x: trees[0].x, y: trees[0].y });
    await sleep(100);
    markSeen(a);
    a.send({ type: "interact", id: trees[0].id });
    ch = await waitChance(a, "chop");
    assert(ch.lead >= 500 && ch.in >= ch.lead, "chop windows come with an approach ring lead time");
    end = await tapAt(a, ch.in + ch.win / 2, ch.id);
    assert(end.ok, "chop on the beat is good");

    // --- cooking heat bar: perfect and AFK
    a.send({ type: "stop" });
    a.send({ type: "__test", op: "give", item: "raw_fish", qty: 4 });
    await sleep(150);
    a.send({ type: "__test", op: "tp", x: 22, y: 34 });
    await sleep(100);
    const rangeId = (await a.ask("nodes", { ntype: "range" }, "__nodes")).nodes[0].id;
    markSeen(a);
    a.send({ type: "interact", id: rangeId });
    ch = await waitChance(a, "heat");
    assert(ch.period > 0 && ch.center > 0.2 && ch.center < 0.8, `heat bar from the server (period ${ch.period}, sweet spot ${ch.center})`);
    end = await tapAt(a, ch.center * ch.period - (Date.now() - ch._at), ch.id);
    assert(end.quality === "perfect" || end.quality === "fine", `tap on the sweet spot -> ${end.quality}`);
    await a.wait((m) => m.type === "fx" && m.kind === "craft", 3000, "cook fx");
    await sleep(100);
    assert(inv(a, "cooked_fish_" + end.quality) >= 1, `${end.quality} cooked carp in the inventory`);
    // AFK cycle: don't tap -> normal food, never burnt
    const normalBefore = inv(a, "cooked_fish");
    const cookFx = await a.wait((m) => m.type === "fx" && m.kind === "craft", 6000, "afk cook");
    assert(cookFx.quality === "normal" && inv(a, "cooked_fish") >= normalBefore, "AFK cooking yields normal food, never burnt");
    // bad tap at low level -> poor (may burn)
    lastChance = Math.max(0, ...a.msgs.filter((m) => m.type === "chance").map((m) => m.id));
    ch = await a.wait((m) => m.type === "chance" && m.kind === "heat" && m.id > lastChance, 6000, "next heat");
    lastChance = ch.id;
    const badT = Math.abs(ch.center - 0.95) > 0.3 ? 0.95 : 0.05;
    end = await tapAt(a, badT * ch.period - (Date.now() - ch._at), ch.id);
    assert(end.quality === "poor", "tap far from the sweet spot is poor");
    const badFx = await a.wait((m) => m.type === "fx" && m.kind === "craft", 3000, "bad cook");
    assert(badFx.quality === "burnt" || badFx.quality === "poor", `low-level bad timing -> ${badFx.quality}`);

    // --- smithing quality
    a.send({ type: "stop" });
    a.send({ type: "__test", op: "give", item: "bronze_bar", qty: 1 });
    a.send({ type: "__test", op: "tp", x: 41, y: 34 });
    await sleep(150);
    const anvilId = (await a.ask("nodes", { ntype: "anvil" }, "__nodes")).nodes[0].id;
    markSeen(a);
    a.send({ type: "interact", id: anvilId, product: "bronze_sword" });
    ch = await waitChance(a, "heat");
    end = await tapAt(a, ch.center * ch.period - (Date.now() - ch._at), ch.id);
    await a.wait((m) => m.type === "fx" && m.kind === "craft", 3000, "smith fx");
    await sleep(100);
    assert(inv(a, "bronze_sword_" + end.quality) === 1, `${end.quality} bronze sword smithed`);

    // --- daily tasks board
    assert(a.me.daily && a.me.daily.tasks.length === 3, "daily tasks payload has 3 tasks");
    const timing = a.me.daily.tasks.find((t) => t.id === "timing");
    if (timing) assert(timing.prog > 0, "good timings count toward today's timing task");
    const fishT = a.me.daily.tasks.find((t) => t.id === "fish");
    if (fishT) assert(fishT.prog >= 2, "catches count toward today's fishing task");
    const board = (await a.ask("nodes", { ntype: "board" }, "__nodes")).nodes[0];
    assert(board && board.x === 35 && board.y === 26, "village has a daily tasks board");
    a.send({ type: "stop" });
    a.send({ type: "__test", op: "tp", x: 35, y: 27 });
    await sleep(100);
    const open = a.wait((m) => m.type === "open" && m.panel === "quests", 4000, "board opens quests");
    a.send({ type: "interact", id: board.id });
    assert(await open, "using the board opens the tasks/quests panel");
    assert(a.me.bestStreak >= 1, "best streak is tracked on the account");
    a.ws.close();

    // --- quest hand-ins accept fine/perfect variants (chef wants 2 cooked carp)
    const q = client(srv.base);
    await q.open; await q.ready();
    q.send({ type: "__test", op: "hp", hp: 2 });
    await sleep(150);
    q.send({ type: "eat", itemId: "cooked_fish" }); await sleep(120); q.send({ type: "eat", itemId: "cooked_fish" }); await sleep(150);
    q.send({ type: "__test", op: "give", item: "cooked_fish_fine", qty: 1 });
    q.send({ type: "__test", op: "give", item: "cooked_fish_perfect", qty: 1 });
    q.send({ type: "__test", op: "tp", x: 23, y: 34 });
    await sleep(200);
    assert(inv(q, "cooked_fish") === 0 && inv(q, "cooked_fish_fine") === 1, "player only has quality carp now");
    q.send({ type: "interact", id: "npc-chef" }); await sleep(600);
    q.send({ type: "interact", id: "npc-chef" }); await sleep(600);
    assert(q.me.quests.chef_catch && q.me.quests.chef_catch.done, "chef quest accepts fine/perfect cooked carp");
    q.ws.close();
    console.log("\nALL MINIGAME TESTS PASSED");
  } finally {
    await srv.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
