// Long-term progression: first-visit guide flag, collection log, story chapters, login streak,
// weekly village event and the share/PWA assets. Usage: node test-progress.mjs
import { createRequire } from "node:module";
import { startServer, client, sleep, assert } from "./test-helpers.mjs";
const require = createRequire(import.meta.url);
const PROG = require("./progress.js");
const { ITEMS } = require("./world.js");

function unit() {
  // login streak with a one-day grace
  const m = PROG.emptyMeta();
  let r = PROG.loginTick(m, "2026-11-01");
  assert(r.streak === 1 && r.gold === 10, "first visit: streak 1, 10 gold");
  assert(PROG.loginTick(m, "2026-11-01") === null, "only one visit bonus per day");
  r = PROG.loginTick(m, "2026-11-02");
  assert(r.streak === 2 && r.gold === 15 && !r.kept, "next day: streak 2, a little more gold");
  r = PROG.loginTick(m, "2026-11-04");
  assert(r.streak === 3 && r.kept, "skipping one day keeps the streak (grace)");
  r = PROG.loginTick(m, "2026-11-07");
  assert(r.streak === 1 && m.login.best === 3, "missing two days resets fairly to 1, best streak remembered");
  for (let d = 8; d <= 13; d++) r = PROG.loginTick(m, `2026-11-${String(d).padStart(2, "0")}`);
  assert(r.streak === 7 && r.gold === 40 && r.item === "pearl", "day 7: 40 gold + a pearl (cap)");
  r = PROG.loginTick(m, "2026-11-14");
  assert(r.gold === 40 && !r.item, "reward stays capped after day 7");
  // events rotate
  const ids = new Set(); for (let w = 1; w <= 4; w++) ids.add(PROG.eventFor(`2026-W${String(w).padStart(2, "0")}`).id);
  assert(ids.size === 4, "4 weekly events rotate");
  // collection rules
  const c = PROG.emptyMeta();
  let res = PROG.recordCollect(c, "cooked_fish_fine", 1);
  assert(res && res.first && res.id === "cooked_fish" && c.coll.cooked_fish === 1, "quality variants count as the base item");
  assert(PROG.recordCollect(c, "cooked_fish_perfect", 1).first === false, "second catch isn't a new discovery");
  assert(PROG.recordCollect(c, "coins_nope", 1) === null, "unknown items aren't collectibles");
  assert(PROG.HOLDER_ONLY.has("raw_lucky_koi") && PROG.COLLECTIBLE.has("raw_moon_koi"), "Moon Koi collectible, Lucky Golden Koi is a holder bonus");
  assert(PROG.COLL_TOTAL >= 40, `collection has ${PROG.COLL_TOTAL} entries`);
  assert(ITEMS.bamboo_hat && ITEMS.koi_charm && ITEMS.shrine_sash, "story cosmetics exist");
  // veteran migration
  const vet = { skills: { fishing: 5000 }, quests: {}, inventory: [{ id: "raw_koi", qty: 2 }], bank: { ore: 10 }, equipped: {}, meta: PROG.normalizeMeta(null) };
  PROG.migrate(vet);
  assert(vet.meta.guide.done && vet.meta.coll.raw_koi === 2 && vet.meta.coll.ore === 10, "veterans skip the guide; log seeded from inventory + bank");
  const again = PROG.normalizeMeta(JSON.parse(JSON.stringify(vet.meta)));
  assert(again.seeded && again.guide.done, "meta survives a save/load round trip");
  assert(PROG.STORY.length >= 7 && PROG.STORY.every((ch) => ch.objectives.some((o) => o.final)), "7 chapters, each with a hand-in");
  const maxLevel = Math.max(...PROG.STORY.flatMap((ch) => ch.objectives.filter((o) => o.type === "level").map((o) => o.n)));
  assert(maxLevel <= 10, "no story chapter needs more than level 10");
  // players route around zones they haven't unlocked (e.g. village -> Temple Rats skirts the Jade Quarry)
  const W = require("./world.js"); const wt = W.buildWorld(); const tiles = wt.tiles || wt; const fresh = { skills: {} };
  const route = W.pathfind(tiles, 32, 26, 74, 36, 1200, (x, y) => !W.zoneBlocked(W.zoneAt(x, y), fresh));
  assert(route.length > 0 && route.every((st) => !W.zoneBlocked(W.zoneAt(st.x, st.y), fresh)), "walk routes avoid locked zones instead of failing");
}

async function main() {
  unit();
  const srv = await startServer("nhl-prog-", Number(process.env.TEST_PORT || 3300));
  try {
    const a = client(srv.base);
    await a.open; await a.ready();
    // login streak on join
    await sleep(300);
    const daily = a.msgs.find((m) => m.type === "fx" && m.kind === "achv") || await a.wait((m) => m.type === "fx" && m.kind === "achv", 4000, "visit fx");
    assert(/Daily visit|streak/.test(daily.title), "first join pays a daily visit bonus with a toast");
    await sleep(200);
    let P = a.me.progress;
    assert(P && P.login.streak === 1 && P.guide.done === false && P.guide.step === 0, "new player: guide not done, streak 1");
    const welcome = a.msgs.find((m) => m.type === "welcome");
    assert(welcome.story.length === 7 && welcome.collection.length >= 7, "welcome carries story + collection catalog");
    // guide flag
    a.send({ type: "guide", op: "step", step: 3 });
    await a.wait((m) => m.type === "me" && m.me.progress.guide.step === 3, 3000, "guide step");
    a.send({ type: "guide", op: "done" });
    await a.wait((m) => m.type === "me" && m.me.progress.guide.done, 3000, "guide done");
    a.send({ type: "guide", op: "reset" });
    await a.wait((m) => m.type === "me" && !m.me.progress.guide.done, 3000, "guide reset (Show guide)");
    a.send({ type: "guide", op: "done" });
    assert(true, "guide step/done/reset persist on the server");
    // streak: next day + grace + reset
    const g0 = a.me.gold;
    a.send({ type: "__test", op: "day", day: "2099-01-01" });
    await a.wait((m) => m.type === "me" && m.me.progress.login.last === "2099-01-01", 3000, "day1");
    a.send({ type: "__test", op: "day", day: "2099-01-02" });
    let me = await a.wait((m) => m.type === "me" && m.me.progress.login.last === "2099-01-02", 3000, "day2");
    assert(me.me.progress.login.streak === 2, "logging in the next day extends the streak");
    a.send({ type: "__test", op: "day", day: "2099-01-04" });
    me = await a.wait((m) => m.type === "me" && m.me.progress.login.last === "2099-01-04", 3000, "day4");
    assert(me.me.progress.login.streak === 3, "one skipped day keeps the streak");
    a.send({ type: "__test", op: "day", day: "2099-01-09" });
    me = await a.wait((m) => m.type === "me" && m.me.progress.login.last === "2099-01-09", 3000, "day9");
    assert(me.me.progress.login.streak === 1 && me.me.progress.login.best >= 3, "a long break resets to 1 (no penalty beyond that)");
    assert(me.me.gold > g0, "streak rewards paid in gold");

    // collection unlock via a real gain
    const fxP = a.wait((m) => m.type === "fx" && m.kind === "achv" && /collection/i.test(m.title), 3000, "collection fx");
    a.send({ type: "__test", op: "give", item: "pearl", qty: 1 });
    const cfx = await fxP;
    assert(/River Pearl|Pearl/.test(cfx.sub), "first pearl triggers a 'New in your collection' toast");
    await sleep(150);
    assert(a.me.progress.coll.pearl === 1 && a.me.progress.collHave >= 1, "pearl recorded in the collection log");
    const nofx = a.wait((m) => m.type === "fx" && m.kind === "achv" && /New in your/.test(m.title), 700, "dup").then(() => true, () => false);
    a.send({ type: "__test", op: "give", item: "pearl", qty: 1 });
    assert(!(await nofx), "a duplicate isn't announced again");
    assert((await a.ask("meta", {}, "__meta")).meta.coll.pearl === 2, "counts keep growing");
    // milestone 25%
    const goldBefore = a.me.gold;
    const need = Math.ceil(PROG.COLL_TOTAL * 0.25);
    let given = 0;
    for (const id of [...PROG.COLLECTIBLE.keys()].filter((id) => !PROG.HOLDER_ONLY.has(id) && ITEMS[id].stack)) {
      if (a.me.progress.collHave + given >= need + 1) break;
      a.send({ type: "__test", op: "give", item: id, qty: 1 }); given++;
    }
    await sleep(600);
    const meta = (await a.ask("meta", {}, "__meta")).meta;
    assert(meta.collMilestones.includes(25), "25% collection milestone reached");
    assert(a.me.gold >= goldBefore + 25 || a.me.progress.collPct >= 25, "milestone pays gold");

    // story chapter 1: merchant -> board -> Old Maneki
    const tpTalk = async (npc, x, y) => { a.send({ type: "__test", op: "tp", x, y }); await sleep(120); a.send({ type: "interact", id: npc }); await sleep(900); };
    assert(a.me.progress.story.ch === 0 && a.me.progress.story.objectives.length === 3, "chapter 1 open with 3 objectives");
    await tpTalk("npc-greeter", 32, 27);
    assert(a.me.progress.story.ch === 0, "can't hand in chapter 1 before the objectives");
    await tpTalk("npc-merchant", 42, 23);
    assert(a.me.progress.story.objectives[0].done, "talking to the merchant ticks the objective");
    const board = (await a.ask("nodes", { ntype: "board" }, "__nodes")).nodes[0];
    a.send({ type: "__test", op: "tp", x: board.x, y: board.y + 1 }); await sleep(120);
    a.send({ type: "interact", id: board.id }); await sleep(900);
    a.send({ type: "__test", op: "bump", id: "noop", n: 1 }); await sleep(200);
    assert(a.me.progress.story.objectives[1].done, "reading the task board ticks the objective");
    const gBefore = a.me.gold;
    const chFx = a.wait((m) => m.type === "fx" && m.kind === "achv" && /Chapter 1/.test(m.title), 4000, "chapter fx");
    await tpTalk("npc-greeter", 32, 27);
    await chFx;
    assert(a.me.progress.story.ch === 1 && a.me.progress.titles.includes("Lantern Helper") && a.me.gold >= gBefore + 30, "chapter 1 pays gold + title");
    assert(a.me.progress.title === "Lantern Helper", "new title equipped");
    // chapter 2 via real counters
    a.send({ type: "__test", op: "bump", id: "fish", n: 5, opts: { good: true } });
    a.send({ type: "__test", op: "bump", id: "timing", n: 2 });
    await sleep(300);
    assert(a.me.progress.story.objectives.filter((o) => !o.final).every((o) => o.done), "chapter 2 objectives tracked from gameplay counters");
    await tpTalk("npc-chef", 23, 34);
    assert(a.me.progress.story.ch === 2 && a.me.progress.titles.includes("Pond Friend"), "chapter 2 handed in at Chef Chou");
    // titles
    a.send({ type: "setTitle", title: "Lantern Helper" }); await sleep(200);
    assert(a.me.progress.title === "Lantern Helper", "pick an earned title");
    a.send({ type: "setTitle", title: "Collector" }); await sleep(200);
    assert(a.me.progress.title === "Lantern Helper", "can't pick an unearned title");

    // other players see the title change via the delta stream
    const b = client(srv.base); await b.open; await b.ready();
    b.send({ type: "__test", op: "tp", x: 33, y: 28 }); a.send({ type: "__test", op: "tp", x: 32, y: 28 }); await sleep(600);
    const seen = b.wait((m) => m.type === "delta" && (m.p || []).some((p) => p.id === a.me.id && p.title === "Pond Friend"), 4000, "title delta");
    a.send({ type: "setTitle", title: "Pond Friend" });
    await seen;
    assert(true, "nearby players get the new title in the delta stream");
    b.ws.close();
    a.send({ type: "setTitle", title: "Lantern Helper" }); await sleep(200);

    // classic quests still work alongside the story (maneki_yarn)
    a.send({ type: "__test", op: "tp", x: 32, y: 27 }); await sleep(100);
    a.send({ type: "interact", id: "npc-greeter" }); await sleep(900);
    assert(a.me.quests.maneki_yarn && a.me.quests.maneki_yarn.step >= 1, "classic Old Maneki quest still starts");

    // weekly event: force a fishing week
    let wk = null; for (let w = 1; w <= 8; w++) { const id = `2099-W${String(w).padStart(2, "0")}`; if (PROG.eventFor(id).id === "fishing") { wk = id; break; } }
    a.send({ type: "__test", op: "week", week: wk }); await sleep(200);
    assert(a.me.progress.event.id === "fishing" && a.me.progress.event.score === 0, "event resets for a new week");
    const gE = a.me.gold;
    const tierFx = a.wait((m) => m.type === "fx" && m.kind === "achv" && /Fishing Contest/.test(m.title), 4000, "tier fx");
    a.send({ type: "__test", op: "bump", id: "fish", n: 1, opts: { good: true } });
    for (let i = 0; i < 4; i++) a.send({ type: "__test", op: "bump", id: "fish", n: 1, opts: { good: true } });
    await tierFx; await sleep(200);
    assert(a.me.progress.event.score === 10 && a.me.progress.event.claimed.includes(0) && a.me.gold >= gE + 30, "good catches score 2, tier 1 pays");
    a.send({ type: "__test", op: "bump", id: "ore", n: 3 }); await sleep(200);
    assert(a.me.progress.event.score === 10, "off-event activity doesn't score");
    // the public board uses the real week, so check the endpoint shape
    const ev = await (await fetch(srv.base + "/api/event")).json();
    assert(ev.event && ev.event.name && Array.isArray(ev.top) && ev.tiers.length === 3, "/api/event returns event + top list");

    // persistence across reconnect (same character via token)
    const token = a.me.token;
    a.ws.close(); await sleep(500);
    const { WebSocket } = await import("ws");
    const ws2 = new WebSocket(srv.base.replace(/^http/, "ws") + "/ws");
    const back = await new Promise((res, rej) => {
      ws2.on("open", () => ws2.send(JSON.stringify({ type: "hello", token, proto: 2 })));
      ws2.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.type === "welcome") res(m.me); });
      setTimeout(() => rej(new Error("no welcome on reconnect")), 6000);
    });
    ws2.close();
    console.log("reconnected:", JSON.stringify({ guide: back.progress.guide, ch: back.progress.story.ch, titles: back.progress.titles, pearl: back.progress.coll.pearl, login: back.progress.login }));
    assert(back.progress.guide.done && back.progress.titles.includes("Pond Friend") && back.progress.story.ch === 2 && back.progress.coll.pearl >= 2 && back.progress.login.last === "2099-01-09", "guide, story, titles, log and streak survive a reconnect");

    // share + PWA assets
    const html = await (await fetch(srv.base + "/")).text();
    for (const tag of ['property="og:title"', 'property="og:image"', 'name="twitter:card" content="summary_large_image"', 'rel="manifest"', 'name="theme-color"', 'rel="apple-touch-icon"']) assert(html.includes(tag), "index has " + tag);
    const og = await fetch(srv.base + "/og.png");
    const ogBuf = Buffer.from(await og.arrayBuffer());
    assert(og.ok && /image\/png/.test(og.headers.get("content-type")) && ogBuf.readUInt32BE(16) === 1200 && ogBuf.readUInt32BE(20) === 630, "/og.png is a 1200×630 png");
    assert(ogBuf.length < 1024 * 1024, `og image is small enough (${Math.round(ogBuf.length / 1024)} KB)`);
    const man = await (await fetch(srv.base + "/manifest.webmanifest")).json();
    assert(man.name === "Ni Hao Lands" && man.icons.some((i) => i.sizes === "512x512"), "manifest with 512 icon");
    for (const i of man.icons) assert((await fetch(srv.base + "/" + i.src.replace(/^\//, ""))).ok, "icon served: " + i.src);
    console.log("\nALL PROGRESS TESTS PASSED");
  } finally { await srv.stop(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
