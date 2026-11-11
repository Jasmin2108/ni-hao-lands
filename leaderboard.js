// Shared leaderboard rankings for Ni Hao Lands.
// Computed from the in-memory accounts map (loaded from JSON or Postgres on boot).

const { SKILLS, levelFromXp } = require("./world");

const CACHE_MS = 30 * 1000;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const HIDDEN_PREFIX = /^(PersistTest|PickerShot|WalletCat)/;
const HIDDEN_PAIR = /^(Scout|Jasmin)\d{6}$/;

const BOARDS = [
  { id: "fishing", name: "Fishing", kind: "skill", skill: "fishing", unit: "level" },
  { id: "yarn", name: "Yarn-gathering", kind: "skill", skill: "yarn", unit: "level" },
  { id: "mining", name: "Mining", kind: "skill", skill: "mining", unit: "level" },
  { id: "cooking", name: "Cooking", kind: "skill", skill: "cooking", unit: "level" },
  { id: "combat", name: "Combat", kind: "skill", skill: "combat", unit: "level" },
  { id: "total", name: "Total level", kind: "total", unit: "level" },
  { id: "gold", name: "Gold", kind: "gold", unit: "gold" },
  { id: "fish", name: "Biggest fish", kind: "fish", unit: "kg" },
  { id: "kills", name: "Dogs defeated", kind: "kills", unit: "kills" },
];

const BOARDS_BY_ID = new Map(BOARDS.map((b) => [b.id, b]));

function isHiddenName(name) {
  const n = String(name || "");
  return HIDDEN_PREFIX.test(n) || HIDDEN_PAIR.test(n);
}

function shortWallet(pubkey) {
  if (!pubkey || String(pubkey).length < 8) return "";
  return String(pubkey).slice(0, 4) + "…" + String(pubkey).slice(-4);
}

function skillXp(account, skillId) {
  const skills = (account && account.skills) || {};
  return Math.max(0, skills[skillId] | 0);
}

function skillLevel(account, skillId) {
  return levelFromXp(skillXp(account, skillId)).level;
}

function totalLevel(account) {
  let sum = 0;
  for (const sk of SKILLS) sum += skillLevel(account, sk.id);
  return sum;
}

function totalGold(account) {
  // Bank holds items only, not gold, so this is pocket gold.
  return Math.max(0, (account && account.gold) | 0);
}

function biggestFish(account) {
  const n = Number(account && account.biggestFish);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function kills(account) {
  return Math.max(0, (account && account.kills) | 0);
}

function formatValue(board, value, account) {
  if (board.kind === "skill") {
    const xp = skillXp(account, board.skill);
    return `lvl ${value} (${xp} xp)`;
  }
  if (board.kind === "total") return String(value);
  if (board.kind === "gold") return value + " gold";
  if (board.kind === "fish") return value.toFixed(1) + " kg";
  if (board.kind === "kills") return String(value);
  return String(value);
}

function metric(board, account) {
  if (board.kind === "skill") {
    const xp = skillXp(account, board.skill);
    const level = levelFromXp(xp).level;
    return { value: level, tie: xp };
  }
  if (board.kind === "total") {
    return { value: totalLevel(account), tie: SKILLS.reduce((s, sk) => s + skillXp(account, sk.id), 0) };
  }
  if (board.kind === "gold") return { value: totalGold(account), tie: 0 };
  if (board.kind === "fish") return { value: biggestFish(account), tie: 0 };
  if (board.kind === "kills") return { value: kills(account), tie: 0 };
  return { value: 0, tie: 0 };
}

function qualifies(board, value) {
  if (board.kind === "fish" || board.kind === "kills") return value > 0;
  return true;
}

function entryFrom(account, board, rank, scored) {
  const value = scored.value;
  return {
    rank,
    name: account.name,
    avatar: account.avatar || "classic-paw",
    walletLabel: account.wallet ? shortWallet(account.wallet) : "",
    value,
    display: formatValue(board, value, account),
  };
}

function rankBoard(accounts, board) {
  const rows = [];
  for (const a of accounts) {
    if (!a || !a.name || isHiddenName(a.name)) continue;
    const scored = metric(board, a);
    if (!qualifies(board, scored.value)) continue;
    rows.push({ account: a, scored });
  }
  rows.sort((a, b) => {
    if (b.scored.value !== a.scored.value) return b.scored.value - a.scored.value;
    if (b.scored.tie !== a.scored.tie) return b.scored.tie - a.scored.tie;
    return String(a.account.name).localeCompare(String(b.account.name));
  });
  return rows.map((row, i) => entryFrom(row.account, board, i + 1, row.scored));
}

let cache = { at: 0, byId: new Map() };

function invalidateCache() {
  cache = { at: 0, byId: new Map() };
}

function buildAll(accounts) {
  const byId = new Map();
  for (const board of BOARDS) byId.set(board.id, rankBoard(accounts, board));
  cache = { at: Date.now(), byId };
  return byId;
}

function listBoards() {
  return BOARDS.map((b) => ({ id: b.id, name: b.name, unit: b.unit }));
}

function getLeaderboard(accounts, { board: boardId, limit, viewer } = {}) {
  const board = BOARDS_BY_ID.get(String(boardId || ""));
  if (!board) {
    return { error: "Unknown board", boards: listBoards() };
  }
  let lim = Number(limit);
  if (!Number.isFinite(lim)) lim = DEFAULT_LIMIT;
  lim = Math.max(1, Math.min(MAX_LIMIT, lim | 0));

  const now = Date.now();
  if (!cache.at || now - cache.at > CACHE_MS || cache.byId.size === 0) {
    buildAll(accounts);
  }
  const ranked = cache.byId.get(board.id) || [];
  const entries = ranked.slice(0, lim);
  let you = null;
  if (viewer && viewer.name) {
    you = ranked.find((e) => e.name === viewer.name) || {
      rank: null,
      name: viewer.name,
      avatar: viewer.avatar || "classic-paw",
      walletLabel: viewer.wallet ? shortWallet(viewer.wallet) : "",
      value: metric(board, viewer).value,
      display: formatValue(board, metric(board, viewer).value, viewer),
      unranked: true,
    };
  }
  return {
    board: board.id,
    name: board.name,
    unit: board.unit,
    boards: listBoards(),
    entries,
    you,
    total: ranked.length,
    cachedAt: cache.at,
  };
}

module.exports = {
  BOARDS,
  CACHE_MS,
  DEFAULT_LIMIT,
  isHiddenName,
  listBoards,
  getLeaderboard,
  invalidateCache,
  rankBoard,
  shortWallet,
};
