// Account, session, and avatar storage for Ni Hao Lands.
// Uses Postgres when DATABASE_URL is set; otherwise data/players.json + data/avatars.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 1500;

let pool = null;
let dataDir = null;
let saveFile = null;
let avatarDir = null;
let dirty = false;
let debounceTimer = null;
let saving = false;

/** @type {Map<string, object>} */
const accountsById = new Map();
/** @type {Map<string, { token: string, accountId: string, expires: number|null }>} */
const sessionsByToken = new Map();
/** @type {Map<string, { mime: string, buf?: Buffer }>} */
const avatarsMeta = new Map();

function usingPg() {
  return !!pool;
}

function backend() {
  return pool ? "postgres" : "json";
}

function accountCount() {
  return accountsById.size;
}

function allAccounts() {
  return [...accountsById.values()];
}

function getById(id) {
  return accountsById.get(id) || null;
}

function getByToken(token) {
  if (!token) return null;
  const sess = sessionsByToken.get(String(token));
  if (!sess) return null;
  if (sess.expires && Date.now() > sess.expires) {
    sessionsByToken.delete(String(token));
    dirty = true;
    scheduleSave();
    return null;
  }
  return accountsById.get(sess.accountId) || null;
}

function getSession(token) {
  const sess = sessionsByToken.get(String(token || ""));
  if (!sess) return null;
  if (sess.expires && Date.now() > sess.expires) {
    sessionsByToken.delete(String(token));
    dirty = true;
    scheduleSave();
    return null;
  }
  return sess;
}

function getByWallet(wallet) {
  if (!wallet) return null;
  for (const a of accountsById.values()) {
    if (a.wallet && a.wallet === wallet) return a;
  }
  return null;
}

function getByName(name) {
  if (!name) return null;
  const lower = String(name).toLowerCase();
  for (const a of accountsById.values()) {
    if (a.name && a.name.toLowerCase() === lower) return a;
  }
  return null;
}

function nameTaken(name, exceptId) {
  const lower = String(name || "").toLowerCase();
  for (const a of accountsById.values()) {
    if (a.id !== exceptId && a.name.toLowerCase() === lower) return true;
  }
  return false;
}

function newAccountId() {
  return "a_" + crypto.randomBytes(12).toString("hex");
}

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

function upsertAccount(account) {
  if (!account.id) account.id = newAccountId();
  accountsById.set(account.id, account);
  dirty = true;
  scheduleSave();
  return account;
}

function addSession(token, accountId, expires) {
  sessionsByToken.set(token, { token, accountId, expires: expires || null });
  dirty = true;
  scheduleSave();
  return sessionsByToken.get(token);
}

function issueSession(accountId, { expire } = {}) {
  const token = newToken();
  const expires = expire ? Date.now() + SESSION_MS : null;
  return addSession(token, accountId, expires);
}

function avatarExists(id) {
  return avatarsMeta.has(id);
}

function isCustomAvatarId(id) {
  return typeof id === "string" && /^[a-f0-9]{16,32}$/.test(id);
}

async function readAvatar(id) {
  if (!isCustomAvatarId(id)) return null;
  const meta = avatarsMeta.get(id);
  if (!meta) return null;
  if (meta.buf && Buffer.isBuffer(meta.buf)) return meta;
  if (pool) {
    const r = await pool.query("SELECT mime, bytes FROM avatars WHERE id = $1", [id]);
    if (!r.rows[0]) return null;
    const rec = { mime: r.rows[0].mime, buf: Buffer.from(r.rows[0].bytes) };
    avatarsMeta.set(id, rec);
    return rec;
  }
  const ext = meta.mime === "image/webp" ? ".webp" : ".png";
  const file = path.join(avatarDir, id + ext);
  if (!fs.existsSync(file)) return null;
  const rec = { mime: meta.mime, buf: fs.readFileSync(file) };
  avatarsMeta.set(id, rec);
  return rec;
}

async function putAvatar(id, mime, buf) {
  if (!isCustomAvatarId(id)) throw new Error("invalid avatar id");
  const rec = { mime, buf };
  avatarsMeta.set(id, rec);
  if (pool) {
    await pool.query(
      "INSERT INTO avatars (id, mime, bytes, created) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET mime = EXCLUDED.mime, bytes = EXCLUDED.bytes",
      [id, mime, buf, Date.now()]
    );
    return;
  }
  fs.mkdirSync(avatarDir, { recursive: true });
  const ext = mime === "image/webp" ? ".webp" : ".png";
  for (const other of [".png", ".webp"]) {
    const leftover = path.join(avatarDir, id + other);
    if (other !== ext && fs.existsSync(leftover)) fs.unlinkSync(leftover);
  }
  fs.writeFileSync(path.join(avatarDir, id + ext), buf);
}

async function removeAvatar(id) {
  if (!isCustomAvatarId(id)) return;
  avatarsMeta.delete(id);
  if (pool) {
    try { await pool.query("DELETE FROM avatars WHERE id = $1", [id]); } catch (e) { console.error("[persist] avatar delete", e.message); }
    return;
  }
  for (const ext of [".png", ".webp"]) {
    const file = path.join(avatarDir, id + ext);
    if (fs.existsSync(file)) {
      try { fs.unlinkSync(file); } catch (e) { console.error("[persist] avatar delete", e.message); }
    }
  }
}

function markDirty() {
  dirty = true;
  scheduleSave();
}

function scheduleSave() {
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    save().catch((e) => console.error("[persist] save failed", e.message));
  }, SAVE_DEBOUNCE_MS);
}

function pgConfig(url) {
  const needsSsl = /render\.com/i.test(url) && !/\.internal/i.test(url) && !/sslmode=disable/i.test(url);
  return {
    connectionString: url,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 5,
  };
}

async function init(opts) {
  dataDir = opts.dataDir;
  saveFile = path.join(dataDir, "players.json");
  avatarDir = opts.avatarDir || path.join(dataDir, "avatars");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(avatarDir, { recursive: true });

  const url = (process.env.DATABASE_URL || "").trim();
  if (url) {
    const { Pool } = require("pg");
    pool = new Pool(pgConfig(url));
    await pool.query("SELECT 1");
    await createTables();
    await loadFromPostgres();
    console.log(`[persist] postgres ready (${accountsById.size} accounts, ${sessionsByToken.size} sessions, ${avatarsMeta.size} pictures)`);
    await maybeImportJsonOnce();
    return;
  }

  loadFromJson();
  loadAvatarsFromDisk();
  console.log(`[persist] json store at ${saveFile} (${accountsById.size} accounts, ${sessionsByToken.size} sessions, ${avatarsMeta.size} pictures)`);
}

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      wallet TEXT UNIQUE,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT 'classic-paw',
      x DOUBLE PRECISION,
      y DOUBLE PRECISION,
      gold INTEGER,
      hp INTEGER,
      skills JSONB,
      inventory JSONB,
      bank JSONB,
      equipped JSONB,
      stats JSONB,
      created BIGINT,
      updated BIGINT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires BIGINT
    );
    CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions(account_id);
    CREATE TABLE IF NOT EXISTS avatars (
      id TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      bytes BYTEA NOT NULL,
      created BIGINT
    );
  `);
  await pool.query("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS stats JSONB");
}

function ingestAccount(p) {
  if (!p || !p.name) return null;
  const id = p.id || (p.token ? "a_" + p.token.slice(0, 24) : newAccountId());
  const account = {
    id,
    wallet: p.wallet || null,
    name: String(p.name).slice(0, 16),
    avatar: p.avatar || "classic-paw",
    x: Number.isFinite(p.x) ? p.x : 0,
    y: Number.isFinite(p.y) ? p.y : 0,
    gold: Math.max(0, p.gold | 0),
    hp: p.hp | 0,
    skills: p.skills && typeof p.skills === "object" ? p.skills : {},
    inventory: Array.isArray(p.inventory) ? p.inventory : [],
    bank: p.bank && typeof p.bank === "object" ? p.bank : {},
    equipped: p.equipped && typeof p.equipped === "object" ? p.equipped : {},
    biggestFish: Math.max(0, Number((p.stats && p.stats.biggestFish) ?? p.biggestFish) || 0),
    kills: Math.max(0, ((p.stats && p.stats.kills) ?? p.kills) | 0),
    periods: p.periods || (p.stats && p.stats.periods) || null,
    lastRenamedAt: Math.max(0, Number(p.lastRenamedAt ?? (p.stats && p.stats.lastRenamedAt) ?? 0) || 0),
    quests: p.quests || (p.stats && p.stats.quests) || null,
    daily: p.daily || (p.stats && p.stats.daily) || null,
    bestStreak: Math.max(0, ((p.stats && p.stats.bestStreak) ?? p.bestStreak) | 0),
    meta: p.meta || (p.stats && p.stats.meta) || null,
    created: p.created || Date.now(),
  };
  accountsById.set(account.id, account);
  return account;
}

function ingestSession(token, accountId, expires) {
  if (!token || !accountId || !accountsById.has(accountId)) return;
  sessionsByToken.set(token, {
    token,
    accountId,
    expires: expires == null || expires === 0 ? null : Number(expires),
  });
}

function loadFromJson() {
  try {
    if (!fs.existsSync(saveFile)) return;
    const raw = JSON.parse(fs.readFileSync(saveFile, "utf8"));
    const list = Array.isArray(raw) ? raw : raw.players || [];
    for (const p of list) {
      const acc = ingestAccount(p);
      if (acc && p.token && !(raw.sessions && raw.sessions.length)) {
        ingestSession(p.token, acc.id, p.sessionExpires || null);
      }
    }
    for (const s of raw.sessions || []) {
      ingestSession(s.token, s.accountId, s.expires);
    }
  } catch (e) {
    console.error("[persist] json load failed", e.message);
  }
}

function loadAvatarsFromDisk() {
  try {
    if (!fs.existsSync(avatarDir)) return;
    for (const name of fs.readdirSync(avatarDir)) {
      const m = /^([a-f0-9]{16,32})\.(png|webp)$/.exec(name);
      if (!m) continue;
      avatarsMeta.set(m[1], { mime: m[2] === "webp" ? "image/webp" : "image/png" });
    }
  } catch (e) {
    console.error("[persist] avatar scan failed", e.message);
  }
}

async function loadFromPostgres() {
  const acc = await pool.query("SELECT * FROM accounts");
  for (const row of acc.rows) {
    ingestAccount({
      id: row.id,
      wallet: row.wallet,
      name: row.name,
      avatar: row.avatar,
      x: Number(row.x),
      y: Number(row.y),
      gold: row.gold,
      hp: row.hp,
      skills: row.skills,
      inventory: row.inventory,
      bank: row.bank,
      equipped: row.equipped,
      stats: row.stats,
      biggestFish: row.stats && row.stats.biggestFish,
      kills: row.stats && row.stats.kills,
      periods: row.stats && row.stats.periods,
      lastRenamedAt: row.stats && row.stats.lastRenamedAt,
      quests: row.stats && row.stats.quests,
      daily: row.stats && row.stats.daily,
      bestStreak: row.stats && row.stats.bestStreak,
      meta: row.stats && row.stats.meta,
      created: Number(row.created) || Date.now(),
    });
  }
  const sess = await pool.query("SELECT token, account_id, expires FROM sessions");
  for (const row of sess.rows) ingestSession(row.token, row.account_id, row.expires);
  const avs = await pool.query("SELECT id, mime FROM avatars");
  for (const row of avs.rows) avatarsMeta.set(row.id, { mime: row.mime });
}

async function maybeImportJsonOnce() {
  if (!fs.existsSync(saveFile)) return;
  if (accountsById.size > 0) return;
  const before = accountsById.size;
  loadFromJson();
  loadAvatarsFromDisk();
  if (accountsById.size > before) {
    console.log(`[persist] imported ${accountsById.size - before} json accounts into postgres`);
    dirty = true;
    await save();
    // copy disk avatars into bytea
    for (const [id, meta] of [...avatarsMeta.entries()]) {
      if (meta.buf) continue;
      const rec = await readAvatar(id).catch(() => null);
      if (rec && rec.buf) {
        await pool.query(
          "INSERT INTO avatars (id, mime, bytes, created) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
          [id, rec.mime, rec.buf, Date.now()]
        );
      }
    }
  }
}

function serializePlayers() {
  return {
    savedAt: Date.now(),
    players: allAccounts(),
    sessions: [...sessionsByToken.values()],
  };
}

async function save() {
  if (saving) { dirty = true; return; }
  dirty = false;
  saving = true;
  try {
    if (pool) await saveToPostgres();
    else saveToJson();
  } catch (e) {
    dirty = true;
    console.error("[persist] write failed", e.message);
  } finally {
    saving = false;
    if (dirty) scheduleSave();
  }
}

function saveToJson() {
  const tmp = saveFile + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(serializePlayers(), null, 2));
  fs.renameSync(tmp, saveFile);
}

async function saveToPostgres() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const a of accountsById.values()) {
      await client.query(
        `INSERT INTO accounts (id, wallet, name, avatar, x, y, gold, hp, skills, inventory, bank, equipped, stats, created, updated)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15)
         ON CONFLICT (id) DO UPDATE SET
           wallet = EXCLUDED.wallet,
           name = EXCLUDED.name,
           avatar = EXCLUDED.avatar,
           x = EXCLUDED.x,
           y = EXCLUDED.y,
           gold = EXCLUDED.gold,
           hp = EXCLUDED.hp,
           skills = EXCLUDED.skills,
           inventory = EXCLUDED.inventory,
           bank = EXCLUDED.bank,
           equipped = EXCLUDED.equipped,
           stats = EXCLUDED.stats,
           created = EXCLUDED.created,
           updated = EXCLUDED.updated`,
        [
          a.id, a.wallet || null, a.name, a.avatar, a.x, a.y, a.gold, a.hp,
          JSON.stringify(a.skills || {}), JSON.stringify(a.inventory || []),
          JSON.stringify(a.bank || {}), JSON.stringify(a.equipped || {}),
          JSON.stringify({ biggestFish: Math.max(0, Number(a.biggestFish) || 0), kills: Math.max(0, a.kills | 0), periods: a.periods || null, lastRenamedAt: Math.max(0, Number(a.lastRenamedAt) || 0), quests: a.quests || null, daily: a.daily || null, bestStreak: Math.max(0, a.bestStreak | 0), meta: a.meta || null }),
          a.created || Date.now(), Date.now(),
        ]
      );
    }
    for (const s of sessionsByToken.values()) {
      await client.query(
        `INSERT INTO sessions (token, account_id, expires) VALUES ($1, $2, $3)
         ON CONFLICT (token) DO UPDATE SET account_id = EXCLUDED.account_id, expires = EXCLUDED.expires`,
        [s.token, s.accountId, s.expires]
      );
    }
    const tokens = [...sessionsByToken.keys()];
    if (tokens.length) {
      await client.query("DELETE FROM sessions WHERE NOT (token = ANY($1::text[]))", [tokens]);
    } else {
      await client.query("DELETE FROM sessions");
    }
    const ids = [...accountsById.keys()];
    if (ids.length) {
      await client.query("DELETE FROM accounts WHERE NOT (id = ANY($1::text[]))", [ids]);
    }
    await client.query("COMMIT");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

async function close() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  await save();
  if (pool) {
    try { await pool.end(); } catch {}
    pool = null;
  }
}

module.exports = {
  SESSION_MS,
  init,
  close,
  save,
  markDirty,
  usingPg,
  backend,
  accountCount,
  allAccounts,
  getById,
  getByToken,
  getSession,
  getByWallet,
  getByName,
  nameTaken,
  newAccountId,
  newToken,
  upsertAccount,
  addSession,
  issueSession,
  avatarExists,
  isCustomAvatarId,
  readAvatar,
  putAvatar,
  removeAvatar,
};
