"use strict";
// Server-side timing mini-games. Every window is generated and judged here:
// the client only says "I tapped chance #id"; the server stamps the receive time,
// subtracts half the measured round-trip (capped), and checks it against the window it made.

const KINDS = {
  bite: { win: 700, chance: 0.6, lead: 0 },       // fishing: bobber dips
  sparkle: { win: 950, chance: 0.5, lead: 0 },    // mining: weak point glints
  chop: { win: 480, chance: 0.65, lead: 700 },    // woodcutting: ring closes on the beat
  heat: { period: 1700 },                         // smithing / cooking quality bar
};
const SLACK_MS = 70;          // edge tolerance on gather windows
const MAX_COMP_MS = 150;      // never compensate more than this for latency
const HEAT_PERFECT = 0.07;    // |marker - centre| for perfect
const HEAT_FINE = 0.17;       // ... for fine

function kindForSkill(skill) {
  if (skill === "fishing") return "bite";
  if (skill === "mining") return "sparkle";
  if (skill === "woodcutting") return "chop";
  return null;
}

let seq = 1;
// Plan a gather window inside a cycle that ends at `cycleEnd`. Returns null when this cycle has none.
function planGather(kind, now, cycleEnd, rand = Math.random, rate) {
  const k = KINDS[kind];
  if (!k) return null;
  const p = rate != null ? rate : k.chance;
  if (rand() >= p) return null;
  const cycle = cycleEnd - now;
  if (cycle < 900) return null;
  let win = Math.min(k.win, Math.round(cycle * 0.4));
  const earliest = now + Math.max(k.lead, Math.round(cycle * 0.2));
  let latest = cycleEnd - win - 300; // leave room for a late tap before the cycle ends
  if (latest < earliest) {
    win = cycleEnd - 300 - earliest;
    if (win < 320) return null;
    latest = earliest;
  }
  const openAt = Math.round(earliest + rand() * (latest - earliest));
  return { id: seq++, kind, openAt, closeAt: openAt + win, lead: k.lead, resolved: false };
}

function planHeat(now, cycleEnd, rand = Math.random) {
  const center = 0.3 + rand() * 0.4;
  return { id: seq++, kind: "heat", openAt: now, closeAt: cycleEnd, period: KINDS.heat.period, center, resolved: false };
}

function compTime(recvAt, rtt) {
  const half = Math.max(0, Math.min(MAX_COMP_MS, (Number(rtt) || 0) / 2));
  return recvAt - half;
}

function judgeGather(ch, recvAt, rtt) {
  const t = compTime(recvAt, rtt);
  return t >= ch.openAt - SLACK_MS && t <= ch.closeAt + SLACK_MS;
}

// Triangle wave 0..1..0 over two periods' halves.
function heatPos(ch, t) {
  const ph = Math.max(0, t - ch.openAt) / ch.period;
  const f = ph % 2;
  return f <= 1 ? f : 2 - f;
}

function judgeHeat(ch, recvAt, rtt) {
  const t = compTime(recvAt, rtt);
  if (t < ch.openAt - SLACK_MS || t > ch.closeAt + SLACK_MS) return { quality: "poor", pos: null };
  const pos = heatPos(ch, t);
  const d = Math.abs(pos - ch.center);
  return { quality: d <= HEAT_PERFECT ? "perfect" : d <= HEAT_FINE ? "fine" : "poor", pos };
}

// Public part of a chance for the client: relative ms so no clock sync is needed.
function publicChance(ch, now) {
  const o = { id: ch.id, kind: ch.kind, in: Math.max(0, ch.openAt - now), win: ch.closeAt - ch.openAt };
  if (ch.kind === "heat") { o.period = ch.period; o.center = Math.round(ch.center * 1000) / 1000; o.perfect = HEAT_PERFECT; o.fine = HEAT_FINE; }
  if (ch.lead) o.lead = ch.lead;
  if (ch.node) o.node = ch.node;
  return o;
}

// Combo multiplier for consecutive good timings: +5% per streak step, max +50%.
function comboMult(streak) { return 1 + Math.min(10, Math.max(0, streak | 0)) * 0.05; }

// ---- daily tasks ----
const DAILY_POOL = [
  { id: "fish", label: "Catch {n} fish", n: [8, 14], gold: 40, xp: { fishing: 140 } },
  { id: "ore", label: "Mine {n} ore", n: [8, 14], gold: 40, xp: { mining: 140 } },
  { id: "logs", label: "Chop {n} logs", n: [8, 14], gold: 40, xp: { woodcutting: 140 } },
  { id: "yarn", label: "Gather {n} yarn", n: [6, 10], gold: 35, xp: { yarn: 120 } },
  { id: "cook", label: "Cook {n} meals", n: [5, 10], gold: 35, xp: { cooking: 120 } },
  { id: "smith", label: "Smelt or smith {n} items", n: [4, 8], gold: 45, xp: { smithing: 140 } },
  { id: "kill", label: "Defeat {n} monsters", n: [3, 6], gold: 50, xp: { combat: 150 } },
  { id: "timing", label: "Land {n} good timings", n: [5, 10], gold: 60, xp: {} },
];

function dayKey(now = Date.now()) { return new Date(now).toISOString().slice(0, 10); }

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry(a) {
  return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Same 3 tasks for everyone on a given UTC day.
function dailyTasksFor(day) {
  const r = mulberry(hashStr("nhl-daily-" + day));
  const pool = DAILY_POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 3).map((t) => {
    const n = t.n[0] + Math.floor(r() * (t.n[1] - t.n[0] + 1));
    return { id: t.id, label: t.label.replace("{n}", n), goal: n, gold: t.gold, xp: t.xp };
  });
}

function normalizeDaily(raw, day) {
  if (!raw || raw.day !== day) return { day, prog: {}, done: {} };
  return { day, prog: { ...(raw.prog || {}) }, done: { ...(raw.done || {}) } };
}

module.exports = {
  KINDS, SLACK_MS, MAX_COMP_MS, HEAT_PERFECT, HEAT_FINE,
  kindForSkill, planGather, planHeat, judgeGather, judgeHeat, heatPos, publicChance, comboMult,
  DAILY_POOL, dayKey, dailyTasksFor, normalizeDaily,
};
