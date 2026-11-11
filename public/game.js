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
    ranksBoard: "fishing",
    ranksPeriod: "all",
    ranksTimer: 0,
    avatar: "classic-paw",
    avatarTouched: false,
    pendingUpload: null,
    customPreview: null,
    loadingImages: {},
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

  function selectAvatarButton(btn) {
    const grid = $("avatar-grid");
    grid.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === btn));
  }

  function renderCustomSlot() {
    const grid = $("avatar-grid");
    let b = grid.querySelector("button.custom");
    const src = state.customPreview;
    if (!src) {
      if (b) b.remove();
      return;
    }
    if (!b) {
      b = document.createElement("button");
      b.type = "button";
      b.className = "custom";
      b.title = "Your picture";
      const img = document.createElement("img");
      img.alt = "Your picture";
      b.appendChild(img);
      b.addEventListener("click", () => {
        if (state.pendingUpload) {
          state.avatarTouched = false;
        } else if (state.avatar && String(state.avatar).startsWith("u:")) {
          state.avatarTouched = false;
        }
        selectAvatarButton(b);
      });
      grid.appendChild(b);
    }
    b.querySelector("img").src = src;
    if (state.pendingUpload || (state.avatar && String(state.avatar).startsWith("u:"))) {
      selectAvatarButton(b);
    }
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
        state.avatarTouched = true;
        state.pendingUpload = null;
        selectAvatarButton(b);
      });
      grid.appendChild(b);
      if (i === 0 && !state.avatar) state.avatar = a.id;
    });
    renderCustomSlot();
  }

  function dataUrlBytes(url) {
    const i = url.indexOf(",") + 1;
    return Math.floor(((url.length - i) * 3) / 4);
  }

  function encodeAvatarCanvas(canvas) {
    for (const q of [0.92, 0.8, 0.65, 0.5]) {
      const webp = canvas.toDataURL("image/webp", q);
      if (webp.startsWith("data:image/webp") && dataUrlBytes(webp) <= 60 * 1024) return webp;
    }
    const png = canvas.toDataURL("image/png");
    if (dataUrlBytes(png) <= 60 * 1024) return png;
    throw new Error("Picture is still too large after shrinking. Try a simpler image.");
  }

  function loadFileImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image.")); };
      img.src = url;
    });
  }

  async function cropToAvatar(file) {
    const img = await loadFileImage(file);
    const size = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
    if (!size) throw new Error("Couldn't read that image.");
    const sx = ((img.naturalWidth || img.width) - size) / 2;
    const sy = ((img.naturalHeight || img.height) - size) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const c = canvas.getContext("2d");
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    c.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);
    return encodeAvatarCanvas(canvas);
  }

  async function uploadAvatar(image, token) {
    const r = await fetch("/api/avatar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, image }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Couldn't upload picture.");
    return j.avatar;
  }

  async function maybeUploadPending() {
    if (!state.pendingUpload || !state.me || !state.me.token) return;
    const image = state.pendingUpload;
    state.pendingUpload = null;
    try {
      const avatar = await uploadAvatar(image, state.me.token);
      state.me.avatar = avatar;
      state.avatar = avatar;
      state.customPreview = image;
      renderCustomSlot();
      toast("Your picture is in the world.");
    } catch (e) {
      toast(e.message || "Couldn't upload picture.");
    }
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
    const saved = localStorage.getItem("nhl-token");
    const savedName = localStorage.getItem("nhl-name");
    if (savedName) $("name").value = savedName;
    if (saved) {
      try {
        const acc = await fetch("/api/account?token=" + encodeURIComponent(saved)).then((r) => r.ok ? r.json() : null);
        if (acc) {
          if (acc.name && !$("name").value) $("name").value = acc.name;
          if (acc.avatar) {
            state.avatar = acc.avatar;
            if (String(acc.avatar).startsWith("u:")) {
              state.customPreview = "/avatars/" + acc.avatar.slice(2);
            }
          }
        }
      } catch {}
    }
    renderAvatarGrid(avatars);
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
        if (msg.me.avatar) state.avatar = msg.me.avatar;
        $("login").hidden = true;
        $("game").hidden = false;
        if (state.companionMint) $("companion-ca").textContent = state.companionMint;
        (msg.chatLog || []).forEach((c) => addChat(c, false));
        refreshHud();
        refreshTabs();
        resize();
        maybeUploadPending();
        maybeHolderCheck();
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
    const wb = $("connect-wallet");
    if (wb) wb.textContent = me.wallet ? "Refresh holder check" : "Sign in / link Solana wallet";
    const al = $("action-label");
    if (me.action) {
      al.hidden = false;
      al.textContent = me.action === "gather" ? "Working…" : me.action === "cook" ? "Cooking…" : me.action === "combat" ? "Fighting…" : "Busy…";
    } else al.hidden = true;
  }

  const RANK_BOARDS = [
    { id: "fishing", name: "Fishing" },
    { id: "yarn", name: "Yarn-gathering" },
    { id: "mining", name: "Mining" },
    { id: "cooking", name: "Cooking" },
    { id: "combat", name: "Combat" },
    { id: "total", name: "Total level" },
    { id: "gold", name: "Gold" },
    { id: "fish", name: "Biggest fish" },
    { id: "kills", name: "Dogs defeated" },
  ];

  function avatarSrc(id) {
    if (id && String(id).startsWith("u:")) return "/avatars/" + encodeURIComponent(String(id).slice(2));
    const a = state.avatars.find((x) => x.id === id);
    return "/assets/" + (a ? a.file : "classic-paw.jpg");
  }

  function fillRanksSelector(boards) {
    const sel = $("ranks-board");
    if (!sel) return;
    const list = boards && boards.length ? boards : RANK_BOARDS;
    const current = state.ranksBoard || "fishing";
    const same = sel.dataset.filled === "1" && sel.options.length === list.length;
    if (!same) {
      sel.innerHTML = "";
      for (const b of list) {
        const opt = document.createElement("option");
        opt.value = b.id;
        opt.textContent = b.name;
        sel.appendChild(opt);
      }
      sel.dataset.filled = "1";
    }
    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
  }

  function rankRow(e, mine) {
    const row = document.createElement("div");
    row.className = "rank-row" + (mine ? " me" : "");
    const place = document.createElement("span");
    place.className = "rank-place";
    place.textContent = e.rank ? "#" + e.rank : "—";
    const img = document.createElement("img");
    img.src = avatarSrc(e.avatar);
    img.alt = "";
    const who = document.createElement("div");
    who.className = "rank-who";
    who.innerHTML = `<span class="name">${esc(e.name)}</span>` +
      (e.walletLabel ? `<span class="wallet">${esc(e.walletLabel)}</span>` : "");
    const val = document.createElement("span");
    val.className = "rank-val";
    val.textContent = e.display != null ? e.display : String(e.value);
    row.appendChild(place);
    row.appendChild(img);
    row.appendChild(who);
    row.appendChild(val);
    return row;
  }

  function renderRanks(data) {
    const list = $("ranks-list");
    const youBox = $("ranks-you");
    if (!list) return;
    if (data && data.boards) fillRanksSelector(data.boards);
    const reset = $("ranks-reset");
    if (reset) {
      reset.textContent = (data && data.reset) || "";
      reset.hidden = !(data && data.reset);
    }
    document.querySelectorAll(".ranks-periods button").forEach((b) => {
      b.classList.toggle("on", b.dataset.period === (state.ranksPeriod || "all"));
    });
    list.innerHTML = "";
    const meName = state.me && state.me.name;
    const entries = (data && data.entries) || [];
    if (!entries.length) {
      const p = document.createElement("p");
      p.className = "fine";
      p.textContent = "No ranks on this board yet.";
      list.appendChild(p);
    }
    for (const e of entries) {
      list.appendChild(rankRow(e, !!(meName && e.name === meName)));
    }
    if (youBox) {
      const you = data && data.you;
      const inTop = !!(you && entries.some((e) => e.name === you.name));
      if (you && you.rank && !inTop) {
        youBox.hidden = false;
        youBox.innerHTML = `<p class="fine">Your rank</p>`;
        youBox.appendChild(rankRow(you, true));
      } else if (you && you.unranked) {
        youBox.hidden = false;
        youBox.innerHTML = `<p class="fine">You're not on this board yet.</p>`;
      } else {
        youBox.hidden = true;
        youBox.innerHTML = "";
      }
    }
  }

  async function loadRanks() {
    if (state.tab !== "ranks") return;
    const board = state.ranksBoard || "fishing";
    const token = (state.me && state.me.token) || localStorage.getItem("nhl-token") || "";
    try {
      const period = state.ranksPeriod || "all";
      const r = await fetch("/api/leaderboard?board=" + encodeURIComponent(board) + "&period=" + encodeURIComponent(period) + "&limit=25" + (token ? "&token=" + encodeURIComponent(token) : ""));
      const data = await r.json();
      if (state.tab !== "ranks") return;
      renderRanks(data);
    } catch {
      if (state.tab !== "ranks") return;
      const list = $("ranks-list");
      if (list) list.innerHTML = `<p class="fine">Couldn't load ranks. Try again in a moment.</p>`;
    }
  }

  function stopRanksRefresh() {
    if (state.ranksTimer) {
      clearInterval(state.ranksTimer);
      state.ranksTimer = 0;
    }
  }

  function startRanksRefresh() {
    stopRanksRefresh();
    fillRanksSelector();
    loadRanks();
    state.ranksTimer = setInterval(loadRanks, 60000);
  }

  function openTab(id) {
    state.tab = id;
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.id === "tab-" + id));
    refreshTabs();
    if (id === "ranks") startRanksRefresh();
    else stopRanksRefresh();
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

  let examinePinnedUntil = 0;
  let examineText = "";

  function showExamine(text, opts) {
    const el = $("examine");
    const tx = $("examine-text") || el;
    const report = $("report-picture");
    examineText = text || "";
    el.hidden = !text;
    tx.textContent = text || "";
    const showReport = !!(opts && opts.reportName && opts.reportAvatar && String(opts.reportAvatar).startsWith("u:"));
    if (report) {
      report.hidden = !showReport;
      if (showReport) report.dataset.name = opts.reportName;
      else delete report.dataset.name;
    }
    if (opts && opts.pin) examinePinnedUntil = performance.now() + 6000;
    if (text) {
      const snap = text;
      setTimeout(() => { if (examineText === snap && performance.now() >= examinePinnedUntil) el.hidden = true; }, 5000);
    }
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
    if (performance.now() < examinePinnedUntil) return;
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
    if (ent && ent.kind === "player") {
      showExamine(ent.e.name, { pin: true, reportName: ent.e.name, reportAvatar: ent.e.avatar });
      return;
    }
    if (ent) {
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
    if (id && String(id).startsWith("u:")) {
      if (state.images[id]) return state.images[id];
      if (!state.loadingImages[id]) {
        state.loadingImages[id] = true;
        const img = new Image();
        img.onload = () => { state.images[id] = img; };
        img.onerror = () => { delete state.loadingImages[id]; };
        img.src = "/avatars/" + encodeURIComponent(String(id).slice(2));
      }
      return state.images["classic-paw.jpg"];
    }
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
  const ranksBoard = $("ranks-board");
  if (ranksBoard) {
    fillRanksSelector();
    ranksBoard.addEventListener("change", () => {
      state.ranksBoard = ranksBoard.value;
      loadRanks();
    });
  }
  document.querySelectorAll(".ranks-periods button").forEach((b) => {
    b.addEventListener("click", () => {
      state.ranksPeriod = b.dataset.period || "all";
      document.querySelectorAll(".ranks-periods button").forEach((x) => x.classList.toggle("on", x === b));
      // Board option labels may change (Total level vs Total XP).
      const sel = $("ranks-board");
      if (sel) delete sel.dataset.filled;
      fillRanksSelector();
      loadRanks();
    });
  });

  function bytesToBase64(bytes) {
    let bin = "";
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  function findWalletProvider() {
    const w = window;
    const cands = [w.solana, w.phantom && w.phantom.solana, w.solflare, w.backpack, w.glow, w.nightly && w.nightly.solana];
    return cands.find((p) => p && typeof p.signMessage === "function") || null;
  }

  function setWalletDeepLinks(show) {
    const box = $("wallet-deeplinks");
    if (!box) return;
    box.hidden = !show;
    if (!show) return;
    const page = location.href.split("#")[0];
    const origin = location.origin;
    const encPage = encodeURIComponent(page);
    const encRef = encodeURIComponent(origin);
    $("open-phantom").href = "https://phantom.app/ul/browse/" + encPage + "?ref=" + encRef;
    $("open-solflare").href = "https://solflare.com/ul/v1/browse/" + encPage + "?ref=" + encRef;
  }

  async function signInWithWallet(opts) {
    const provider = findWalletProvider();
    if (!provider) {
      setWalletDeepLinks(true);
      throw new Error("No Solana wallet found in this browser. Open the game in Phantom or Solflare.");
    }
    setWalletDeepLinks(false);
    if (typeof provider.connect === "function") {
      await provider.connect();
    }
    const pubkey = provider.publicKey && (provider.publicKey.toBase58 ? provider.publicKey.toBase58() : String(provider.publicKey));
    if (!pubkey) throw new Error("Wallet did not share an address.");
    const nr = await fetch("/api/auth/nonce").then((r) => r.json());
    if (!nr.nonce) throw new Error(nr.error || "Couldn't start sign-in.");
    const message = "Ni Hao Lands sign-in\nWallet: " + pubkey + "\nNonce: " + nr.nonce + "\nThis signature only logs you in. It is not a transaction and costs nothing.";
    const encoded = new TextEncoder().encode(message);
    const raw = await provider.signMessage(encoded, "utf8");
    const sigBytes = raw && raw.signature ? raw.signature : raw;
    if (!sigBytes) throw new Error("Wallet did not return a signature.");
    const body = {
      pubkey,
      nonce: nr.nonce,
      signature: bytesToBase64(sigBytes),
    };
    const token = (opts && opts.token) || (state.me && state.me.token) || localStorage.getItem("nhl-token");
    if (token) body.token = token;
    const name = ($("name") && $("name").value.trim()) || (state.me && state.me.name) || "";
    if (name) body.name = name;
    const r = await fetch("/api/auth/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Wallet sign-in failed.");
    if (j.token) localStorage.setItem("nhl-token", j.token);
    if (j.name) localStorage.setItem("nhl-name", j.name);
    return j;
  }

  async function maybeHolderCheck() {
    const wallet = state.me && state.me.wallet;
    if (!wallet) return;
    try {
      const r = await fetch("/api/holder/" + encodeURIComponent(wallet)).then((x) => x.json());
      if (r && !r.error) {
        send({ type: "wallet", address: wallet, holder: !!r.holder });
        const status = $("wallet-status");
        if (status) {
          status.textContent = "Signed in " + (state.me.walletLabel || wallet.slice(0, 4) + "…" + wallet.slice(-4)) +
            ". $mihao: " + (r.mihao && r.mihao.uiAmount != null ? r.mihao.uiAmount : 0) +
            ". No transaction was created.";
        }
      }
    } catch {}
  }

  $("enter").addEventListener("click", () => {
    showLoginError("");
    const name = $("name").value.trim();
    const token = localStorage.getItem("nhl-token");
    const savedName = localStorage.getItem("nhl-name");
    const hello = { type: "hello", name };
    if (token && savedName && savedName === name) hello.token = token;
    if (state.avatarTouched && state.avatar && !String(state.avatar).startsWith("u:")) {
      hello.avatar = state.avatar;
    } else if (!hello.token && state.avatar && !state.pendingUpload) {
      hello.avatar = state.avatar;
    }
    connect(hello);
  });

  $("upload-avatar-btn").addEventListener("click", () => $("upload-avatar-input").click());
  $("upload-avatar-input").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    showLoginError("");
    try {
      const dataUrl = await cropToAvatar(file);
      state.pendingUpload = dataUrl;
      state.customPreview = dataUrl;
      state.avatarTouched = false;
      renderCustomSlot();
    } catch (err) {
      showLoginError(err.message || "Couldn't use that image.");
    }
  });

  $("report-picture").addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const name = $("report-picture").dataset.name;
    const token = (state.me && state.me.token) || localStorage.getItem("nhl-token");
    if (!name || !token) return;
    try {
      const r = await fetch("/api/report-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name }),
      });
      const j = await r.json().catch(() => ({}));
      toast(j.text || j.error || "Thanks, we logged that report.");
    } catch {
      toast("Couldn't send the report.");
    }
    $("report-picture").hidden = true;
  });
  $("name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("enter").click();
  });

  $("wallet-signin").addEventListener("click", async () => {
    showLoginError("");
    $("wallet-signin").disabled = true;
    try {
      const j = await signInWithWallet({ token: localStorage.getItem("nhl-token") });
      if (j.name && $("name")) $("name").value = j.name;
      const hello = { type: "hello", name: j.name };
      hello.token = j.token;
      connect(hello);
    } catch (err) {
      showLoginError(err.message || "Wallet sign-in failed.");
    } finally {
      $("wallet-signin").disabled = false;
    }
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
    if (state.me && state.me.wallet) {
      status.textContent = "Checking $mihao balance for " + (state.me.walletLabel || state.me.wallet) + "…";
      await maybeHolderCheck();
      return;
    }
    try {
      const j = await signInWithWallet({ token: state.me && state.me.token });
      if (state.me) {
        state.me.wallet = j.wallet;
        state.me.walletLabel = j.walletLabel;
        if (j.token) {
          state.me.token = j.token;
          localStorage.setItem("nhl-token", j.token);
        }
      }
      toast(j.linked ? "This character is now linked to your wallet." : "Signed in with your wallet. No transaction was sent.");
      const btn = $("connect-wallet");
      if (btn) btn.textContent = "Refresh holder check";
      await maybeHolderCheck();
    } catch (err) {
      status.textContent = (err.message || "Wallet sign-in failed.") + " No transaction was created.";
      toast(err.message || "Wallet sign-in failed.");
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
