// Ni Hao Lands — shared world data, map generator, pathfinding, items, skills.
// Unofficial fan project. Not financial advice.

const W = 64;
const H = 48;

const AVATARS = [
  { id: "classic-paw", file: "classic-paw.jpg", name: "Paw Wave" },
  { id: "classic-shocked", file: "classic-shocked.jpg", name: "Shocked" },
  { id: "classic-grumpy", file: "classic-grumpy.jpg", name: "Grumpy" },
  { id: "coat", file: "coat.jpg", name: "Winter Coat" },
  { id: "suit", file: "suit.jpg", name: "Business Suit" },
  { id: "astronaut", file: "astronaut.jpg", name: "Astronaut" },
  { id: "cape", file: "cape.jpg", name: "Cape" },
  { id: "knight", file: "knight.jpg", name: "Knight" },
  { id: "bonnet", file: "bonnet.jpg", name: "Bonnet" },
  { id: "laser-eyes", file: "laser-eyes.jpg", name: "Laser Eyes" },
];

const SKILLS = [
  { id: "fishing", name: "Fishing", verb: "fishing", icon: "🎣" },
  { id: "yarn", name: "Yarn-gathering", verb: "gathering yarn", icon: "🧶" },
  { id: "mining", name: "Mining", verb: "mining", icon: "⛏" },
  { id: "cooking", name: "Cooking", verb: "cooking", icon: "🍳" },
  { id: "combat", name: "Combat", verb: "fighting", icon: "⚔" },
];

const ITEMS = {
  raw_fish: { id: "raw_fish", name: "Raw Fish", stack: true, desc: "A wriggling pond fish. Cook it in the village.", sell: 3, heal: 0 },
  cooked_fish: { id: "cooked_fish", name: "Cooked Fish", stack: true, desc: "Smells like 好运. Eat to heal 8 HP.", sell: 8, heal: 8 },
  yarn: { id: "yarn", name: "Yarn", stack: true, desc: "Soft yarn pulled from a forest bush.", sell: 4, heal: 0 },
  ore: { id: "ore", name: "Copper Ore", stack: true, desc: "A lump of ore from the mine.", sell: 5, heal: 0 },
  bones: { id: "bones", name: "Dog Bones", stack: true, desc: "Dropped by rival dogs. The shop buys them.", sell: 6, heal: 0 },
  lucky_bell: { id: "lucky_bell", name: "Lucky Bell", stack: false, cosmetic: true, slot: "neck", desc: "A tiny gold bell. Cosmetic.", sell: 20 },
  red_scarf: { id: "red_scarf", name: "Red Scarf", stack: false, cosmetic: true, slot: "body", desc: "A bright red scarf. Cosmetic.", sell: 25 },
  gold_collar: { id: "gold_collar", name: "Gold Collar", stack: false, cosmetic: true, slot: "neck", desc: "Shiny collar. Cosmetic.", sell: 40 },
  lantern_hat: { id: "lantern_hat", name: "Lantern Hat", stack: false, cosmetic: true, slot: "hat", desc: "A paper-lantern hat. Cosmetic.", sell: 50 },
};

const SHOP = [
  { itemId: "lucky_bell", price: 50 },
  { itemId: "red_scarf", price: 120 },
  { itemId: "gold_collar", price: 250 },
  { itemId: "lantern_hat", price: 400 },
  { itemId: "cooked_fish", price: 12 },
];

// Companion-token premium catalogue — display + stub only. No purchases in code.
const PREMIUM_SHOP = [
  { id: "gold_nametag", name: "Golden Nametag", priceToken: 50, desc: "Your name draws in gold for everyone. Planned companion-token item." },
  { id: "shrine_pet", name: "Shrine Pet (cosmetic)", priceToken: 150, desc: "A tiny maneki follower. Planned companion-token item." },
  { id: "premium_cape", name: "Premium Cape", priceToken: 100, desc: "A ceremonial cape. Planned companion-token item." },
];

const MIHAO_MINT = "4CxjZyMNoF1p6eXHXHv1TWpS2X47CuUmLwtGe18spump";
const MIHAO_TOKEN_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const DEXSCREENER = "https://dexscreener.com/solana/ho1asg6wgh1ffxdehrk2f4ggt1hoxo9s5jclmdqeyebz";

function levelFromXp(xp) {
  let level = 1;
  let need = 40;
  let rem = Math.max(0, xp | 0);
  while (rem >= need && level < 99) {
    rem -= need;
    level++;
    need = Math.floor(need * 1.18 + 18);
  }
  return { level, into: rem, need };
}

function xpToNext(xp) {
  return levelFromXp(xp);
}

function emptySkills() {
  const s = {};
  for (const sk of SKILLS) s[sk.id] = 0;
  return s;
}

// Light random catch weight in kg, skewed toward smaller fish (about 0.3–5.0 kg).
function rollFishKg() {
  const kg = 0.3 + Math.pow(Math.random(), 1.7) * 4.7;
  return Math.round(kg * 10) / 10;
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < W && y < H;
}

const WALK = new Set(["grass", "path", "sand", "floor", "stone", "dock", "flower", "rug"]);

function isWalkable(tiles, x, y) {
  if (!inBounds(x, y)) return false;
  return WALK.has(tiles[y][x]);
}

function adj(x1, y1, x2, y2) {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)) <= 1;
}

function pathfind(tiles, x0, y0, x1, y1, maxSteps = 200) {
  x0 = Math.round(x0); y0 = Math.round(y0);
  x1 = Math.round(x1); y1 = Math.round(y1);
  if (!inBounds(x1, y1)) return [];
  if (!isWalkable(tiles, x1, y1)) {
    // snap to nearest walkable within 2 tiles
    let best = null, bd = 99;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = x1 + dx, y = y1 + dy;
        if (isWalkable(tiles, x, y)) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d < bd) { bd = d; best = { x, y }; }
        }
      }
    }
    if (!best) return [];
    x1 = best.x; y1 = best.y;
  }
  if (x0 === x1 && y0 === y1) return [];
  const key = (x, y) => x + y * 256;
  const q = [[x0, y0]];
  const prev = new Map();
  prev.set(key(x0, y0), null);
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  let found = false;
  let steps = 0;
  while (q.length && steps++ < maxSteps * 8) {
    const [x, y] = q.shift();
    if (x === x1 && y === y1) { found = true; break; }
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (!isWalkable(tiles, nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!isWalkable(tiles, x + dx, y) || !isWalkable(tiles, x, y + dy)) continue;
      }
      const k = key(nx, ny);
      if (prev.has(k)) continue;
      prev.set(k, [x, y]);
      q.push([nx, ny]);
    }
  }
  if (!found || !prev.has(key(x1, y1))) return [];
  const path = [];
  let cur = [x1, y1];
  while (cur) {
    path.push({ x: cur[0], y: cur[1] });
    cur = prev.get(key(cur[0], cur[1]));
  }
  path.reverse();
  if (path.length && path[0].x === x0 && path[0].y === y0) path.shift();
  return path.slice(0, maxSteps);
}

function zoneAt(x, y) {
  if (y <= 15 && x >= 16 && x <= 50) return { id: "mine", name: "The Mine" };
  if (x <= 16 && y >= 14) return { id: "pond", name: "Fish Pond" };
  if (x >= 47 && y >= 14) return { id: "forest", name: "Yarn Forest" };
  if (x >= 17 && x <= 46 && y >= 16) return { id: "village", name: "Ni Hao Village" };
  if (y < 16) return { id: "mine", name: "The Mine" };
  return { id: "wilds", name: "The Wilds" };
}

function fill(tiles, x0, y0, x1, y1, v) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (inBounds(x, y)) tiles[y][x] = v;
    }
  }
}

function stampBuilding(tiles, x, y, w, h, doorSide) {
  fill(tiles, x, y, x + w - 1, y + h - 1, "wall");
  fill(tiles, x + 1, y + 1, x + w - 2, y + h - 2, "floor");
  const midX = x + Math.floor(w / 2);
  const midY = y + Math.floor(h / 2);
  if (doorSide === "s") tiles[y + h - 1][midX] = "floor";
  if (doorSide === "n") tiles[y][midX] = "floor";
  if (doorSide === "e") tiles[midY][x + w - 1] = "floor";
  if (doorSide === "w") tiles[midY][x] = "floor";
}

function buildWorld() {
  const tiles = Array.from({ length: H }, () => Array(W).fill("grass"));

  // --- Mine (north) ---
  fill(tiles, 16, 1, 50, 15, "stone");
  fill(tiles, 16, 1, 50, 1, "wall");
  fill(tiles, 16, 1, 16, 15, "wall");
  fill(tiles, 50, 1, 50, 15, "wall");
  fill(tiles, 16, 1, 24, 4, "wall");
  fill(tiles, 42, 1, 50, 4, "wall");
  // cave pillars
  for (const [x, y] of [[22, 6], [28, 9], [35, 6], [41, 10], [25, 12], [38, 13]]) {
    if (inBounds(x, y)) tiles[y][x] = "wall";
  }
  // mine mouth opening into village
  fill(tiles, 30, 15, 34, 18, "path");
  fill(tiles, 31, 15, 33, 15, "path");

  // --- Village plaza ---
  fill(tiles, 18, 17, 45, 38, "grass");
  fill(tiles, 24, 22, 40, 34, "path");
  fill(tiles, 30, 18, 34, 22, "path");
  // east/west roads
  fill(tiles, 16, 26, 24, 28, "path");
  fill(tiles, 40, 26, 48, 28, "path");
  fill(tiles, 30, 34, 34, 38, "path");

  // Bank (west building)
  stampBuilding(tiles, 19, 20, 7, 6, "e");
  tiles[23][24] = "rug";
  tiles[22][21] = "floor";

  // Shop (east building)
  stampBuilding(tiles, 38, 20, 7, 6, "w");
  tiles[23][39] = "rug";

  // Kitchen / range (south-west hut)
  stampBuilding(tiles, 20, 31, 6, 5, "n");

  // Shrine / spawn pavilion
  fill(tiles, 30, 25, 34, 29, "path");
  tiles[27][32] = "rug";

  // flower beds
  for (const [x, y] of [[26, 21], [27, 21], [37, 21], [26, 35], [38, 35], [25, 30], [39, 30], [28, 19], [36, 19]]) {
    tiles[y][x] = "flower";
  }

  // --- Fish Pond (west) ---
  fill(tiles, 1, 16, 15, 42, "grass");
  // pond body
  for (let y = 18; y <= 40; y++) {
    for (let x = 1; x <= 13; x++) {
      const cx = 7, cy = 29;
      const dx = (x - cx) / 6.2, dy = (y - cy) / 10.5;
      if (dx * dx + dy * dy < 1) tiles[y][x] = "water";
    }
  }
  // docks / shore
  fill(tiles, 12, 25, 16, 28, "dock");
  fill(tiles, 11, 26, 12, 27, "dock");
  tiles[26][11] = "dock";
  tiles[27][11] = "dock";
  // keep a walkable ring of sand around some edges
  for (let y = 17; y <= 41; y++) {
    for (let x = 1; x <= 14; x++) {
      if (tiles[y][x] === "water") {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (inBounds(nx, ny) && tiles[ny][nx] === "grass") tiles[ny][nx] = "sand";
        }
      }
    }
  }
  fill(tiles, 13, 26, 18, 27, "path");

  // --- Yarn Forest (east) ---
  fill(tiles, 47, 16, 62, 46, "grass");
  fill(tiles, 45, 26, 50, 28, "path");
  const treeSpots = [];
  for (let y = 17; y <= 45; y++) {
    for (let x = 48; x <= 62; x++) {
      if ((x * 13 + y * 29) % 7 === 0 && tiles[y][x] === "grass") {
        tiles[y][x] = "tree";
        treeSpots.push({ x, y });
      }
    }
  }
  // clear a small glade
  fill(tiles, 52, 28, 57, 33, "grass");
  tiles[30][54] = "flower";
  tiles[31][55] = "flower";

  // southern grass fringe
  fill(tiles, 18, 39, 46, 46, "grass");
  for (const [x, y] of [[22, 41], [28, 43], [36, 42], [40, 44], [18, 44]]) tiles[y][x] = "flower";

  // border walls so players can't fall off
  for (let x = 0; x < W; x++) {
    tiles[0][x] = "wall";
    tiles[H - 1][x] = "wall";
  }
  for (let y = 0; y < H; y++) {
    tiles[y][0] = "wall";
    tiles[y][W - 1] = "wall";
  }

  const nodes = [];
  let nid = 1;
  const addNode = (type, x, y, extra = {}) => {
    nodes.push({
      id: "n" + nid++,
      type, x, y,
      depleted: false,
      respawnAt: 0,
      ...extra,
    });
  };

  // Fishing spots on dock / shore adjacent to water
  const fishSpots = [[11, 26], [11, 27], [12, 25], [10, 24], [8, 18], [5, 20], [4, 36], [9, 38], [12, 33]];
  for (const [x, y] of fishSpots) {
    if (inBounds(x, y) && isWalkable(tiles, x, y)) addNode("fish", x, y, { skill: "fishing", xp: 22, item: "raw_fish", time: 2400, respawn: 14000 });
  }

  // Yarn bushes in forest (walkable tiles next to trees)
  let yarnCount = 0;
  for (const t of treeSpots) {
    if (yarnCount >= 14) break;
    const cand = [[t.x + 1, t.y], [t.x - 1, t.y], [t.x, t.y + 1], [t.x, t.y - 1]];
    for (const [x, y] of cand) {
      if (isWalkable(tiles, x, y) && !nodes.some((n) => n.x === x && n.y === y)) {
        addNode("yarn", x, y, { skill: "yarn", xp: 20, item: "yarn", time: 2200, respawn: 16000 });
        yarnCount++;
        break;
      }
    }
  }
  // guaranteed yarn bushes in the glade
  for (const [x, y] of [[52, 29], [56, 29], [52, 32], [56, 32], [54, 27], [55, 34]]) {
    if (isWalkable(tiles, x, y) && !nodes.some((n) => n.x === x && n.y === y)) {
      tiles[y][x] = "flower";
      addNode("yarn", x, y, { skill: "yarn", xp: 20, item: "yarn", time: 2200, respawn: 16000 });
    }
  }

  // Ore rocks in the mine
  const ores = [[20, 7], [24, 8], [27, 5], [33, 5], [37, 8], [43, 7], [21, 11], [29, 11], [36, 11], [44, 12], [40, 5], [18, 9]];
  for (const [x, y] of ores) {
    if (inBounds(x, y)) {
      tiles[y][x] = "ore";
      // place interact node on a walkable neighbor
      let placed = false;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (isWalkable(tiles, nx, ny)) {
          addNode("ore", nx, ny, { skill: "mining", xp: 26, item: "ore", time: 2600, respawn: 18000, rockX: x, rockY: y });
          placed = true;
          break;
        }
      }
      if (!placed && isWalkable(tiles, x, y)) {
        addNode("ore", x, y, { skill: "mining", xp: 26, item: "ore", time: 2600, respawn: 18000 });
      }
    }
  }

  // Cooking range inside kitchen
  addNode("range", 22, 33, { skill: "cooking", xp: 24, time: 1800, respawn: 0 });
  tiles[33][22] = "floor";

  const npcs = [
    { id: "npc-banker", name: "Banker Bao", role: "bank", x: 21, y: 22, avatar: "suit", examine: "Banker Bao keeps everyone's yarn safe." },
    { id: "npc-merchant", name: "Merchant Mao", role: "shop", x: 42, y: 22, avatar: "coat", examine: "Merchant Mao sells cosmetics for in-game gold." },
    { id: "npc-chef", name: "Chef Chou", role: "cook", x: 23, y: 33, avatar: "bonnet", examine: "Chef Chou minds the village range. Click the range to cook fish." },
    { id: "npc-greeter", name: "Old Maneki", role: "greet", x: 32, y: 26, avatar: "classic-paw", examine: "你好，朋友. Welcome to Ni Hao Village." },
  ];

  const mobs = [
    { id: "dog-1", name: "Rival Dog", x: 53, y: 36, hp: 12, maxHp: 12, wander: true },
    { id: "dog-2", name: "Rival Dog", x: 58, y: 24, hp: 12, maxHp: 12, wander: true },
    { id: "dog-3", name: "Rival Dog", x: 50, y: 42, hp: 14, maxHp: 14, wander: true },
  ];

  const spawn = { x: 32, y: 28 };

  return { tiles, nodes, npcs, mobs, spawn, W, H };
}

module.exports = {
  W, H, AVATARS, SKILLS, ITEMS, SHOP, PREMIUM_SHOP,
  MIHAO_MINT, MIHAO_TOKEN_PROGRAM, DEXSCREENER,
  levelFromXp, xpToNext, emptySkills, rollFishKg, inBounds, isWalkable, pathfind, zoneAt, adj, buildWorld, WALK,
};
