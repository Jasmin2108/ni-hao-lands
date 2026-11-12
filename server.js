// Ni Hao Lands — unofficial fan MMO prototype server.
// Wallet sign-in uses signMessage only. No fund movement, no token purchases. Not financial advice.

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { verifyLaunchToken, LaunchTokenError } = require("@cherrydotfun/miniapp-sdk");
const { WebSocketServer } = require("ws");
const nacl = require("tweetnacl");
const bs58 = require("bs58");
const persist = require("./persist");

const world = require("./world");
const {
  AVATARS, SKILLS, ITEMS, SHOP, PREMIUM_SHOP, HOLDER_SHOP, QUESTS,
  SMELT_RECIPES, SMITH_RECIPES,
  MIHAO_MINT, MIHAO_TOKEN_PROGRAM, DEXSCREENER,
  levelFromXp, emptySkills, normalizeQuests, rollFishKg, isWalkable, pathfind, zoneAt, zoneBlocked, adj, buildWorld,
  combatLevel, equipmentBonuses,
} = world;
const leaderboard = require("./leaderboard");
const MG = require("./minigames");
const PROG = require("./progress");

const PORT = Number(process.env.PORT || 3000);
const CHERRY_APP_ID = process.env.CHERRY_APP_ID || "9fac6fde-1424-40ea-98db-680c3d724931";
const CHERRY_TEST_JWKS = process.env.CHERRY_TEST_JWKS ? JSON.parse(process.env.CHERRY_TEST_JWKS) : null;

const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const SAVE_FILE = path.join(DATA_DIR, "players.json");
const AVATAR_DIR = path.join(DATA_DIR, "avatars");
const MAX_AVATAR_BYTES = 60 * 1024;
const AVATAR_DIM = 128;
const AVATAR_UPLOAD_COOLDOWN_MS = 30000;
const RENAME_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const ADMIN_KEY = (process.env.ADMIN_KEY || "").trim();
const PUBLIC_RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
// $nihala (lowercase ticker) holder perks. Read-only SPL balance checks; nothing is ever signed or sent.
const NIHALA_MINT = "FNkoLTsBFEMjhM6qwUhnRwAzJcSCURfgeEmC1hGcsHao";
const NIHALA_DEXSCREENER = "https://dexscreener.com/solana/8fytcqt1hzjyh2zv26qw6mhkqzasxeugu7i1hzuyutna";
const NIHALA_HOLDER_MIN = 0; // holder = balance strictly greater than this
const NIHALA_CACHE_MS = 7 * 60 * 1000; // RPC result cache (5–10 min)
const NIHALA_RECHECK_MS = Number(process.env.NIHALA_RECHECK_MS) || 8 * 60 * 1000; // periodic re-check for online players
const NIHALA_RARE_CHANCE = process.env.NIHALA_RARE_CHANCE != null ? Number(process.env.NIHALA_RARE_CHANCE) : 0.03;
const NIHALA_DISCLAIMER = "Holder perks are in-game only. Not financial advice. $mihao rewards for holders are planned, not promised.";
const HOLDER_TOOLS = ["golden_cat_rod", "lucky_jade_axe", "lucky_pickaxe"];
const {
  createHolderChecker, wholeTokenBalance, holdsAtLeast, NIHALA_DECIMALS,
} = require("./holders");
const nihalaChecker = createHolderChecker({
  rpc: PUBLIC_RPC, mint: NIHALA_MINT, minBalance: NIHALA_HOLDER_MIN,
  cacheMs: Number(process.env.NIHALA_CACHE_MS) || NIHALA_CACHE_MS,
});

const TICK_MS = 100;
const WALK_SPEED = 4.2; // tiles / second
const CHAT_MAX = 140;
const CHAT_COOLDOWN_MS = 1200;
const CHAT_WINDOW_MS = 15000;
const CHAT_WINDOW_MAX = 6;
const INV_SIZE = 28;
const PLAYER_HP = 20;
// Mob aggro / leash. Mobs only aggro when attacked; these rules make sure they let go.
const AGGRO_GRACE_MS = 45000;   // after a death, mobs won't re-aggro that player for this long
const MOB_LEASH = 9;            // max tiles a mob will stray from its home while chasing
const MOB_GIVEUP = 7;           // drop the chase when the target is this far away
const MOB_CHASE_MAX = 16;       // or after chasing this many tiles in one go
const MOB_SPEED = 2.4;          // tiles/s, deliberately slower than WALK_SPEED so players can escape
const MOB_RETURN_SPEED = 3.2;   // walking home after a reset (still <= WALK_SPEED)
const SAFE_RESPAWN_RADIUS = 10; // no live mob may be this close to the respawn tile
const TEST_HOOKS = process.env.NHL_TEST_HOOKS === "1";
const VIEW_RADIUS = 40;
const STEP_WINDOW_MS = 1000;
const STEP_WINDOW_MAX = 20; // keyboard/joystick step intents per second (excess is dropped)

const PROFANITY = [
  "fuck", "shit", "bitch", "asshole", "cunt", "nigger", "nigga", "faggot",
  "retard", "rape", "slut", "whore", "kike", "spic", "chink",
];

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const uploadByToken = new Map();
const uploadByIp = new Map();
const reportByToken = new Map();
const authByIp = new Map();
const authNonces = new Map();
const SIGNIN_TTL_MS = 5 * 60 * 1000;

function pruneRateMap(map, windowMs) {
  const now = Date.now();
  if (map.size < 800) return;
  for (const [k, t] of map) {
    if (now - t > windowMs * 2) map.delete(k);
  }
}

function hitRateLimit(map, key, windowMs) {
  const now = Date.now();
  const last = map.get(key) || 0;
  if (now - last < windowMs) return true;
  map.set(key, now);
  pruneRateMap(map, windowMs);
  return false;
}

function wouldHitRateLimit(map, key, windowMs) {
  const last = map.get(key) || 0;
  return Date.now() - last < windowMs;
}

function hitWindow(map, key, windowMs, maxHits) {
  const now = Date.now();
  const list = (map.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= maxHits) {
    map.set(key, list);
    return true;
  }
  list.push(now);
  map.set(key, list);
  return false;
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function isCustomAvatarId(id) {
  return persist.isCustomAvatarId(id);
}

function isAllowedAvatar(id) {
  if (AVATARS.some((a) => a.id === id)) return true;
  if (typeof id === "string" && id.startsWith("u:")) {
    return persist.avatarExists(id.slice(2));
  }
  return false;
}

function resolveAvatar(id) {
  return isAllowedAvatar(id) ? id : "classic-paw";
}

function deleteCustomAvatar(avatar) {
  if (typeof avatar !== "string" || !avatar.startsWith("u:")) return;
  persist.removeAvatar(avatar.slice(2)).catch((e) => console.error("[avatar] delete failed", e.message));
}

function signInMessage(pubkey, nonce) {
  return (
    "Ni Hao Lands sign-in\n" +
    "Wallet: " + pubkey + "\n" +
    "Nonce: " + nonce + "\n" +
    "This signature only logs you in. It is not a transaction and costs nothing."
  );
}

function shortWallet(pubkey) {
  if (!pubkey || String(pubkey).length < 8) return "";
  return String(pubkey).slice(0, 4) + "…" + String(pubkey).slice(-4);
}

function isSolanaPubkey(pubkey) {
  try {
    return Buffer.from(bs58.decode(String(pubkey || ""))).length === 32;
  } catch {
    return false;
  }
}

function decodeSignature(signature) {
  if (Buffer.isBuffer(signature)) return signature.length === 64 ? signature : null;
  if (signature && signature.type === "Buffer" && Array.isArray(signature.data)) {
    const buf = Buffer.from(signature.data);
    return buf.length === 64 ? buf : null;
  }
  if (Array.isArray(signature)) {
    const buf = Buffer.from(signature);
    return buf.length === 64 ? buf : null;
  }
  if (typeof signature !== "string" || !signature) return null;
  try {
    const buf = Buffer.from(bs58.decode(signature));
    if (buf.length === 64) return buf;
  } catch {}
  try {
    const buf = Buffer.from(signature, "base64");
    if (buf.length === 64) return buf;
  } catch {}
  try {
    const buf = Buffer.from(signature, "hex");
    if (buf.length === 64) return buf;
  } catch {}
  return null;
}

function verifyWalletSig(pubkey, nonce, signature) {
  const sig = decodeSignature(signature);
  if (!sig || !isSolanaPubkey(pubkey)) return false;
  const msg = Buffer.from(signInMessage(pubkey, nonce), "utf8");
  const pub = Buffer.from(bs58.decode(pubkey));
  try {
    return nacl.sign.detached.verify(new Uint8Array(msg), new Uint8Array(sig), new Uint8Array(pub));
  } catch {
    return false;
  }
}

function uniqueWalletName(preferred, pub) {
  let base = "";
  if (preferred && !validName(preferred)) base = String(preferred).trim();
  if (!base) {
    const compact = String(pub).slice(0, 4) + String(pub).slice(-4);
    base = /^[A-Za-z0-9_]+$/.test(compact) ? compact : ("Hao" + String(pub).slice(0, 4));
  }
  base = base.replace(/[^A-Za-z0-9_]/g, "").slice(0, 12) || "HaoFriend";
  if (!persist.nameTaken(base)) return base;
  for (let i = 1; i < 1000; i++) {
    const n = (base.slice(0, 12) + i).slice(0, 16);
    if (!persist.nameTaken(n)) return n;
  }
  return ("Hao" + crypto.randomBytes(4).toString("hex")).slice(0, 16);
}

function pruneNonces() {
  const now = Date.now();
  for (const [k, exp] of authNonces) {
    if (now > exp) authNonces.delete(k);
  }
}

function pngSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  if (buf[4] !== 0x0d || buf[5] !== 0x0a || buf[6] !== 0x1a || buf[7] !== 0x0a) return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function webpSize(buf) {
  if (!buf || buf.length < 30) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const fourcc = buf.toString("ascii", 12, 16);
  if (fourcc === "VP8X") {
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width, height };
  }
  if (fourcc === "VP8L") {
    if (buf[20] !== 0x2f) return null;
    const bits = buf[21] | (buf[22] << 8) | (buf[23] << 16) | (buf[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === "VP8 ") {
    const end = Math.min(buf.length - 7, 48);
    for (let i = 20; i <= end; i++) {
      if (buf[i] === 0x9d && buf[i + 1] === 0x01 && buf[i + 2] === 0x2a) {
        return {
          width: buf[i + 3] | ((buf[i + 4] & 0x3f) << 8),
          height: buf[i + 5] | ((buf[i + 6] & 0x3f) << 8),
        };
      }
    }
  }
  return null;
}

function parseAvatarDataUrl(image) {
  if (typeof image !== "string" || image.length > 160000) return { error: "Picture is missing or too large." };
  const m = /^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  if (!m) return { error: "Upload a PNG or WebP picture." };
  let buf;
  try { buf = Buffer.from(m[2], "base64"); } catch { return { error: "Picture could not be read." }; }
  if (!buf.length) return { error: "Picture could not be read." };
  if (buf.length > MAX_AVATAR_BYTES) return { error: "Picture must be 60KB or smaller." };
  const kind = m[1];
  const size = kind === "png" ? pngSize(buf) : webpSize(buf);
  if (!size) return { error: "That file is not a valid " + kind.toUpperCase() + " picture." };
  if (size.width !== AVATAR_DIM || size.height !== AVATAR_DIM) {
    return { error: "Picture must be 128×128." };
  }
  return { kind, buf };
}

function adminKeyOk(given) {
  if (!ADMIN_KEY || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_KEY);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function applyAvatar(account, avatar, doSave) {
  account.avatar = avatar;
  persist.upsertAccount(account);
  for (const s of sessions.values()) {
    if (s.account.id === account.id) {
      s.account.avatar = avatar;
      send(s.ws, { type: "me", me: mePayload(s) });
    }
  }
  if (doSave) saveAccounts();
  broadcastState();
}

const staticWorld = buildWorld();
const tiles = staticWorld.tiles;
let nodes = staticWorld.nodes.map((n) => ({ ...n }));
let mobs = staticWorld.mobs.map((m) => ({
  ...m,
  alive: true,
  target: null,
  nextHit: 0,
  nextWander: Date.now() + 1000 + Math.random() * 2000,
  path: [],
  fx: m.x,
  fy: m.y,
  homeX: m.x,
  homeY: m.y,
}));

computeFishAlts();

/** ws -> live session */
const sessions = new Map();
const chatLog = [];
const MAX_CHAT_LOG = 80;

const accounts = {
  get: (token) => persist.getByToken(token),
  has: (token) => !!persist.getByToken(token),
  values: () => persist.allAccounts(),
  get size() { return persist.accountCount(); },
};

function hydrateAccount(a) {
  if (!a) return a;
  a.avatar = resolveAvatar(a.avatar);
  a.skills = { ...emptySkills(), ...(a.skills || {}) };
  a.hp = Math.max(1, Math.min(PLAYER_HP, a.hp || PLAYER_HP));
  if (!Number.isFinite(a.x)) a.x = staticWorld.spawn.x;
  if (!Number.isFinite(a.y)) a.y = staticWorld.spawn.y;
  a.gold = Math.max(0, a.gold | 0);
  if (!Array.isArray(a.inventory)) a.inventory = [];
  if (!a.bank || typeof a.bank !== "object") a.bank = {};
  if (!a.equipped || typeof a.equipped !== "object") a.equipped = {};
  a.biggestFish = Math.max(0, Number(a.biggestFish) || 0);
  a.kills = Math.max(0, a.kills | 0);
  a.periods = leaderboard.normalizePeriods(a.periods);
  a.lastRenamedAt = Math.max(0, Number(a.lastRenamedAt) || 0);
  a.quests = normalizeQuests(a.quests);
  a.daily = a.daily && typeof a.daily === "object" ? a.daily : null;
  a.bestStreak = Math.max(0, a.bestStreak | 0);
  a.meta = PROG.normalizeMeta(a.meta);
  PROG.migrate(a);
  if (a.equipped && a.equipped.hat && !a.equipped.head) {
    a.equipped.head = a.equipped.hat;
    delete a.equipped.hat;
  }
  return a;
}

function createAccount({ name, avatar, wallet, cherryId }) {
  return persist.upsertAccount(hydrateAccount({
    id: persist.newAccountId(),
    wallet: wallet || null,
    cherryId: cherryId || null,
    name: String(name).slice(0, 16),
    avatar: resolveAvatar(avatar),
    x: staticWorld.spawn.x,
    y: staticWorld.spawn.y,
    gold: 40,
    hp: PLAYER_HP,
    skills: emptySkills(),
    inventory: [{ id: "cooked_fish", qty: 2 }],
    bank: {},
    equipped: {},
    biggestFish: 0,
    kills: 0,
    periods: leaderboard.normalizePeriods(null),
    lastRenamedAt: 0,
    quests: normalizeQuests(null),
    created: Date.now(),
  }));
}

function saveAccounts() {
  for (const s of sessions.values()) {
    if (s.account) {
      Object.assign(s.account, snapshot(s));
      persist.upsertAccount(s.account);
    }
  }
  persist.markDirty();
  return persist.save();
}

function snapshot(s) {
  const a = s.account;
  return {
    id: a.id,
    wallet: a.wallet || null,
    cherryId: a.cherryId || null,
    name: a.name,
    avatar: a.avatar,
    x: s.x,
    y: s.y,
    gold: a.gold,
    hp: s.hp,
    skills: a.skills,
    inventory: a.inventory,
    bank: a.bank,
    equipped: a.equipped,
    biggestFish: a.biggestFish || 0,
    kills: a.kills || 0,
    periods: a.periods || leaderboard.normalizePeriods(null),
    lastRenamedAt: Math.max(0, Number(a.lastRenamedAt) || 0),
    quests: a.quests || normalizeQuests(null),
    daily: a.daily || null,
    bestStreak: Math.max(0, a.bestStreak | 0),
    meta: a.meta || null,
    created: a.created,
  };
}

function randToken() {
  return crypto.randomBytes(24).toString("hex");
}

function normalizeNameKey(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const EXTRA_RESERVED_NAMES = [
  "system", "admin", "administrator", "moderator", "mod", "gm", "npc",
  "nihao", "nihaolands", "server",
];

let reservedNameKeys = null;
function reservedKeys() {
  if (reservedNameKeys) return reservedNameKeys;
  const set = new Set(EXTRA_RESERVED_NAMES);
  for (const n of staticWorld.npcs || []) set.add(normalizeNameKey(n.name));
  for (const m of staticWorld.mobs || []) set.add(normalizeNameKey(m.name));
  reservedNameKeys = set;
  return set;
}

function isReservedName(name) {
  const key = normalizeNameKey(name);
  return !!key && reservedKeys().has(key);
}

function validName(name) {
  if (typeof name !== "string") return "Pick a name.";
  const n = name.trim();
  if (n.length < 2 || n.length > 16) return "Name must be 2–16 characters.";
  if (!/^[A-Za-z0-9_]+$/.test(n)) return "Name can only use letters, numbers, and underscores.";
  if (isProfane(n)) return "That name isn't allowed.";
  if (isReservedName(n)) return "That name is reserved.";
  return null;
}

function nameTaken(name, exceptId) {
  return persist.nameTaken(name, exceptId);
}

function isDefaultWalletName(account) {
  if (!account || !account.wallet) return false;
  const name = String(account.name || "");
  const pub = String(account.wallet);
  const short = shortWallet(pub);
  const compact = pub.slice(0, 4) + pub.slice(-4);
  const hao = "Hao" + pub.slice(0, 4);
  return name === short || name === compact || name === hao;
}

function needsNamePick(account) {
  return !!(account && account.wallet && !account.lastRenamedAt && isDefaultWalletName(account));
}

function nextRenameAt(account) {
  const last = account ? (Number(account.lastRenamedAt) || 0) : 0;
  return last ? last + RENAME_COOLDOWN_MS : 0;
}

function renameCooldownMs(account) {
  if (!account) return RENAME_COOLDOWN_MS;
  if (needsNamePick(account)) return 0;
  const last = Number(account.lastRenamedAt) || 0;
  if (!last) return 0;
  return Math.max(0, last + RENAME_COOLDOWN_MS - Date.now());
}

function applyRename(account, rawName) {
  const err = validName(rawName || "");
  if (err) return { error: err, status: 400 };
  const name = String(rawName).trim();
  if (name === account.name) return { error: "That's already your name.", status: 400 };
  if (nameTaken(name, account.id)) return { error: "That name is already in this world.", status: 409 };
  const wait = renameCooldownMs(account);
  if (wait > 0) {
    const hours = Math.max(1, Math.ceil(wait / 3600000));
    return {
      error: "You can change your name again in " + hours + " hour" + (hours === 1 ? "" : "s") + ".",
      status: 429,
      nextRenameAt: nextRenameAt(account),
    };
  }
  const oldName = account.name;
  account.name = name;
  account.lastRenamedAt = Date.now();
  persist.upsertAccount(account);
  persist.markDirty();
  leaderboard.invalidateCache();
  return { ok: true, oldName, name, nextRenameAt: nextRenameAt(account) };
}

function finishRename(account, result) {
  for (const s of sessions.values()) {
    if (s.account && s.account.id === account.id) {
      send(s.ws, { type: "renamed", oldName: result.oldName, name: result.name, me: mePayload(s) });
      toast(s, "You are now known as " + result.name + ".");
    }
  }
  systemChat(result.oldName + " is now known as " + result.name + ".");
  broadcastState();
  saveAccounts();
}

function isProfane(text) {
  const t = " " + text.toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  return PROFANITY.some((w) => t.includes(" " + w + " ") || t.includes(w));
}

function cleanChat(text) {
  let s = String(text || "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (s.length > CHAT_MAX) s = s.slice(0, CHAT_MAX);
  const lower = s.toLowerCase();
  for (const w of PROFANITY) {
    const re = new RegExp(w, "ig");
    if (re.test(s)) s = s.replace(re, "•".repeat(Math.min(w.length, 6)));
  }
  return s;
}

function invCount(inv, itemId) {
  return inv.filter((it) => it && it.id === itemId).reduce((n, it) => n + (it.qty || 1), 0);
}

function invAdd(inv, itemId, qty = 1) {
  const def = ITEMS[itemId];
  if (!def) return false;
  qty = qty | 0;
  if (qty <= 0) return false;
  if (def.stack) {
    const slot = inv.find((it) => it && it.id === itemId);
    if (slot) { slot.qty = (slot.qty || 1) + qty; return true; }
    if (inv.length >= INV_SIZE) return false;
    inv.push({ id: itemId, qty });
    return true;
  }
  for (let i = 0; i < qty; i++) {
    if (inv.length >= INV_SIZE) return i > 0;
    inv.push({ id: itemId, qty: 1 });
  }
  return true;
}

// ---- progression (collection log, story, login streak, weekly event, guide) ----
function gainItem(s, itemId, qty = 1) {
  const ok = invAdd(s.account.inventory, itemId, qty);
  if (ok) onCollect(s, PROG.recordCollect(s.account.meta, itemId, qty));
  return ok;
}
function achv(s, title, sub) { send(s.ws, { type: "fx", kind: "achv", title, sub: sub || "", x: s.x, y: s.y, onMe: true }); }
function onCollect(s, res) {
  if (!res) return;
  persist.markDirty();
  if (res.first) {
    const nm = ITEMS[res.id] ? ITEMS[res.id].name : res.id;
    const m = s.account.meta;
    achv(s, "New in your collection", `${nm}${res.holder ? " (holder bonus)" : ""} · ${PROG.collHave(m)}/${PROG.COLL_TOTAL}`);
  }
  for (const c of res.milestones || []) {
    s.account.gold += c.gold;
    leaderboard.addPeriodGold(s.account, c.gold);
    if (c.title) grantTitle(s, c.title);
    achv(s, `Collection ${c.pct}%`, `+${c.gold} gold${c.title ? " · title: " + c.title : ""}`);
  }
}
function grantTitle(s, t) {
  const m = s.account.meta;
  if (!m.titles.includes(t)) m.titles.push(t);
  m.title = t;
  persist.markDirty();
  broadcastState();
}
function currentWeek(s) { return (TEST_HOOKS && s && s.testWeek) || leaderboard.isoWeekId(); }
function currentDay(s) { return (TEST_HOOKS && s && s.testDay) || MG.dayKey(); }
// Called from every gameplay counter (dailyBump); opts carry details like timing quality.
function progressBump(s, id, n, opts) {
  opts = opts || {};
  const m = s.account.meta, acc = s.account;
  let changed = false;
  const stat = id === "smith" && opts.verb === "smelt" ? "smelt" : id;
  changed = PROG.storyEvent(m, acc, { type: "count", stat, n }) || changed;
  if (id === "fish" && opts.item === "raw_minnow") changed = PROG.storyEvent(m, acc, { type: "count", stat: "minnow", n: 1 }) || changed;
  if (id === "kill" && opts.mobKind === "hound") changed = PROG.storyEvent(m, acc, { type: "count", stat: "hound", n: 1 }) || changed;
  let evId = null, pts = 0;
  if (id === "fish") { evId = "fishing"; pts = opts.good ? 2 : 1; }
  else if (id === "ore") { evId = "ore"; pts = n; }
  else if (id === "cook") { evId = "cook"; pts = opts.quality === "perfect" ? 3 : opts.quality === "fine" ? 2 : 1; }
  else if (id === "logs") { evId = "woods"; pts = n + (opts.good ? 1 : 0); }
  if (evId) {
    const before = (m.event && m.event.score) || 0;
    const hits = PROG.eventScore(m, currentWeek(s), evId, pts);
    if (m.event.score !== before) changed = true;
    for (const t of hits) {
      s.account.gold += t.gold;
      leaderboard.addPeriodGold(s.account, t.gold);
      if (t.xp && t.skill) giveXp(s, t.skill, t.xp);
      if (t.title) grantTitle(s, t.title);
      const ev = PROG.eventFor(currentWeek(s));
      achv(s, `${ev.name} · ${t.pts} points`, `+${t.gold} gold${t.xp ? ` · +${t.xp} xp` : ""}${t.title ? " · title: " + t.title : ""}`);
    }
    eventBoardCache = null;
  }
  if (changed) persist.markDirty();
}
function storyNotify(s, res) {
  if (!res) return false;
  if (res.completed) {
    const ch = res.completed, r = ch.reward;
    s.account.gold += r.gold || 0;
    leaderboard.addPeriodGold(s.account, r.gold || 0);
    for (const [sk, amt] of Object.entries(r.xp || {})) giveXp(s, sk, amt);
    if (r.item) gainItem(s, r.item, 1);
    if (r.title) grantTitle(s, r.title);
    persist.markDirty();
    toast(s, ch.finish);
    achv(s, `Chapter ${ch.n} complete: ${ch.name}`, `+${r.gold} gold${r.item ? " · " + ITEMS[r.item].name : ""}${r.title ? " · title: " + r.title : ""}`);
    const next = PROG.storyChapter(s.account.meta);
    if (next) toast(s, `Next chapter: ${next.name} — ${next.intro}`);
    PROG.storyEvent(s.account.meta, s.account, { type: "visit", zone: zoneAt(s.x, s.y).id });
    send(s.ws, { type: "open", panel: "quests" });
    return true;
  }
  if (res.waiting) { toast(s, `Lantern Festival: first ${res.waiting[0].charAt(0).toLowerCase() + res.waiting[0].slice(1)}.`); return false; }
  if (res.progressed) persist.markDirty();
  return false;
}
function storyVisit(s, zoneId) {
  if (PROG.storyEvent(s.account.meta, s.account, { type: "visit", zone: zoneId })) { persist.markDirty(); send(s.ws, { type: "me", me: mePayload(s) }); }
}
function loginCheck(s) {
  const r = PROG.loginTick(s.account.meta, currentDay(s));
  if (!r) return;
  s.account.gold += r.gold;
  leaderboard.addPeriodGold(s.account, r.gold);
  if (r.item) gainItem(s, r.item, 1);
  persist.markDirty();
  achv(s, r.streak > 1 ? `Welcome back! Day ${r.streak} visit streak` : "Daily visit bonus", `+${r.gold} gold${r.item ? " · River Pearl" : ""}${r.kept ? " · a skipped day didn't break it" : r.streak > 1 ? "" : " · come back tomorrow for a little more"}`);
  send(s.ws, { type: "me", me: mePayload(s) });
}
function progressPayload(s) {
  const m = s.account.meta;
  const week = currentWeek(s);
  const { ev, st } = PROG.eventState(m, week);
  return {
    guide: m.guide,
    coll: m.coll,
    collPct: PROG.collPct(m),
    collHave: PROG.collHave(m),
    collTotal: PROG.COLL_TOTAL,
    story: { ch: m.story.ch, done: m.story.done, objectives: m.story.ch < PROG.STORY.length ? PROG.storyPayload(m, s.account)[m.story.ch].objectives : [] },
    login: { ...m.login, next: PROG.loginReward(m.login.streak + 1) },
    event: { week, id: ev.id, name: ev.name, desc: ev.desc, score: st.score, claimed: st.claimed },
    titles: m.titles,
    title: m.title,
  };
}
// weekly event leaderboard (cached; hidden test names never shown)
let eventBoardCache = null;
function eventBoard(week) {
  if (eventBoardCache && eventBoardCache.week === week && Date.now() - eventBoardCache.at < 15000) return eventBoardCache.rows;
  const rows = [];
  for (const a of persist.allAccounts()) {
    const e = a.meta && a.meta.event;
    if (!e || e.week !== week || !(e.score > 0) || leaderboard.isHiddenName(a.name)) continue;
    rows.push({ id: a.id, name: a.name, avatar: a.avatar, score: e.score, title: (a.meta && a.meta.title) || "" });
  }
  rows.sort((x, y) => y.score - x.score || String(x.name).localeCompare(String(y.name)));
  eventBoardCache = { week, at: Date.now(), rows };
  return rows;
}

// Quest hand-ins accept fine / perfect variants of an item; plain ones are used up first.
function variantIds(itemId) { return [itemId, itemId + "_fine", itemId + "_perfect"].filter((id) => ITEMS[id]); }
function invCountAny(inv, itemId) { return variantIds(itemId).reduce((t, id) => t + invCount(inv, id), 0); }
function invRemoveAny(inv, itemId, qty = 1) {
  let left = qty;
  for (const id of variantIds(itemId)) {
    const take = Math.min(left, invCount(inv, id));
    if (take > 0 && invRemove(inv, id, take)) left -= take;
    if (!left) break;
  }
  return left === 0;
}
function invRemove(inv, itemId, qty = 1) {
  qty = qty | 0;
  if (invCount(inv, itemId) < qty) return false;
  let left = qty;
  for (let i = inv.length - 1; i >= 0 && left > 0; i--) {
    const it = inv[i];
    if (!it || it.id !== itemId) continue;
    const have = it.qty || 1;
    if (have <= left) { left -= have; inv.splice(i, 1); }
    else { it.qty = have - left; left = 0; }
  }
  return true;
}

function publicPlayer(s) {
  const z = zoneAt(s.x, s.y);
  return {
    id: s.id,
    name: s.account.name || shortWallet(s.account.wallet),
    avatar: s.account.avatar,
    x: Math.round(s.x * 100) / 100,
    y: Math.round(s.y * 100) / 100,
    zone: z.name,
    hp: s.hp,
    maxHp: PLAYER_HP,
    equipped: s.account.equipped,
    title: (s.account.meta && s.account.meta.title) || "",
    action: s.action ? s.action.kind : null,
    holder: !!s.holderBadge,
    nihala: isNihalaHolder(s),
    premiumName: !!s.account.equipped?.gold_nametag,
    wallet: s.account.wallet || null,
    walletLabel: shortWallet(s.account.wallet),
    combatLevel: combatLevel(s.account),
    facing: s.facing || "down",
  };
}

function mePayload(s) {
  const skills = {};
  for (const sk of SKILLS) {
    const xp = s.account.skills[sk.id] || 0;
    skills[sk.id] = { xp, ...levelFromXp(xp) };
  }
  return {
    ...publicPlayer(s),
    token: s.token,
    gold: s.account.gold,
    skills,
    inventory: s.account.inventory,
    bank: s.account.bank,
    equipped: s.account.equipped,
    needsName: needsNamePick(s.account),
    nextRenameAt: nextRenameAt(s.account) || null,
    quests: s.account.quests || normalizeQuests(null),
    combatLevel: combatLevel(s.account),
    bonuses: equipmentBonuses(s.account),
    nihalaStatus: nihalaStatusPayload(s),
    streak: s.streak || 0,
    bestStreak: s.account.bestStreak || 0,
    daily: dailyPayload(s),
    graceUntil: s.graceUntil && s.graceUntil > Date.now() ? s.graceUntil - Date.now() : 0,
    progress: progressPayload(s),
  };
}

// ---- daily tasks board (same 3 tasks for everyone per UTC day) ----
let dailyCache = { day: "", tasks: [] };
function todaysTasks() {
  const day = MG.dayKey();
  if (dailyCache.day !== day) dailyCache = { day, tasks: MG.dailyTasksFor(day) };
  return dailyCache;
}
function dailyState(s) {
  const { day } = todaysTasks();
  if (!s.account.daily || s.account.daily.day !== day) s.account.daily = MG.normalizeDaily(s.account.daily, day);
  return s.account.daily;
}
function dailyPayload(s) {
  const d = dailyState(s);
  return {
    day: d.day,
    tasks: todaysTasks().tasks.map((t) => ({ id: t.id, label: t.label, goal: t.goal, gold: t.gold, xp: t.xp, prog: Math.min(t.goal, d.prog[t.id] || 0), done: !!d.done[t.id] })),
  };
}
function dailyBump(s, id, n = 1, opts) {
  if (!n) return;
  progressBump(s, id, n, opts);
  const d = dailyState(s);
  const task = todaysTasks().tasks.find((t) => t.id === id);
  if (!task || d.done[id]) return;
  d.prog[id] = (d.prog[id] || 0) + n;
  persist.markDirty();
  if (d.prog[id] < task.goal) return;
  d.done[id] = true;
  s.account.gold += task.gold;
  leaderboard.addPeriodGold(s.account, task.gold);
  for (const [sk, amt] of Object.entries(task.xp || {})) giveXp(s, sk, amt);
  toast(s, `Daily task done: ${task.label}! +${task.gold} gold.`);
  send(s.ws, { type: "fx", kind: "task", id, x: s.x, y: s.y, onMe: true });
}

// ---- streaks for good timings ----
function streakUp(s) {
  s.streak = (s.streak || 0) + 1;
  if (s.streak > (s.account.bestStreak || 0)) { s.account.bestStreak = s.streak; persist.markDirty(); }
  dailyBump(s, "timing", 1);
}
function streakReset(s) { s.streak = 0; }

// ---------- $nihala holder perks ----------
function isNihalaHolder(s) {
  return !!(s && s.account && s.account.wallet && s.nihala && s.nihala.holder && s.nihala.owner === s.account.wallet);
}
function formatHold(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function signedNihalaStatus(s) {
  return (s && s.account && s.account.wallet && s.nihala && s.nihala.owner === s.account.wallet) ? s.nihala : null;
}
function canUseHolderItem(s, def) {
  if (!def || !def.holderOnly) return true;
  const st = signedNihalaStatus(s);
  if (!st) return false;
  const need = def.holdMin || 0;
  if (need <= 0) return isNihalaHolder(s);
  return holdsAtLeast(st, need);
}
function shopUnlocked(s, hold) {
  const st = signedNihalaStatus(s);
  return !!(st && holdsAtLeast(st, hold));
}
function nihalaStatusPayload(s) {
  const st = s.nihala;
  const signedIn = !!s.account.wallet;
  const mine = signedNihalaStatus(s);
  return {
    signedIn,
    holder: isNihalaHolder(s),
    balance: mine ? st.balance : 0,
    balanceWhole: mine ? wholeTokenBalance(st).toString() : "0",
    checkedAt: st ? st.checkedAt : null,
    checking: !!s.nihalaChecking,
    error: st && st.error ? "Balance check unavailable right now; will retry." : null,
    tools: HOLDER_TOOLS.map((id) => ({ id, name: ITEMS[id].name, owned: ownsItem(s.account, id) })),
    shop: HOLDER_SHOP.map((o) => ({
      itemId: o.itemId,
      name: ITEMS[o.itemId].name,
      hold: o.hold,
      owned: ownsItem(s.account, o.itemId),
      unlocked: shopUnlocked(s, o.hold),
    })),
  };
}
function ownsItem(account, id) {
  return (account.inventory || []).some((i) => i.id === id) || !!(account.bank && account.bank[id] > 0) ||
    Object.values(account.equipped || {}).includes(id);
}
async function refreshNihala(s, force = false) {
  const owner = s.account.wallet;
  if (!owner || s.nihalaChecking) return;
  s.nihalaChecking = true;
  const was = isNihalaHolder(s);
  try {
    s.nihala = await nihalaChecker.check(owner, { force });
  } catch (e) {
    s.nihala = { owner, holder: false, balance: 0, checkedAt: Date.now(), error: String(e.message || e) };
  } finally {
    s.nihalaChecking = false;
    s.nihalaNextCheck = Date.now() + NIHALA_RECHECK_MS;
  }
  if (!sessionsHas(s)) return;
  const now = isNihalaHolder(s);
  const stripped = enforceHolderEquipment(s);
  if (now && !was) toast(s, "nihala holder perks active: holder badge, holder tools and rare finds.");
  if (!now && was) toast(s, "Your $nihala balance reads 0, so holder perks are paused.");
  send(s.ws, { type: "me", me: mePayload(s) });
  if (now !== was || stripped) broadcastState();
}
function enforceHolderEquipment(s) {
  const eq = s.account.equipped || {};
  let changed = false;
  for (const [slot, id] of Object.entries(eq)) {
    const def = ITEMS[id];
    if (!def || !def.holderOnly || canUseHolderItem(s, def)) continue;
    delete eq[slot];
    changed = true;
    const need = def.holdMin || 0;
    toast(s, need
      ? `The ${def.name} is unequipped. Hold ${formatHold(need)} $nihala to use it again.`
      : `The ${def.name} is unequipped. Holder perks are paused.`);
  }
  if (changed) persist.markDirty();
  return changed;
}
function unlockHolderShopItem(s, itemId) {
  const offer = HOLDER_SHOP.find((o) => o.itemId === itemId);
  if (!offer) { toast(s, "The holder shop doesn't have that."); return; }
  const def = ITEMS[itemId];
  if (!s.account.wallet) { toast(s, "Sign in with a wallet to check $nihala and unlock by holding."); return; }
  if (!shopUnlocked(s, offer.hold)) {
    toast(s, `Hold ${formatHold(offer.hold)} $nihala to unlock the ${def.name}. Nothing is spent.`);
    return;
  }
  if (ownsItem(s.account, itemId)) { toast(s, `You already have the ${def.name}.`); return; }
  if (!gainItem(s, itemId, 1)) { toast(s, "Your inventory is full."); return; }
  toast(s, `You unlock the ${def.name} by holding ${formatHold(offer.hold)} $nihala. It works while you keep holding enough. Nothing was spent.`);
  send(s.ws, { type: "me", me: mePayload(s) });
}
function sessionsHas(s) { return sessions.get(s.ws) === s; }
function claimHolderTool(s, itemId) {
  if (!HOLDER_TOOLS.includes(itemId)) { toast(s, "That isn't a holder tool."); return; }
  if (!isNihalaHolder(s)) { toast(s, "Holder tools need a wallet sign-in holding $nihala."); return; }
  if (ownsItem(s.account, itemId)) { toast(s, `You already have the ${ITEMS[itemId].name}.`); return; }
  if (!gainItem(s, itemId, 1)) { toast(s, "Your inventory is full."); return; }
  toast(s, `You receive the ${ITEMS[itemId].name}. Holder perk, in-game only.`);
  send(s.ws, { type: "me", me: mePayload(s) });
}
const HOLDER_DROPS = { fishing: "raw_lucky_koi", mining: "lucky_cat_gem", woodcutting: "golden_bamboo", yarn: "golden_yarn" };
function rollHolderDrop(s, node) {
  if (!isNihalaHolder(s)) return null;
  const drop = HOLDER_DROPS[node.skill];
  if (!drop || Math.random() >= NIHALA_RARE_CHANCE) return null;
  if (!gainItem(s, drop, 1)) return null;
  if (drop === "raw_lucky_koi") {
    // a bigger golden koi; kept off the fish leaderboard so it stays fair
    const kg = Math.round(rollFishKg("golden_koi") * 1.15 * 10) / 10;
    return `Lucky! A ${kg.toFixed(1)} kg Lucky Golden Koi bites too (holder rare find).`;
  }
  return `Lucky! You also find ${ITEMS[drop].name} (holder rare find).`;
}

function compactNodes() {
  return nodes.map((n) => ({
    id: n.id, type: n.type, x: n.x, y: n.y,
    depleted: !!n.depleted, skill: n.skill,
    level: n.level || 1, label: n.label || n.type,
    resource: n.resource || null, action: n.action || null,
    charges: n.depleted ? 0 : (n.charges || 0),
    rockX: n.rockX != null ? n.rockX : null, rockY: n.rockY != null ? n.rockY : null,
  }));
}

function compactMobs() {
  return mobs.map((m) => ({
    id: m.id, name: m.name, kind: m.kind || "dog",
    level: m.level || 1,
    x: Math.round(m.fx * 100) / 100, y: Math.round(m.fy * 100) / 100,
    hp: m.hp, maxHp: m.maxHp, alive: m.alive,
  }));
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(msg, except) {
  const raw = JSON.stringify(msg);
  for (const [ws] of sessions) {
    if (ws !== except && ws.readyState === 1) ws.send(raw);
  }
}

function nearbyOf(s, list, radius = VIEW_RADIUS) {
  return list.filter((o) => Math.hypot((o.x - s.x), (o.y - s.y)) <= radius);
}

// State updates are coalesced: callers mark the world dirty and the tick flushes at most once per TICK_MS.
let stateDirty = false;
function broadcastState() { stateDirty = true; }

// Delta protocol (hello {proto: 2}): only changed entities within DELTA_RADIUS, positions as compact arrays.
const DELTA_RADIUS = 26;
const FACE_CODE = { down: 0, up: 1, left: 2, right: 3 };
function playerPosKey(pp) { return pp.x + "," + pp.y + "," + pp.facing + "," + (pp.action || "") + "," + pp.hp; }
function playerRestKey(pp) {
  return JSON.stringify([pp.name, pp.avatar, pp.zone, pp.maxHp, pp.equipped, pp.holder, pp.nihala, pp.premiumName, pp.wallet, pp.walletLabel, pp.combatLevel, pp.title]);
}
function flushState() {
  stateDirty = false;
  const now = Date.now();
  const allNodes = compactNodes();
  const allMobs = compactMobs();
  const everyone = [...sessions.values()];
  const pub = new Map();
  for (const o of everyone) pub.set(o.id, publicPlayer(o));
  for (const s of everyone) {
    if (!s.ws || s.ws.readyState !== 1) continue;
    if (s.proto === 2) { sendDelta(s, everyone, pub, allNodes, allMobs, now); continue; }
    const players = everyone
      .filter((o) => o.id === s.id || Math.hypot(o.x - s.x, o.y - s.y) <= VIEW_RADIUS)
      .map((o) => pub.get(o.id));
    send(s.ws, {
      type: "state",
      players,
      nodes: nearbyOf(s, allNodes),
      mobs: nearbyOf(s, allMobs),
      t: now,
    });
  }
}
function sendDelta(s, everyone, pub, allNodes, allMobs, now) {
  const sent = s.sent || (s.sent = { p: new Map(), n: new Map(), m: new Map() });
  const msg = { type: "delta", t: now };
  let any = false;
  // players
  const seenP = new Set();
  for (const o of everyone) {
    if (o.id !== s.id && Math.abs(o.x - s.x) > DELTA_RADIUS && Math.abs(o.y - s.y) > DELTA_RADIUS) continue;
    if (o.id !== s.id && Math.hypot(o.x - s.x, o.y - s.y) > DELTA_RADIUS) continue;
    seenP.add(o.id);
    const pp = pub.get(o.id);
    const rest = playerRestKey(pp), pos = playerPosKey(pp);
    const prev = sent.p.get(o.id);
    if (!prev || prev.rest !== rest) {
      (msg.p || (msg.p = [])).push(pp); any = true;
      sent.p.set(o.id, { rest, pos });
    } else if (prev.pos !== pos) {
      (msg.q || (msg.q = [])).push([o.id, pp.x, pp.y, FACE_CODE[pp.facing] || 0, pp.action || 0, pp.hp]); any = true;
      prev.pos = pos;
    }
  }
  for (const id of sent.p.keys()) if (!seenP.has(id)) { (msg.pr || (msg.pr = [])).push(id); sent.p.delete(id); any = true; }
  // nodes: depletion/charges change; fishing spots also move on respawn (wider radius for the minimap)
  const seenN = new Set();
  for (const e of allNodes) {
    if (Math.abs(e.x - s.x) > VIEW_RADIUS || Math.abs(e.y - s.y) > VIEW_RADIUS) continue;
    seenN.add(e.id);
    const key = e.depleted + "," + e.charges + "," + e.x + "," + e.y;
    if (sent.n.get(e.id) !== key) { (msg.n || (msg.n = [])).push(e); sent.n.set(e.id, key); any = true; }
  }
  for (const id of sent.n.keys()) if (!seenN.has(id)) { (msg.nr || (msg.nr = [])).push(id); sent.n.delete(id); any = true; }
  // mobs: full record when hp/alive changes, compact [id,x,y] when only moving
  const seenM = new Set();
  for (const e of allMobs) {
    if (Math.abs(e.x - s.x) > DELTA_RADIUS || Math.abs(e.y - s.y) > DELTA_RADIUS) continue;
    seenM.add(e.id);
    const rest = e.hp + "," + e.maxHp + "," + e.alive + "," + e.level + "," + e.name, pos = e.x + "," + e.y;
    const prev = sent.m.get(e.id);
    if (!prev || prev.rest !== rest) { (msg.m || (msg.m = [])).push(e); sent.m.set(e.id, { rest, pos }); any = true; }
    else if (prev.pos !== pos) { (msg.mq || (msg.mq = [])).push([e.id, e.x, e.y]); prev.pos = pos; any = true; }
  }
  for (const id of sent.m.keys()) if (!seenM.has(id)) { (msg.mr || (msg.mr = [])).push(id); sent.m.delete(id); any = true; }
  if (any || now - (s.lastDeltaAt || 0) > 2000) { s.lastDeltaAt = now; send(s.ws, msg); }
}

function systemChat(text) {
  const entry = { from: "system", text, ts: Date.now(), system: true };
  chatLog.push(entry);
  if (chatLog.length > MAX_CHAT_LOG) chatLog.shift();
  broadcast({ type: "chat", ...entry });
}

function toast(s, text) {
  send(s.ws, { type: "toast", text });
}

function giveXp(s, skill, amount) {
  amount = amount | 0;
  if (amount <= 0) return;
  s.account.skills[skill] = (s.account.skills[skill] || 0) + amount;
  leaderboard.addPeriodXp(s.account, skill, amount);
  const before = levelFromXp(s.account.skills[skill] - amount);
  const after = levelFromXp(s.account.skills[skill]);
  if (after.level > before.level) {
    const sk = SKILLS.find((k) => k.id === skill);
    const label = sk ? sk.name : skill;
    toast(s, `${label} level ${after.level}!`);
    systemChat(`${s.account.name} reached ${label} level ${after.level}.`);
    send(s.ws, { type: "levelup", skill, name: label, level: after.level });
  }
}

function startAction(s, kind, target, duration) {
  s.action = { kind, target, started: Date.now(), duration, next: Date.now() + duration };
  s.path = [];
}

function cancelAction(s) {
  s.action = null;
  s.targetMob = null;
}

function skillLevelOf(account, skill) {
  return levelFromXp((account.skills && account.skills[skill]) || 0).level;
}
PROG.setLevelFn(skillLevelOf);

function invHasRoom(inv, itemId) {
  if (inv.length < INV_SIZE) return true;
  const def = ITEMS[itemId];
  return !!(def && def.stack && invCount(inv, itemId) > 0);
}

function bestTool(account, kind, session) {
  if (!kind) return null;
  let best = null;
  const skill = kind === "pickaxe" ? "mining" : kind === "axe" ? "woodcutting" : kind === "rod" ? "fishing" : null;
  const lvl = skill ? skillLevelOf(account, skill) : 99;
  const consider = (id) => {
    const def = ITEMS[id];
    if (!def || def.tool !== kind) return;
    if ((def.toolLevel || 1) > lvl) return;
    if (def.holderOnly && !canUseHolderItem(session, def)) return;
    const betterTier = (def.toolTier || 0) > (best && best.toolTier || 0);
    const betterSpeed = (def.toolTier || 0) === (best && best.toolTier || 0) && (def.toolSpeed || 1) < (best && best.toolSpeed || 1);
    if (!best || betterTier || betterSpeed) best = def;
  };
  for (const it of account.inventory || []) consider(it.id);
  for (const id of Object.values(account.equipped || {})) consider(id);
  return best;
}

function toolKindFor(node) {
  if (!node) return null;
  if (node.skill === "mining" || node.type === "ore") return "pickaxe";
  if (node.skill === "woodcutting" || node.type === "tree") return "axe";
  if (node.skill === "fishing" || node.type === "fish") return "rod";
  return null;
}

function gatherDuration(s, node) {
  let time = node.time || 2400;
  const kind = toolKindFor(node);
  const tool = kind ? bestTool(s.account, kind, s) : null;
  if (tool && tool.toolSpeed) time = Math.round(time * tool.toolSpeed);
  else if ((node.toolTier || 0) <= 1 && kind) time = Math.round(time * 1.25);
  return Math.max(600, time);
}

function canStartGather(s, node) {
  if (!node || node.type === "range" || node.type === "furnace" || node.type === "anvil" || node.type === "board") return "Nothing happens.";
  if (node.depleted || (node.charges || 0) <= 0) return "Nothing there right now.";
  const need = node.level || 1;
  if (need > 1 && skillLevelOf(s.account, node.skill) < need) {
    const sk = SKILLS.find((k) => k.id === node.skill);
    return `You need ${sk ? sk.name : node.skill} level ${need}.`;
  }
  const kind = toolKindFor(node);
  if (kind && (node.toolTier || 0) >= 2) {
    const tool = bestTool(s.account, kind, s);
    if (!tool || (tool.toolTier || 0) < node.toolTier) {
      return `You need a better ${kind} for this.`;
    }
  }
  if (!invHasRoom(s.account.inventory, node.item)) return "Your inventory is full.";
  return null;
}

function recipeInputsOk(account, recipe) {
  if (!recipe || !recipe.inputs) return false;
  if (skillLevelOf(account, "smithing") < (recipe.level || 1)) return false;
  for (const [id, qty] of Object.entries(recipe.inputs)) {
    if (invCount(account.inventory, id) < qty) return false;
  }
  return true;
}

function availableRecipes(account, list) {
  return list.filter((r) => recipeInputsOk(account, r));
}

function pickRecipe(account, list, recipeId, product) {
  const pool = availableRecipes(account, list);
  if (recipeId) return pool.find((r) => r.id === recipeId || r.product === recipeId) || null;
  if (product) return pool.find((r) => r.product === product) || null;
  // Prefer the highest-level recipe the player can currently make.
  return pool.slice().sort((a, b) => (b.level || 0) - (a.level || 0))[0] || null;
}

function consumeInputs(account, recipe) {
  for (const [id, qty] of Object.entries(recipe.inputs)) {
    if (!invRemove(account.inventory, id, qty)) return false;
  }
  return true;
}

function restoreInputs(account, recipe) {
  for (const [id, qty] of Object.entries(recipe.inputs)) invAdd(account.inventory, id, qty);
}

function talkQuest(s, npc) {
  const quest = QUESTS.find((q) => q.giver === npc.id);
  if (!quest) return false;
  s.account.quests = normalizeQuests(s.account.quests);
  const st = s.account.quests[quest.id] || { step: 0, done: false };
  if (st.done) {
    toast(s, "Thank you again, friend.");
    return true;
  }
  if (st.step <= 0) {
    st.step = 1;
    s.account.quests[quest.id] = st;
    persist.markDirty();
    toast(s, quest.start);
    send(s.ws, { type: "me", me: mePayload(s) });
    send(s.ws, { type: "open", panel: "quests" });
    return true;
  }
  const need = quest.need || {};
  const missing = Object.entries(need).filter(([id, qty]) => invCountAny(s.account.inventory, id) < qty);
  if (missing.length) {
    toast(s, quest.waiting);
    return true;
  }
  for (const [id, qty] of Object.entries(need)) invRemoveAny(s.account.inventory, id, qty);
  const reward = quest.reward || {};
  if (reward.gold) {
    s.account.gold += reward.gold;
    leaderboard.addPeriodGold(s.account, reward.gold);
  }
  if (reward.item) gainItem(s, reward.item, 1);
  if (reward.xp) {
    for (const [sk, amt] of Object.entries(reward.xp)) giveXp(s, sk, amt);
  }
  st.step = 2;
  st.done = true;
  s.account.quests[quest.id] = st;
  persist.markDirty();
  toast(s, quest.finish);
  send(s.ws, { type: "me", me: mePayload(s) });
  send(s.ws, { type: "open", panel: "quests" });
  return true;
}

function interact(s, targetId, extra) {
  extra = extra || {};
  const npc = staticWorld.npcs.find((n) => n.id === targetId);
  if (npc) {
    walkThen(s, npc.x, npc.y, () => {
      if (npc.role === "bank") send(s.ws, { type: "open", panel: "bank" });
      else if (npc.role === "shop") send(s.ws, { type: "open", panel: "shop" });
      else if (npc.role === "cook") toast(s, "Click the cooking range to cook raw fish.");
      else if (npc.role === "smith") toast(s, "Use the furnace to smelt ore, then the anvil to smith bars into tools.");
      const story = PROG.storyTalk(s.account.meta, s.account, npc.id);
      const storyDone = storyNotify(s, story);
      const quested = storyDone || talkQuest(s, npc) || !!(story && (story.waiting || story.progressed));
      if (story) send(s.ws, { type: "me", me: mePayload(s) });
      if (!quested && npc.role !== "bank" && npc.role !== "shop" && npc.role !== "cook" && npc.role !== "smith") {
        toast(s, "你好，朋友. Grind, bank, and be kind.");
      }
      send(s.ws, { type: "examine", text: npc.examine });
    });
    return;
  }
  const node = nodes.find((n) => n.id === targetId);
  if (node) {
    walkThen(s, node.x, node.y, () => beginNode(s, node, extra));
    return;
  }
  const mob = mobs.find((m) => m.id === targetId && m.alive);
  if (mob) {
    s.targetMob = mob.id;
    walkThen(s, Math.round(mob.fx), Math.round(mob.fy), () => {
      s.targetMob = mob.id;
      startAction(s, "combat", mob.id, 1200);
    });
  }
}

// Players route around zones they haven't unlocked instead of being refused when the straight route crosses one.
function canEnterFn(s) {
  const cache = new Map();
  return (x, y) => {
    const z = zoneAt(x, y);
    if (!cache.has(z.id)) cache.set(z.id, !zoneBlocked(z, s.account));
    return cache.get(z.id);
  };
}
function pathBlockedFor(s, path) {
  for (const step of path) {
    const err = zoneBlocked(zoneAt(step.x, step.y), s.account);
    if (err) return err;
  }
  return null;
}

function walkThen(s, tx, ty, cb) {
  const px = Math.round(s.x), py = Math.round(s.y);
  if (adj(px, py, tx, ty) || (px === tx && py === ty)) {
    s.path = [];
    cb && cb();
    return;
  }
  let dest = null;
  if (isWalkable(tiles, tx, ty) && (px !== tx || py !== ty)) dest = { x: tx, y: ty };
  if (!dest) {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = tx + dx, y = ty + dy;
      if (isWalkable(tiles, x, y)) { dest = { x, y }; break; }
    }
  }
  if (!dest) { toast(s, "Can't reach that."); return; }
  const gate = zoneBlocked(zoneAt(dest.x, dest.y), s.account);
  if (gate) { toast(s, gate); return; }
  const path = pathfind(tiles, s.x, s.y, dest.x, dest.y, 1200, canEnterFn(s));
  if (!path.length) { toast(s, "No path."); return; }
  const blocked = pathBlockedFor(s, path);
  if (blocked) { toast(s, blocked); return; }
  s.path = path;
  s.pending = cb || null;
  s.action = null;
  s.stepMode = false;
  s.nextStep = null;
}

function rawFishOptions(account) {
  const out = [];
  for (const def of Object.values(ITEMS)) {
    if (!def || !def.cook) continue;
    const have = invCount(account.inventory, def.id);
    if (have <= 0) continue;
    out.push({ raw: def, cooked: ITEMS[def.cook], have, level: def.cookLevel || 1, xp: def.cookXp || 20, time: def.cookTime || 1800 });
  }
  return out.sort((a, b) => b.level - a.level);
}

function beginNode(s, node, extra) {
  extra = extra || {};
  if (node.type === "board") {
    if (PROG.storyEvent(s.account.meta, s.account, { type: "board" })) persist.markDirty();
    const d = dailyPayload(s);
    const left = d.tasks.filter((t) => !t.done).length;
    toast(s, left ? `Daily tasks: ${left} left today. Rewards are paid automatically.` : "All daily tasks done today. New ones at 00:00 UTC.");
    send(s.ws, { type: "me", me: mePayload(s) });
    send(s.ws, { type: "open", panel: "quests" });
    return;
  }
  if (node.type === "range") {
    const opts = rawFishOptions(s.account).filter((o) => skillLevelOf(s.account, "cooking") >= o.level);
    if (!opts.length) {
      const any = rawFishOptions(s.account);
      if (!any.length) toast(s, "You need raw fish to cook.");
      else toast(s, `You need Cooking level ${any[0].level} to cook ${any[0].raw.name}.`);
      return;
    }
    const pick = extra.recipe ? opts.find((o) => o.raw.id === extra.recipe || o.cooked.id === extra.recipe) : opts[0];
    const use = pick || opts[0];
    startAction(s, "cook", node.id, use.time);
    s.action.recipe = use.raw.id;
    toast(s, `You start cooking ${use.raw.name}...`);
    return;
  }
  if (node.type === "furnace" || node.type === "anvil") {
    const list = node.type === "furnace" ? SMELT_RECIPES : SMITH_RECIPES;
    const recipe = pickRecipe(s.account, list, extra.recipe, extra.product);
    if (!recipe) {
      toast(s, node.type === "furnace" ? "You don't have ore to smelt, or the level for it." : "You don't have bars to smith, or the level for it.");
      return;
    }
    if (!invHasRoom(s.account.inventory, recipe.product) && !ITEMS[recipe.product]?.stack) {
      toast(s, "Your inventory is full.");
      return;
    }
    const kind = node.type === "furnace" ? "smelt" : "smith";
    startAction(s, kind, node.id, recipe.time || 2000);
    s.action.recipe = recipe.id || recipe.product;
    toast(s, "You start " + (recipe.label || kind) + "...");
    return;
  }
  const err = canStartGather(s, node);
  if (err) { toast(s, err); return; }
  startAction(s, "gather", node.id, gatherDuration(s, node));
  const sk = SKILLS.find((k) => k.id === node.skill);
  toast(s, `You start ${sk ? sk.verb : "working"}...`);
}

function pickWeighted(list) {
  let r = Math.random() * list.reduce((t, e) => t + e[1], 0);
  for (const [id, w] of list) { r -= w; if (r <= 0) return id; }
  return list[list.length - 1][0];
}
function finishGather(s, node) {
  if (!node || node.type === "range" || node.type === "furnace" || node.type === "anvil" || node.type === "board") return;
  const bonus = (s.action && s.action.bonus) || null;
  if (s.action) s.action.bonus = null;
  const good = !!(bonus && bonus.ok);
  const err = canStartGather(s, node);
  if (err) { toast(s, err); cancelAction(s); return; }
  if (!gainItem(s, node.item, 1)) {
    toast(s, "Your inventory is full.");
    cancelAction(s);
    return;
  }
  node.charges = Math.max(0, (node.charges || 1) - 1);
  const item = ITEMS[node.item];
  let xp = node.xp || 20;
  let note = `You get ${item ? item.name : node.item}.`;
  const extras = [];
  const addExtra = (id, qty = 1) => { let got = 0; for (let i = 0; i < qty; i++) if (gainItem(s, id, 1)) got++; if (got) extras.push(got > 1 ? `${got}× ${ITEMS[id] ? ITEMS[id].name : id}` : (ITEMS[id] ? ITEMS[id].name : id)); return got; };
  let shower = false, rareFind = false;
  const sk = node.skill;
  if ((node.item && String(node.item).startsWith("raw_")) || node.type === "fish") {
    let kg = rollFishKg(node.resource);
    if (good) { kg = Math.round(kg * 1.35 * 10) / 10; xp *= 2; }
    leaderboard.addPeriodFish(s.account, kg);
    const prev = Number(s.account.biggestFish) || 0;
    const fishName = item ? item.name.replace(/^Raw /, "") : "fish";
    if (kg > prev) { s.account.biggestFish = kg; note = `You catch a ${kg.toFixed(1)} kg ${fishName} — new personal best!`; }
    else note = `You catch a ${kg.toFixed(1)} kg ${fishName}.`;
    if (good) note = "Perfect strike! " + note + " (2× xp)";
    if (good && Math.random() < 0.2) addExtra(node.item, 1);
    if (good && Math.random() < 0.04) { addExtra("raw_moon_koi", 1); rareFind = true; }
    if (Math.random() < (good ? 0.07 : 0.04)) {
      const t = pickWeighted([["old_boot", 45], ["message_bottle", 35], ["pearl", 20]]);
      addExtra(t, 1);
      if (t === "old_boot") note += " ...and an old boot. Classic.";
      else rareFind = true;
    }
    dailyBump(s, "fish", 1, { good, item: node.item });
  } else if (sk === "mining") {
    if (good) {
      xp *= 1.5;
      addExtra(node.item, 1);
      note = "Weak point! " + note;
      if ((s.streak || 0) >= 3 && Math.random() < 0.3) { shower = true; addExtra(node.item, 2); note += " Rock shower!"; }
    }
    if (Math.random() < (good ? 0.04 : 0.015)) { addExtra(pickWeighted([["sapphire", 50], ["emerald", 30], ["ruby", 20]]), 1); rareFind = true; }
    dailyBump(s, "ore", 1 + (good ? 1 : 0) + (shower ? 2 : 0));
  } else if (sk === "woodcutting") {
    let logs = 1;
    if (good) {
      xp *= 1.5;
      if (Math.random() < 0.35) logs += addExtra(node.item, 1);
      note = `Clean chop! (combo ${s.streak || 1}) ` + note;
      if ((s.streak || 0) > 0 && s.streak % 5 === 0) { logs += addExtra(node.item, 2); note += " Timber combo!"; shower = true; }
    }
    if (Math.random() < 0.025) { addExtra("bird_nest", 1); rareFind = true; }
    else if (Math.random() < 0.03) addExtra("tree_seed", 1);
    dailyBump(s, "logs", logs, { good });
  } else if (sk === "yarn") {
    if (Math.random() < 0.06) { addExtra(pickWeighted([["rose_yarn", 40], ["sky_yarn", 40], ["rainbow_yarn", 20]]), 1); rareFind = true; }
    dailyBump(s, "yarn", 1);
  }
  giveXp(s, node.skill, Math.round(xp * (good ? MG.comboMult(s.streak) : 1)));
  if (extras.length) note += ` Bonus: ${extras.join(", ")}.`;
  toast(s, note);
  const rare = rollHolderDrop(s, node);
  if (rare) toast(s, rare);
  send(s.ws, { type: "fx", kind: "gather", skill: sk, good, shower, rare: rareFind || !!rare, x: node.x, y: node.y, node: node.id, onMe: true });
  send(s.ws, { type: "me", me: mePayload(s) });
  if (node.charges > 0) {
    const nextErr = canStartGather(s, node);
    if (nextErr) { toast(s, nextErr); cancelAction(s); return; }
    s.action.next = Date.now() + gatherDuration(s, node);
    return;
  }
  node.depleted = true;
  node.respawnAt = Date.now() + (node.respawn || 15000);
  if (node.type === "fish") toast(s, "The fish scatter. The spot will reappear somewhere nearby.");
  cancelAction(s);
}

// Fishing spots drift: each respawn picks one of the shore tiles near the original spot.
function computeFishAlts() {
  const isW = (x, y) => { const t = tiles[y] && tiles[y][x]; return t === "water" || t === "deepwater"; };
  const npcAt = (x, y) => staticWorld.npcs.some((n) => n.x === x && n.y === y);
  for (const n of nodes) {
    if (n.type !== "fish") continue;
    n.homeX = n.x; n.homeY = n.y;
    const z = zoneAt(n.x, n.y).id;
    const alts = [{ x: n.x, y: n.y }];
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = n.x + dx, y = n.y + dy;
      if ((!dx && !dy) || !isWalkable(tiles, x, y) || npcAt(x, y)) continue;
      if (!(isW(x + 1, y) || isW(x - 1, y) || isW(x, y + 1) || isW(x, y - 1))) continue;
      if (zoneAt(x, y).id !== z) continue;
      if (nodes.some((o) => o !== n && o.x === x && o.y === y)) continue;
      alts.push({ x, y });
    }
    n.alts = alts;
  }
}
function relocateFishSpot(n) {
  const free = n.alts.filter((a) => !nodes.some((o) => o !== n && o.x === a.x && o.y === a.y) && !(a.x === n.x && a.y === n.y));
  if (!free.length) return;
  const a = free[Math.floor(Math.random() * free.length)];
  n.x = a.x; n.y = a.y;
}

// ---- timing chances: server plans a window per action cycle and judges taps by its own clock ----
function ensureChance(s, now) {
  const a = s.action;
  const ch = s.chance;
  if (ch && !ch.resolved && now > ch.closeAt + MG.SLACK_MS + MG.MAX_COMP_MS) {
    ch.resolved = true;
    if (ch.kind !== "heat") { streakReset(s); send(s.ws, { type: "chanceEnd", id: ch.id, ok: false, missed: true, streak: 0 }); }
  }
  if (!a || !(a.kind === "gather" || a.kind === "cook" || a.kind === "smith")) {
    if (ch && !ch.resolved) { ch.resolved = true; send(s.ws, { type: "chanceEnd", id: ch.id, ok: false, cancelled: true, streak: s.streak || 0 }); }
    if (ch && ch.resolved) s.chance = null;
    return;
  }
  if (a.chanceFor === a.next) return;
  a.chanceFor = a.next;
  let next = null;
  if (a.kind === "gather") {
    const node = nodes.find((n) => n.id === a.target);
    const kind = node && MG.kindForSkill(node.skill);
    if (kind) next = MG.planGather(kind, now, a.next, Math.random, s.testChanceRate);
    if (next) next.node = node.id;
  } else {
    next = MG.planHeat(now, a.next);
  }
  if (ch && !ch.resolved) { ch.resolved = true; if (ch.kind !== "heat") streakReset(s); }
  s.chance = next;
  if (next) send(s.ws, { type: "chance", ...MG.publicChance(next, now) });
}

function onHit(s, id) {
  const now = Date.now();
  const ch = s.chance;
  if (!ch || ch.id !== id || ch.resolved || !s.action) return;
  ch.resolved = true;
  let ok, quality = null;
  if (ch.kind === "heat") {
    quality = MG.judgeHeat(ch, now, s.rtt).quality;
    ok = quality !== "poor";
  } else {
    ok = MG.judgeGather(ch, now, s.rtt);
  }
  if (ok) streakUp(s); else streakReset(s);
  s.action.bonus = { ok, quality };
  if (ok || ch.kind === "heat") {
    // a good tap lands the catch / finishes the craft right away; a heat tap always finishes it
    s.action.next = Math.min(s.action.next, now + 150);
    s.action.chanceFor = s.action.next;
  }
  send(s.ws, { type: "chanceEnd", id, ok, quality, kind: ch.kind, streak: s.streak || 0 });
}

function finishCook(s) {
  const rawId = (s.action && s.action.recipe) || "raw_fish";
  const raw = ITEMS[rawId];
  if (!raw || !raw.cook) {
    toast(s, "You have nothing to cook.");
    cancelAction(s);
    return;
  }
  if (skillLevelOf(s.account, "cooking") < (raw.cookLevel || 1)) {
    toast(s, `You need Cooking level ${raw.cookLevel} for that.`);
    cancelAction(s);
    return;
  }
  if (!invRemove(s.account.inventory, rawId, 1)) {
    toast(s, "You have no more raw fish.");
    cancelAction(s);
    return;
  }
  const bonus = (s.action && s.action.bonus) || null;
  if (s.action) s.action.bonus = null;
  const q = bonus && bonus.quality;
  const lvlDelta = skillLevelOf(s.account, "cooking") - (raw.cookLevel || 1);
  // Burnt food only on a badly-timed tap while still low level for that fish; AFK cooking never burns.
  const burnt = q === "poor" && lvlDelta < 10 && Math.random() < 0.6;
  const outId = burnt ? "burnt_fish" : (q === "fine" || q === "perfect") && ITEMS[raw.cook + "_" + q] ? raw.cook + "_" + q : raw.cook;
  if (!gainItem(s, outId, 1)) {
    invAdd(s.account.inventory, rawId, 1);
    toast(s, "Your inventory is full.");
    cancelAction(s);
    return;
  }
  if (burnt) {
    giveXp(s, "cooking", Math.round((raw.cookXp || 24) * 0.2));
    toast(s, "Too hot! You burn it. (Better timing, or more Cooking levels, stop burning.)");
    send(s.ws, { type: "fx", kind: "craft", quality: "burnt", x: s.x, y: s.y, onMe: true });
  } else {
    const mult = q === "perfect" ? 1.5 : q === "fine" ? 1.2 : 1;
    giveXp(s, "cooking", Math.round((raw.cookXp || 24) * mult * (q === "fine" || q === "perfect" ? MG.comboMult(s.streak) : 1)));
    toast(s, `You cook ${ITEMS[outId] ? ITEMS[outId].name : outId}.${q === "perfect" ? " Perfect!" : q === "fine" ? " Nicely done." : ""}`);
    dailyBump(s, "cook", 1, { quality: q });
    send(s.ws, { type: "fx", kind: "craft", quality: q || "normal", x: s.x, y: s.y, onMe: true });
  }
  send(s.ws, { type: "me", me: mePayload(s) });
  const next = rawFishOptions(s.account).find((o) => skillLevelOf(s.account, "cooking") >= o.level);
  if (next && s.action) {
    s.action.recipe = next.raw.id;
    s.action.next = Date.now() + next.time;
  } else {
    cancelAction(s);
    toast(s, "You finish cooking.");
  }
}

function finishCraft(s, list, verb) {
  const recipe = pickRecipe(s.account, list, s.action && s.action.recipe);
  if (!recipe) {
    toast(s, `You have nothing left to ${verb}.`);
    cancelAction(s);
    return;
  }
  if (!consumeInputs(s.account, recipe)) {
    toast(s, "You're missing materials.");
    cancelAction(s);
    return;
  }
  const bonus = (s.action && s.action.bonus) || null;
  if (s.action) s.action.bonus = null;
  const q = verb === "smith" && bonus && (bonus.quality === "fine" || bonus.quality === "perfect") ? bonus.quality : null;
  const outId = q && ITEMS[recipe.product + "_" + q] ? recipe.product + "_" + q : recipe.product;
  if (!gainItem(s, outId, 1)) {
    restoreInputs(s.account, recipe);
    toast(s, "Your inventory is full.");
    cancelAction(s);
    return;
  }
  giveXp(s, "smithing", Math.round((recipe.xp || 20) * (q === "perfect" ? 1.5 : q === "fine" ? 1.2 : 1) * (q ? MG.comboMult(s.streak) : 1)));
  dailyBump(s, "smith", 1, { verb });
  const def = ITEMS[outId];
  toast(s, `You ${verb} a ${def ? def.name : outId}.${q === "perfect" ? " Perfect strike!" : q === "fine" ? " Fine work." : ""}`);
  send(s.ws, { type: "fx", kind: "craft", verb, quality: q || "normal", x: s.x, y: s.y, onMe: true });
  send(s.ws, { type: "me", me: mePayload(s) });
  const next = pickRecipe(s.account, list, recipe.id || recipe.product);
  if (next && s.action) {
    s.action.recipe = next.id || next.product;
    s.action.next = Date.now() + (next.time || 2000);
  } else {
    cancelAction(s);
    toast(s, `You finish ${verb === "smelt" ? "smelting" : "smithing"}.`);
  }
}

function combatTick(s, now) {
  const mob = mobs.find((m) => m.id === s.targetMob && m.alive);
  if (!mob) { cancelAction(s); return; }
  if (!adj(Math.round(s.x), Math.round(s.y), Math.round(mob.fx), Math.round(mob.fy))) {
    walkThen(s, Math.round(mob.fx), Math.round(mob.fy), () => {
      s.targetMob = mob.id;
      startAction(s, "combat", mob.id, 1200);
    });
    return;
  }
  if (now < (s.action.next || 0)) return;
  s.action.next = now + 1200;
  const bonus = equipmentBonuses(s.account);
  const dmg = Math.max(1, 2 + Math.floor(Math.random() * 3) + Math.floor(skillLevelOf(s.account, "combat") / 8) + (bonus.atk || 0) - Math.floor((mob.level || 1) / 6));
  mob.hp -= dmg;
  // Attacking is the player's choice: it ends their post-death grace for this fight.
  s.graceUntil = 0;
  if (mob.grace) mob.grace.delete(s.id);
  if (!mob.returning) { if (mob.target !== s.id) mob.chased = 0; mob.target = s.id; }
  toast(s, `You hit the ${mob.name} for ${dmg}.`);
  send(s.ws, { type: "fx", kind: "hit", target: mob.id, dmg, x: mob.fx, y: mob.fy });
  if (mob.hp <= 0) {
    mob.alive = false;
    mob.hp = 0;
    mob.respawnAt = now + 20000 + (mob.level || 1) * 800;
    giveXp(s, "combat", mob.xp || 30);
    dailyBump(s, "kill", 1, { mobKind: mob.kind });
    s.account.kills = (s.account.kills || 0) + 1;
    leaderboard.addPeriodKill(s.account);
    const lo = Array.isArray(mob.gold) ? mob.gold[0] : 5;
    const hi = Array.isArray(mob.gold) ? mob.gold[1] : 15;
    const gold = lo + Math.floor(Math.random() * (hi - lo + 1));
    s.account.gold += gold;
    leaderboard.addPeriodGold(s.account, gold);
    const drop = mob.drop || "bones";
    gainItem(s, drop, 1);
    const dropName = ITEMS[drop] ? ITEMS[drop].name : drop;
    toast(s, `The ${mob.name} is defeated. +${gold} gold, ${dropName}.`);
    cancelAction(s);
    send(s.ws, { type: "me", me: mePayload(s) });
  }
}

function hitPlayer(s, dmg, fromName) {
  const bonus = equipmentBonuses(s.account);
  dmg = Math.max(1, dmg - Math.floor((bonus.def || 0) / 2));
  s.hp -= dmg;
  send(s.ws, { type: "toast", text: `${fromName || "A monster"} hits you for ${dmg}.` });
  send(s.ws, { type: "fx", kind: "hit", target: s.id, dmg, x: s.x, y: s.y, onMe: true });
  if (s.hp <= 0) {
    onPlayerDeath(s);
  } else {
    send(s.ws, { type: "me", me: mePayload(s) });
  }
}

// Every mob that was on this player lets go, walks home, and leaves them alone for a while.
function dropAggroOn(playerId, now, graceMs) {
  for (const m of mobs) {
    if (m.target !== playerId) continue;
    m.target = null;
    sendMobHome(m);
    if (graceMs) (m.grace || (m.grace = new Map())).set(playerId, now + graceMs);
  }
}
function sendMobHome(m) {
  m.target = null;
  m.returning = true;
  m.chased = 0;
  m.path = pathfind(tiles, m.fx, m.fy, m.homeX, m.homeY, 80);
  if (!m.path.length && (Math.abs(m.fx - m.homeX) > 0.01 || Math.abs(m.fy - m.homeY) > 0.01)) {
    m.fx = m.x = m.homeX;
    m.fy = m.y = m.homeY;
  }
}
function mobIgnores(m, s, now) {
  if (s.graceUntil && now < s.graceUntil) return true;
  const g = m.grace && m.grace.get(s.id);
  return !!(g && now < g);
}
function safeRespawnPoint() {
  const sp = staticWorld.spawn;
  const unsafe = (x, y) => mobs.some((m) => m.alive && Math.hypot(m.fx - x, m.fy - y) < SAFE_RESPAWN_RADIUS);
  if (!unsafe(sp.x, sp.y)) return { x: sp.x, y: sp.y };
  for (let r = 1; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = sp.x + dx, y = sp.y + dy;
      if (isWalkable(tiles, x, y) && !unsafe(x, y)) return { x, y };
    }
  }
  return { x: sp.x, y: sp.y };
}
function onPlayerDeath(s) {
  const now = Date.now();
  dropAggroOn(s.id, now, AGGRO_GRACE_MS);
  s.graceUntil = now + AGGRO_GRACE_MS;
  const p = safeRespawnPoint();
  s.hp = PLAYER_HP;
  s.x = p.x;
  s.y = p.y;
  s.path = [];
  s.pending = null;
  s.stepMode = false;
  s.nextStep = null;
  s.chance = null;
  streakReset(s);
  cancelAction(s);
  toast(s, "You wake up back in Ni Hao Village. Monsters will leave you alone for a bit. (You keep your items.)");
  send(s.ws, { type: "fx", kind: "death", target: s.id, x: s.x, y: s.y, onMe: true });
  send(s.ws, { type: "me", me: mePayload(s) });
  broadcastState();
}

function shopBuy(s, itemId) {
  const offer = SHOP.find((o) => o.itemId === itemId);
  if (!offer) { toast(s, "The shop doesn't sell that."); return; }
  const npc = staticWorld.npcs.find((n) => n.role === "shop");
  if (npc && !adj(Math.round(s.x), Math.round(s.y), npc.x, npc.y) && !(Math.round(s.x) === npc.x && Math.round(s.y) === npc.y)) {
    toast(s, "Walk over to Merchant Mao first.");
    return;
  }
  if (s.account.gold < offer.price) { toast(s, "Not enough gold."); return; }
  const def = ITEMS[itemId];
  if (def && def.cosmetic && s.account.inventory.some((i) => i.id === itemId)) {
    toast(s, "You already have that.");
    return;
  }
  if (!invAdd(s.account.inventory, itemId, 1)) { toast(s, "Inventory full."); return; }
  s.account.gold -= offer.price;
  toast(s, `You buy ${def ? def.name : itemId} for ${offer.price} gold.`);
  send(s.ws, { type: "me", me: mePayload(s) });
}

function shopSell(s, itemId, qty = 1) {
  const def = ITEMS[itemId];
  if (!def || !def.sell) { toast(s, "The shop won't buy that."); return; }
  qty = Math.max(1, qty | 0);
  if (!invRemove(s.account.inventory, itemId, qty)) { toast(s, "You don't have that."); return; }
  const gold = def.sell * qty;
  s.account.gold += gold;
  leaderboard.addPeriodGold(s.account, gold);
  toast(s, `You sell ${qty}× ${def.name} for ${gold} gold.`);
  send(s.ws, { type: "me", me: mePayload(s) });
}

function bankOp(s, op, itemId, qty = 1) {
  const npc = staticWorld.npcs.find((n) => n.role === "bank");
  if (npc && !adj(Math.round(s.x), Math.round(s.y), npc.x, npc.y) && !(Math.round(s.x) === npc.x && Math.round(s.y) === npc.y)) {
    toast(s, "Walk over to Banker Bao first.");
    return;
  }
  qty = Math.max(1, qty | 0);
  if (op === "deposit") {
    if (!invRemove(s.account.inventory, itemId, qty)) { toast(s, "You don't have that."); return; }
    s.account.bank[itemId] = (s.account.bank[itemId] || 0) + qty;
    toast(s, "Deposited.");
  } else if (op === "withdraw") {
    const have = s.account.bank[itemId] || 0;
    if (have < qty) { toast(s, "The bank doesn't have that many."); return; }
    if (!invAdd(s.account.inventory, itemId, qty)) { toast(s, "Inventory full."); return; }
    s.account.bank[itemId] = have - qty;
    if (s.account.bank[itemId] <= 0) delete s.account.bank[itemId];
    toast(s, "Withdrawn.");
  }
  send(s.ws, { type: "me", me: mePayload(s) });
}

function equipItem(s, itemId) {
  const def = ITEMS[itemId];
  if (!def || !def.slot) { toast(s, "You can't wear that."); return; }
  if (def.holderOnly && !canUseHolderItem(s, def) && s.account.equipped[def.slot] !== itemId) {
    const need = def.holdMin || 0;
    toast(s, need
      ? `Hold ${formatHold(need)} $nihala to use the ${def.name}.`
      : "Holder tools work while your signed-in wallet holds $nihala. Perks are paused.");
    return;
  }
  if (!s.account.inventory.some((i) => i.id === itemId) && s.account.equipped[def.slot] !== itemId) {
    toast(s, "You don't have that.");
    return;
  }
  if (s.account.equipped[def.slot] === itemId) {
    delete s.account.equipped[def.slot];
    toast(s, `You take off the ${def.name}.`);
  } else {
    s.account.equipped[def.slot] = itemId;
    toast(s, `You put on the ${def.name}.`);
  }
  send(s.ws, { type: "me", me: mePayload(s) });
}

function eatFood(s, itemId) {
  const def = ITEMS[itemId];
  if (!def || !def.heal) { toast(s, "You can't eat that."); return; }
  if (s.hp >= PLAYER_HP) { toast(s, "You're already full health."); return; }
  if (!invRemove(s.account.inventory, itemId, 1)) return;
  s.hp = Math.min(PLAYER_HP, s.hp + def.heal);
  toast(s, `You eat ${def.name} and heal ${def.heal} HP.`);
  send(s.ws, { type: "me", me: mePayload(s) });
}

function handleChat(s, text) {
  const now = Date.now();
  if (now - (s.lastChat || 0) < CHAT_COOLDOWN_MS) {
    toast(s, "Slow down a little.");
    return;
  }
  s.chatTimes = (s.chatTimes || []).filter((t) => now - t < CHAT_WINDOW_MS);
  if (s.chatTimes.length >= CHAT_WINDOW_MAX) {
    toast(s, "Chat rate limit — try again in a few seconds.");
    return;
  }
  const cleaned = cleanChat(text);
  if (!cleaned) return;
  if (isProfane(cleaned) && cleaned === cleanChat(text)) {
    // already starred; still allow if only stars? we already replaced
  }
  s.lastChat = now;
  s.chatTimes.push(now);
  const entry = { from: s.account.name, text: cleaned, ts: now, system: false, holder: !!s.holderBadge, nihala: isNihalaHolder(s) };
  chatLog.push(entry);
  if (chatLog.length > MAX_CHAT_LOG) chatLog.shift();
  broadcast({ type: "chat", ...entry });
}

function welcomePayload(s) {
  return {
    type: "welcome",
    me: mePayload(s),
    world: {
      W: staticWorld.W,
      H: staticWorld.H,
      tiles,
      spawn: staticWorld.spawn,
      npcs: staticWorld.npcs,
      walk: [...world.WALK],
      speed: WALK_SPEED,
    },
    items: ITEMS,
    skills: SKILLS,
    avatars: AVATARS,
    shop: SHOP,
    premiumShop: PREMIUM_SHOP,
    mihaoMint: MIHAO_MINT,
    companionMint: NIHALA_MINT,
    nihalaMint: NIHALA_MINT,
    nihalaChart: NIHALA_DEXSCREENER,
    nihalaDisclaimer: NIHALA_DISCLAIMER,
    holderTools: HOLDER_TOOLS,
    holderShop: HOLDER_SHOP,
    nihalaDecimals: NIHALA_DECIMALS,
    dexscreener: DEXSCREENER,
    players: [...sessions.values()].map(publicPlayer),
    t: Date.now(),
    nodes: compactNodes(),
    mobs: compactMobs(),
    chatLog: chatLog.slice(-40),
    quests: QUESTS.map((q) => ({ id: q.id, name: q.name, steps: q.steps, giver: q.giver })),
    story: PROG.STORY.map((c) => ({ id: c.id, n: c.n, name: c.name, zone: c.zone, intro: c.intro, objectives: c.objectives.map((o) => ({ type: o.type, label: o.label, final: !!o.final, n: o.n || 1, skill: o.skill || null, npc: o.npc || null })), reward: c.reward })),
    collection: PROG.COLLECTION.map((g) => ({ id: g.id, name: g.name, hint: g.hint, items: g.items.map((id) => ({ id, holder: PROG.HOLDER_ONLY.has(id) })) })),
    collMilestones: PROG.COLL_MILESTONES,
    eventTiers: PROG.EVENT_TIERS,
    smeltRecipes: SMELT_RECIPES,
    smithRecipes: SMITH_RECIPES,
  };
}

function newLive(ws, account, token) {
  const s = {
    ws,
    id: "p_" + crypto.randomBytes(6).toString("hex"),
    account,
    token,
    x: account.x,
    y: account.y,
    hp: account.hp || PLAYER_HP,
    path: [],
    action: null,
    pending: null,
    targetMob: null,
    lastChat: 0,
    chatTimes: [],
    lastZone: zoneAt(account.x, account.y).id,
    holderBadge: false,
    wallet: account.wallet || null,
  };
  sessions.set(ws, s);
  return s;
}

function onHello(ws, msg) {
  let account = null;
  let token = null;
  if (msg.token) {
    account = persist.getByToken(String(msg.token));
    if (account) {
      token = String(msg.token);
      // Only change a returning player's avatar when the client explicitly sent a valid one
      // (the login screen leaves this off unless the player picked a new preset).
      if (msg.avatar && isAllowedAvatar(msg.avatar)) {
        account.avatar = msg.avatar;
        persist.markDirty();
      }
    }
  }
  if (!account) {
    const err = validName(msg.name || "");
    if (err) { send(ws, { type: "error", text: err }); return; }
    const name = String(msg.name).trim();
    if (nameTaken(name)) { send(ws, { type: "error", text: "That name is already in this world." }); return; }
    const avatar = isAllowedAvatar(msg.avatar) ? msg.avatar : "classic-paw";
    account = createAccount({ name, avatar });
    const sess = persist.issueSession(account.id, { expire: false });
    token = sess.token;
    saveAccounts();
  }
  // already connected from another tab or device?
  for (const [other, s] of sessions) {
    if (s.account.id === account.id && other !== ws) {
      send(other, { type: "error", text: "You signed in from another window." });
      other.close();
      sessions.delete(other);
    }
  }
  const live = newLive(ws, account, token);
  live.proto = msg.proto === 2 ? 2 : 1;
  if (account.wallet) live.wallet = account.wallet;
  send(ws, welcomePayload(live));
  loginCheck(live);
  storyVisit(live, zoneAt(live.x, live.y).id);
  systemChat(`${account.name} has arrived in Ni Hao Village.`);
  if (account.wallet) refreshNihala(live);
  broadcastState();
}

function facingFor(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  if (dy !== 0) return dy > 0 ? "down" : "up";
  return null;
}

// Keyboard / joystick movement: one tile per intent, validated here.
// The tick loop still moves the player at WALK_SPEED, so intents can't teleport or speed up.
function tryStep(s, dx, dy) {
  const px = Math.round(s.x), py = Math.round(s.y);
  const tx = px + dx, ty = py + dy;
  const face = facingFor(dx, dy);
  if (face) s.facing = face;
  let reason = null;
  if (!isWalkable(tiles, tx, ty)) reason = "blocked";
  else if (dx !== 0 && dy !== 0 && (!isWalkable(tiles, px + dx, py) || !isWalkable(tiles, px, py + dy))) reason = "corner";
  let gate = null;
  if (!reason) {
    gate = zoneBlocked(zoneAt(tx, ty), s.account);
    if (gate) reason = "gate";
  }
  if (reason) {
    s.stepMode = false;
    s.nextStep = null;
    send(s.ws, { type: "stepReject", reason, x: px, y: py, facing: s.facing });
    if (gate && Date.now() - (s.lastGateToast || 0) > 3000) {
      s.lastGateToast = Date.now();
      toast(s, gate);
    }
    return false;
  }
  s.path = [{ x: tx, y: ty }];
  s.stepMode = true;
  return true;
}

function handleStep(s, msg) {
  const now = Date.now();
  s.stepTimes = (s.stepTimes || []).filter((t) => now - t < STEP_WINDOW_MS);
  if (s.stepTimes.length >= STEP_WINDOW_MAX) {
    if (!s.stepFlood || now - s.stepFlood > 1000) {
      s.stepFlood = now;
      send(s.ws, { type: "stepReject", reason: "rate", x: Math.round(s.x), y: Math.round(s.y) });
    }
    return;
  }
  s.stepTimes.push(now);
  const dx = Math.sign(Number(msg.dx) || 0);
  const dy = Math.sign(Number(msg.dy) || 0);
  if (!dx && !dy) { s.nextStep = null; return; }
  // Manual movement cancels skilling, combat and any click-to-walk route.
  if (s.action) cancelAction(s);
  s.pending = null;
  s.targetMob = null;
  if (s.path && s.path.length) {
    // Finish the tile we're crossing, then take this step.
    s.path = s.path.slice(0, 1);
    s.stepMode = true;
    s.nextStep = { dx, dy };
    const face = facingFor(dx, dy);
    if (face) s.facing = face;
    return;
  }
  s.nextStep = null;
  tryStep(s, dx, dy);
}

// Test-only hooks (NHL_TEST_HOOKS=1). Never enabled in production.
function testHook(s, msg) {
  const op = String(msg.op || "");
  if (op === "hp") { s.hp = Math.max(1, msg.hp | 0); send(s.ws, { type: "me", me: mePayload(s) }); }
  else if (op === "tp") { s.x = msg.x | 0; s.y = msg.y | 0; s.path = []; broadcastState(); }
  else if (op === "rate") s.testChanceRate = Number(msg.rate);
  else if (op === "skill") { s.account.skills[String(msg.skill)] = Math.max(0, msg.xp | 0); send(s.ws, { type: "me", me: mePayload(s) }); }
  else if (op === "day") { s.testDay = String(msg.day || ""); loginCheck(s); }
  else if (op === "week") { s.testWeek = String(msg.week || ""); send(s.ws, { type: "me", me: mePayload(s) }); }
  else if (op === "bump") { dailyBump(s, String(msg.id), Math.max(1, msg.n | 0), msg.opts || {}); send(s.ws, { type: "me", me: mePayload(s) }); }
  else if (op === "meta") { send(s.ws, { type: "__meta", meta: s.account.meta }); }
  else if (op === "give") { gainItem(s, String(msg.item), Math.max(1, msg.qty | 0)); send(s.ws, { type: "me", me: mePayload(s) }); }
  else if (op === "mobs") {
    const now = Date.now();
    send(s.ws, {
      type: "__mobs", graceLeft: s.graceUntil ? Math.max(0, s.graceUntil - now) : 0, me: { x: s.x, y: s.y, hp: s.hp },
      mobs: mobs.map((m) => ({ id: m.id, alive: m.alive, target: m.target, returning: !!m.returning, x: m.fx, y: m.fy, homeX: m.homeX, homeY: m.homeY, hp: m.hp, grace: m.grace && m.grace.get(s.id) ? Math.max(0, m.grace.get(s.id) - now) : 0 })),
    });
  } else if (op === "aggro") {
    const m = mobs.find((x) => x.id === msg.id);
    if (m && !mobIgnores(m, s, Date.now())) { m.target = s.id; m.returning = false; m.chased = 0; }
  } else if (op === "chance") send(s.ws, { type: "__chance", chance: s.chance ? { ...s.chance, now: Date.now() } : null, rtt: s.rtt || 0, streak: s.streak || 0 });
  else if (op === "nodes") send(s.ws, { type: "__nodes", nodes: nodes.filter((n) => !msg.ntype || n.type === msg.ntype).map((n) => ({ id: n.id, type: n.type, x: n.x, y: n.y, depleted: n.depleted, charges: n.charges, alts: n.alts ? n.alts.length : 0, skill: n.skill, resource: n.resource })) });
  else if (op === "respawnNodes") { for (const n of nodes) if (n.depleted) n.respawnAt = 1; }
}

function onMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg.type !== "string") return;
  if (msg.type === "hello") { onHello(ws, msg); return; }
  const s = sessions.get(ws);
  if (!s) { send(ws, { type: "error", text: "Send hello first." }); return; }

  switch (msg.type) {
    case "move": {
      const x = msg.x | 0, y = msg.y | 0;
      if (!isWalkable(tiles, x, y)) { toast(s, "You can't walk there."); return; }
      const gate = zoneBlocked(zoneAt(x, y), s.account);
      if (gate) { toast(s, gate); return; }
      const planned = pathfind(tiles, s.x, s.y, x, y, 1200, canEnterFn(s));
      const blocked = planned.length ? pathBlockedFor(s, planned) : null;
      if (blocked) { toast(s, blocked); return; }
      cancelAction(s);
      s.pending = null;
      s.targetMob = null;
      s.stepMode = false;
      s.nextStep = null;
      s.path = planned;
      if (!planned.length && !(Math.round(s.x) === x && Math.round(s.y) === y)) toast(s, "No path.");
      break;
    }
    case "step":
      handleStep(s, msg);
      break;
    case "guide": {
      const g = s.account.meta.guide;
      if (msg.op === "step") g.step = Math.max(0, Math.min(10, msg.step | 0));
      else if (msg.op === "done") { g.done = true; g.step = 0; }
      else if (msg.op === "reset") { g.done = false; g.step = 0; }
      persist.markDirty();
      send(s.ws, { type: "me", me: mePayload(s) });
      break;
    }
    case "setTitle": {
      const t = String(msg.title || "");
      const m = s.account.meta;
      if (t === "" || m.titles.includes(t)) { m.title = t; persist.markDirty(); send(s.ws, { type: "me", me: mePayload(s) }); broadcastState(); }
      break;
    }
    case "hit":
      onHit(s, msg.id | 0);
      break;
    case "pong":
      // RTT from the server's own timestamps; only the latest ping is accepted.
      if (s.pingT && msg.t === s.pingT) {
        const rtt = Date.now() - s.pingT;
        s.pingT = 0;
        if (rtt >= 0 && rtt < 5000) s.rtt = s.rtt ? Math.round(s.rtt * 0.7 + rtt * 0.3) : rtt;
      }
      break;
    case "__test":
      if (TEST_HOOKS) testHook(s, msg);
      break;
    case "interact":
      if (typeof msg.id === "string") interact(s, msg.id, msg);
      break;
    case "chat":
      handleChat(s, msg.text);
      break;
    case "shopBuy":
      shopBuy(s, String(msg.itemId || ""));
      break;
    case "shopSell":
      shopSell(s, String(msg.itemId || ""), msg.qty | 0 || 1);
      break;
    case "bank":
      bankOp(s, String(msg.op || ""), String(msg.itemId || ""), msg.qty | 0 || 1);
      break;
    case "equip":
      equipItem(s, String(msg.itemId || ""));
      break;
    case "eat":
      eatFood(s, String(msg.itemId || ""));
      break;
    case "stop":
      cancelAction(s);
      s.path = [];
      s.pending = null;
      s.nextStep = null;
      s.stepMode = false;
      break;
    case "wallet":
      // client reports a public key after a read-only Phantom connect. No signatures accepted.
      if (typeof msg.address === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(msg.address)) {
        s.wallet = msg.address;
        s.holderBadge = !!msg.holder;
        send(s.ws, { type: "me", me: mePayload(s) });
        if (s.holderBadge) toast(s, "mihao holder badge enabled (read-only balance check).");
      }
      // re-read $nihala for the signed-in wallet (rate-limited; never trusts the client's claim)
      if (s.account.wallet && Date.now() - (s.nihalaManualAt || 0) > 30000) {
        s.nihalaManualAt = Date.now();
        refreshNihala(s, true);
      }
      break;
    case "holderCheck":
      if (s.account.wallet && Date.now() - (s.nihalaManualAt || 0) > 30000) {
        s.nihalaManualAt = Date.now();
        refreshNihala(s, true);
      } else if (!s.account.wallet) toast(s, "Sign in with a wallet first (login message only).");
      else toast(s, "Checked recently. Try again in a little while.");
      break;
    case "holderClaim":
      claimHolderTool(s, String(msg.itemId || ""));
      break;
    case "holderShopUnlock":
      unlockHolderShopItem(s, String(msg.itemId || ""));
      break;
    case "premiumBuy":
      toast(s, "Token purchases are not enabled. This is a design stub only.");
      break;
    case "rename": {
      const result = applyRename(s.account, msg.name);
      if (result.error) { send(s.ws, { type: "error", text: result.error }); break; }
      finishRename(s.account, result);
      break;
    }
    default:
      break;
  }
}

function tick(dt, now) {
  let changed = false;

  for (const s of sessions.values()) {
    if (s.path && s.path.length) {
      // Spend the whole tick's movement budget, carrying leftovers across tile boundaries so the
      // server walks at exactly WALK_SPEED (no 1-tick pause per tile; keeps client prediction in sync).
      let budget = WALK_SPEED * dt;
      let guard = 0;
      while (budget > 0 && s.path && s.path.length && guard++ < 4) {
        const step = s.path[0];
        const dx = step.x - s.x, dy = step.y - s.y;
        const dist = Math.hypot(dx, dy);
        const face = facingFor(dx, dy);
        if (face) s.facing = face;
        if (dist <= budget || dist < 0.02) {
          s.x = step.x;
          s.y = step.y;
          budget -= dist;
          s.path.shift();
          if (!s.path.length && s.pending) {
            const cb = s.pending;
            s.pending = null;
            cb();
            break;
          }
          if (!s.path.length && s.stepMode) {
            s.stepMode = false;
            if (s.nextStep) {
              const n = s.nextStep;
              s.nextStep = null;
              tryStep(s, n.dx, n.dy);
            }
          }
        } else {
          s.x += (dx / dist) * budget;
          s.y += (dy / dist) * budget;
          budget = 0;
        }
      }
      s.x = Math.round(s.x * 1000) / 1000;
      s.y = Math.round(s.y * 1000) / 1000;
      changed = true;
      const z = zoneAt(s.x, s.y);
      if (z.id !== s.lastZone) {
        s.lastZone = z.id;
        toast(s, `Entering ${z.name}`);
        send(s.ws, { type: "zone", zone: z });
        storyVisit(s, z.id);
      }
    }

    if (s.action) {
      if (s.action.kind === "gather" && now >= s.action.next) {
        const node = nodes.find((n) => n.id === s.action.target);
        finishGather(s, node);
        changed = true;
      } else if (s.action.kind === "cook" && now >= s.action.next) {
        finishCook(s);
        changed = true;
      } else if (s.action.kind === "smelt" && now >= s.action.next) {
        finishCraft(s, SMELT_RECIPES, "smelt");
        changed = true;
      } else if (s.action.kind === "smith" && now >= s.action.next) {
        finishCraft(s, SMITH_RECIPES, "smith");
        changed = true;
      } else if (s.action.kind === "combat") {
        combatTick(s, now);
        changed = true;
      }
    }
    ensureChance(s, now);
  }

  for (const n of nodes) {
    if (n.depleted && n.respawnAt && now >= n.respawnAt) {
      n.depleted = false;
      n.respawnAt = 0;
      n.charges = n.maxCharges || 1;
      if (n.type === "fish" && n.alts && n.alts.length > 1) relocateFishSpot(n);
      changed = true;
    }
  }

  for (const m of mobs) {
    if (!m.alive) {
      if (m.respawnAt && now >= m.respawnAt) {
        m.alive = true;
        m.hp = m.maxHp;
        m.fx = m.homeX;
        m.fy = m.homeY;
        m.x = m.homeX;
        m.y = m.homeY;
        m.target = null;
        m.returning = false;
        m.chased = 0;
        m.path = [];
        changed = true;
      }
      continue;
    }
    // aggro / attack with leash: mobs only chase a player who attacked them, never far from home.
    if (m.returning) {
      if ((!m.path || !m.path.length) && Math.hypot(m.fx - m.homeX, m.fy - m.homeY) < 0.05) {
        m.returning = false;
        m.hp = m.maxHp; // reset like a classic leash
        changed = true;
      } else if (!m.path || !m.path.length) sendMobHome(m);
    } else if (m.target) {
      let victim = null;
      for (const vs of sessions.values()) if (vs.id === m.target) { victim = vs; break; }
      if (!victim || mobIgnores(m, victim, now)) sendMobHome(m);
      else {
        const homeD = Math.hypot(m.fx - m.homeX, m.fy - m.homeY);
        const vd = Math.hypot(victim.x - m.fx, victim.y - m.fy);
        const victimHome = Math.hypot(victim.x - m.homeX, victim.y - m.homeY);
        if (homeD > MOB_LEASH || vd > MOB_GIVEUP || victimHome > MOB_LEASH + 2 || (m.chased || 0) > MOB_CHASE_MAX) {
          sendMobHome(m);
          changed = true;
        } else if (!adj(Math.round(m.fx), Math.round(m.fy), Math.round(victim.x), Math.round(victim.y))) {
          if (now >= (m.repathAt || 0) || !m.path || !m.path.length) {
            m.repathAt = now + 400;
            m.path = pathfind(tiles, m.fx, m.fy, Math.round(victim.x), Math.round(victim.y), 24);
          }
        } else {
          m.path = [];
          if (now >= m.nextHit) {
            m.nextHit = now + 1400;
            hitPlayer(victim, 1 + Math.floor(Math.random() * 3) + Math.floor((m.level || 1) / 5), m.name);
            changed = true;
          }
        }
      }
    } else if (now >= m.nextWander) {
      m.nextWander = now + 2500 + Math.random() * 3000;
      const tx = m.homeX + Math.floor(Math.random() * 7) - 3;
      const ty = m.homeY + Math.floor(Math.random() * 7) - 3;
      if (isWalkable(tiles, tx, ty)) m.path = pathfind(tiles, m.fx, m.fy, tx, ty, 30);
    }
    if (m.path && m.path.length) {
      const step = m.path[0];
      const dx = step.x - m.fx, dy = step.y - m.fy;
      const dist = Math.hypot(dx, dy);
      const move = (m.returning ? MOB_RETURN_SPEED : MOB_SPEED) * dt;
      if (dist <= move) { m.fx = step.x; m.fy = step.y; m.path.shift(); }
      else { m.fx += (dx / dist) * move; m.fy += (dy / dist) * move; }
      if (m.target) m.chased = (m.chased || 0) + Math.min(dist, move);
      m.x = m.fx; m.y = m.fy;
      changed = true;
    }
  }

  if (changed || stateDirty) flushState();
}

// --- HTTP + WS ---
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
// Cherry can embed the game; other sites cannot. See frame-ancestors from cherry.fun.
app.use((_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors 'self' https://chat.cherry.fun https://cherry.fun https://*.cherry.fun"
  );
  next();
});
// Domain proof for the Cherry marketplace listing (dotfiles are not served by express.static).
app.get("/.well-known/cherry-app.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.sendFile(path.join(__dirname, "public", ".well-known", "cherry-app.json"));
});
app.post("/api/avatar", express.json({ limit: "120kb" }), handleAvatarUpload);
app.use(express.json({ limit: "32kb" }));
app.use("/assets", express.static(path.join(__dirname, "assets"), { maxAge: "1h" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/avatars/:id", async (req, res) => {
  const id = String(req.params.id || "");
  try {
    const rec = await persist.readAvatar(id);
    if (!rec || !rec.buf) return res.status(404).end();
    res.setHeader("Content-Type", rec.mime || "image/png");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.end(rec.buf);
  } catch {
    res.status(404).end();
  }
});

app.get("/api/event", (req, res) => {
  const week = leaderboard.isoWeekId();
  const ev = PROG.eventFor(week);
  const rows = eventBoard(week);
  const viewer = String(req.query.viewer || "");
  const acct = viewer ? persist.getByToken(viewer) : null;
  const youIdx = acct ? rows.findIndex((r) => r.id === acct.id) : -1;
  res.set("Cache-Control", "no-store");
  res.json({
    week, event: ev, tiers: PROG.EVENT_TIERS, resets: "Monday 00:00 Helsinki",
    top: rows.slice(0, 10).map((r, i) => ({ rank: i + 1, name: r.name, avatar: r.avatar, score: r.score, title: r.title })),
    you: youIdx >= 0 ? { rank: youIdx + 1, score: rows[youIdx].score } : null,
    players: rows.length,
  });
});
app.get("/api/leaderboard", (req, res) => {
  const board = String(req.query.board || "");
  const period = String(req.query.period || "all");
  const limit = req.query.limit;
  const token = String(req.query.token || "");
  const viewer = token ? persist.getByToken(token) : null;
  const payload = leaderboard.getLeaderboard(persist.allAccounts(), { board, period, limit, viewer });
  if (payload.error) return res.status(400).json(payload);
  res.setHeader("Cache-Control", "public, max-age=15");
  res.json(payload);
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    players: sessions.size,
    accounts: persist.accountCount(),
    persist: persist.backend(),
    uptime: process.uptime(),
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    mihaoMint: MIHAO_MINT,
    companionMint: NIHALA_MINT,
    nihalaMint: NIHALA_MINT,
    nihalaChart: NIHALA_DEXSCREENER,
    nihalaDisclaimer: NIHALA_DISCLAIMER,
    nihalaHolderMin: NIHALA_HOLDER_MIN,
    nihalaDecimals: NIHALA_DECIMALS,
    holderShop: HOLDER_SHOP,
    dexscreener: DEXSCREENER,
    premiumShop: PREMIUM_SHOP,
    avatars: AVATARS,
    purchasesEnabled: false,
  });
});

app.get("/api/account", (req, res) => {
  const token = String(req.query.token || "");
  const account = persist.getByToken(token);
  if (!account) return res.status(404).json({ error: "Unknown account" });
  res.json({
    name: account.name,
    avatar: resolveAvatar(account.avatar),
    wallet: account.wallet || null,
    walletLabel: shortWallet(account.wallet),
    needsName: needsNamePick(account),
    nextRenameAt: nextRenameAt(account) || null,
  });
});

app.get("/api/auth/nonce", (req, res) => {
  if (hitWindow(authByIp, clientIp(req), 60000, 30)) {
    return res.status(429).json({ error: "Too many sign-in attempts. Wait a moment." });
  }
  pruneNonces();
  const nonce = crypto.randomBytes(16).toString("hex");
  authNonces.set(nonce, Date.now() + SIGNIN_TTL_MS);
  res.json({ nonce, expiresIn: SIGNIN_TTL_MS });
});

app.post("/api/auth/wallet", (req, res) => {
  if (hitWindow(authByIp, clientIp(req), 60000, 30)) {
    return res.status(429).json({ error: "Too many sign-in attempts. Wait a moment." });
  }
  const pubkey = String(req.body?.pubkey || "").trim();
  const nonce = String(req.body?.nonce || "").trim();
  const signature = req.body?.signature;
  const linkToken = req.body?.token ? String(req.body.token) : "";
  const requestedName = req.body?.name ? String(req.body.name) : "";

  pruneNonces();
  const expiresAt = authNonces.get(nonce);
  if (!expiresAt || Date.now() > expiresAt) {
    return res.status(400).json({ error: "Sign-in expired. Please try again." });
  }
  if (!isSolanaPubkey(pubkey)) return res.status(400).json({ error: "Invalid wallet address." });
  if (!verifyWalletSig(pubkey, nonce, signature)) {
    return res.status(400).json({ error: "Signature did not verify. This login is not a transaction." });
  }
  authNonces.delete(nonce);

  let account = persist.getByWallet(pubkey);
  const guest = linkToken ? persist.getByToken(linkToken) : null;
  let linked = false;
  if (account) {
    // Wallet already has a character. A different guest character is left alone.
  } else if (guest && !guest.wallet) {
    guest.wallet = pubkey;
    persist.upsertAccount(guest);
    account = guest;
    linked = true;
  } else {
    account = createAccount({ name: uniqueWalletName(requestedName, pubkey), avatar: "classic-paw", wallet: pubkey });
  }
  const sess = persist.issueSession(account.id, { expire: true });
  persist.markDirty();
  saveAccounts();
  res.json({
    ok: true,
    token: sess.token,
    expires: sess.expires,
    name: account.name,
    avatar: resolveAvatar(account.avatar),
    wallet: pubkey,
    walletLabel: shortWallet(pubkey),
    linked,
    needsName: needsNamePick(account),
    note: "Signature only logged you in. No transaction was created or sent.",
  });
});

async function verifyCherryLaunchToken(token) {
  const opts = { appId: CHERRY_APP_ID };
  if (CHERRY_TEST_JWKS) opts.jwks = CHERRY_TEST_JWKS;
  return verifyLaunchToken(token, opts);
}

function accountFromCherryClaims(claims) {
  const cherryId = claims.cherry_id ? String(claims.cherry_id) : null;
  const wallet = String(claims.payment_wallet || claims.sub || "").trim();
  if (!isSolanaPubkey(wallet)) return { error: "Launch token did not name a Solana wallet." };
  let account = cherryId ? persist.getByCherryId(cherryId) : null;
  if (!account) account = persist.getByWallet(wallet);
  if (account) {
    if (cherryId && !account.cherryId) account.cherryId = cherryId;
    account.wallet = wallet;
    persist.upsertAccount(account);
  } else {
    account = createAccount({
      name: uniqueWalletName("", wallet),
      avatar: "classic-paw",
      wallet,
      cherryId,
    });
  }
  return { account, wallet, cherryId };
}

app.post("/api/auth/cherry", async (req, res) => {
  if (hitWindow(authByIp, clientIp(req), 60000, 30)) {
    return res.status(429).json({ error: "Too many sign-in attempts. Wait a moment." });
  }
  const raw = String(req.headers.authorization || "");
  const token = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Missing Cherry launch token." });
  let claims;
  try {
    claims = await verifyCherryLaunchToken(token);
  } catch (err) {
    if (err instanceof LaunchTokenError && err.code === "JWKS_UNAVAILABLE") {
      return res.status(503).json({ error: "Cherry sign-in is briefly unavailable. Please try again." });
    }
    const code = err instanceof LaunchTokenError ? err.code : "INVALID_TOKEN";
    return res.status(401).json({ error: "Cherry sign-in failed.", code });
  }
  const got = accountFromCherryClaims(claims);
  if (got.error) return res.status(400).json({ error: got.error });
  const { account, wallet } = got;
  const sess = persist.issueSession(account.id, { expire: true });
  persist.markDirty();
  saveAccounts();
  res.json({
    ok: true,
    token: sess.token,
    expires: sess.expires,
    name: account.name,
    avatar: resolveAvatar(account.avatar),
    wallet,
    walletLabel: shortWallet(wallet),
    needsName: needsNamePick(account),
    note: "Signed in with Cherry. No transaction was created or sent.",
  });
});

async function handleAvatarUpload(req, res) {
  const ip = clientIp(req);
  // Count every attempt per IP (success or not) so a flood still gets a 429.
  // Token cooldown starts only after a successful save, so a bad file can be retried.
  if (hitWindow(uploadByIp, ip, AVATAR_UPLOAD_COOLDOWN_MS, 10)) {
    return res.status(429).json({ error: "Please wait a little before uploading again." });
  }
  const token = String(req.body?.token || "");
  const account = persist.getByToken(token);
  if (!account) return res.status(401).json({ error: "Join the world once before uploading a picture." });
  if (wouldHitRateLimit(uploadByToken, token, AVATAR_UPLOAD_COOLDOWN_MS)) {
    return res.status(429).json({ error: "Please wait a little before uploading again." });
  }

  const parsed = parseAvatarDataUrl(req.body?.image);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const id = crypto.randomBytes(12).toString("hex");
  const mime = parsed.kind === "webp" ? "image/webp" : "image/png";
  try {
    await persist.putAvatar(id, mime, parsed.buf);
  } catch (e) {
    console.error("[avatar] write failed", e.message);
    return res.status(500).json({ error: "Could not save that picture." });
  }

  hitRateLimit(uploadByToken, token, AVATAR_UPLOAD_COOLDOWN_MS);
  const previous = account.avatar;
  const avatar = "u:" + id;
  applyAvatar(account, avatar, true);
  if (previous && previous !== avatar) deleteCustomAvatar(previous);
  return res.json({ ok: true, avatar });
}

app.post("/api/rename", (req, res) => {
  const token = String(req.body?.token || "");
  const account = persist.getByToken(token);
  if (!account) return res.status(401).json({ error: "Sign in first." });
  const result = applyRename(account, req.body?.name);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error, nextRenameAt: result.nextRenameAt || null });
  }
  finishRename(account, result);
  return res.json({
    ok: true,
    name: result.name,
    oldName: result.oldName,
    nextRenameAt: result.nextRenameAt,
    needsName: false,
  });
});

app.post("/api/report-avatar", (req, res) => {

  const token = String(req.body?.token || "");
  const reporter = persist.getByToken(token);
  if (!reporter) return res.status(401).json({ error: "Sign in first." });
  if (hitRateLimit(reportByToken, token, 15000)) {
    return res.status(429).json({ error: "Please wait a little before reporting again." });
  }
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Missing player name." });
  let target = null;
  for (const a of accounts.values()) {
    if (a.name.toLowerCase() === name.toLowerCase()) { target = a; break; }
  }
  if (!target) return res.status(404).json({ error: "No player with that name." });
  if (typeof target.avatar !== "string" || !target.avatar.startsWith("u:")) {
    return res.status(400).json({ error: "That player is using a built-in picture." });
  }
  console.warn("[report] %s reported %s avatar %s", reporter.name, target.name, target.avatar);
  return res.json({ ok: true, text: "Thanks. An admin can remove that picture." });
});

app.post("/api/admin/reset-avatar", (req, res) => {
  if (!adminKeyOk(req.body?.adminKey)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Missing player name." });
  let target = null;
  for (const a of accounts.values()) {
    if (a.name.toLowerCase() === name.toLowerCase()) { target = a; break; }
  }
  if (!target) return res.status(404).json({ error: "No player with that name." });
  const previous = target.avatar;
  applyAvatar(target, "classic-paw", true);
  deleteCustomAvatar(previous);
  return res.json({ ok: true, name: target.name, avatar: "classic-paw" });
});

// Read-only holder check. No keys, no transactions.
app.get("/api/holder/:address", async (req, res) => {
  const address = String(req.params.address || "");
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return res.status(400).json({ error: "Invalid address" });
  }
  try {
    const mihao = await tokenBalance(address, MIHAO_MINT, MIHAO_TOKEN_PROGRAM);
    const n = await nihalaChecker.check(address);
    res.json({
      address,
      mihao,
      nihala: { mint: NIHALA_MINT, uiAmount: n.balance, amount: n.amount, holder: n.holder, checkedAt: n.checkedAt, error: n.error || null },
      holder: mihao.uiAmount > 0,
      nihalaHolder: !!n.holder,
      note: "Read-only balance check. No transaction is created or signed.",
    });
  } catch (e) {
    res.status(502).json({ error: "RPC unavailable", detail: String(e.message || e) });
  }
});

async function tokenBalance(owner, mint, programId) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTokenAccountsByOwner",
    params: [
      owner,
      { mint },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ],
  };
  // Try with program filter if needed — mint filter is enough.
  const r = await fetch(PUBLIC_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("RPC HTTP " + r.status);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  let uiAmount = 0, amount = "0";
  for (const acc of j.result?.value || []) {
    const info = acc.account?.data?.parsed?.info?.tokenAmount;
    if (info) {
      uiAmount += Number(info.uiAmount || 0);
      amount = String(BigInt(amount) + BigInt(info.amount || "0"));
    }
  }
  return { mint, uiAmount, amount, programId };
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  ws.on("message", (raw) => {
    try { onMessage(ws, raw.toString()); }
    catch (e) { console.error("msg error", e); }
  });
  ws.on("close", () => {
    const s = sessions.get(ws);
    if (s) {
      Object.assign(s.account, snapshot(s));
      persist.upsertAccount(s.account);
      sessions.delete(ws);
      saveAccounts();
      systemChat(`${s.account.name} has left.`);
      broadcastState();
    }
  });
  ws.on("error", () => {});
});

let last = Date.now();
let ticker = null;
let saveTimer = null;

function shutdown() {
  console.log("[server] shutting down, saving...");
  if (ticker) clearInterval(ticker);
  if (saveTimer) clearInterval(saveTimer);
  Promise.resolve(saveAccounts())
    .then(() => persist.close())
    .finally(() => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2000);
    });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  await persist.init({ dataDir: DATA_DIR, avatarDir: AVATAR_DIR });
  for (const a of persist.allAccounts()) hydrateAccount(a);
  ticker = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    tick(dt, now);
  }, TICK_MS);
  saveTimer = setInterval(() => { saveAccounts(); }, 20000);
  // RTT probe for latency-compensated timing judgements (server timestamps only).
  setInterval(() => {
    const now = Date.now();
    for (const s of sessions.values()) { s.pingT = now; send(s.ws, { type: "ping", t: now }); }
  }, 4000);
  // day rollover while online: daily visit bonus
  setInterval(() => { for (const s of sessions.values()) if (s.account) loginCheck(s); }, 60000);
  // periodic $nihala re-check for online wallet players (perks pause when the balance hits 0)
  setInterval(() => {
    const now = Date.now();
    for (const s of sessions.values()) if (s.account.wallet && now >= (s.nihalaNextCheck || 0)) refreshNihala(s);
  }, Math.min(60000, NIHALA_RECHECK_MS));
  server.listen(PORT, HOST, () => {
    console.log(`[Ni Hao Lands] unofficial fan MMO listening on http://${HOST}:${PORT} (${persist.backend()} store)`);
    console.log("Not financial advice. No token purchases. Wallet sign-in uses signMessage only. Art from the mihao pfps Meme Depot community.");
  });
}

main().catch((e) => {
  console.error("[server] failed to start", e);
  process.exit(1);
});
