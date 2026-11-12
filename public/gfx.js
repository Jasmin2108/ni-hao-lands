/* Ni Hao Lands — procedural pixel-art renderer. All art is generated in code at load time
   (no external or copyrighted assets). Unofficial fan game. */
(() => {
  const BT = 20;          // base pixels per tile; sprites/tiles are authored at this size
  const CH = 8;           // tiles per cached ground chunk (small so a build fits in an idle slice)

  // ---------- helpers ----------
  function hash(x, y, s = 0) {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0 || 1;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgb(a) { return `rgb(${a[0] | 0},${a[1] | 0},${a[2] | 0})`; }
  function shade(c, f) {
    const a = hex(c);
    if (f >= 0) return rgb(a.map((v) => v + (255 - v) * f));
    return rgb(a.map((v) => v * (1 + f)));
  }
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]].map(r => r.map(v => (v + 0.5) / 16));
  function vnoise(x, y, s) {
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const h = (a, b) => (hash(a, b, s) % 1000) / 1000;
    const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  }
  function mix(c1, c2, t) { const a = hex(c1), b = hex(c2); return rgb(a.map((v, i) => v + (b[i] - v) * t)); }
  function mk(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); g.imageSmoothingEnabled = false; return [c, g]; }
  function px(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }

  // ---------- world analysis ----------
  const W_ = { tiles: null, W: 0, H: 0, wallKind: null, buildings: [], zone: null, chunks: new Map(), mini: null, water: null };

  function zoneIdAt(x, y) {
    if (x >= 64 && y <= 26) return "quarry";
    if (y <= 15 && x >= 16 && x <= 50) return "mine";
    if (y < 16 && x < 64) return "mine";
    if (x <= 28 && y >= 48) return "harbor";
    if (x <= 16 && y >= 14 && y < 48) return "pond";
    if (x >= 20 && x <= 72 && y >= 50) return "bamboo";
    if (x >= 96 && y >= 38 && y <= 62) return "shrine-inner";
    if (x >= 64 && y >= 27) return "shrine";
    if (x >= 47 && y >= 14 && y < 50 && x < 64) return "forest";
    if (x >= 17 && x <= 46 && y >= 16 && y < 50) return "village";
    return "wilds";
  }

  const WATERS = new Set(["water", "deepwater"]);
  const TREES = new Set(["tree", "pine", "cherry", "bamboo"]);
  const ORES = new Set(["ore", "tinore", "ironore", "jadeore"]);
  function T(x, y) { if (x < 0 || y < 0 || x >= W_.W || y >= W_.H) return "void"; return W_.tiles[y][x]; }
  function isWater(k) { return WATERS.has(k); }

  function analyze(world, npcs) {
    W_.tiles = world.tiles; W_.W = world.W; W_.H = world.H;
    W_.chunks.clear();
    const Wd = W_.W, Hd = W_.H;
    W_.zone = []; for (let y = 0; y < Hd; y++) { const r = []; for (let x = 0; x < Wd; x++) r.push(zoneIdAt(x, y)); W_.zone.push(r); }
    // wall kinds: building (touches floor/rug), fence (outer ring beside open ground), rock
    W_.wallKind = [];
    for (let y = 0; y < Hd; y++) {
      const r = [];
      for (let x = 0; x < Wd; x++) {
        if (T(x, y) !== "wall") { r.push(null); continue; }
        let b = false;
        for (let dy = -1; dy <= 1 && !b; dy++) for (let dx = -1; dx <= 1; dx++) { const k = T(x + dx, y + dy); if (k === "floor" || k === "rug") { b = true; break; } }
        if (b) { r.push("bld"); continue; }
        const border = x === 0 || y === 0 || x === Wd - 1 || y === Hd - 1;
        if (border) {
          const ix = x === 0 ? 1 : x === Wd - 1 ? Wd - 2 : x, iy = y === 0 ? 1 : y === Hd - 1 ? Hd - 2 : y;
          const k = T(ix, iy);
          r.push(k === "wall" || k === "stone" || ORES.has(k) ? "rock" : "fence");
          continue;
        }
        r.push("rock");
      }
      W_.wallKind.push(r);
    }
    // buildings: connected components of bld walls + floors/rugs
    const seen = new Set();
    W_.buildings = [];
    for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) {
      if (W_.wallKind[y][x] !== "bld" || seen.has(x + "," + y)) continue;
      const st = [[x, y]]; seen.add(x + "," + y);
      let x0 = x, y0 = y, x1 = x, y1 = y;
      while (st.length) {
        const [cx, cy] = st.pop();
        x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy, k = T(nx, ny), key = nx + "," + ny;
          if (seen.has(key)) continue;
          if ((k === "wall" && W_.wallKind[ny][nx] === "bld") || k === "floor" || k === "rug") { seen.add(key); st.push([nx, ny]); }
        }
      }
      W_.buildings.push({ x0, y0, x1, y1 });
    }
    // buildings with an interior that leaks (doors) — clamp to wall rectangle size
    for (const b of W_.buildings) {
      const inside = (npcs || []).find((n) => n.x > b.x0 && n.x < b.x1 && n.y > b.y0 && n.y < b.y1);
      b.role = inside ? inside.role : null;
      b.npc = inside ? inside.name : null;
      b.zone = W_.zone[b.y0][b.x0];
      if (b.x0 <= 22 && b.y0 >= 30 && b.y0 <= 32) b.role = "cook";
    }
    W_.mini = null;
  }

  // ---------- palettes ----------
  const GRASS = {
    village: ["#6cab4c", "#5a9a3f", "#82c060", "#4c8636"],
    forest: ["#4f9443", "#417f37", "#62a853", "#356c2d"],
    bamboo: ["#5ea548", "#4d913b", "#74b85a", "#3f7c31"],
    shrine: ["#86ad4f", "#759b42", "#9bc262", "#62873a"],
    "shrine-inner": ["#86ad4f", "#759b42", "#9bc262", "#62873a"],
    pond: ["#66aa4d", "#55983f", "#7fbe62", "#478433"],
    harbor: ["#6aa84c", "#58963f", "#80bd60", "#4a8535"],
    mine: ["#6aa84c", "#58963f", "#80bd60", "#4a8535"],
    quarry: ["#6aa84c", "#58963f", "#80bd60", "#4a8535"],
    wilds: ["#6aa84c", "#58963f", "#80bd60", "#4a8535"],
  };
  const STONE = { mine: ["#857a6c", "#746a5d", "#968b7c", "#62594e"], quarry: ["#8d958a", "#7b8378", "#a1a99c", "#687066"] };
  const ORE_COL = { ore: ["#d9823e", "#f2a865"], tinore: ["#cfd8de", "#ffffff"], ironore: ["#9a5b44", "#c98a6c"], jadeore: ["#3fbf74", "#9ef0b8"],
    copper: ["#d9823e", "#f2a865"], tin: ["#cfd8de", "#ffffff"], iron: ["#9a5b44", "#c98a6c"], jade: ["#3fbf74", "#9ef0b8"] };

  // terrain class used for blending
  function groundClass(x, y) {
    const k = T(x, y);
    if (k === "void") return "grass";
    if (k === "water") return "water";
    if (k === "deepwater") return "deep";
    if (k === "sand") return "sand";
    if (k === "path") return W_.zone[y][x] === "village" ? "cobble" : "path";
    if (k === "quarry") return "gravel";
    if (ORES.has(k)) {
      // ore nodes sit on whatever ground surrounds them (no square patch under the rock)
      const cnt = {};
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nk = T(x + dx, y + dy);
        if (ORES.has(nk) || nk === "wall" || nk === "void") continue;
        const c = groundClass(x + dx, y + dy);
        cnt[c] = (cnt[c] || 0) + 1;
      }
      let best = "stone", bn = 0;
      for (const c in cnt) if (cnt[c] > bn) { best = c; bn = cnt[c]; }
      return best === "water" || best === "deep" || best === "dock" ? "stone" : best;
    }
    if (k === "stone") return "stone";
    if (k === "dock" || k === "plank" || k === "bridge") return "dock";
    if (k === "lantern") return "dock";
    if (k === "floor") return "floor";
    if (k === "rug") return "rug";
    if (k === "shrine") return "shrine";
    if (k === "wall") {
      const wk = W_.wallKind[y][x];
      if (wk === "fence") return "grass";
      if (wk === "bld") return "bwall";
      return "rock";
    }
    return "grass";
  }
  const BLEND = { deep: 0, water: 1, sand: 2, gravel: 3, path: 4, stone: 4, cobble: 5, grass: 6 };

  // ---------- base tile textures (20x20 base px) ----------
  function paintGrass(g, ox, oy, x, y) {
    const z = W_.zone[Math.max(0, Math.min(W_.H - 1, y))][Math.max(0, Math.min(W_.W - 1, x))];
    const p = GRASS[z] || GRASS.wilds;
    px(g, ox, oy, BT, BT, p[0]);
    const r = rng(hash(x, y, 1));
    // soft large-scale variation: smooth value noise, ordered-dithered into 3 tones
    const lo = shade(p[0], -0.07), hi = shade(p[0], 0.07);
    const n00 = vnoise(x / 3.2, y / 3.2, 7), n10 = vnoise((x + 1) / 3.2, y / 3.2, 7);
    const n01 = vnoise(x / 3.2, (y + 1) / 3.2, 7), n11 = vnoise((x + 1) / 3.2, (y + 1) / 3.2, 7);
    for (let cy = 0; cy < BT; cy += 2) for (let cx = 0; cx < BT; cx += 2) {
      const u = cx / BT, v = cy / BT;
      const n = (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v;
      const t = n * 2.2 - 0.6 + BAYER[(cy >> 1) & 3][(cx >> 1) & 3] * 0.45;
      if (t < 0) px(g, ox + cx, oy + cy, 2, 2, lo); else if (t > 1.15) px(g, ox + cx, oy + cy, 2, 2, hi);
    }
    for (let i = 0; i < 9; i++) {
      const bx = ox + Math.floor(r() * 19), by = oy + Math.floor(r() * 18);
      px(g, bx, by, 1, 2, r() < 0.6 ? p[1] : p[3]);
    }
    for (let i = 0; i < 5; i++) {
      const bx = ox + Math.floor(r() * 19), by = oy + Math.floor(r() * 19);
      px(g, bx, by, 1, 1, p[2]);
    }
    // little tufts
    if (r() < 0.45) {
      const bx = ox + 3 + Math.floor(r() * 13), by = oy + 4 + Math.floor(r() * 12);
      px(g, bx, by, 1, 2, p[3]); px(g, bx + 2, by, 1, 2, p[3]); px(g, bx + 1, by - 1, 1, 3, p[1]);
      px(g, bx + 1, by - 1, 1, 1, p[2]);
    }
    if (r() < 0.06) { // tiny wildflower
      const cols = ["#f6e27a", "#ffffff", "#f29ab8", "#c9a0ff"];
      const c = cols[Math.floor(r() * cols.length)];
      const bx = ox + 3 + Math.floor(r() * 14), by = oy + 3 + Math.floor(r() * 14);
      px(g, bx, by, 1, 1, c);
    }
    if ((z === "shrine" || z === "wilds") && r() < 0.05) { // pebble
      const bx = ox + 3 + Math.floor(r() * 13), by = oy + 3 + Math.floor(r() * 13);
      px(g, bx, by, 3, 2, "#9a9a8a"); px(g, bx, by, 2, 1, "#c2c2b0"); px(g, bx, by + 2, 3, 1, p[3]);
    }
  }
  function paintFlowers(g, ox, oy, x, y) {
    const r = rng(hash(x, y, 3));
    const sets = [["#e8483a", "#ffb0a0"], ["#f6d55c", "#fff2b0"], ["#f29ab8", "#ffd6e6"], ["#ffffff", "#f6e27a"], ["#a77cf0", "#e0ccff"]];
    const n = 4 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const s = sets[Math.floor(r() * sets.length)];
      const fx = ox + 2 + Math.floor(r() * 15), fy = oy + 2 + Math.floor(r() * 14);
      px(g, fx, fy + 2, 1, 2, "#3f7a2c");
      px(g, fx - 1, fy, 3, 1, s[0]); px(g, fx, fy - 1, 1, 3, s[0]); px(g, fx, fy, 1, 1, s[1]);
    }
  }
  function paintPath(g, ox, oy, x, y) {
    px(g, ox, oy, BT, BT, "#c79d63");
    const r = rng(hash(x, y, 5));
    for (let i = 0; i < 14; i++) px(g, ox + Math.floor(r() * 19), oy + Math.floor(r() * 19), 2, 1, r() < 0.5 ? "#b48a52" : "#d6b07a");
    for (let i = 0; i < 3; i++) {
      const bx = ox + 1 + Math.floor(r() * 17), by = oy + 1 + Math.floor(r() * 17);
      px(g, bx, by, 2, 2, "#a9a08e"); px(g, bx, by, 1, 1, "#d7d0bf"); px(g, bx, by + 2, 2, 1, "#9d7646");
    }
    // cart ruts
    if (hash(x, y, 9) % 4 === 0) { px(g, ox + 5, oy, 1, BT, "#b8915b"); px(g, ox + 14, oy, 1, BT, "#b8915b"); }
  }
  function paintCobble(g, ox, oy, x, y) {
    px(g, ox, oy, BT, BT, "#8f7f68");
    const r = rng(hash(x, y, 11));
    const rows = [[0, 6], [6, 7], [13, 7]];
    let shift = (y % 2) * 4;
    for (const [ry, rh] of rows) {
      let cx = -shift;
      while (cx < BT) {
        const w = 5 + Math.floor(r() * 4);
        const sx = Math.max(0, cx + 1), ex = Math.min(BT, cx + w);
        if (ex - sx > 0) {
          const base = ["#c9b99a", "#bcac8c", "#d2c4a6", "#b4a383"][Math.floor(r() * 4)];
          px(g, ox + sx, oy + ry + 1, ex - sx, rh - 1, base);
          px(g, ox + sx, oy + ry + 1, ex - sx, 1, shade(base, 0.25));
          px(g, ox + sx, oy + ry + rh - 1, ex - sx, 1, shade(base, -0.15));
        }
        cx += w;
      }
      shift = (shift + 3) % 6;
    }
  }
  function paintSand(g, ox, oy, x, y) {
    px(g, ox, oy, BT, BT, "#e3c98f");
    const r = rng(hash(x, y, 13));
    for (let i = 0; i < 12; i++) px(g, ox + Math.floor(r() * 20), oy + Math.floor(r() * 20), 1, 1, r() < 0.6 ? "#cdb075" : "#f3e1b0");
    if (r() < 0.12) { const bx = ox + 4 + Math.floor(r() * 10), by = oy + 4 + Math.floor(r() * 10); px(g, bx, by, 3, 2, "#f6efe4"); px(g, bx + 1, by + 1, 1, 1, "#e8a0a0"); }
    if (r() < 0.25) { const by = oy + 5 + Math.floor(r() * 10); px(g, ox + 3, by, 6, 1, "#d6bb80"); px(g, ox + 11, by + 2, 5, 1, "#d6bb80"); }
  }
  function paintGravel(g, ox, oy, x, y) {
    px(g, ox, oy, BT, BT, "#b2b49e");
    const r = rng(hash(x, y, 17));
    for (let i = 0; i < 26; i++) px(g, ox + Math.floor(r() * 19), oy + Math.floor(r() * 19), 2, 1, ["#9fa18b", "#c8cab4", "#8e907c"][Math.floor(r() * 3)]);
  }
  function paintStone(g, ox, oy, x, y) {
    const z = W_.zone[Math.max(0, Math.min(W_.H - 1, y))][Math.max(0, Math.min(W_.W - 1, x))];
    const p = STONE[z === "quarry" ? "quarry" : "mine"];
    px(g, ox, oy, BT, BT, p[0]);
    const r = rng(hash(x, y, 19));
    for (let i = 0; i < 10; i++) px(g, ox + Math.floor(r() * 18), oy + Math.floor(r() * 19), 2 + Math.floor(r() * 2), 1, r() < 0.5 ? p[1] : p[2]);
    if (r() < 0.5) { // crack
      let cx = ox + 3 + Math.floor(r() * 12), cy = oy + 3 + Math.floor(r() * 10);
      for (let i = 0; i < 5; i++) { px(g, cx, cy, 1, 1, p[3]); cx += r() < 0.5 ? 1 : 0; cy += 1; }
    }
    if (r() < 0.3) { const bx = ox + 3 + Math.floor(r() * 13), by = oy + 3 + Math.floor(r() * 13); px(g, bx, by, 3, 2, p[2]); px(g, bx, by + 2, 3, 1, p[3]); }
  }
  function waterD(x, y) {
    if (x < 0 || y < 0 || x >= W_.W || y >= W_.H) return 0;
    const v = W_.water[y * W_.W + x];
    if (v < 0) return -0.6;
    return v + (T(x, y) === "deepwater" ? 1 : 0);
  }
  function paintWater(g, ox, oy, x, y, deep) {
    // depth shading by distance to shore, bilinear + ordered dither so it reads as a smooth gradient
    const d = W_.water ? W_.water[y * W_.W + x] : 3;
    const cols = ["#58aecb", "#4a9dbf", "#3f8db3", "#357fa8", "#2e729c", "#286690"];
    const base = cols[Math.min(cols.length - 1, d + (deep ? 1 : 0))];
    px(g, ox, oy, BT, BT, base);
    if (W_.water) {
      for (let cy = 0; cy < BT; cy += 2) for (let cx = 0; cx < BT; cx += 2) {
        const fx = x + (cx + 1) / BT - 0.5, fy = y + (cy + 1) / BT - 0.5;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const a = waterD(x0, y0), b = waterD(x0 + 1, y0), c = waterD(x0, y0 + 1), e = waterD(x0 + 1, y0 + 1);
        const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
        const lvl = Math.max(0, Math.min(cols.length - 1, Math.floor(v + BAYER[(cy >> 1) & 3][(cx >> 1) & 3])));
        px(g, ox + cx, oy + cy, 2, 2, cols[lvl]);
      }
    }
    const r = rng(hash(x, y, 23));
    for (let i = 0; i < 3; i++) px(g, ox + Math.floor(r() * 14), oy + Math.floor(r() * 19), 3 + Math.floor(r() * 4), 1, shade(base, 0.12));
    for (let i = 0; i < 2; i++) px(g, ox + Math.floor(r() * 16), oy + Math.floor(r() * 19), 3, 1, shade(base, -0.1));
  }
  function paintFloor(g, ox, oy, x, y) {
    px(g, ox, oy, BT, BT, "#a8763f");
    for (let i = 0; i < 4; i++) {
      const by = oy + i * 5;
      px(g, ox, by, BT, 1, "#7f5429");
      const off = ((x * 7 + i * 5 + y * 3) % 4) * 5;
      px(g, ox + off, by + 1, 1, 4, "#8a5e30");
      px(g, ox, by + 1, BT, 1, "#b8864c");
    }
  }
  function paintRug(g, ox, oy, x, y) {
    paintFloor(g, ox, oy, x, y);
    const n = (k) => k === "rug";
    const l = n(T(x - 1, y)), r_ = n(T(x + 1, y)), u = n(T(x, y - 1)), d = n(T(x, y + 1));
    const x0 = ox + (l ? 0 : 2), y0 = oy + (u ? 0 : 2), x1 = ox + BT - (r_ ? 0 : 2), y1 = oy + BT - (d ? 0 : 2);
    px(g, x0, y0, x1 - x0, y1 - y0, "#a8322a");
    g.strokeStyle = "#e6b84a"; g.lineWidth = 1;
    if (!l) px(g, x0 + 1, y0 + 1, 1, y1 - y0 - 2, "#e6b84a");
    if (!r_) px(g, x1 - 2, y0 + 1, 1, y1 - y0 - 2, "#e6b84a");
    if (!u) px(g, x0 + 1, y0 + 1, x1 - x0 - 2, 1, "#e6b84a");
    if (!d) px(g, x0 + 1, y1 - 2, x1 - x0 - 2, 1, "#e6b84a");
    // central motif: 福-like diamond
    const cx = ox + 10, cy = oy + 10;
    px(g, cx - 1, cy - 4, 2, 8, "#e6b84a"); px(g, cx - 4, cy - 1, 8, 2, "#e6b84a");
    px(g, cx - 1, cy - 1, 2, 2, "#7a1d16");
  }
  function paintShrine(g, ox, oy, x, y) {
    px(g, ox, oy, BT, BT, "#d8ccad");
    const r = rng(hash(x, y, 29));
    px(g, ox, oy + 9, BT, 1, "#b7a888"); px(g, ox + ((y % 2) ? 4 : 13), oy, 1, 9, "#b7a888"); px(g, ox + ((y % 2) ? 13 : 6), oy + 10, 1, 10, "#b7a888");
    px(g, ox, oy, BT, 1, "#e7dcc0");
    for (let i = 0; i < 6; i++) px(g, ox + Math.floor(r() * 19), oy + Math.floor(r() * 19), 1, 1, "#c4b795");
    if (r() < 0.15) { px(g, ox + 2 + Math.floor(r() * 14), oy + 2 + Math.floor(r() * 14), 2, 1, "#7fae4e"); }
    // edge trim toward non-shrine ground
    const edge = (k) => k !== "shrine" && k !== "rug" && k !== "wall" && k !== "floor" && k !== "path";
    if (edge(T(x, y - 1))) { px(g, ox, oy, BT, 2, "#a8322a"); px(g, ox, oy + 2, BT, 1, "#e6b84a"); }
    if (edge(T(x, y + 1))) { px(g, ox, oy + BT - 3, BT, 1, "#e6b84a"); px(g, ox, oy + BT - 2, BT, 2, "#a8322a"); }
    if (edge(T(x - 1, y))) { px(g, ox, oy, 2, BT, "#a8322a"); px(g, ox + 2, oy, 1, BT, "#e6b84a"); }
    if (edge(T(x + 1, y))) { px(g, ox + BT - 3, oy, 1, BT, "#e6b84a"); px(g, ox + BT - 2, oy, 2, BT, "#a8322a"); }
  }
  function paintDock(g, ox, oy, x, y) {
    const k = T(x, y);
    // under-water or sand first
    const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isWater(T(x + dx, y + dy)));
    const vert = (groundClass(x, y - 1) === "dock" || groundClass(x, y + 1) === "dock") && !(groundClass(x - 1, y) === "dock" && groundClass(x + 1, y) === "dock");
    const plankCols = k === "plank" ? ["#8d5f35", "#6e4624", "#a87645"] : ["#a2703f", "#76502a", "#bd8a55"];
    px(g, ox, oy, BT, BT, plankCols[0]);
    const r = rng(hash(x, y, 31));
    if (vert) {
      for (let i = 0; i < 4; i++) {
        const by = oy + i * 5;
        px(g, ox, by + 4, BT, 1, plankCols[1]);
        px(g, ox, by, BT, 1, plankCols[2]);
        px(g, ox + 3 + Math.floor(r() * 14), by + 2, 1, 1, plankCols[1]);
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const bx = ox + i * 5;
        px(g, bx + 4, oy, 1, BT, plankCols[1]);
        px(g, bx, oy, 1, BT, plankCols[2]);
        px(g, bx + 2, oy + 3 + Math.floor(r() * 14), 1, 1, plankCols[1]);
      }
    }
    // rope / rail posts on water edges
    if (wet) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!isWater(T(x + dx, y + dy))) continue;
        if (dx === 1) { px(g, ox + BT - 2, oy, 2, BT, plankCols[1]); if ((x + y) % 2 === 0) px(g, ox + BT - 4, oy + 8, 4, 4, "#5a3a1e"); }
        if (dx === -1) { px(g, ox, oy, 2, BT, plankCols[1]); if ((x + y) % 2 === 0) px(g, ox, oy + 8, 4, 4, "#5a3a1e"); }
        if (dy === 1) { px(g, ox, oy + BT - 2, BT, 2, "#5a3a1e"); }
        if (dy === -1) { px(g, ox, oy, BT, 1, plankCols[1]); }
      }
    }
  }
  function paintRockTop(g, ox, oy, x, y) {
    const z = W_.zone[Math.max(0, Math.min(W_.H - 1, y))][Math.max(0, Math.min(W_.W - 1, x))];
    const q = z === "quarry";
    const base = q ? "#6b7268" : "#6b6157", hi = q ? "#848c80" : "#82776b", lo = q ? "#525950" : "#4d453d";
    px(g, ox, oy, BT, BT, base);
    const r = rng(hash(x, y, 37));
    for (let i = 0; i < 6; i++) {
      const bx = ox + Math.floor(r() * 16), by = oy + Math.floor(r() * 14);
      const w = 3 + Math.floor(r() * 4);
      px(g, bx, by, w, 3, hi); px(g, bx, by + 3, w, 1, lo); px(g, bx, by, 1, 3, shade(hi, 0.1));
    }
    const below = groundClass(x, y + 1);
    if (below !== "rock") {
      // cliff face
      px(g, ox, oy + 11, BT, 9, q ? "#5a6158" : "#5a5047");
      for (let i = 0; i < 6; i++) px(g, ox + 1 + i * 3 + (hash(x, y, i) % 2), oy + 12, 1, 7, q ? "#4a5049" : "#463e37");
      px(g, ox, oy + 11, BT, 1, hi);
      px(g, ox, oy + BT - 1, BT, 1, "#2e2924");
    }
    if (groundClass(x, y - 1) !== "rock") px(g, ox, oy, BT, 1, shade(hi, 0.2));
  }
  function paintFence(g, ox, oy, x, y) {
    paintGrass(g, ox, oy, x, y);
    const horiz = y === 0 || y === W_.H - 1;
    if (horiz) {
      px(g, ox, oy + 7, BT, 2, "#8a5a2e"); px(g, ox, oy + 12, BT, 2, "#8a5a2e");
      px(g, ox, oy + 7, BT, 1, "#b07a44");
      px(g, ox + 2, oy + 4, 3, 13, "#6e4422"); px(g, ox + 2, oy + 4, 3, 1, "#b07a44");
      px(g, ox + 12, oy + 4, 3, 13, "#6e4422"); px(g, ox + 12, oy + 4, 3, 1, "#b07a44");
      px(g, ox, oy + 17, BT, 1, "rgba(0,0,0,.18)");
    } else {
      px(g, ox + 8, oy, 2, BT, "#8a5a2e"); px(g, ox + 8, oy, 1, BT, "#b07a44");
      px(g, ox + 6, oy + 3, 5, 4, "#6e4422"); px(g, ox + 6, oy + 13, 5, 4, "#6e4422");
      px(g, ox + 6, oy + 3, 5, 1, "#b07a44"); px(g, ox + 6, oy + 13, 5, 1, "#b07a44");
    }
  }
  function paintBuildingWall(g, ox, oy, x, y) {
    const b = buildingAt(x, y);
    if (!b) { paintRockTop(g, ox, oy, x, y); return; }
    const north = y === b.y0, south = y === b.y1, west = x === b.x0, east = x === b.x1;
    const pillar = "#9c2b20", pillarHi = "#c4473a", plaster = "#efe2c4", plasterLo = "#d9c8a2", cap = "#46545c", capHi = "#6c7f88";
    if (north || south) {
      // facade: plaster with timber and lattice window
      px(g, ox, oy, BT, BT, plaster);
      px(g, ox, oy + BT - 4, BT, 4, "#8e8472"); px(g, ox, oy + BT - 4, BT, 1, "#a99f8b");
      for (let i = 0; i < 3; i++) px(g, ox + i * 7 + 1, oy + BT - 3, 5, 1, "#7a7062");
      px(g, ox, oy, BT, 4, cap); px(g, ox, oy, BT, 1, capHi);
      for (let i = 0; i < 5; i++) px(g, ox + i * 4 + 1, oy + 1, 2, 3, capHi);
      px(g, ox, oy + 4, BT, 1, pillar);
      if ((x + (south ? 1 : 0)) % 2 === 0 && !west && !east) {
        // lattice window
        px(g, ox + 5, oy + 7, 10, 7, "#5a2a1c");
        px(g, ox + 6, oy + 8, 8, 5, "#f3d48a");
        px(g, ox + 6, oy + 10, 8, 1, "#5a2a1c"); px(g, ox + 9, oy + 8, 1, 5, "#5a2a1c"); px(g, ox + 12, oy + 8, 1, 5, "#5a2a1c");
      } else {
        px(g, ox + 2, oy + 9, 16, 1, plasterLo);
      }
      if (west || east) { const cx = west ? ox : ox + BT - 5; px(g, cx, oy + 4, 5, BT - 8, pillar); px(g, cx + 1, oy + 4, 1, BT - 8, pillarHi); }
    } else {
      // side walls seen from above: tiled cap
      px(g, ox, oy, BT, BT, cap);
      for (let i = 0; i < 5; i++) { px(g, ox + 2, oy + i * 4, BT - 4, 1, capHi); px(g, ox + 2, oy + i * 4 + 3, BT - 4, 1, "#33404a"); }
      px(g, ox + 8, oy, 4, BT, "#56666f");
      px(g, ox, oy, 2, BT, pillar); px(g, ox + BT - 2, oy, 2, BT, pillar);
    }
  }
  function buildingAt(x, y) {
    for (const b of W_.buildings) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return b;
    return null;
  }

  function paintClass(g, cls, ox, oy, x, y) {
    switch (cls) {
      case "grass": paintGrass(g, ox, oy, x, y); break;
      case "path": paintPath(g, ox, oy, x, y); break;
      case "cobble": paintCobble(g, ox, oy, x, y); break;
      case "sand": paintSand(g, ox, oy, x, y); break;
      case "gravel": paintGravel(g, ox, oy, x, y); break;
      case "stone": paintStone(g, ox, oy, x, y); break;
      case "water": paintWater(g, ox, oy, x, y, false); break;
      case "deep": paintWater(g, ox, oy, x, y, true); break;
      case "floor": paintFloor(g, ox, oy, x, y); break;
      case "rug": paintRug(g, ox, oy, x, y); break;
      case "shrine": paintShrine(g, ox, oy, x, y); break;
      case "dock": paintDock(g, ox, oy, x, y); break;
      case "rock": paintRockTop(g, ox, oy, x, y); break;
      case "bwall": paintBuildingWall(g, ox, oy, x, y); break;
      default: paintGrass(g, ox, oy, x, y);
    }
  }

  // ragged blend band of neighbour terrain into this tile
  function blendEdge(g, ncls, ox, oy, x, y, nx, ny, side) {
    g.save();
    g.beginPath();
    const r = rng(hash(x * 3 + side, y * 5 + side, 41));
    for (let i = 0; i < BT; i += 2) {
      const d = 2 + Math.floor(r() * 3) + (i > 3 && i < 16 ? 0 : 0);
      if (side === 0) g.rect(ox + i, oy, 2, d);               // north
      if (side === 1) g.rect(ox + i, oy + BT - d, 2, d);      // south
      if (side === 2) g.rect(ox, oy + i, d, 2);               // west
      if (side === 3) g.rect(ox + BT - d, oy + i, d, 2);      // east
    }
    g.clip();
    paintClass(g, ncls, ox, oy, nx, ny);
    g.restore();
  }
  function blendCorner(g, ncls, ox, oy, x, y, nx, ny, corner) {
    g.save();
    g.beginPath();
    const cx = corner & 1 ? ox + BT - 3 : ox, cy = corner & 2 ? oy + BT - 3 : oy;
    g.rect(cx, cy, 3, 3);
    g.clip();
    paintClass(g, ncls, ox, oy, nx, ny);
    g.restore();
  }

  function computeWaterDepth() {
    const Wd = W_.W, Hd = W_.H, d = new Int16Array(Wd * Hd).fill(99);
    const q = [];
    for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) {
      if (!isWater(T(x, y))) { d[y * Wd + x] = -1; continue; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!isWater(T(x + dx, y + dy))) { d[y * Wd + x] = 0; q.push(x, y); break; }
    }
    for (let i = 0; i < q.length; i += 2) {
      const x = q[i], y = q[i + 1], v = d[y * Wd + x];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= Wd || ny >= Hd) continue;
        if (d[ny * Wd + nx] > v + 1) { d[ny * Wd + nx] = v + 1; q.push(nx, ny); }
      }
    }
    W_.water = d;
  }

  function buildChunk(cx, cy) {
    if (!W_.water) computeWaterDepth();
    const [c, g] = mk(CH * BT, CH * BT);
    for (let ty = 0; ty < CH; ty++) for (let tx = 0; tx < CH; tx++) {
      const x = cx * CH + tx, y = cy * CH + ty;
      if (x >= W_.W || y >= W_.H) continue;
      const ox = tx * BT, oy = ty * BT;
      const k = T(x, y);
      const cls = groundClass(x, y);
      paintClass(g, cls, ox, oy, x, y);
      if (k === "wall" && W_.wallKind[y][x] === "fence") paintFence(g, ox, oy, x, y);
      if (k === "flower") paintFlowers(g, ox, oy, x, y);
      // blends
      const bp = BLEND[cls];
      if (bp != null) {
        const ns = [[0, -1, 0], [0, 1, 1], [-1, 0, 2], [1, 0, 3]];
        const higher = [];
        for (const [dx, dy, side] of ns) {
          const nc = groundClass(x + dx, y + dy);
          const np = BLEND[nc];
          if (np != null && np > bp && nc !== cls) { blendEdge(g, nc, ox, oy, x, y, x + dx, y + dy, side); higher.push(side); }
        }
        const cs = [[-1, -1, 0], [1, -1, 1], [-1, 1, 2], [1, 1, 3]];
        for (const [dx, dy, corner] of cs) {
          const nc = groundClass(x + dx, y + dy);
          const np = BLEND[nc];
          if (np != null && np > bp && nc !== cls && groundClass(x + dx, y) !== nc && groundClass(x, y + dy) !== nc) blendCorner(g, nc, ox, oy, x, y, x + dx, y + dy, corner);
        }
      }
      // shoreline foam on water
      if (cls === "water" || cls === "deep") {
        for (const [dx, dy, side] of [[0, -1, 0], [0, 1, 1], [-1, 0, 2], [1, 0, 3]]) {
          const nk = T(x + dx, y + dy);
          if (isWater(nk) || nk === "void") continue;
          const foam = "rgba(235,248,255,.75)", foam2 = "rgba(200,235,250,.45)";
          const r = rng(hash(x, y, side + 50));
          for (let i = 0; i < BT; i += 2) {
            const d = 1 + Math.floor(r() * 2);
            if (side === 0) { px(g, ox + i, oy, 2, d, foam); px(g, ox + i, oy + d, 2, 1, foam2); }
            if (side === 1) { px(g, ox + i, oy + BT - d, 2, d, foam); }
            if (side === 2) { px(g, ox, oy + i, d, 2, foam); px(g, ox + d, oy + i, 1, 2, foam2); }
            if (side === 3) { px(g, ox + BT - d, oy + i, d, 2, foam); }
          }
          if (side === 0 && groundClass(x, y - 1) === "dock") px(g, ox, oy + 2, BT, 4, "rgba(10,40,70,.28)");
        }
      }
      // soft shadow under cliffs and building walls
      const above = groundClass(x, y - 1);
      if ((above === "rock" || above === "bwall") && cls !== "rock" && cls !== "bwall") {
        px(g, ox, oy, BT, 2, "rgba(0,0,0,.25)"); px(g, ox, oy + 2, BT, 2, "rgba(0,0,0,.12)");
      }
    }
    return c;
  }
  function hasChunk(cx, cy) { return W_.chunks.has(cy * 1024 + cx); }
  function chunk(cx, cy) {
    const key = cy * 1024 + cx;
    let c = W_.chunks.get(key);
    if (!c) { c = buildChunk(cx, cy); W_.chunks.set(key, c); }
    return c;
  }

  // ---------- sprites ----------
  const SPR = new Map();
  function sprite(key, fn) { let s = SPR.get(key); if (!s) { s = fn(); SPR.set(key, s); } return s; }

  // per-pixel blob shader: circles = [[cx,cy,r],...]
  function blob(g, w, h, circles, pal, seed, opts = {}) {
    const r = rng(seed);
    const inside = (x, y) => circles.some(([cx, cy, rr]) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= rr * rr);
    const lx = opts.lx != null ? opts.lx : -0.6, ly = opts.ly != null ? opts.ly : -0.8;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!inside(x + 0.5, y + 0.5)) continue;
      // outline
      if (!inside(x - 0.5, y + 0.5) || !inside(x + 1.5, y + 0.5) || !inside(x + 0.5, y - 0.5) || !inside(x + 0.5, y + 1.5)) { px(g, x, y, 1, 1, pal.outline); continue; }
      // light from nearest circle centre
      let best = circles[0], bd = 1e9;
      for (const c of circles) { const d = Math.hypot(x - c[0], y - c[1]) / c[2]; if (d < bd) { bd = d; best = c; } }
      const nx = (x - best[0]) / best[2], ny = (y - best[1]) / best[2];
      let l = -(nx * lx + ny * ly) * 0.9 + (opts.flat || 0);
      l += (r() - 0.5) * (opts.noise != null ? opts.noise : 0.55);
      const col = l > 0.55 ? pal.hi : l > 0.05 ? pal.mid : l > -0.45 ? pal.base : pal.dark;
      px(g, x, y, 1, 1, col);
    }
  }

  function treeSprite(kind, variant) {
    return sprite("tree:" + kind + ":" + variant, () => {
      const seed = hash(variant, kind.length, 77);
      const r = rng(seed);
      if (kind === "pine") {
        const [c, g] = mk(30, 46);
        px(g, 13, 36, 4, 9, "#6b4426"); px(g, 13, 36, 1, 9, "#8a5a33");
        const tiers = [[15, 4, 9, 14], [15, 12, 12, 26], [15, 20, 14, 38]];
        const pal = { outline: "#1e3b22", dark: "#24512b", base: "#2f6a35", mid: "#3d8041", hi: "#5aa152" };
        for (let i = tiers.length - 1; i >= 0; i--) {
          const [cx, top, half, bottom] = tiers[i];
          for (let y = top; y <= bottom; y++) {
            const t = (y - top) / (bottom - top);
            const hw = Math.round(half * t + 1);
            for (let x = cx - hw; x <= cx + hw; x++) {
              const edge = x === cx - hw || x === cx + hw || y === bottom;
              let col = edge ? pal.outline : x < cx - hw * 0.3 ? pal.mid : x > cx + hw * 0.4 ? pal.dark : pal.base;
              if (!edge && r() < 0.12) col = pal.hi;
              if (!edge && y === bottom - 1) col = pal.dark;
              px(g, x, y, 1, 1, col);
            }
          }
        }
        return { c, ax: 15, ay: 45 };
      }
      if (kind === "bamboo") {
        const [c, g] = mk(26, 58);
        const stalks = 3 + (variant % 2);
        for (let i = 0; i < stalks; i++) {
          const sx = 3 + i * 6 + Math.floor(r() * 3), top = 4 + Math.floor(r() * 14);
          const lean = r() < 0.5 ? 0 : 1;
          for (let y = top; y < 57; y++) {
            const xx = sx + (y < top + 12 ? lean : 0);
            px(g, xx, y, 3, 1, "#7fb446"); px(g, xx, y, 1, 1, "#a8d46a"); px(g, xx + 2, y, 1, 1, "#5a8a30");
          }
          for (let y = top + 6; y < 56; y += 7 + Math.floor(r() * 2)) { px(g, sx - 1, y, 5, 1, "#4f7a2a"); px(g, sx, y - 1, 3, 1, "#c4e08a"); }
          // leaves
          for (let k = 0; k < 4; k++) {
            const ly = top + Math.floor(r() * 18), dir = r() < 0.5 ? -1 : 1;
            for (let j = 0; j < 5; j++) px(g, sx + 1 + dir * (j + 1), ly + Math.floor(j / 2), 1, 1, j < 2 ? "#6aa83a" : "#4f8f2c");
            px(g, sx + 1 + dir * 2, ly, 1, 1, "#9fd45e");
          }
        }
        return { c, ax: 13, ay: 57 };
      }
      const cherry = kind === "cherry";
      const [c, g] = mk(34, 44);
      // trunk
      px(g, 15, 26, 5, 17, cherry ? "#5a3426" : "#6b4426");
      px(g, 15, 26, 1, 17, cherry ? "#7a4a36" : "#8a5a33");
      px(g, 19, 26, 1, 17, "#3e2416");
      px(g, 12, 41, 11, 2, cherry ? "#4a2a1e" : "#5a3820");
      if (cherry) { px(g, 11, 24, 5, 2, "#5a3426"); px(g, 20, 22, 5, 2, "#5a3426"); }
      const pal = cherry
        ? { outline: "#a14a72", dark: "#d97aa2", base: "#ec9cbd", mid: "#f6bdd3", hi: "#ffe4ef" }
        : { outline: "#22482a", dark: "#2f6234", base: "#3f7d3e", mid: "#55984a", hi: "#78b85e" };
      const circles = [[17, 14, 10 + r() * 2], [9, 20, 7 + r() * 2], [25, 20, 7 + r() * 2], [17, 23, 8]];
      if (variant % 3 === 1) circles.push([12, 10, 6]);
      if (variant % 3 === 2) circles.push([23, 9, 6]);
      blob(g, 34, 34, circles, pal, seed);
      if (cherry) for (let i = 0; i < 10; i++) px(g, 6 + Math.floor(r() * 22), 6 + Math.floor(r() * 22), 1, 1, "#ffffff");
      else for (let i = 0; i < 4; i++) px(g, 8 + Math.floor(r() * 18), 10 + Math.floor(r() * 14), 2, 2, "#9ccf6a");
      return { c, ax: 17, ay: 43 };
    });
  }
  function stumpSprite(kind) {
    return sprite("stump:" + kind, () => {
      const [c, g] = mk(20, 14);
      if (kind === "bamboo") {
        for (let i = 0; i < 3; i++) { px(g, 4 + i * 5, 5 + (i % 2) * 2, 3, 8 - (i % 2) * 2, "#7fb446"); px(g, 4 + i * 5, 5 + (i % 2) * 2, 3, 1, "#d8e8a0"); }
        return { c, ax: 10, ay: 13 };
      }
      px(g, 5, 6, 10, 7, kind === "cherry" ? "#5a3426" : "#6b4426");
      px(g, 5, 4, 10, 3, "#c79a62"); px(g, 7, 5, 6, 1, "#a57a46"); px(g, 9, 5, 2, 1, "#8a6034");
      px(g, 3, 12, 14, 1, "#4a2e18");
      return { c, ax: 10, ay: 13 };
    });
  }
  function rockSprite(kind, depleted, variant) {
    return sprite("rock:" + kind + ":" + !!depleted + ":" + variant, () => {
      const [c, g] = mk(24, 22);
      const quarry = kind === "jadeore";
      const pal = depleted
        ? { outline: "#3a3632", dark: "#55504a", base: "#68625b", mid: "#77716a", hi: "#8a847c" }
        : quarry ? { outline: "#36403a", dark: "#56625a", base: "#6c786f", mid: "#808c82", hi: "#9eaa9f" }
          : { outline: "#3a332c", dark: "#5c5248", base: "#72675b", mid: "#867a6c", hi: "#a09382" };
      const seed = hash(variant, kind.length, 91);
      blob(g, 24, 22, [[12, 12, 9], [7, 15, 6], [17, 15, 6], [12, 8, 6]], pal, seed);
      const r = rng(seed + 1);
      if (!depleted) {
        const oc = ORE_COL[kind] || ORE_COL.ore;
        for (let i = 0; i < 5; i++) {
          const x = 6 + Math.floor(r() * 12), y = 6 + Math.floor(r() * 10);
          px(g, x, y, 2, 2, oc[0]); px(g, x, y, 1, 1, oc[1]); px(g, x + 1, y + 2, 1, 1, "rgba(0,0,0,.25)");
        }
      } else {
        px(g, 9, 9, 1, 4, "#3a3632"); px(g, 10, 12, 1, 3, "#3a3632"); px(g, 14, 8, 1, 3, "#3a3632");
      }
      return { c, ax: 12, ay: 20 };
    });
  }
  function bushSprite(depleted, variant) {
    return sprite("bush:" + !!depleted + ":" + variant, () => {
      const [c, g] = mk(20, 16);
      const pal = { outline: "#244a26", dark: "#2f6234", base: "#3f7d3e", mid: "#55984a", hi: "#78b85e" };
      blob(g, 20, 16, [[10, 9, 6], [5, 11, 4], [15, 11, 4]], pal, hash(variant, 3, 5));
      if (!depleted) {
        const cols = [["#e8578a", "#ffb3cc"], ["#5aa0e6", "#bfe0ff"], ["#f2c94c", "#fff0b0"]];
        const spots = [[6, 8], [12, 6], [14, 11], [8, 12]];
        spots.forEach(([x, y], i) => {
          const cc = cols[(i + variant) % cols.length];
          px(g, x - 1, y - 1, 3, 3, cc[0]); px(g, x - 1, y - 1, 1, 1, cc[1]); px(g, x + 1, y, 1, 2, shade(cc[0], -0.25));
          px(g, x, y - 1, 1, 3, shade(cc[0], -0.12));
        });
      }
      return { c, ax: 10, ay: 15 };
    });
  }
  function lanternPostSprite() {
    return sprite("lanternpost", () => {
      const [c, g] = mk(16, 34);
      px(g, 7, 6, 2, 27, "#5a3820"); px(g, 7, 6, 1, 27, "#7a5230");
      px(g, 3, 6, 10, 2, "#5a3820");
      px(g, 4, 32, 8, 2, "#4a2e18");
      // lantern
      px(g, 3, 9, 1, 2, "#3a2414");
      px(g, 1, 11, 6, 1, "#e6b84a"); px(g, 0, 12, 8, 7, "#c8322a"); px(g, 1, 12, 2, 7, "#e85a4a"); px(g, 6, 12, 2, 7, "#9a2018");
      px(g, 0, 15, 8, 1, "#9a2018"); px(g, 1, 19, 6, 1, "#e6b84a"); px(g, 3, 20, 2, 2, "#e6b84a");
      return { c, ax: 8, ay: 33 };
    });
  }
  function furnaceSprite() {
    return sprite("furnace", () => {
      const [c, g] = mk(26, 32);
      // chimney
      px(g, 15, 0, 6, 12, "#7a4a3a"); px(g, 15, 0, 6, 2, "#4a2e26"); px(g, 15, 0, 1, 12, "#9a6050");
      // dome of bricks
      for (let y = 8; y < 30; y++) {
        const t = (y - 8) / 22, hw = Math.round(6 + Math.sqrt(Math.min(1, t * 1.6)) * 6);
        for (let x = 13 - hw; x <= 12 + hw; x++) {
          const edge = x === 13 - hw || x === 12 + hw;
          const brick = ((y % 4 === 0) || ((x + (Math.floor(y / 4) % 2) * 3) % 6 === 0)) ? "#6e3a2c" : (x < 10 ? "#b0604a" : "#94503c");
          px(g, x, y, 1, 1, edge ? "#4a2a20" : brick);
        }
      }
      px(g, 1, 29, 24, 3, "#5a5047");
      // mouth
      px(g, 8, 19, 10, 9, "#2a1410"); px(g, 9, 18, 8, 1, "#2a1410"); px(g, 7, 18, 12, 1, "#4a2a20");
      return { c, ax: 13, ay: 31 };
    });
  }
  function anvilSprite() {
    return sprite("anvil", () => {
      const [c, g] = mk(22, 18);
      px(g, 6, 9, 10, 8, "#6b4426"); px(g, 6, 9, 10, 2, "#8a5a33"); px(g, 5, 16, 12, 2, "#4a2e18");
      px(g, 2, 3, 16, 4, "#4a4e56"); px(g, 2, 3, 16, 1, "#9aa2ae"); px(g, 18, 4, 3, 2, "#4a4e56");
      px(g, 7, 7, 7, 3, "#3a3e46"); px(g, 2, 6, 16, 1, "#2a2e34");
      return { c, ax: 11, ay: 17 };
    });
  }
  function rangeSprite() {
    return sprite("range", () => {
      const [c, g] = mk(24, 22);
      px(g, 2, 8, 20, 13, "#8a8478"); px(g, 2, 8, 20, 2, "#b0a898"); px(g, 2, 20, 20, 2, "#4a443c");
      for (let i = 0; i < 4; i++) px(g, 3 + i * 5, 12, 4, 1, "#6a645a");
      px(g, 8, 14, 8, 6, "#2a1410");
      // wok
      px(g, 5, 4, 14, 4, "#2e3236"); px(g, 6, 4, 12, 1, "#5a6066"); px(g, 18, 3, 5, 1, "#6b4426");
      return { c, ax: 12, ay: 21 };
    });
  }
  // ---------- roofs ----------
  function roofSprite(b) {
    return sprite("roof:" + b.x0 + "," + b.y0, () => {
      const wTiles = b.x1 - b.x0 + 1;
      const w = wTiles * BT + 16, h = 36;
      const [c, g] = mk(w, h);
      const temple = b.zone === "shrine-inner" || b.role === "greet";
      const smith = b.role === "smith";
      const tile = temple ? ["#b8432f", "#8f2c1f", "#d8614a", "#6e1f15"] : smith ? ["#4f5960", "#3a434a", "#6b777f", "#2a3136"] : ["#3f6670", "#2f4f58", "#5a8a95", "#22393f"];
      // body of roof: trapezoid
      for (let y = 6; y < 30; y++) {
        const inset = Math.max(0, Math.round((30 - y) * 0.15));
        for (let x = 4 + inset; x < w - 4 - inset; x++) {
          const row = Math.floor((y - 6) / 4);
          let col = (y - 6) % 4 === 3 ? tile[1] : ((x + row * 3) % 6 === 0 ? tile[3] : tile[0]);
          if ((y - 6) % 4 === 0) col = tile[2];
          px(g, x, y, 1, 1, col);
        }
      }
      // ridge
      px(g, 6, 3, w - 12, 4, temple ? "#e6b84a" : "#7a2a20"); px(g, 6, 3, w - 12, 1, temple ? "#fff0a8" : "#a8443a");
      // upturned eaves
      for (let i = 0; i < 6; i++) { px(g, i, 24 - i * 2, 4, 3, tile[1]); px(g, w - 4 - i, 24 - i * 2, 4, 3, tile[1]); }
      px(g, 0, 12, 3, 2, "#e6b84a"); px(g, w - 3, 12, 3, 2, "#e6b84a");
      // fascia
      px(g, 2, 29, w - 4, 4, "#9c2b20"); px(g, 2, 29, w - 4, 1, "#e6b84a"); px(g, 2, 33, w - 4, 1, "#5a1810");
      // ridge ornaments
      px(g, 4, 1, 4, 4, "#e6b84a"); px(g, w - 8, 1, 4, 4, "#e6b84a");
      if (temple) { px(g, w / 2 - 3, 0, 6, 4, "#e6b84a"); px(g, w / 2 - 1, 0, 2, 1, "#fff0a8"); }
      return { c, ax: 8, ay: 0, w, h };
    });
  }
  const SIGN = { bank: "银", shop: "商", cook: "厨", smith: "铁", greet: "庙" };

  // ---------- avatar tokens ----------
  const TOKENS = new Map();
  function tokenFor(img, key, ring) {
    const k = key + "|" + ring;
    let t = TOKENS.get(k);
    if (t) return t;
    if (!img || !img.complete || !img.naturalWidth) return null;
    const S = 40;
    const c = document.createElement("canvas"); c.width = S; c.height = S;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.clip();
    const iw = img.naturalWidth, ih = img.naturalHeight, s = Math.min(iw, ih);
    g.drawImage(img, (iw - s) / 2, (ih - s) / 2, s, s, 2, 2, S - 4, S - 4);
    // soft top highlight
    const grd = g.createLinearGradient(0, 0, 0, S);
    grd.addColorStop(0, "rgba(255,255,255,.18)"); grd.addColorStop(0.5, "rgba(255,255,255,0)"); grd.addColorStop(1, "rgba(0,0,0,.15)");
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    g.restore();
    g.lineWidth = 2.5; g.strokeStyle = ring || "#2a1c12";
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1.5, 0, Math.PI * 2); g.stroke();
    TOKENS.set(k, c);
    return c;
  }

  // ---------- icons (procedural pixel icons as data URLs) ----------
  const ICONS = new Map();
  function iconCanvas(draw) { const [c, g] = mk(16, 16); draw(g); return c; }
  const METAL = { bronze: ["#c98a3e", "#f0b870", "#8a5a24"], iron: ["#9aa2ae", "#d6dde6", "#5a626e"], jade: ["#3fbf74", "#a4f0c0", "#1f7a46"], copper: ["#d9823e", "#f2a865", "#8a4a1e"], gold: ["#e6b84a", "#fff0a8", "#9a7420"] };
  function metalOf(id) { for (const m of ["bronze", "iron", "jade", "copper", "gold"]) if (id.indexOf(m) >= 0) return METAL[m]; return METAL.iron; }
  function drawFish(g, body, belly, small) {
    const o = small ? 2 : 0;
    px(g, 3 + o, 6, 9 - o, 5, body); px(g, 2 + o, 7, 1, 3, body); px(g, 4 + o, 10, 7 - o, 1, belly);
    px(g, 12, 5, 1, 7, body); px(g, 13, 4, 2, 3, body); px(g, 13, 10, 2, 3, body);
    px(g, 4 + o, 7, 1, 1, "#1a1a1a"); px(g, 5 + o, 6, 5, 1, shade(body, 0.3));
  }
  function itemIconCanvas(id) {
    return iconCanvas((g) => {
      const fishCols = { minnow: ["#9fb8c4", "#dfeef4"], fish: ["#7f9aa8", "#cfe2ea"], koi: ["#f0904a", "#fff0e0"], golden_koi: ["#e6b84a", "#fff0a8"], lucky_koi: ["#f2c230", "#fffbe0"], moon_koi: ["#c8d4f0", "#ffffff"] };
      const sparkle = () => { px(g, 13, 1, 1, 3, "#fffbe0"); px(g, 12, 2, 3, 1, "#fffbe0"); };
      const qm = /^(.*)_(fine|perfect)$/.exec(id);
      if (qm) {
        g.drawImage(itemIconCanvas(qm[1]), 0, 0);
        const c = qm[2] === "perfect" ? ["#ffd84a", "#fff6c0"] : ["#c8d4e0", "#ffffff"];
        px(g, 11, 0, 5, 5, "#2a1a0a"); px(g, 12, 1, 3, 3, c[0]); px(g, 13, 0, 1, 5, c[0]); px(g, 11, 2, 5, 1, c[0]); px(g, 13, 2, 1, 1, c[1]);
        return;
      }
      const yarnBall = (a, b, c) => { px(g, 3, 3, 10, 10, a); px(g, 4, 2, 8, 12, a); px(g, 2, 4, 12, 8, a); px(g, 4, 4, 3, 2, b); px(g, 5, 6, 7, 1, c); px(g, 4, 9, 8, 1, c); };
      const gem = (a, b, c) => { px(g, 5, 3, 6, 2, b); px(g, 3, 5, 10, 3, a); px(g, 4, 8, 8, 2, a); px(g, 6, 10, 4, 2, c); px(g, 7, 12, 2, 1, c); px(g, 5, 5, 2, 2, b); sparkle(); };
      if (id === "rose_yarn") { yarnBall("#ff8ab8", "#ffd6e8", "#d0507e"); sparkle(); return; }
      if (id === "sky_yarn") { yarnBall("#5ab4f0", "#c8ecff", "#2a78b8"); sparkle(); return; }
      if (id === "rainbow_yarn") { px(g, 3, 3, 10, 10, "#e8578a"); px(g, 4, 2, 8, 12, "#e8578a"); px(g, 2, 4, 12, 8, "#e8578a"); px(g, 2, 5, 12, 2, "#f0a040"); px(g, 2, 7, 12, 2, "#f0e050"); px(g, 2, 9, 12, 2, "#60c060"); px(g, 3, 11, 10, 2, "#5a8af0"); px(g, 4, 2, 8, 1, "#a060d0"); sparkle(); return; }
      if (id === "sapphire") { gem("#3a6ae0", "#a8c4ff", "#1a3a90"); return; }
      if (id === "ruby") { gem("#d0303a", "#ffb0b0", "#801820"); return; }
      if (id === "emerald") { gem("#30b060", "#b0f0c8", "#16602e"); return; }
      if (id === "pearl") { px(g, 5, 5, 6, 6, "#f4eee6"); px(g, 4, 6, 8, 4, "#f4eee6"); px(g, 6, 4, 4, 8, "#f4eee6"); px(g, 6, 6, 2, 2, "#ffffff"); px(g, 9, 9, 2, 2, "#c8bcae"); sparkle(); return; }
      if (id === "old_boot") { px(g, 4, 2, 6, 9, "#6b4a2a"); px(g, 4, 10, 10, 4, "#6b4a2a"); px(g, 4, 13, 11, 1, "#3a2814"); px(g, 5, 2, 4, 1, "#8a6a42"); px(g, 6, 5, 3, 1, "#c8b890"); px(g, 6, 7, 3, 1, "#c8b890"); px(g, 11, 9, 1, 1, "#5aa0e6"); px(g, 12, 7, 1, 1, "#5aa0e6"); return; }
      if (id === "message_bottle") { px(g, 4, 6, 9, 7, "#5aa880"); px(g, 3, 7, 11, 5, "#5aa880"); px(g, 12, 8, 3, 3, "#5aa880"); px(g, 14, 8, 1, 3, "#8a5a33"); px(g, 5, 8, 6, 3, "#f3ead6"); px(g, 6, 9, 4, 1, "#a09382"); px(g, 4, 6, 4, 1, "#9ad8b8"); return; }
      if (id === "bird_nest") { px(g, 2, 8, 12, 5, "#8a6438"); px(g, 3, 7, 10, 1, "#a8804a"); px(g, 3, 12, 10, 2, "#6b4a2a"); for (const [x, y] of [[3, 9], [7, 10], [11, 9], [5, 11], [9, 12]]) px(g, x, y, 2, 1, "#c8a060"); px(g, 5, 6, 3, 3, "#e8f0f8"); px(g, 8, 6, 3, 3, "#c8e0f0"); return; }
      if (id === "tree_seed") { px(g, 6, 4, 4, 8, "#9a6a32"); px(g, 5, 6, 6, 4, "#9a6a32"); px(g, 7, 5, 1, 3, "#c8925a"); px(g, 8, 1, 1, 3, "#5aa040"); px(g, 9, 1, 3, 2, "#7fc050"); return; }
      if (id === "burnt_fish") { px(g, 1, 11, 14, 3, "#f3ead6"); px(g, 1, 13, 14, 1, "#c8b890"); drawFish(g, "#2a2420", "#4a3a30", false); px(g, 6, 2, 1, 2, "#9a9a9a"); px(g, 9, 1, 1, 3, "#9a9a9a"); return; }
      if (id === "lucky_cat_gem") { px(g, 4, 5, 8, 8, "#3fbf74"); px(g, 3, 6, 10, 6, "#3fbf74"); px(g, 4, 3, 2, 2, "#3fbf74"); px(g, 10, 3, 2, 2, "#3fbf74"); px(g, 5, 6, 3, 2, "#a4f0c0"); px(g, 6, 8, 1, 1, "#1f5a36"); px(g, 9, 8, 1, 1, "#1f5a36"); px(g, 4, 12, 8, 1, "#1f7a46"); sparkle(); return; }
      if (id === "golden_bamboo") { px(g, 6, 1, 3, 14, "#e6b84a"); px(g, 6, 1, 1, 14, "#fff0a8"); px(g, 5, 5, 5, 1, "#9a7420"); px(g, 5, 10, 5, 1, "#9a7420"); px(g, 9, 3, 3, 1, "#c8962a"); sparkle(); return; }
      if (id === "golden_yarn") { px(g, 3, 3, 10, 10, "#e6b84a"); px(g, 4, 2, 8, 12, "#e6b84a"); px(g, 2, 4, 12, 8, "#e6b84a"); px(g, 4, 4, 3, 2, "#fff0a8"); px(g, 5, 6, 7, 1, "#9a7420"); px(g, 4, 9, 8, 1, "#9a7420"); sparkle(); return; }
      if (id === "raw_lucky_koi") { drawFish(g, fishCols.lucky_koi[0], fishCols.lucky_koi[1], false); sparkle(); return; }
      if (id.startsWith("raw_") || id.startsWith("cooked_")) {
        const kind = id.replace(/^(raw|cooked)_/, "");
        const cc = fishCols[kind] || fishCols.fish;
        if (id.startsWith("cooked_")) { px(g, 1, 11, 14, 3, "#f3ead6"); px(g, 1, 13, 14, 1, "#c8b890"); drawFish(g, shade(cc[0], -0.35), "#d8a060", kind === "minnow"); px(g, 6, 7, 1, 1, "#5a3010"); px(g, 9, 8, 1, 1, "#5a3010"); }
        else drawFish(g, cc[0], cc[1], kind === "minnow");
        return;
      }
      if (id === "yarn") { px(g, 3, 3, 10, 10, "#e8578a"); px(g, 4, 2, 8, 12, "#e8578a"); px(g, 2, 4, 12, 8, "#e8578a"); px(g, 4, 4, 3, 2, "#ffb3cc"); px(g, 5, 6, 7, 1, "#b8336a"); px(g, 4, 9, 8, 1, "#b8336a"); px(g, 12, 12, 3, 1, "#e8578a"); return; }
      if (id === "bamboo") { px(g, 6, 1, 3, 14, "#7fb446"); px(g, 6, 1, 1, 14, "#a8d46a"); px(g, 5, 5, 5, 1, "#4f7a2a"); px(g, 5, 10, 5, 1, "#4f7a2a"); px(g, 9, 3, 4, 1, "#5a9a32"); px(g, 11, 2, 2, 1, "#5a9a32"); return; }
      if (id.endsWith("_logs")) { const bark = id.startsWith("cherry") ? "#7a4a46" : "#6b4426", core = id.startsWith("cherry") ? "#f0b8c8" : "#e0b47a"; for (const [x, y] of [[2, 8], [7, 8], [4, 3]]) { px(g, x, y, 7, 5, bark); px(g, x + 5, y, 2, 5, core); px(g, x + 6, y + 2, 1, 1, shade(core, -0.3)); px(g, x, y, 5, 1, shade(bark, 0.25)); } return; }
      if (id === "ore" || id.endsWith("_ore")) { const oc = ORE_COL[id === "ore" ? "ore" : id.replace("_ore", "")] || ORE_COL.ore; px(g, 2, 5, 12, 8, "#72675b"); px(g, 3, 4, 10, 10, "#72675b"); px(g, 3, 4, 6, 2, "#a09382"); px(g, 4, 12, 9, 1, "#4a423a"); for (const [x, y] of [[5, 7], [9, 6], [8, 10], [11, 9]]) { px(g, x, y, 2, 2, oc[0]); px(g, x, y, 1, 1, oc[1]); } return; }
      if (id.endsWith("_bar")) { const m = metalOf(id); px(g, 2, 7, 12, 5, m[0]); px(g, 4, 5, 8, 2, m[1]); px(g, 2, 11, 12, 1, m[2]); px(g, 3, 7, 10, 1, m[1]); return; }
      if (id === "bones") { px(g, 3, 7, 10, 2, "#f3ead6"); px(g, 2, 6, 2, 2, "#f3ead6"); px(g, 2, 9, 2, 2, "#f3ead6"); px(g, 12, 6, 2, 2, "#f3ead6"); px(g, 12, 9, 2, 2, "#f3ead6"); px(g, 4, 9, 8, 1, "#c8b890"); return; }
      if (id === "rat_tail") { for (let i = 0; i < 10; i++) px(g, 3 + i, 4 + Math.round(Math.sin(i / 1.5) * 2) + i / 2, 2, 1, "#e8a0a8"); return; }
      if (id === "shrine_token") { px(g, 3, 3, 10, 10, "#e6b84a"); px(g, 4, 2, 8, 12, "#e6b84a"); px(g, 2, 4, 12, 8, "#e6b84a"); px(g, 7, 7, 2, 2, "#5a3a10"); px(g, 4, 4, 3, 1, "#fff0a8"); px(g, 5, 13, 7, 1, "#9a7420"); return; }
      if (id === "lucky_bell") { px(g, 5, 4, 6, 7, "#e6b84a"); px(g, 4, 9, 8, 2, "#e6b84a"); px(g, 7, 11, 2, 2, "#9a7420"); px(g, 6, 5, 2, 2, "#fff0a8"); px(g, 4, 2, 8, 2, "#c8322a"); return; }
      if (id === "red_scarf") { px(g, 2, 4, 12, 4, "#c8322a"); px(g, 9, 8, 4, 6, "#c8322a"); px(g, 2, 4, 12, 1, "#e85a4a"); px(g, 9, 13, 4, 1, "#e6b84a"); return; }
      if (id === "gold_collar") { g.strokeStyle = "#e6b84a"; px(g, 3, 5, 10, 2, "#e6b84a"); px(g, 2, 7, 2, 3, "#e6b84a"); px(g, 12, 7, 2, 3, "#e6b84a"); px(g, 4, 10, 8, 2, "#e6b84a"); px(g, 7, 11, 2, 3, "#fff0a8"); return; }
      if (id === "lantern_hat") { px(g, 4, 4, 8, 9, "#c8322a"); px(g, 5, 4, 2, 9, "#e85a4a"); px(g, 3, 3, 10, 1, "#e6b84a"); px(g, 3, 13, 10, 1, "#e6b84a"); px(g, 7, 1, 2, 2, "#e6b84a"); return; }
      if (id === "bamboo_hat") { px(g, 1, 10, 14, 2, "#a8843a"); px(g, 2, 8, 12, 2, "#e0c070"); px(g, 4, 6, 8, 2, "#d0b060"); px(g, 6, 4, 4, 2, "#c8a050"); px(g, 7, 2, 2, 2, "#e0c070"); px(g, 3, 9, 10, 1, "#c8322a"); px(g, 2, 12, 12, 1, "#6a4a1a"); return; }
      if (id === "koi_charm") { px(g, 3, 1, 1, 6, "#3a2a1c"); px(g, 12, 1, 1, 6, "#3a2a1c"); px(g, 4, 6, 8, 1, "#3a2a1c"); px(g, 5, 7, 6, 5, "#f08a3a"); px(g, 6, 8, 2, 2, "#fff3c8"); px(g, 9, 9, 2, 2, "#e85a2a"); px(g, 7, 12, 2, 3, "#e85a2a"); px(g, 5, 7, 6, 1, "#ffb070"); return; }
      if (id === "shrine_sash") { px(g, 2, 1, 4, 3, "#f4ead0"); px(g, 4, 4, 4, 3, "#f4ead0"); px(g, 6, 7, 4, 3, "#f4ead0"); px(g, 8, 10, 4, 3, "#f4ead0"); px(g, 2, 1, 1, 3, "#c8322a"); px(g, 11, 10, 1, 3, "#c8322a"); px(g, 9, 12, 5, 3, "#e6b84a"); px(g, 10, 13, 3, 1, "#fff0a8"); return; }
      if (id === "maneki_ribbon") { px(g, 2, 5, 5, 5, "#c8322a"); px(g, 9, 5, 5, 5, "#c8322a"); px(g, 7, 6, 2, 3, "#e6b84a"); px(g, 5, 10, 2, 4, "#c8322a"); px(g, 9, 10, 2, 4, "#c8322a"); return; }
      const m = (id === "lucky_pickaxe" || id.includes("charm")) ? METAL.gold : metalOf(id);
      const holderSparkle = /charm|lantern_jade/.test(id);
      if (id.endsWith("_pickaxe")) { for (let i = 0; i < 10; i++) px(g, 3 + i, 13 - i, 2, 2, "#8a5a33"); px(g, 4, 2, 9, 2, m[0]); px(g, 3, 3, 2, 3, m[0]); px(g, 12, 3, 2, 3, m[0]); px(g, 5, 2, 6, 1, m[1]); if (holderSparkle) sparkle(); return; }
      if (id.endsWith("_axe")) { for (let i = 0; i < 10; i++) px(g, 3 + i, 13 - i, 2, 2, "#8a5a33"); px(g, 9, 2, 5, 6, m[0]); px(g, 13, 2, 1, 6, m[1]); px(g, 9, 2, 5, 1, m[1]); if (holderSparkle) sparkle(); return; }
      if (id.endsWith("_rod")) { for (let i = 0; i < 12; i++) px(g, 2 + i, 14 - i, 1, 1, "#8a5a33"); px(g, 2, 13, 3, 2, m[0]); px(g, 13, 2, 1, 9, "#e8e8e8"); px(g, 12, 11, 3, 2, "#c8322a"); if (holderSparkle) sparkle(); return; }
      if (id.endsWith("_sword")) { for (let i = 0; i < 8; i++) px(g, 6 + i, 9 - i, 2, 2, m[0]); for (let i = 0; i < 8; i++) px(g, 7 + i, 8 - i, 1, 1, m[1]); px(g, 3, 10, 5, 2, "#e6b84a"); px(g, 5, 8, 2, 5, "#e6b84a"); px(g, 2, 12, 3, 2, "#6b4426"); return; }
      if (id.endsWith("_helm")) { px(g, 3, 4, 10, 8, m[0]); px(g, 4, 3, 8, 1, m[0]); px(g, 4, 4, 4, 2, m[1]); px(g, 3, 11, 10, 2, m[2]); px(g, 7, 7, 2, 5, m[2]); return; }
      if (id.endsWith("_mail")) { px(g, 3, 3, 10, 11, m[0]); px(g, 1, 4, 3, 5, m[0]); px(g, 12, 4, 3, 5, m[0]); px(g, 6, 3, 4, 2, m[2]); for (let y = 6; y < 14; y += 2) px(g, 4, y, 8, 1, m[2]); px(g, 4, 4, 2, 9, m[1]); return; }
      // generic pouch
      px(g, 4, 5, 8, 9, "#a8763f"); px(g, 5, 3, 6, 2, "#8a5a24"); px(g, 5, 6, 2, 6, "#c8925a");
    });
  }
  function skillIconCanvas(id) {
    return iconCanvas((g) => {
      if (id === "fishing") { for (let i = 0; i < 12; i++) px(g, 2 + i, 14 - i, 1, 1, "#8a5a33"); px(g, 13, 2, 1, 7, "#dfe8ee"); px(g, 11, 9, 3, 1, "#c0c8d0"); px(g, 11, 8, 1, 1, "#c0c8d0"); px(g, 3, 9, 5, 3, "#5aa0e6"); px(g, 2, 10, 1, 1, "#5aa0e6"); return; }
      if (id === "yarn") { const c = itemIconCanvas("yarn"); g.drawImage(c, 0, 0); return; }
      if (id === "woodcutting") { const c = itemIconCanvas("bronze_axe"); g.drawImage(c, 0, 0); return; }
      if (id === "mining") { const c = itemIconCanvas("iron_pickaxe"); g.drawImage(c, 0, 0); return; }
      if (id === "smithing") { px(g, 2, 10, 12, 3, "#4a4e56"); px(g, 2, 10, 12, 1, "#9aa2ae"); px(g, 5, 13, 6, 2, "#3a3e46"); px(g, 8, 2, 5, 3, "#9aa2ae"); for (let i = 0; i < 5; i++) px(g, 7 - i, 5 + i, 2, 1, "#8a5a33"); px(g, 13, 8, 1, 1, "#ffd27a"); px(g, 12, 7, 1, 1, "#ff9a3a"); return; }
      if (id === "cooking") { px(g, 2, 7, 9, 5, "#2e3236"); px(g, 3, 7, 7, 1, "#5a6066"); px(g, 11, 8, 4, 2, "#6b4426"); px(g, 4, 2, 1, 3, "#dfe8ee"); px(g, 7, 1, 1, 4, "#dfe8ee"); px(g, 4, 12, 6, 2, "#ff9a3a"); return; }
      if (id === "combat") { for (let i = 0; i < 10; i++) { px(g, 3 + i, 12 - i, 2, 1, "#c8d0d8"); px(g, 12 - i, 12 - i, 2, 1, "#c8d0d8"); } px(g, 2, 12, 3, 2, "#e6b84a"); px(g, 11, 12, 3, 2, "#e6b84a"); return; }
      const c = itemIconCanvas("x"); g.drawImage(c, 0, 0);
    });
  }
  function iconURL(kind, id) {
    const key = kind + ":" + id;
    let u = ICONS.get(key);
    if (!u) {
      const c16 = kind === "skill" ? skillIconCanvas(id) : itemIconCanvas(id);
      const [c, g] = mk(32, 32);
      g.drawImage(c16, 0, 0, 32, 32);
      u = c.toDataURL("image/png");
      ICONS.set(key, u);
    }
    return u;
  }

  // ---------- minimap ----------
  function miniColor(x, y) {
    const k = T(x, y);
    const z = W_.zone[y][x];
    if (k === "water") return "#4a9dbf";
    if (k === "deepwater") return "#2e729c";
    if (k === "sand") return "#e3c98f";
    if (k === "dock" || k === "plank" || k === "bridge" || k === "lantern") return "#a2703f";
    if (k === "path") return z === "village" ? "#c9b99a" : "#c79d63";
    if (k === "quarry") return "#b2b49e";
    if (k === "stone") return z === "quarry" ? "#8d958a" : "#857a6c";
    if (ORES.has(k)) return (ORE_COL[k] || ORE_COL.ore)[0];
    if (k === "wall") { const wk = W_.wallKind[y][x]; return wk === "bld" ? "#9c2b20" : wk === "fence" ? "#8a5a2e" : "#4d453d"; }
    if (k === "floor" || k === "rug") return "#a8763f";
    if (k === "shrine") return "#d8ccad";
    if (k === "cherry") return "#ec9cbd";
    if (k === "pine") return "#2f6a35";
    if (k === "bamboo") return "#7fb446";
    if (k === "tree") return "#3f7d3e";
    if (k === "flower") return "#9cc262";
    return (GRASS[z] || GRASS.wilds)[0];
  }
  function miniBase() {
    if (W_.mini) return W_.mini;
    const [c, g] = mk(W_.W, W_.H);
    for (let y = 0; y < W_.H; y++) for (let x = 0; x < W_.W; x++) px(g, x, y, 1, 1, miniColor(x, y));
    W_.mini = c;
    return c;
  }

  // ---------- day / night ----------
  const DAY_MINUTES = 24; // one in-game day lasts 24 real minutes
  function hourNow(override) {
    if (override != null) return override;
    const m = (Date.now() / 60000) % DAY_MINUTES;
    return (m / DAY_MINUTES) * 24;
  }
  function darknessAt(h) {
    // 0 = full day; 1 = deepest night
    if (h >= 7 && h < 17.5) return 0;
    if (h >= 17.5 && h < 20) return (h - 17.5) / 2.5;
    if (h >= 20 || h < 4.5) return 1;
    return 1 - (h - 4.5) / 2.5;
  }
  function duskAt(h) {
    if (h >= 16.5 && h < 20) return Math.sin(((h - 16.5) / 3.5) * Math.PI);
    if (h >= 4.5 && h < 7.5) return Math.sin(((h - 4.5) / 3) * Math.PI) * 0.7;
    return 0;
  }

  window.NHLGfx = {
    BT, CH, hash, rng, shade, mix, mk,
    analyze, chunk, hasChunk, T, groundClass, zoneIdAt, buildingAt,
    get buildings() { return W_.buildings; },
    get world() { return W_; },
    treeSprite, stumpSprite, rockSprite, bushSprite, lanternPostSprite, furnaceSprite, anvilSprite, rangeSprite, roofSprite,
    SIGN, ORE_COL, METAL, tokenFor, iconURL, miniBase, miniColor,
    hourNow, darknessAt, duskAt, isWater, TREES, ORES,
  };
})();
