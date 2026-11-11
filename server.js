// Ni Hao Lands — unofficial fan MMO prototype server.
// No wallets, no fund movement, no token purchases. Not financial advice.

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { WebSocketServer } = require("ws");

const world = require("./world");
const {
  AVATARS, SKILLS, ITEMS, SHOP, PREMIUM_SHOP,
  MIHAO_MINT, MIHAO_TOKEN_PROGRAM, DEXSCREENER,
  levelFromXp, emptySkills, isWalkable, pathfind, zoneAt, adj, buildWorld,
} = world;

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.join(__dirname, "data");
const SAVE_FILE = path.join(DATA_DIR, "players.json");
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

/** token -> saved player record */
const accounts = new Map();
/** ws -> live session */
const sessions = new Map();
const chatLog = [];
const MAX_CHAT_LOG = 80;

function loadAccounts() {
  try {
    if (!fs.existsSync(SAVE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));
    const list = Array.isArray(raw) ? raw : raw.players || [];
    for (const p of list) {
      if (p && p.token && p.name) accounts.set(p.token, sanitizeAccount(p));
    }
    console.log(`[save] loaded ${accounts.size} accounts`);
  } catch (e) {
    console.error("[save] load failed", e.message);
  }
}

function sanitizeAccount(p) {
  return {
    token: String(p.token),
    name: String(p.name).slice(0, 16),
    avatar: AVATARS.some((a) => a.id === p.avatar) ? p.avatar : "classic-paw",
    x: Number.isFinite(p.x) ? p.x : staticWorld.spawn.x,
    y: Number.isFinite(p.y) ? p.y : staticWorld.spawn.y,
    gold: Math.max(0, p.gold | 0),
    hp: Math.max(1, Math.min(PLAYER_HP, p.hp | 0 || PLAYER_HP)),
    skills: { ...emptySkills(), ...(p.skills || {}) },
    inventory: Array.isArray(p.inventory) ? p.inventory.slice(0, INV_SIZE) : [],
    bank: p.bank && typeof p.bank === "object" ? p.bank : {},
    equipped: p.equipped && typeof p.equipped === "object" ? p.equipped : {},
    created: p.created || Date.now(),
  };
}

function saveAccounts() {
  try {
    // flush live positions into accounts
    for (const s of sessions.values()) {
      if (s.account) Object.assign(accounts.get(s.account.token) || s.account, snapshot(s));
    }
    const players = [...accounts.values()];
    fs.writeFileSync(SAVE_FILE, JSON.stringify({ savedAt: Date.now(), players }, null, 2));
  } catch (e) {
    console.error("[save] write failed", e.message);
  }
}

function snapshot(s) {
  const a = s.account;
  return {
    token: a.token,
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
    created: a.created,
  };
}

function randToken() {
  return crypto.randomBytes(24).toString("hex");
}

function validName(name) {
  if (typeof name !== "string") return "Pick a name.";
  const n = name.trim();
  if (n.length < 2 || n.length > 16) return "Name must be 2–16 characters.";
  if (!/^[A-Za-z0-9_]+$/.test(n)) return "Name can only use letters, numbers, and underscores.";
  if (isProfane(n)) return "That name isn't allowed.";
  return null;
}

function nameTaken(name, exceptToken) {
  const lower = name.toLowerCase();
  for (const a of accounts.values()) {
    if (a.token !== exceptToken && a.name.toLowerCase() === lower) return true;
  }
  return false;
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
    name: s.account.name,
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
    token: s.account.token,
    gold: s.account.gold,
    skills,
    inventory: s.account.inventory,
    bank: s.account.bank,
    equipped: s.account.equipped,
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
  s.account.skills[skill] = (s.account.skills[skill] || 0) + amount;
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
  toast(s, `You get ${item ? item.name : node.item}.`);
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
    const gold = 5 + Math.floor(Math.random() * 11);
    s.account.gold += gold;
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

function newLive(ws, account) {
  const s = {
    ws,
    id: "p_" + crypto.randomBytes(6).toString("hex"),
    account,
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
    wallet: null,
  };
  sessions.set(ws, s);
  return s;
}

function onHello(ws, msg) {
  let account = null;
  if (msg.token && accounts.has(String(msg.token))) {
    account = accounts.get(String(msg.token));
    if (msg.avatar && AVATARS.some((a) => a.id === msg.avatar)) account.avatar = msg.avatar;
  } else {
    const err = validName(msg.name || "");
    if (err) { send(ws, { type: "error", text: err }); return; }
    const name = String(msg.name).trim();
    if (nameTaken(name)) { send(ws, { type: "error", text: "That name is already in this world." }); return; }
    const avatar = AVATARS.some((a) => a.id === msg.avatar) ? msg.avatar : "classic-paw";
    account = {
      token: randToken(),
      name,
      avatar,
      x: staticWorld.spawn.x,
      y: staticWorld.spawn.y,
      gold: 15,
      hp: PLAYER_HP,
      skills: emptySkills(),
      inventory: [{ id: "cooked_fish", qty: 2 }],
      bank: {},
      equipped: {},
      created: Date.now(),
    };
    accounts.set(account.token, account);
    saveAccounts();
  }
  // already connected from another tab?
  for (const [other, s] of sessions) {
    if (s.account.token === account.token && other !== ws) {
      send(other, { type: "error", text: "You signed in from another window." });
      other.close();
      sessions.delete(other);
    }
  }
  const live = newLive(ws, account);
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
app.use(express.json({ limit: "32kb" }));
app.use("/assets", express.static(path.join(__dirname, "assets"), { maxAge: "1h" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, players: sessions.size, accounts: accounts.size, uptime: process.uptime() });
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
      accounts.set(s.account.token, s.account);
      sessions.delete(ws);
      systemChat(`${s.account.name} has left.`);
      broadcastState();
    }
  });
  ws.on("error", () => {});
});

loadAccounts();
let last = Date.now();
const ticker = setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  tick(dt, now);
}, TICK_MS);

const saveTimer = setInterval(saveAccounts, 20000);

function shutdown() {
  console.log("[server] shutting down, saving...");
  saveAccounts();
  clearInterval(ticker);
  clearInterval(saveTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, HOST, () => {
  console.log(`[Ni Hao Lands] unofficial fan MMO listening on http://${HOST}:${PORT}`);
  console.log("Not financial advice. No token purchases. Art from the mihao pfps Meme Depot community.");
});
