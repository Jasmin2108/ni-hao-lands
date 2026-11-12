"use strict";
// Long-term progression for Ni Hao Lands: collection log, story chapters, daily login streak,
// weekly village events, first-visit guide and titles. Pure data + rules over account.meta;
// server.js owns side effects (inventory, gold, xp, toasts). Everything is server-authoritative.
const { ITEMS } = require("./world");

// ---------------- collection log ----------------
const HOLDER_ONLY = new Set(["raw_lucky_koi", "lucky_cat_gem", "golden_bamboo", "golden_yarn", "golden_cat_rod", "lucky_jade_axe", "lucky_pickaxe"]);
const COLLECTION = [
  { id: "fish", name: "Fish", hint: "Pond, harbor and deep piers. Perfect strikes can hook a Moon Koi.",
    items: ["raw_minnow", "raw_fish", "raw_koi", "raw_golden_koi", "raw_moon_koi", "raw_lucky_koi"] },
  { id: "treasure", name: "Treasures", hint: "Sometimes something else bites. Timing helps.",
    items: ["old_boot", "message_bottle", "pearl"] },
  { id: "stone", name: "Ores & gems", hint: "Hit the sparkle when mining for a better chance at gems.",
    items: ["ore", "tin_ore", "iron_ore", "jade_ore", "sapphire", "emerald", "ruby", "lucky_cat_gem"] },
  { id: "woods", name: "Woods & nests", hint: "Bamboo, pine and cherry trees. Birds nest in the tall ones.",
    items: ["bamboo", "pine_logs", "cherry_logs", "bird_nest", "tree_seed", "golden_bamboo"] },
  { id: "yarn", name: "Yarn", hint: "Yarn bushes in the forest. Rare colours turn up now and then.",
    items: ["yarn", "rose_yarn", "sky_yarn", "rainbow_yarn", "golden_yarn"] },
  { id: "kitchen", name: "Kitchen", hint: "Cook at the village range. Fine and perfect dishes count too.",
    items: ["cooked_minnow", "cooked_fish", "cooked_koi", "cooked_golden_koi", "burnt_fish"] },
  { id: "forge", name: "Forge", hint: "Smelt at the furnace, smith at the anvil.",
    items: ["copper_bar", "bronze_bar", "iron_bar", "jade_bar", "bronze_sword", "bronze_pickaxe", "bronze_axe", "bronze_rod"] },
  { id: "keepsakes", name: "Keepsakes & special tools", hint: "Quest rewards, monster drops, and holder tools.",
    items: ["maneki_ribbon", "bamboo_hat", "koi_charm", "shrine_sash", "rat_tail", "bones", "shrine_token", "golden_cat_rod", "lucky_jade_axe", "lucky_pickaxe"] },
].map((g) => ({ ...g, items: g.items.filter((id) => ITEMS[id]) }));
const COLLECTIBLE = new Map();
for (const g of COLLECTION) for (const id of g.items) COLLECTIBLE.set(id, g.id);
const COLL_TOTAL = [...COLLECTIBLE.keys()].filter((id) => !HOLDER_ONLY.has(id)).length;
const COLL_MILESTONES = [
  { pct: 25, gold: 25 },
  { pct: 50, gold: 60 },
  { pct: 75, gold: 120 },
  { pct: 100, gold: 250, title: "Collector" },
];
function baseId(id) { const d = ITEMS[id]; return d && d.base ? d.base : id; }

// ---------------- story chapters ----------------
// Objectives: talk (npc), board, visit (zone id), count (stat, n; counted after the chapter opens), level (skill, n).
// The objective marked final is a talk that hands the chapter in once the others are done.
const STORY = [
  { id: "ch1", n: 1, zone: "Ni Hao Village", name: "Lantern Day",
    intro: "Old Maneki is getting the village ready for the Lantern Festival and needs a helper.",
    objectives: [
      { type: "talk", npc: "npc-merchant", label: "Say 你好 to Merchant Mao" },
      { type: "board", label: "Read the Daily tasks board" },
      { type: "talk", npc: "npc-greeter", label: "Report back to Old Maneki", final: true },
    ],
    finish: "Wonderful. The festival needs a feast, lanterns, and brave paws. Start at the pond.",
    reward: { gold: 30, xp: { yarn: 40 }, title: "Lantern Helper" } },
  { id: "ch2", n: 2, zone: "Fish Pond", name: "Ripples at the Pond",
    intro: "Chef Chou needs fresh fish for the festival feast.",
    objectives: [
      { type: "count", stat: "fish", n: 5, label: "Catch 5 fish" },
      { type: "count", stat: "timing", n: 2, label: "Land 2 well-timed taps (bite, sparkle, chop or heat bar)" },
      { type: "talk", npc: "npc-chef", label: "Tell Chef Chou the pond is lively", final: true },
    ],
    finish: "Lovely fish! Now, Old Maneki mentioned yarn for the lanterns…",
    reward: { gold: 60, xp: { fishing: 120 }, title: "Pond Friend" } },
  { id: "ch3", n: 3, zone: "Yarn Forest & Bamboo Woods", name: "Whispers in the Woods",
    intro: "Lanterns need yarn for tassels and bamboo for frames.",
    objectives: [
      { type: "count", stat: "yarn", n: 5, label: "Gather 5 yarn in Yarn Forest" },
      { type: "visit", zone: "bamboo", label: "Visit the Bamboo Woods" },
      { type: "count", stat: "logs", n: 5, label: "Chop 5 logs" },
      { type: "talk", npc: "npc-greeter", label: "Bring word to Old Maneki", final: true },
    ],
    finish: "The frames are perfect. Wear this hat — the woods remember kind visitors.",
    reward: { gold: 80, xp: { woodcutting: 150 }, item: "bamboo_hat", title: "Woodland Friend" } },
  { id: "ch4", n: 4, zone: "The Mine", name: "Sparks Under Stone",
    intro: "Smith Lin is forging lantern hooks and needs ore and an extra pair of hands.",
    objectives: [
      { type: "count", stat: "ore", n: 6, label: "Mine 6 ore in The Mine" },
      { type: "count", stat: "smelt", n: 2, label: "Smelt 2 bars at the furnace" },
      { type: "count", stat: "smith", n: 1, label: "Smith 1 item at the anvil" },
      { type: "talk", npc: "npc-smith", label: "Show Smith Lin your work", final: true },
    ],
    finish: "Good, honest work. The hooks will hold a hundred lanterns.",
    reward: { gold: 100, xp: { smithing: 200, mining: 100 }, title: "Spark Keeper" } },
  { id: "ch5", n: 5, zone: "Lantern Harbor", name: "Lanterns on the Water",
    intro: "Harbor Hao floats the first lanterns at dusk, and the cooks need minnows.",
    objectives: [
      { type: "visit", zone: "harbor", label: "Walk down to Lantern Harbor" },
      { type: "count", stat: "minnow", n: 3, label: "Catch 3 minnows off the harbor docks" },
      { type: "count", stat: "cook", n: 3, label: "Cook 3 dishes" },
      { type: "talk", npc: "npc-harbor", label: "Help Harbor Hao launch the lanterns", final: true },
    ],
    finish: "Look at them glow on the water. Take this charm; the koi will know you.",
    reward: { gold: 120, xp: { cooking: 150, fishing: 100 }, item: "koi_charm", title: "Harbor Light" } },
  { id: "ch6", n: 6, zone: "Cat Shrine Plains", name: "Paws on the Plains",
    intro: "Rats and rival dogs keep knocking over lanterns on the road to the shrine.",
    objectives: [
      { type: "visit", zone: "shrine", label: "Reach Cat Shrine Plains" },
      { type: "count", stat: "kill", n: 4, label: "Defeat 4 monsters" },
      { type: "level", skill: "combat", n: 5, label: "Reach Combat level 5" },
      { type: "talk", npc: "npc-greeter", label: "Tell Old Maneki the road is safe", final: true },
    ],
    finish: "Brave paws! Only the inner shrine is left. Train until you're ready — there's no rush.",
    reward: { gold: 140, xp: { combat: 200 }, title: "Plains Walker" } },
  { id: "ch7", n: 7, zone: "Cat Shrine (Combat 10)", name: "The Inner Shrine",
    intro: "Shrine Mei lights the last lantern, but the Shrine Hounds guard the steps.",
    objectives: [
      { type: "level", skill: "combat", n: 10, label: "Reach Combat level 10 (the inner shrine's rule)" },
      { type: "count", stat: "hound", n: 2, label: "Defeat 2 Shrine Hounds" },
      { type: "talk", npc: "npc-shrine", label: "Light the last lantern with Shrine Mei", final: true },
    ],
    finish: "The festival can begin. Ni Hao Lands thanks you, friend.",
    reward: { gold: 250, xp: { combat: 300 }, item: "shrine_sash", title: "Shrine Guardian" } },
];

// ---------------- weekly village events (rotate by ISO week, Helsinki) ----------------
const EVENTS = [
  { id: "fishing", name: "Pond Fishing Contest", desc: "Every fish scores 1 point, a perfect strike scores 2." },
  { id: "ore", name: "Ore Rush", desc: "Every ore or gem mined scores 1 point, a weak-point hit scores 2." },
  { id: "cook", name: "Village Cook-off", desc: "Every dish scores 1 point, fine 2, perfect 3. Burnt food scores 0." },
  { id: "woods", name: "Bamboo Harvest", desc: "Every log chopped scores 1 point, a clean chop scores 2." },
];
const EVENT_TIERS = [
  { pts: 10, gold: 30, xp: 60 },
  { pts: 30, gold: 60, xp: 150 },
  { pts: 60, gold: 100, xp: 300, title: "Festival Star" },
];
const EVENT_SKILL = { fishing: "fishing", ore: "mining", cook: "cooking", woods: "woodcutting" };
function weekNumber(weekId) { const m = /^(\d{4})-W(\d{2})$/.exec(String(weekId)); return m ? Number(m[1]) * 53 + Number(m[2]) : 0; }
function eventFor(weekId) { return EVENTS[weekNumber(weekId) % EVENTS.length]; }

// ---------------- daily login streak ----------------
// One login reward per UTC day. Skipping one day keeps the streak (one-day grace); two or more resets it.
function loginReward(streak) {
  const d = Math.max(1, streak);
  return { gold: 10 + 5 * (Math.min(d, 7) - 1), item: d % 7 === 0 ? "pearl" : null };
}
function daysBetween(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }

// ---------------- meta ----------------
function emptyMeta() {
  return {
    guide: { done: false, step: 0 },
    coll: {},
    collMilestones: [],
    story: { ch: 0, prog: [], done: [] },
    login: { last: "", streak: 0, best: 0 },
    event: { week: "", id: "", score: 0, claimed: [] },
    titles: [],
    title: "",
    seeded: false,
  };
}
function normalizeMeta(raw) {
  const m = emptyMeta();
  if (!raw || typeof raw !== "object") return m;
  if (raw.guide && typeof raw.guide === "object") m.guide = { done: !!raw.guide.done, step: Math.max(0, Math.min(10, raw.guide.step | 0)) };
  if (raw.coll && typeof raw.coll === "object") for (const [k, v] of Object.entries(raw.coll)) if (COLLECTIBLE.has(k)) m.coll[k] = Math.max(0, v | 0);
  if (Array.isArray(raw.collMilestones)) m.collMilestones = raw.collMilestones.filter((x) => COLL_MILESTONES.some((c) => c.pct === x));
  if (raw.story && typeof raw.story === "object") {
    m.story.ch = Math.max(0, Math.min(STORY.length, raw.story.ch | 0));
    m.story.prog = Array.isArray(raw.story.prog) ? raw.story.prog.map((x) => Math.max(0, x | 0)).slice(0, 8) : [];
    m.story.done = Array.isArray(raw.story.done) ? raw.story.done.filter((id) => STORY.some((c) => c.id === id)) : [];
  }
  if (raw.login && typeof raw.login === "object") m.login = { last: /^\d{4}-\d{2}-\d{2}$/.test(raw.login.last || "") ? raw.login.last : "", streak: Math.max(0, raw.login.streak | 0), best: Math.max(0, raw.login.best | 0) };
  if (raw.event && typeof raw.event === "object") m.event = { week: String(raw.event.week || ""), id: String(raw.event.id || ""), score: Math.max(0, raw.event.score | 0), claimed: Array.isArray(raw.event.claimed) ? raw.event.claimed.map((x) => x | 0) : [] };
  if (Array.isArray(raw.titles)) m.titles = [...new Set(raw.titles.map(String))].filter(isKnownTitle);
  m.title = m.titles.includes(raw.title) ? raw.title : "";
  m.seeded = !!raw.seeded;
  return m;
}
const TITLES = new Set([...STORY.map((c) => c.reward.title), ...COLL_MILESTONES.filter((c) => c.title).map((c) => c.title), ...EVENT_TIERS.filter((t) => t.title).map((t) => t.title)]);
function isKnownTitle(t) { return TITLES.has(t); }

// Veterans (made before this release with real progress) skip the first-visit guide; their log is seeded from what they own.
function migrate(account) {
  const m = account.meta;
  const totalXp = Object.values(account.skills || {}).reduce((a, b) => a + (b | 0), 0);
  const anyQuest = Object.values(account.quests || {}).some((q) => q && (q.done || q.step > 0));
  if (!m.seeded) {
    m.seeded = true;
    if (!m.guide.done && (totalXp >= 300 || anyQuest)) m.guide.done = true;
    const own = {};
    for (const it of account.inventory || []) if (it) own[baseId(it.id)] = (own[baseId(it.id)] || 0) + (it.qty || 1);
    for (const [id, q] of Object.entries(account.bank || {})) own[baseId(id)] = (own[baseId(id)] || 0) + (q | 0);
    for (const id of Object.values(account.equipped || {})) if (id) own[baseId(id)] = (own[baseId(id)] || 0) + 1;
    if ((account.biggestFish || 0) > 0) own.raw_fish = own.raw_fish || 1;
    for (const [id, q] of Object.entries(own)) if (COLLECTIBLE.has(id) && q > 0) m.coll[id] = Math.max(m.coll[id] || 0, q);
    for (const c of COLL_MILESTONES) if (collPct(m) >= c.pct && !m.collMilestones.includes(c.pct)) m.collMilestones.push(c.pct); // no retro payout
  }
  return m;
}

function collPct(m) {
  let have = 0;
  for (const id of COLLECTIBLE.keys()) if (!HOLDER_ONLY.has(id) && (m.coll[id] || 0) > 0) have++;
  return COLL_TOTAL ? Math.floor((have * 100) / COLL_TOTAL) : 0;
}
function collHave(m) { let n = 0; for (const id of COLLECTIBLE.keys()) if (!HOLDER_ONLY.has(id) && (m.coll[id] || 0) > 0) n++; return n; }

// Records an obtained item. Returns { first, milestones: [..] } for the server to announce/pay.
function recordCollect(m, itemId, qty = 1) {
  const id = baseId(itemId);
  if (!COLLECTIBLE.has(id) || qty <= 0) return null;
  const first = !(m.coll[id] > 0);
  m.coll[id] = Math.min(1e9, (m.coll[id] || 0) + qty);
  const milestones = [];
  if (first) for (const c of COLL_MILESTONES) if (collPct(m) >= c.pct && !m.collMilestones.includes(c.pct)) { m.collMilestones.push(c.pct); milestones.push(c); }
  return { id, first, milestones, holder: HOLDER_ONLY.has(id) };
}

// ---- story ----
function storyChapter(m) { return m.story.ch < STORY.length ? STORY[m.story.ch] : null; }
function objDone(ch, i, m, account) {
  const o = ch.objectives[i];
  if (o.type === "level") return levelOf(account, o.skill) >= o.n;
  if (o.type === "count") return (m.story.prog[i] || 0) >= o.n;
  return (m.story.prog[i] || 0) >= 1;
}
let levelOf = () => 1;
function setLevelFn(fn) { levelOf = fn; }
function readyToHandIn(ch, m, account) { return ch.objectives.every((o, i) => o.final || objDone(ch, i, m, account)); }
// Applies a game event to the open chapter. Returns true if visible progress changed.
function storyEvent(m, account, ev) {
  const ch = storyChapter(m);
  if (!ch) return false;
  let changed = false;
  ch.objectives.forEach((o, i) => {
    if (o.final || objDone(ch, i, m, account)) return;
    let add = 0;
    if (o.type === "count" && ev.type === "count" && ev.stat === o.stat) add = ev.n || 1;
    else if (o.type === "talk" && ev.type === "talk" && ev.npc === o.npc) add = 1;
    else if (o.type === "board" && ev.type === "board") add = 1;
    else if (o.type === "visit" && ev.type === "visit" && ev.zone === o.zone) add = 1;
    if (add) { m.story.prog[i] = Math.min(o.type === "count" ? o.n : 1, (m.story.prog[i] || 0) + add); changed = true; }
  });
  return changed;
}
// Talking to the hand-in NPC. Returns {completed: chapter} | {waiting: [labels]} | null (not this NPC).
function storyTalk(m, account, npcId) {
  const ch = storyChapter(m);
  if (!ch) return null;
  const fin = ch.objectives.find((o) => o.final);
  const progressed = storyEvent(m, account, { type: "talk", npc: npcId });
  if (!fin || fin.npc !== npcId) return progressed ? { progressed: true } : null;
  if (!readyToHandIn(ch, m, account)) return { waiting: ch.objectives.filter((o, i) => !o.final && !objDone(ch, i, m, account)).map((o) => o.label), chapter: ch };
  m.story.done.push(ch.id);
  m.story.ch += 1;
  m.story.prog = [];
  if (ch.reward.title && !m.titles.includes(ch.reward.title)) { m.titles.push(ch.reward.title); m.title = ch.reward.title; }
  return { completed: ch };
}
function storyPayload(m, account) {
  return STORY.map((ch, idx) => {
    const done = m.story.done.includes(ch.id);
    const open = idx === m.story.ch;
    return {
      id: ch.id, n: ch.n, name: ch.name, zone: ch.zone, intro: ch.intro,
      state: done ? "done" : open ? "open" : "locked",
      reward: { gold: ch.reward.gold, xp: ch.reward.xp, item: ch.reward.item || null, title: ch.reward.title || null },
      objectives: open || done ? ch.objectives.map((o, i) => ({
        label: o.label, final: !!o.final, goal: o.type === "count" ? o.n : o.type === "level" ? o.n : 1,
        prog: done ? (o.type === "count" || o.type === "level" ? o.n : 1) : o.type === "level" ? Math.min(o.n, levelOf(account, o.skill)) : Math.min(o.type === "count" ? o.n : 1, m.story.prog[i] || 0),
        done: done || (!o.final && objDone(ch, i, m, account)),
      })) : [],
    };
  });
}

// ---- login ----
// Returns the reward for today's first login, or null if already counted today.
function loginTick(m, day) {
  const L = m.login;
  if (L.last === day) return null;
  const gap = L.last ? daysBetween(L.last, day) : 99;
  if (gap < 0) return null; // clock skew: ignore
  L.streak = gap <= 2 && L.last ? L.streak + 1 : 1;
  L.best = Math.max(L.best, L.streak);
  L.last = day;
  return { streak: L.streak, kept: gap === 2, ...loginReward(L.streak) };
}

// ---- events ----
function eventState(m, weekId) {
  const ev = eventFor(weekId);
  if (m.event.week !== weekId) m.event = { week: weekId, id: ev.id, score: 0, claimed: [] };
  return { ev, st: m.event };
}
// Adds points; returns the tiers newly reached.
function eventScore(m, weekId, eventId, pts) {
  const { ev, st } = eventState(m, weekId);
  if (ev.id !== eventId || pts <= 0) return [];
  st.score += pts;
  const hit = [];
  EVENT_TIERS.forEach((t, i) => { if (st.score >= t.pts && !st.claimed.includes(i)) { st.claimed.push(i); hit.push({ ...t, i, skill: EVENT_SKILL[ev.id] }); } });
  return hit;
}

module.exports = {
  COLLECTION, COLLECTIBLE, HOLDER_ONLY, COLL_TOTAL, COLL_MILESTONES, STORY, EVENTS, EVENT_TIERS, EVENT_SKILL, TITLES,
  emptyMeta, normalizeMeta, migrate, recordCollect, collPct, collHave, baseId,
  storyChapter, storyEvent, storyTalk, storyPayload, setLevelFn, readyToHandIn,
  loginTick, loginReward, daysBetween, eventFor, eventState, eventScore, weekNumber,
};
