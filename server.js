// Ni Hao Lands — unofficial fan MMO prototype server.
// Wallet sign-in uses signMessage only. No fund movement, no token purchases. Not financial advice.

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { WebSocketServer } = require("ws");
const nacl = require("tweetnacl");
const bs58 = require("bs58");
const persist = require("./persist");

const world = require("./world");
const {
  AVATARS, SKILLS, ITEMS, SHOP, PREMIUM_SHOP,
  MIHAO_MINT, MIHAO_TOKEN_PROGRAM, DEXSCREENER,
  levelFromXp, emptySkills, rollFishKg, isWalkable, pathfind, zoneAt, adj, buildWorld,
} = world;
const leaderboard = require("./leaderboard");

const PORT = Number(process.env.PORT || 3000);
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
const COMPANION_MINT = (process.env.COMPANION_MINT || "").trim(); // TBA until launch
const COMPANION_TOKEN_PROGRAM = process.env.COMPANION_TOKEN_PROGRAM || "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const TICK_MS = 100;
const WALK_SPEED = 4.2; // tiles / second
const CHAT_MAX = 140;
const CHAT_COOLDOWN_MS = 1200;
const CHAT_WINDOW_MS = 15000;
const CHAT_WINDOW_MAX = 6;
const INV_SIZE = 28;
const PLAYER_HP = 20;

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
  return a;
}

function createAccount({ name, avatar, wallet }) {
  return persist.upsertAccount(hydrateAccount({
    id: persist.newAccountId(),
    wallet: wallet || null,
    name: String(name).slice(0, 16),
    avatar: resolveAvatar(avatar),
    x: staticWorld.spawn.x,
    y: staticWorld.spawn.y,
    gold: 15,
    hp: PLAYER_HP,
    skills: emptySkills(),
    inventory: [{ id: "cooked_fish", qty: 2 }],
    bank: {},
    equipped: {},
    biggestFish: 0,
    kills: 0,
    periods: leaderboard.normalizePeriods(null),
    lastRenamedAt: 0,
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
    action: s.action ? s.action.kind : null,
    holder: !!s.holderBadge,
    premiumName: !!s.account.equipped?.gold_nametag,
    wallet: s.account.wallet || null,
    walletLabel: shortWallet(s.account.wallet),
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
  };
}

function compactNodes() {
  return nodes.map((n) => ({
    id: n.id, type: n.type, x: n.x, y: n.y,
    depleted: !!n.depleted, skill: n.skill,
  }));
}

function compactMobs() {
  return mobs.map((m) => ({
    id: m.id, name: m.name, x: Math.round(m.fx * 100) / 100, y: Math.round(m.fy * 100) / 100,
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

function broadcastState() {
  const players = [...sessions.values()].map(publicPlayer);
  const msg = { type: "state", players, nodes: compactNodes(), mobs: compactMobs(), t: Date.now() };
  broadcast(msg);
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
    toast(s, `${sk ? sk.name : skill} level ${after.level}!`);
    systemChat(`${s.account.name} reached ${sk ? sk.name : skill} level ${after.level}.`);
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

function interact(s, targetId) {
  const npc = staticWorld.npcs.find((n) => n.id === targetId);
  if (npc) {
    walkThen(s, npc.x, npc.y, () => {
      if (npc.role === "bank") send(s.ws, { type: "open", panel: "bank" });
      else if (npc.role === "shop") send(s.ws, { type: "open", panel: "shop" });
      else if (npc.role === "cook") toast(s, "Click the cooking range to cook raw fish.");
      else toast(s, "你好，朋友. Grind, bank, and be kind.");
      send(s.ws, { type: "examine", text: npc.examine });
    });
    return;
  }
  const node = nodes.find((n) => n.id === targetId);
  if (node) {
    walkThen(s, node.x, node.y, () => beginNode(s, node));
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

function walkThen(s, tx, ty, cb) {
  const px = Math.round(s.x), py = Math.round(s.y);
  if (adj(px, py, tx, ty) || (px === tx && py === ty)) {
    s.path = [];
    cb && cb();
    return;
  }
  // path to a walkable adjacent tile
  let dest = null;
  if (isWalkable(tiles, tx, ty) && (px !== tx || py !== ty)) dest = { x: tx, y: ty };
  if (!dest) {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = tx + dx, y = ty + dy;
      if (isWalkable(tiles, x, y)) { dest = { x, y }; break; }
    }
  }
  if (!dest) { toast(s, "Can't reach that."); return; }
  const path = pathfind(tiles, s.x, s.y, dest.x, dest.y);
  if (!path.length) { toast(s, "No path."); return; }
  s.path = path;
  s.pending = cb || null;
  s.action = null;
}

function beginNode(s, node) {
  if (node.type === "range") {
    if (invCount(s.account.inventory, "raw_fish") < 1) {
      toast(s, "You need raw fish to cook.");
      return;
    }
    startAction(s, "cook", node.id, node.time || 1800);
    toast(s, "You start cooking...");
    return;
  }
  if (node.depleted) { toast(s, "Nothing there right now."); return; }
  if (s.account.inventory.length >= INV_SIZE && !(ITEMS[node.item] && ITEMS[node.item].stack && invCount(s.account.inventory, node.item) > 0)) {
    toast(s, "Your inventory is full.");
    return;
  }
  startAction(s, "gather", node.id, node.time || 2400);
  const sk = SKILLS.find((k) => k.id === node.skill);
  toast(s, `You start ${sk ? sk.verb : "working"}...`);
}

function finishGather(s, node) {
  if (!node || node.depleted) return;
  if (node.type === "range") return;
  if (!invAdd(s.account.inventory, node.item, 1)) {
    toast(s, "Your inventory is full.");
    cancelAction(s);
    return;
  }
  giveXp(s, node.skill, node.xp || 20);
  node.depleted = true;
  node.respawnAt = Date.now() + (node.respawn || 15000);
  const item = ITEMS[node.item];
  let note = `You get ${item ? item.name : node.item}.`;
  if (node.item === "raw_fish" || node.type === "fish") {
    const kg = rollFishKg();
    leaderboard.addPeriodFish(s.account, kg);
    const prev = Number(s.account.biggestFish) || 0;
    if (kg > prev) {
      s.account.biggestFish = kg;
      note = `You catch a ${kg.toFixed(1)} kg fish — new personal best!`;
    } else {
      note = `You catch a ${kg.toFixed(1)} kg fish.`;
    }
  }
  toast(s, note);
  send(s.ws, { type: "me", me: mePayload(s) });
  // auto-repeat if still there and node will respawn later — stop this cycle
  cancelAction(s);
}

function finishCook(s) {
  if (!invRemove(s.account.inventory, "raw_fish", 1)) {
    toast(s, "You have no more raw fish.");
    cancelAction(s);
    return;
  }
  if (!invAdd(s.account.inventory, "cooked_fish", 1)) {
    invAdd(s.account.inventory, "raw_fish", 1);
    toast(s, "Your inventory is full.");
    cancelAction(s);
    return;
  }
  giveXp(s, "cooking", 24);
  toast(s, "You cook a fish.");
  send(s.ws, { type: "me", me: mePayload(s) });
  if (invCount(s.account.inventory, "raw_fish") > 0) {
    s.action.next = Date.now() + 1800;
  } else {
    cancelAction(s);
    toast(s, "You finish cooking.");
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
  const dmg = 2 + Math.floor(Math.random() * 3) + Math.floor(levelFromXp(s.account.skills.combat || 0).level / 8);
  mob.hp -= dmg;
  mob.target = s.id;
  toast(s, `You hit the ${mob.name} for ${dmg}.`);
  if (mob.hp <= 0) {
    mob.alive = false;
    mob.hp = 0;
    mob.respawnAt = now + 20000;
    giveXp(s, "combat", 30);
    s.account.kills = (s.account.kills || 0) + 1;
    leaderboard.addPeriodKill(s.account);
    const gold = 5 + Math.floor(Math.random() * 11);
    s.account.gold += gold;
    leaderboard.addPeriodGold(s.account, gold);
    invAdd(s.account.inventory, "bones", 1);
    toast(s, `The ${mob.name} is defeated. +${gold} gold, dog bones.`);
    cancelAction(s);
    send(s.ws, { type: "me", me: mePayload(s) });
  }
}

function hitPlayer(s, dmg) {
  s.hp -= dmg;
  send(s.ws, { type: "toast", text: `A rival dog hits you for ${dmg}.` });
  if (s.hp <= 0) {
    s.hp = PLAYER_HP;
    s.x = staticWorld.spawn.x;
    s.y = staticWorld.spawn.y;
    s.path = [];
    cancelAction(s);
    toast(s, "You wake up back in Ni Hao Village. (Prototype: you keep your items.)");
    send(s.ws, { type: "me", me: mePayload(s) });
  } else {
    send(s.ws, { type: "me", me: mePayload(s) });
  }
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
  if (!def || !def.cosmetic) { toast(s, "You can't wear that."); return; }
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
  const entry = { from: s.account.name, text: cleaned, ts: now, system: false, holder: !!s.holderBadge };
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
    },
    items: ITEMS,
    skills: SKILLS,
    avatars: AVATARS,
    shop: SHOP,
    premiumShop: PREMIUM_SHOP,
    mihaoMint: MIHAO_MINT,
    companionMint: COMPANION_MINT || null,
    dexscreener: DEXSCREENER,
    players: [...sessions.values()].map(publicPlayer),
    nodes: compactNodes(),
    mobs: compactMobs(),
    chatLog: chatLog.slice(-40),
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
  if (account.wallet) live.wallet = account.wallet;
  send(ws, welcomePayload(live));
  systemChat(`${account.name} has arrived in Ni Hao Village.`);
  broadcastState();
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
      cancelAction(s);
      s.pending = null;
      s.targetMob = null;
      const path = pathfind(tiles, s.x, s.y, x, y);
      s.path = path;
      if (!path.length && !(Math.round(s.x) === x && Math.round(s.y) === y)) toast(s, "No path.");
      break;
    }
    case "interact":
      if (typeof msg.id === "string") interact(s, msg.id);
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
      break;
    case "wallet":
      // client reports a public key after a read-only Phantom connect. No signatures accepted.
      if (typeof msg.address === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(msg.address)) {
        s.wallet = msg.address;
        s.holderBadge = !!msg.holder;
        send(s.ws, { type: "me", me: mePayload(s) });
        if (s.holderBadge) toast(s, "mihao holder badge enabled (read-only balance check).");
      }
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
      const step = s.path[0];
      const dx = step.x - s.x, dy = step.y - s.y;
      const dist = Math.hypot(dx, dy);
      const move = WALK_SPEED * dt;
      if (dist <= move || dist < 0.02) {
        s.x = step.x;
        s.y = step.y;
        s.path.shift();
        if (!s.path.length && s.pending) {
          const cb = s.pending;
          s.pending = null;
          cb();
        }
      } else {
        s.x += (dx / dist) * move;
        s.y += (dy / dist) * move;
      }
      changed = true;
      const z = zoneAt(s.x, s.y);
      if (z.id !== s.lastZone) {
        s.lastZone = z.id;
        toast(s, `Entering ${z.name}`);
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
      } else if (s.action.kind === "combat") {
        combatTick(s, now);
        changed = true;
      }
    }
  }

  for (const n of nodes) {
    if (n.depleted && n.respawnAt && now >= n.respawnAt) {
      n.depleted = false;
      n.respawnAt = 0;
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
        m.path = [];
        changed = true;
      }
      continue;
    }
    // aggro / attack
    if (m.target) {
      const victim = [...sessions.values()].find((s) => s.id === m.target);
      if (!victim) m.target = null;
      else {
        if (!adj(Math.round(m.fx), Math.round(m.fy), Math.round(victim.x), Math.round(victim.y))) {
          const path = pathfind(tiles, m.fx, m.fy, Math.round(victim.x), Math.round(victim.y), 40);
          m.path = path;
        } else if (now >= m.nextHit) {
          m.nextHit = now + 1400;
          hitPlayer(victim, 1 + Math.floor(Math.random() * 3));
          changed = true;
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
      const move = 2.4 * dt;
      if (dist <= move) { m.fx = step.x; m.fy = step.y; m.path.shift(); }
      else { m.fx += (dx / dist) * move; m.fy += (dy / dist) * move; }
      m.x = m.fx; m.y = m.fy;
      changed = true;
    }
  }

  if (changed) broadcastState();
}

// --- HTTP + WS ---
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
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
    companionMint: COMPANION_MINT || null,
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
    let companion = null;
    if (COMPANION_MINT) companion = await tokenBalance(address, COMPANION_MINT, COMPANION_TOKEN_PROGRAM);
    res.json({
      address,
      mihao,
      companion,
      holder: mihao.uiAmount > 0,
      companionHolder: !!(companion && companion.uiAmount > 0),
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
  server.listen(PORT, HOST, () => {
    console.log(`[Ni Hao Lands] unofficial fan MMO listening on http://${HOST}:${PORT} (${persist.backend()} store)`);
    console.log("Not financial advice. No token purchases. Wallet sign-in uses signMessage only. Art from the mihao pfps Meme Depot community.");
  });
}

main().catch((e) => {
  console.error("[server] failed to start", e);
  process.exit(1);
});
