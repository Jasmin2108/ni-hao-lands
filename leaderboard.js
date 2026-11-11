// Shared leaderboard rankings for Ni Hao Lands.
// Computed from the in-memory accounts map (loaded from JSON or Postgres on boot).
// Weekly / monthly boards use per-account period counters in Europe/Helsinki time.

const { SKILLS, levelFromXp } = require("./world");

const CACHE_MS = 30 * 1000;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const TZ = "Europe/Helsinki";

const HIDDEN_PREFIX = /^(PersistTest|PickerShot|WalletCat)/;
const HIDDEN_PAIR = /^(Scout|Jasmin)\d{6}$/;

const PERIODS = [
  { id: "week", name: "Weekly", reset: "Resets Monday 00:00 Helsinki" },
  { id: "month", name: "Monthly", reset: "Resets on the 1st" },
  { id: "all", name: "All-time", reset: "" },
];

const BOARDS = [
  { id: "fishing", name: "Fishing", kind: "skill", skill: "fishing", unit: "level" },
  { id: "yarn", name: "Yarn-gathering", kind: "skill", skill: "yarn", unit: "level" },
  { id: "woodcutting", name: "Woodcutting", kind: "skill", skill: "woodcutting", unit: "level" },
  { id: "mining", name: "Mining", kind: "skill", skill: "mining", unit: "level" },
  { id: "smithing", name: "Smithing", kind: "skill", skill: "smithing", unit: "level" },
  { id: "cooking", name: "Cooking", kind: "skill", skill: "cooking", unit: "level" },
  { id: "combat", name: "Combat", kind: "skill", skill: "combat", unit: "level" },
  { id: "total", name: "Total level", kind: "total", unit: "level" },
  { id: "gold", name: "Gold", kind: "gold", unit: "gold" },
  { id: "fish", name: "Biggest fish", kind: "fish", unit: "kg" },
  { id: "kills", name: "Dogs defeated", kind: "kills", unit: "kills" },
];

const BOARDS_BY_ID = new Map(BOARDS.map((b) => [b.id, b]));
const PERIODS_BY_ID = new Map(PERIODS.map((p) => [p.id, p]));

function isHiddenName(name) {
  const n = String(name || "");
  return HIDDEN_PREFIX.test(n) || HIDDEN_PAIR.test(n);
}

function shortWallet(pubkey) {
  if (!pubkey || String(pubkey).length < 8) return "";
  return String(pubkey).slice(0, 4) + "…" + String(pubkey).slice(-4);
}

function helsinkiYmd(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

// ISO week id for the civil date in Europe/Helsinki, weeks starting Monday 00:00.
function isoWeekId(date = new Date()) {
  const { year, month, day } = helsinkiYmd(date);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const isoYear = utc.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((utc.getTime() - yearStart) / 86400000 + 1) / 7);
  return isoYear + "-W" + String(week).padStart(2, "0");
}

function monthId(date = new Date()) {
  const { year, month } = helsinkiYmd(date);
  return year + "-" + String(month).padStart(2, "0");
}

function emptyPeriodStats() {
  return { fishing: 0, yarn: 0, woodcutting: 0, mining: 0, smithing: 0, cooking: 0, combat: 0, xp: 0, gold: 0, fish: 0, kills: 0 };
}

function cloneStats(src) {
  const out = emptyPeriodStats();
  if (!src || typeof src !== "object") return out;
  for (const k of Object.keys(out)) {
    const n = k === "fish" ? Number(src[k]) : (src[k] | 0);
    out[k] = Number.isFinite(n) && n > 0 ? (k === "fish" ? n : n | 0) : 0;
  }
  return out;
}

function normalizePeriods(raw) {
  if (!raw || typeof raw !== "object") return { week: "", month: "", w: emptyPeriodStats(), m: emptyPeriodStats() };
  return {
    week: typeof raw.week === "string" ? raw.week : "",
    month: typeof raw.month === "string" ? raw.month : "",
    w: cloneStats(raw.w),
    m: cloneStats(raw.m),
  };
}

function touchPeriods(account, date = new Date()) {
  const week = isoWeekId(date);
  const month = monthId(date);
  const p = normalizePeriods(account && account.periods);
  if (p.week !== week) {
    p.week = week;
    p.w = emptyPeriodStats();
  }
  if (p.month !== month) {
    p.month = month;
    p.m = emptyPeriodStats();
  }
  if (account) account.periods = p;
  return p;
}

function addPeriodXp(account, skill, amount) {
  amount = amount | 0;
  if (!account || amount <= 0) return;
  const p = touchPeriods(account);
  for (const bucket of [p.w, p.m]) {
    if (Object.prototype.hasOwnProperty.call(bucket, skill)) bucket[skill] += amount;
    bucket.xp += amount;
  }
}

function addPeriodGold(account, amount) {
  amount = amount | 0;
  if (!account || amount <= 0) return;
  const p = touchPeriods(account);
  p.w.gold += amount;
  p.m.gold += amount;
}

function addPeriodFish(account, kg) {
  kg = Number(kg);
  if (!account || !Number.isFinite(kg) || kg <= 0) return;
  const p = touchPeriods(account);
  if (kg > (p.w.fish || 0)) p.w.fish = kg;
  if (kg > (p.m.fish || 0)) p.m.fish = kg;
}

function addPeriodKill(account) {
  if (!account) return;
  const p = touchPeriods(account);
  p.w.kills += 1;
  p.m.kills += 1;
}

// Read-only: stale period ids count as empty (do not mutate on a leaderboard read).
function periodBucket(account, period, date = new Date()) {
  const raw = account && account.periods;
  if (!raw) return emptyPeriodStats();
  if (period === "week") {
    if (raw.week !== isoWeekId(date)) return emptyPeriodStats();
    return cloneStats(raw.w);
  }
  if (period === "month") {
    if (raw.month !== monthId(date)) return emptyPeriodStats();
    return cloneStats(raw.m);
  }
  return emptyPeriodStats();
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
  // Bank holds items only, not gold, so all-time gold is pocket gold.
  return Math.max(0, (account && account.gold) | 0);
}

function biggestFish(account) {
  const n = Number(account && account.biggestFish);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function kills(account) {
  return Math.max(0, (account && account.kills) | 0);
}

function boardName(board, period) {
  if (period === "all") return board.name;
  if (board.kind === "total") return "Total XP";
  if (board.kind === "gold") return "Gold earned";
  if (board.kind === "skill") return board.name;
  return board.name;
}

function formatValue(board, value, account, period) {
  if (period !== "all") {
    if (board.kind === "skill" || board.kind === "total") return value + " xp";
    if (board.kind === "gold") return value + " gold";
    if (board.kind === "fish") return Number(value).toFixed(1) + " kg";
    if (board.kind === "kills") return String(value);
  }
  if (board.kind === "skill") {
    const xp = skillXp(account, board.skill);
    return `lvl ${value} (${xp} xp)`;
  }
  if (board.kind === "total") return String(value);
  if (board.kind === "gold") return value + " gold";
  if (board.kind === "fish") return Number(value).toFixed(1) + " kg";
  if (board.kind === "kills") return String(value);
  return String(value);
}

function metric(board, account, period) {
  if (period === "week" || period === "month") {
    const b = periodBucket(account, period);
    if (board.kind === "skill") return { value: b[board.skill] || 0, tie: 0 };
    if (board.kind === "total") return { value: b.xp || 0, tie: 0 };
    if (board.kind === "gold") return { value: b.gold || 0, tie: 0 };
    if (board.kind === "fish") return { value: b.fish || 0, tie: 0 };
    if (board.kind === "kills") return { value: b.kills || 0, tie: 0 };
    return { value: 0, tie: 0 };
  }
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

function qualifies(board, value, period) {
  if (period !== "all") return value > 0;
  if (board.kind === "fish" || board.kind === "kills") return value > 0;
  return true;
}

function entryFrom(account, board, rank, scored, period) {
  const value = scored.value;
  return {
    rank,
    name: account.name,
    avatar: account.avatar || "classic-paw",
    walletLabel: account.wallet ? shortWallet(account.wallet) : "",
    value,
    display: formatValue(board, value, account, period),
  };
}

function rankBoard(accounts, board, period) {
  const rows = [];
  for (const a of accounts) {
    if (!a || !a.name || isHiddenName(a.name)) continue;
    const scored = metric(board, a, period);
    if (!qualifies(board, scored.value, period)) continue;
    rows.push({ account: a, scored });
  }
  rows.sort((a, b) => {
    if (b.scored.value !== a.scored.value) return b.scored.value - a.scored.value;
    if (b.scored.tie !== a.scored.tie) return b.scored.tie - a.scored.tie;
    return String(a.account.name).localeCompare(String(b.account.name));
  });
  return rows.map((row, i) => entryFrom(row.account, board, i + 1, row.scored, period));
}

let cache = { at: 0, key: "", byPeriod: {} };

function periodCacheKey(date = new Date()) {
  return isoWeekId(date) + "|" + monthId(date);
}

function invalidateCache() {
  cache = { at: 0, key: "", byPeriod: {} };
}

function buildAll(accounts, date = new Date()) {
  const byPeriod = { all: new Map(), week: new Map(), month: new Map() };
  for (const period of ["all", "week", "month"]) {
    for (const board of BOARDS) {
      byPeriod[period].set(board.id, rankBoard(accounts, board, period));
    }
  }
  cache = { at: Date.now(), key: periodCacheKey(date), byPeriod };
  return byPeriod;
}

function listBoards(period) {
  return BOARDS.map((b) => ({
    id: b.id,
    name: boardName(b, period || "all"),
    unit: period && period !== "all" ? (b.kind === "skill" || b.kind === "total" ? "xp" : b.unit) : b.unit,
  }));
}

function listPeriods() {
  return PERIODS.map((p) => ({ id: p.id, name: p.name, reset: p.reset }));
}

function getLeaderboard(accounts, { board: boardId, period: periodId, limit, viewer } = {}) {
  const periodKey = String(periodId || "all");
  const periodMeta = PERIODS_BY_ID.get(periodKey);
  if (!periodMeta) {
    return { error: "Unknown period", periods: listPeriods(), boards: listBoards() };
  }
  const board = BOARDS_BY_ID.get(String(boardId || ""));
  if (!board) {
    return { error: "Unknown board", periods: listPeriods(), boards: listBoards(periodKey) };
  }
  let lim = Number(limit);
  if (!Number.isFinite(lim)) lim = DEFAULT_LIMIT;
  lim = Math.max(1, Math.min(MAX_LIMIT, lim | 0));

  const now = Date.now();
  const key = periodCacheKey();
  if (!cache.at || now - cache.at > CACHE_MS || cache.key !== key || !cache.byPeriod[periodKey]) {
    buildAll(accounts);
  }
  const ranked = (cache.byPeriod[periodKey] && cache.byPeriod[periodKey].get(board.id)) || [];
  const entries = ranked.slice(0, lim);
  let you = null;
  if (viewer && viewer.name) {
    you = ranked.find((e) => e.name === viewer.name) || {
      rank: null,
      name: viewer.name,
      avatar: viewer.avatar || "classic-paw",
      walletLabel: viewer.wallet ? shortWallet(viewer.wallet) : "",
      value: metric(board, viewer, periodKey).value,
      display: formatValue(board, metric(board, viewer, periodKey).value, viewer, periodKey),
      unranked: true,
    };
  }
  const periodIds = { week: isoWeekId(), month: monthId() };
  return {
    board: board.id,
    name: boardName(board, periodKey),
    unit: periodKey === "all" ? board.unit : (board.kind === "skill" || board.kind === "total" ? "xp" : board.unit),
    period: periodKey,
    periodId: periodKey === "all" ? "all" : periodIds[periodKey],
    reset: periodMeta.reset,
    periods: listPeriods(),
    boards: listBoards(periodKey),
    entries,
    you,
    total: ranked.length,
    cachedAt: cache.at,
  };
}

module.exports = {
  BOARDS,
  PERIODS,
  CACHE_MS,
  DEFAULT_LIMIT,
  TZ,
  isHiddenName,
  isoWeekId,
  monthId,
  emptyPeriodStats,
  normalizePeriods,
  touchPeriods,
  addPeriodXp,
  addPeriodGold,
  addPeriodFish,
  addPeriodKill,
  periodBucket,
  listBoards,
  listPeriods,
  getLeaderboard,
  invalidateCache,
  rankBoard,
  shortWallet,
};
