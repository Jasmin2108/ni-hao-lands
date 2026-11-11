/* Ni Hao Lands client — unofficial fan MMO. No token purchases. */
(() => {
  const TILE = 40;
  const $ = (id) => document.getElementById(id);

  const state = {
    ws: null,
    me: null,
    world: null,
    items: {},
    skills: [],
    avatars: [],
    shop: [],
    premiumShop: [],
    players: [],
    nodes: [],
    mobs: [],
    npcs: [],
    images: {},
    camX: 0,
    camY: 0,
    hover: null,
    clickFx: null,
    lastState: 0,
    tab: "skills",
    avatar: "classic-paw",
    mihaoMint: "4CxjZyMNoF1p6eXHXHv1TWpS2X47CuUmLwtGe18spump",
    companionMint: null,
    wallet: null,
    t0: performance.now(),
  };

  const canvas = $("view");
  const ctx = canvas.getContext("2d");
  const mini = $("minimap");
  const mctx = mini.getContext("2d");

  function wsUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host + "/ws";
  }

  function loadImage(file) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = "/assets/" + file;
    });
  }

  async function loadAvatars(list) {
    const files = new Set(list.map((a) => a.file));
    ["maneki-gold.jpg", "maneki-ceramic.jpg", "orange-peel.jpg", "crying.jpg", "depot-cover.jpg"].forEach((f) => files.add(f));
    await Promise.all([...files].map(async (f) => {
      state.images[f] = await loadImage(f);
    }));
  }

  function showLoginError(text) {
    const el = $("login-error");
    el.hidden = !text;
    el.textContent = text || "";
  }

  function renderAvatarGrid(avatars) {
    const grid = $("avatar-grid");
    grid.innerHTML = "";
    avatars.forEach((a, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.title = a.name;
      if (a.id === state.avatar) b.className = "on";
      const img = document.createElement("img");
      img.src = "/assets/" + a.file;
      img.alt = a.name;
      b.appendChild(img);
      b.addEventListener("click", () => {
        state.avatar = a.id;
        grid.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      });
      grid.appendChild(b);
      if (i === 0 && !state.avatar) state.avatar = a.id;
    });
  }

  async function bootLogin() {
    let cfg = { avatars: [] };
    try {
      cfg = await fetch("/api/config").then((r) => r.json());
    } catch {}
    const avatars = cfg.avatars && cfg.avatars.length ? cfg.avatars : [
      { id: "classic-paw", file: "classic-paw.jpg", name: "Paw Wave" },
    ];
    state.avatars = avatars;
    if (cfg.companionMint) {
      $("companion-ca").textContent = cfg.companionMint;
    }
    await loadAvatars(avatars);
    renderAvatarGrid(avatars);
    const saved = localStorage.getItem("nhl-token");
    const savedName = localStorage.getItem("nhl-name");
    if (savedName) $("name").value = savedName;
    if (saved && savedName) {
      // auto-show the previous name; user still clicks Enter
    }
  }

  function connect(hello) {
    if (state.ws) try { state.ws.close(); } catch {}
    const ws = new WebSocket(wsUrl());
    state.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify(hello));
    ws.onclose = () => {
      toast("Disconnected from the world.");
    };
    ws.onerror = () => showLoginError("Couldn't reach the server.");
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handle(msg);
    };
  }

  function send(msg) {
    if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(msg));
  }

  function handle(msg) {
    switch (msg.type) {
      case "welcome":
        state.me = msg.me;
        state.world = msg.world;
        state.items = msg.items || {};
        state.skills = msg.skills || [];
        state.avatars = msg.avatars || state.avatars;
        state.shop = msg.shop || [];
        state.premiumShop = msg.premiumShop || [];
        state.npcs = (msg.world && msg.world.npcs) || [];
        state.players = msg.players || [];
        state.nodes = msg.nodes || [];
        state.mobs = msg.mobs || [];
        state.mihaoMint = msg.mihaoMint || state.mihaoMint;
        state.companionMint = msg.companionMint || null;
        if (msg.me.token) localStorage.setItem("nhl-token", msg.me.token);
        if (msg.me.name) localStorage.setItem("nhl-name", msg.me.name);
        $("login").hidden = true;
        $("game").hidden = false;
        if (state.companionMint) $("companion-ca").textContent = state.companionMint;
        (msg.chatLog || []).forEach((c) => addChat(c, false));
        refreshHud();
        refreshTabs();
        resize();
        break;
      case "state":
        state.players = msg.players || [];
        state.nodes = msg.nodes || [];
        state.mobs = msg.mobs || [];
        const mine = state.players.find((p) => state.me && p.id === state.me.id);
        if (mine && state.me) {
          state.me.x = mine.x;
          state.me.y = mine.y;
          state.me.hp = mine.hp;
          state.me.action = mine.action;
          state.me.holder = mine.holder;
          $("zone-name").textContent = mine.zone || "";
        }
        refreshHud();
        break;
      case "me":
        state.me = Object.assign(state.me || {}, msg.me);
        refreshHud();
        refreshTabs();
        break;
      case "chat":
        addChat(msg, true);
        break;
      case "toast":
        toast(msg.text);
        break;
      case "examine":
        showExamine(msg.text);
        break;
      case "open":
        openTab(msg.panel);
        break;
      case "error":
        if (!$("login").hidden) showLoginError(msg.text);
        else toast(msg.text);
        break;
    }
  }

  function refreshHud() {
    const me = state.me;
    if (!me) return;
    $("player-name").textContent = me.name || "";
    $("gold").textContent = (me.gold | 0) + " gold";
    $("hp").textContent = me.hp | 0;
    $("holder-badge").hidden = !me.holder;
    const al = $("action-label");
    if (me.action) {
      al.hidden = false;
      al.textContent = me.action === "gather" ? "Working…" : me.action === "cook" ? "Cooking…" : me.action === "combat" ? "Fighting…" : "Busy…";
    } else al.hidden = true;
  }

  function openTab(id) {
    state.tab = id;
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.id === "tab-" + id));
    refreshTabs();
  }

  function itemName(id) {
    return (state.items[id] && state.items[id].name) || id;
  }

  function refreshTabs() {
    const me = state.me;
    if (!me) return;
    const sk = $("tab-skills");
    sk.innerHTML = "";
    for (const def of state.skills) {
      const info = (me.skills && me.skills[def.id]) || { level: 1, into: 0, need: 40, xp: 0 };
      const d = document.createElement("div");
      d.className = "skill";
      const pct = Math.max(0, Math.min(100, (info.into / (info.need || 1)) * 100));
      d.innerHTML = `<div class="row"><span>${def.icon || ""} ${esc(def.name)}</span><span>lvl ${info.level}</span></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="fine">${info.into}/${info.need} xp to next · ${info.xp | 0} total</div>`;
      sk.appendChild(d);
    }

    const inv = $("tab-inv");
    inv.innerHTML = `<p class="fine">Click a cosmetic to wear it, cooked fish to eat, or other items to sell (when at the shop).</p>`;
    const grid = document.createElement("div");
    grid.className = "slots";
    (me.inventory || []).forEach((it) => {
      const b = document.createElement("div");
      b.className = "slot";
      const def = state.items[it.id] || {};
      b.innerHTML = `${esc(def.name || it.id)}<span class="qty">${it.qty > 1 ? it.qty : ""}</span>`;
      b.title = def.desc || it.id;
      b.addEventListener("click", () => {
        if (def.cosmetic) send({ type: "equip", itemId: it.id });
        else if (def.heal) send({ type: "eat", itemId: it.id });
        else if (def.sell) {
          if (confirm(`Sell 1× ${def.name} for ${def.sell} gold? (You must be at Merchant Mao.)`)) {
            send({ type: "shopSell", itemId: it.id, qty: 1 });
          }
        }
      });
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        send({ type: "bank", op: "deposit", itemId: it.id, qty: it.qty || 1 });
      });
      grid.appendChild(b);
    });
    for (let i = (me.inventory || []).length; i < 28; i++) {
      const b = document.createElement("div");
      b.className = "slot";
      b.innerHTML = "&nbsp;";
      grid.appendChild(b);
    }
    inv.appendChild(grid);
    const worn = Object.values(me.equipped || {});
    if (worn.length) {
      const p = document.createElement("p");
      p.className = "fine";
      p.textContent = "Wearing: " + worn.map(itemName).join(", ");
      inv.appendChild(p);
    }

    const shop = $("tab-shop");
    shop.innerHTML = `<p class="fine">Walk to Merchant Mao in the east building. Prices are in-game gold earned by grinding. Sell resources from your inventory.</p>`;
    for (const offer of state.shop) {
      const def = state.items[offer.itemId] || { name: offer.itemId };
      const row = document.createElement("div");
      row.className = "shop-row";
      row.innerHTML = `<div><strong>${esc(def.name)}</strong><div class="fine">${esc(def.desc || "")}</div></div>`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = offer.price + "g";
      btn.addEventListener("click", () => send({ type: "shopBuy", itemId: offer.itemId }));
      row.appendChild(btn);
      shop.appendChild(row);
    }

    const bank = $("tab-bank");
    bank.innerHTML = `<p class="fine">Walk to Banker Bao (west building). Right-click inventory to deposit. Click a bank pile to withdraw.</p>`;
    const piles = me.bank || {};
    const keys = Object.keys(piles);
    if (!keys.length) {
      const p = document.createElement("p");
      p.textContent = "Your bank is empty.";
      bank.appendChild(p);
    }
    keys.forEach((id) => {
      const row = document.createElement("div");
      row.className = "shop-row";
      row.innerHTML = `<div>${esc(itemName(id))}</div><div class="qty">${piles[id]}</div>`;
      row.style.cursor = "pointer";
      row.addEventListener("click", () => send({ type: "bank", op: "withdraw", itemId: id, qty: 1 }));
      bank.appendChild(row);
    });

    const list = $("premium-list");
    list.innerHTML = "";
    for (const it of state.premiumShop) {
      const row = document.createElement("div");
      row.className = "shop-row";
      const ticker = state.companionMint ? "companion token" : "companion token (TBA)";
      row.innerHTML = `<div><strong>${esc(it.name)}</strong><div class="fine">${esc(it.desc)}</div></div>`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "disabled";
      btn.disabled = true;
      btn.textContent = it.priceToken + " " + ticker + " — disabled";
      btn.addEventListener("click", () => send({ type: "premiumBuy", itemId: it.id }));
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function addChat(entry, stick) {
    const log = $("chat-log");
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const line = document.createElement("div");
    const time = new Date(entry.ts || Date.now());
    const hh = String(time.getHours()).padStart(2, "0");
    const mm = String(time.getMinutes()).padStart(2, "0");
    if (entry.system) {
      line.className = "sys";
      line.textContent = `[${hh}:${mm}] ${entry.text}`;
    } else {
      const name = document.createElement("strong");
      name.className = entry.holder ? "holder-name" : (state.me && entry.from === state.me.name ? "me" : "");
      name.textContent = entry.from;
      line.append(`[${hh}:${mm}] `);
      line.appendChild(name);
      line.append(": " + entry.text);
    }
    log.appendChild(line);
    if (atBottom || stick) log.scrollTop = log.scrollHeight;
  }

  function toast(text) {
    const box = $("toasts");
    const d = document.createElement("div");
    d.textContent = text;
    box.appendChild(d);
    setTimeout(() => d.remove(), 2800);
  }

  function showExamine(text) {
    const el = $("examine");
    el.hidden = !text;
    el.textContent = text || "";
    if (text) setTimeout(() => { if (el.textContent === text) el.hidden = true; }, 5000);
  }

  function resize() {
    const stage = document.querySelector(".stage");
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(320, r.width) * dpr;
    canvas.height = Math.max(240, r.height) * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);

  function tileAt(sx, sy) {
    if (!state.world) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (sx - rect.left) + state.camX;
    const y = (sy - rect.top) + state.camY;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= state.world.W || ty >= state.world.H) return null;
    return { tx, ty, x, y };
  }

  function entityAt(tx, ty) {
    const near = (e) => Math.round(e.x) === tx && Math.round(e.y) === ty;
    const npc = state.npcs.find((n) => n.x === tx && n.y === ty);
    if (npc) return { kind: "npc", e: npc };
    const node = state.nodes.find((n) => n.x === tx && n.y === ty);
    if (node) return { kind: "node", e: node };
    const mob = state.mobs.find((m) => m.alive && near(m));
    if (mob) return { kind: "mob", e: mob };
    const pl = state.players.find((p) => state.me && p.id !== state.me.id && near(p));
    if (pl) return { kind: "player", e: pl };
    return null;
  }

  canvas.addEventListener("mousemove", (e) => {
    const t = tileAt(e.clientX, e.clientY);
    state.hover = t;
    if (!t) { showExamine(""); return; }
    const ent = entityAt(t.tx, t.ty);
    if (ent) {
      if (ent.kind === "npc") showExamine(ent.e.name + " — " + (ent.e.examine || "Click to talk."));
      else if (ent.kind === "node") showExamine(nodeLabel(ent.e) + (ent.e.depleted ? " (depleted)" : " — click to use"));
      else if (ent.kind === "mob") showExamine(ent.e.name + ` (${ent.e.hp}/${ent.e.maxHp}) — click to fight`);
      else if (ent.kind === "player") showExamine(ent.e.name);
    }
  });

  canvas.addEventListener("click", (e) => {
    const t = tileAt(e.clientX, e.clientY);
    if (!t) return;
    state.clickFx = { x: t.tx, y: t.ty, t: performance.now() };
    const ent = entityAt(t.tx, t.ty);
    if (ent && ent.kind !== "player") {
      send({ type: "interact", id: ent.e.id });
    } else {
      send({ type: "move", x: t.tx, y: t.ty });
    }
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  function nodeLabel(n) {
    if (n.type === "fish") return "Fishing spot";
    if (n.type === "yarn") return "Yarn bush";
    if (n.type === "ore") return "Ore rock";
    if (n.type === "range") return "Cooking range";
    return n.type;
  }

  function hash(x, y) {
    return Math.abs((x * 73856093) ^ (y * 19349663)) % 1000;
  }

  function drawRounded(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawWorld(now) {
    if (!state.world || !state.me) return;
    const W = state.world.W, H = state.world.H;
    const tiles = state.world.tiles;
    const viewW = canvas.clientWidth || 800;
    const viewH = canvas.clientHeight || 600;
    const px = state.me.x * TILE + TILE / 2;
    const py = state.me.y * TILE + TILE / 2;
    state.camX = Math.max(0, Math.min(W * TILE - viewW, px - viewW / 2));
    state.camY = Math.max(0, Math.min(H * TILE - viewH, py - viewH / 2));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(-state.camX, -state.camY);

    const x0 = Math.max(0, Math.floor(state.camX / TILE) - 1);
    const y0 = Math.max(0, Math.floor(state.camY / TILE) - 1);
    const x1 = Math.min(W - 1, Math.ceil((state.camX + viewW) / TILE) + 1);
    const y1 = Math.min(H - 1, Math.ceil((state.camY + viewH) / TILE) + 1);

    const t = now / 1000;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const kind = tiles[y][x];
        const sx = x * TILE, sy = y * TILE;
        drawTile(ctx, kind, sx, sy, hash(x, y), t, x, y);
      }
    }

    // resource markers
    for (const n of state.nodes) {
      const sx = n.x * TILE, sy = n.y * TILE;
      if (n.type === "yarn") drawBush(ctx, sx, sy, n.depleted);
      if (n.type === "fish") drawRipple(ctx, sx, sy, t, n.depleted);
      if (n.type === "ore") drawOreMark(ctx, sx, sy, n.depleted);
      if (n.type === "range") drawRange(ctx, sx, sy, t);
    }

    for (const npc of state.npcs) drawActor(ctx, npc.x, npc.y, npc.avatar, npc.name, { npc: true }, now);
    for (const mob of state.mobs) {
      if (!mob.alive) continue;
      drawDog(ctx, mob.x, mob.y, mob, now);
    }
    const others = state.players.filter((p) => !state.me || p.id !== state.me.id);
    for (const p of others) drawActor(ctx, p.x, p.y, p.avatar, p.name, { holder: p.holder, action: p.action }, now);
    if (state.me) drawActor(ctx, state.me.x, state.me.y, state.me.avatar, state.me.name, { self: true, holder: state.me.holder, action: state.me.action }, now);

    if (state.clickFx && now - state.clickFx.t < 500) {
      const a = 1 - (now - state.clickFx.t) / 500;
      ctx.strokeStyle = `rgba(255,230,120,${a})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(state.clickFx.x * TILE + 4, state.clickFx.y * TILE + 4, TILE - 8, TILE - 8);
    }
    if (state.hover) {
      ctx.strokeStyle = "rgba(255,255,255,.25)";
      ctx.strokeRect(state.hover.tx * TILE, state.hover.ty * TILE, TILE, TILE);
    }

    ctx.restore();
    drawMinimap();
  }

  function drawTile(c, kind, sx, sy, h, t, x, y) {
    const v = (h % 18) - 9;
    if (kind === "water") {
      const wave = Math.sin(t * 2 + x * 0.4 + y * 0.3) * 8;
      c.fillStyle = `rgb(${54 + wave}, ${110 + wave}, ${140 + wave / 2})`;
      c.fillRect(sx, sy, TILE, TILE);
      c.fillStyle = "rgba(200,230,255,.15)";
      c.fillRect(sx, sy + (h % TILE), TILE, 2);
      return;
    }
    if (kind === "stone") { c.fillStyle = `rgb(${70 + v},${68 + v},${72 + v})`; c.fillRect(sx, sy, TILE, TILE); stoneNoise(c, sx, sy, h); return; }
    if (kind === "wall") { c.fillStyle = "#4a3a32"; c.fillRect(sx, sy, TILE, TILE); c.fillStyle = "#2f2620"; c.fillRect(sx, sy, TILE, 4); c.fillRect(sx, sy, 3, TILE); return; }
    if (kind === "ore") { c.fillStyle = "#5a5550"; c.fillRect(sx, sy, TILE, TILE); c.fillStyle = "#c4843a"; c.beginPath(); c.arc(sx + 20, sy + 20, 10, 0, 6.3); c.fill(); return; }
    if (kind === "floor") { c.fillStyle = "#7a5a38"; c.fillRect(sx, sy, TILE, TILE); c.strokeStyle = "rgba(40,20,8,.3)"; c.strokeRect(sx, sy, TILE, TILE / 2); return; }
    if (kind === "rug") { c.fillStyle = "#7a5a38"; c.fillRect(sx, sy, TILE, TILE); c.fillStyle = "#a32018"; c.fillRect(sx + 4, sy + 4, TILE - 8, TILE - 8); c.strokeStyle = "#d4a017"; c.strokeRect(sx + 6, sy + 6, TILE - 12, TILE - 12); return; }
    if (kind === "path") { c.fillStyle = `rgb(${168 + v},${140 + v},${90 + v})`; c.fillRect(sx, sy, TILE, TILE); return; }
    if (kind === "dock" || kind === "sand") { c.fillStyle = `rgb(${194 + v},${170 + v},${110 + v})`; c.fillRect(sx, sy, TILE, TILE); return; }
    if (kind === "tree") {
      c.fillStyle = `rgb(${58 + v},${110 + v},${48 + v})`;
      c.fillRect(sx, sy, TILE, TILE);
      c.fillStyle = "#3d6a2e";
      c.beginPath(); c.arc(sx + 20, sy + 16, 16, 0, 6.3); c.fill();
      c.fillStyle = "#6a4428";
      c.fillRect(sx + 16, sy + 26, 8, 12);
      return;
    }
    if (kind === "flower") {
      c.fillStyle = `rgb(${70 + v},${120 + v},${52 + v})`;
      c.fillRect(sx, sy, TILE, TILE);
      c.fillStyle = (h % 2) ? "#d44a3a" : "#f2d66b";
      c.beginPath(); c.arc(sx + 12, sy + 14, 3, 0, 6.3); c.fill();
      c.beginPath(); c.arc(sx + 26, sy + 22, 3, 0, 6.3); c.fill();
      return;
    }
    // grass
    c.fillStyle = `rgb(${62 + v},${118 + v},${50 + v})`;
    c.fillRect(sx, sy, TILE, TILE);
    c.fillStyle = "rgba(255,255,255,.04)";
    c.fillRect(sx, sy, TILE, 1);
  }

  function stoneNoise(c, sx, sy, h) {
    c.fillStyle = "rgba(255,255,255,.06)";
    c.fillRect(sx + (h % 10), sy + (h % 13), 6, 3);
  }

  function drawBush(c, sx, sy, depleted) {
    c.fillStyle = depleted ? "#6a6a4a" : "#c45a8a";
    c.beginPath(); c.arc(sx + 20, sy + 22, depleted ? 7 : 11, 0, 6.3); c.fill();
    if (!depleted) {
      c.fillStyle = "#f2d6de";
      c.beginPath(); c.arc(sx + 16, sy + 18, 3, 0, 6.3); c.fill();
    }
  }
  function drawRipple(c, sx, sy, t, depleted) {
    if (depleted) return;
    c.strokeStyle = "rgba(255,240,180,.7)";
    c.beginPath();
    c.arc(sx + 20, sy + 20, 6 + (t * 3 % 6), 0, 6.3);
    c.stroke();
  }
  function drawOreMark(c, sx, sy, depleted) {
    c.fillStyle = depleted ? "#888" : "#f0c050";
    c.fillRect(sx + 16, sy + 8, 8, 6);
  }
  function drawRange(c, sx, sy, t) {
    c.fillStyle = "#333";
    c.fillRect(sx + 8, sy + 14, 24, 18);
    c.fillStyle = `rgb(240,${120 + Math.sin(t * 8) * 40},40)`;
    c.fillRect(sx + 14, sy + 8, 12, 10);
  }

  function avatarImg(id) {
    const a = state.avatars.find((x) => x.id === id);
    return state.images[a ? a.file : (id + ".jpg")] || state.images["classic-paw.jpg"];
  }

  function drawActor(c, x, y, avatar, name, flags, now) {
    const sx = x * TILE + TILE / 2;
    const bob = flags.action ? Math.sin(now / 80) * 1.5 : Math.sin(now / 250 + x) * 0.6;
    const sy = y * TILE + TILE / 2 + bob;
    const r = 16;
    c.save();
    c.beginPath();
    c.arc(sx, sy, r, 0, Math.PI * 2);
    c.closePath();
    c.clip();
    const img = avatarImg(avatar);
    if (img) c.drawImage(img, sx - r, sy - r, r * 2, r * 2);
    else {
      c.fillStyle = "#d48a3a";
      c.fill();
    }
    c.restore();
    c.lineWidth = flags.self ? 3 : 2;
    c.strokeStyle = flags.self ? "#fff3a0" : flags.npc ? "#f0c96a" : "#2a1c12";
    c.beginPath();
    c.arc(sx, sy, r, 0, Math.PI * 2);
    c.stroke();
    if (flags.holder) {
      c.strokeStyle = "#d4a017";
      c.beginPath(); c.arc(sx, sy, r + 3, 0, Math.PI * 2); c.stroke();
    }
    c.font = "bold 11px sans-serif";
    c.textAlign = "center";
    c.lineWidth = 3;
    c.strokeStyle = "rgba(0,0,0,.7)";
    c.fillStyle = flags.holder ? "#ffe9a0" : flags.npc ? "#f3cf6a" : "#fff";
    c.strokeText(name, sx, sy - r - 4);
    c.fillText(name, sx, sy - r - 4);
  }

  function drawDog(c, x, y, mob, now) {
    const sx = x * TILE + TILE / 2;
    const sy = y * TILE + TILE / 2;
    c.save();
    c.translate(sx, sy);
    c.fillStyle = "#c8b090";
    c.beginPath(); c.ellipse(0, 4, 13, 9, 0, 0, 6.3); c.fill();
    c.fillStyle = "#b89a78";
    c.beginPath(); c.arc(-8, -4, 7, 0, 6.3); c.fill();
    c.fillStyle = "#3a2a1c";
    c.beginPath(); c.arc(-10, -9, 3, 0, 6.3); c.fill();
    c.beginPath(); c.arc(-5, -9, 3, 0, 6.3); c.fill();
    c.fillStyle = "#1a1a1a";
    c.fillRect(-12, -5, 2, 2);
    c.fillStyle = "#a03020";
    const w = 22 * (mob.hp / mob.maxHp);
    c.fillRect(-11, -18, w, 3);
    c.strokeStyle = "#111";
    c.strokeRect(-11, -18, 22, 3);
    c.restore();
    c.font = "10px sans-serif";
    c.textAlign = "center";
    c.fillStyle = "#fff";
    c.fillText("Rival Dog", sx, sy - 22);
  }

  function drawMinimap() {
    if (!state.world) return;
    const W = state.world.W, H = state.world.H;
    const mw = mini.width, mh = mini.height;
    const sx = mw / W, sy = mh / H;
    const tiles = state.world.tiles;
    mctx.fillStyle = "#111";
    mctx.fillRect(0, 0, mw, mh);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = tiles[y][x];
        mctx.fillStyle =
          k === "water" ? "#3a6e90" :
          k === "wall" || k === "ore" || k === "stone" ? "#555" :
          k === "tree" ? "#2e5a28" :
          k === "path" || k === "dock" || k === "sand" ? "#c2a46a" :
          k === "floor" || k === "rug" ? "#8a5a30" :
          "#4a8a40";
        mctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
      }
    }
    for (const p of state.players) {
      mctx.fillStyle = state.me && p.id === state.me.id ? "#fff36a" : "#fff";
      mctx.fillRect(p.x * sx - 1, p.y * sy - 1, 3, 3);
    }
  }

  let raf = 0;
  function loop(now) {
    drawWorld(now);
    raf = requestAnimationFrame(loop);
  }

  // UI events
  document.querySelectorAll(".tabs button").forEach((b) => {
    b.addEventListener("click", () => openTab(b.dataset.tab));
  });

  $("enter").addEventListener("click", () => {
    showLoginError("");
    const name = $("name").value.trim();
    const token = localStorage.getItem("nhl-token");
    const savedName = localStorage.getItem("nhl-name");
    const hello = { type: "hello", name, avatar: state.avatar };
    if (token && savedName && savedName === name) hello.token = token;
    connect(hello);
  });
  $("name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("enter").click();
  });

  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("chat-input").value;
    if (!text.trim()) return;
    send({ type: "chat", text });
    $("chat-input").value = "";
  });

  $("copy-ca").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.mihaoMint);
      toast("Copied $mihao contract.");
    } catch {
      toast(state.mihaoMint);
    }
  });

  $("connect-wallet").addEventListener("click", connectWallet);

  async function connectWallet() {
    const status = $("wallet-status");
    const provider = window.solana;
    if (!provider || !provider.isPhantom) {
      status.textContent = "Phantom is not installed in this browser. Wallet connect is a preview only — the game will never ask you to sign a purchase.";
      toast("Phantom not found. Purchases are disabled.");
      return;
    }
    try {
      const res = await provider.connect({ onlyIfTrusted: false });
      const address = res.publicKey.toString();
      state.wallet = address;
      status.textContent = "Connected (read-only): " + address.slice(0, 4) + "…" + address.slice(-4) + ". Checking $mihao balance…";
      const r = await fetch("/api/holder/" + address).then((x) => x.json());
      if (r.error) {
        status.textContent = "Connected " + address.slice(0, 4) + "…" + address.slice(-4) + " — balance check failed: " + r.error;
        send({ type: "wallet", address, holder: false });
        return;
      }
      status.textContent = `Connected ${address.slice(0, 4)}…${address.slice(-4)}. $mihao: ${r.mihao?.uiAmount ?? 0}` +
        (r.companion ? ` · companion: ${r.companion.uiAmount}` : " · companion token CA still TBA") +
        ". No transaction was created.";
      send({ type: "wallet", address, holder: !!r.holder });
    } catch (e) {
      status.textContent = "Connect cancelled or failed. No transaction was created.";
    }
  }

  // keyboard: arrow/WASD optional nudge via move to neighbor
  const keys = {};
  window.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    keys[e.key] = true;
    const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0], W: [0, -1], A: [-1, 0], S: [0, 1], D: [1, 0] };
    if (dir[e.key] && state.me) {
      e.preventDefault();
      send({ type: "move", x: Math.round(state.me.x) + dir[e.key][0], y: Math.round(state.me.y) + dir[e.key][1] });
    }
    if (e.key === "Escape") send({ type: "stop" });
  });

  bootLogin().then(() => {
    requestAnimationFrame(loop);
  });
})();
