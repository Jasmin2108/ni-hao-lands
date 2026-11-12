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
    holderShop: [],
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
    zoom: 1,
    quests: [],
    smeltRecipes: [],
    smithRecipes: [],
    chatCollapsed: false,
    chatUnread: 0,
    namePrompted: false,
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
          if (acc.name) {
            $("name").value = acc.name;
            localStorage.setItem("nhl-name", acc.name);
          }
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
    setWalletDeepLinks(!findWalletProvider());
  }

  function connect(hello) {
    if (state.ws) try { state.ws.close(); } catch {}
    const ws = new WebSocket(wsUrl());
    state.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify(Object.assign({ proto: 2 }, hello)));
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
    if (msg.type === "interact" && typeof noteInteract === "function") noteInteract(msg.id);
    if (msg.type === "move" || msg.type === "interact" || msg.type === "walkThen" || msg.type === "attack" || msg.type === "stop") predCancel();
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
        state.holderShop = msg.holderShop || [];
        state.npcs = (msg.world && msg.world.npcs) || [];
        state.players = msg.players || [];
        state.nodes = msg.nodes || [];
        state.mobs = msg.mobs || [];
        netReset(msg);
        state.mihaoMint = msg.mihaoMint || state.mihaoMint;
        state.companionMint = msg.nihalaMint || msg.companionMint || null;
        state.nihalaDisclaimer = msg.nihalaDisclaimer || null;
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
        state.quests = msg.quests || [];
        state.smeltRecipes = msg.smeltRecipes || [];
        state.smithRecipes = msg.smithRecipes || [];
        welcomeProgress(msg);
        maybeNamePrompt();
        applyMobileChrome();
        applyTouchControls();
        showControlsHint();
        break;
      case "state": {
        state.players = msg.players || [];
        state.nodes = msg.nodes || [];
        state.mobs = msg.mobs || [];
        if (msg.t) netTime(msg.t);
        for (const p of state.players) netSample(p.id, msg.t, p.x, p.y);
        for (const m of state.mobs) netSample(m.id, msg.t, m.x, m.y);
        const mine = state.players.find((p) => state.me && p.id === state.me.id);
        if (mine) syncMine(mine);
        state.hudDirty = true;
        break;
      }
      case "delta":
        applyDelta(msg);
        break;
      case "ping":
        if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: "pong", t: msg.t }));
        break;
      case "chance":
        onChance(msg);
        break;
      case "chanceEnd":
        onChanceEnd(msg);
        break;
      case "me": {
        const prevMe = state.me ? { skills: JSON.parse(JSON.stringify(state.me.skills || {})), gold: state.me.gold, invQty: invTotal(state.me), questsDone: questsDone(state.me) } : null;
        state.me = Object.assign(state.me || {}, msg.me);
        noteMeUpdate(prevMe, state.me);
        rememberName(state.me && state.me.name);
        refreshHud();
        refreshTabs();
        guideSync();
        break;
      }
      case "fx":
        if (msg.kind === "hit") {
          const id = msg.onMe ? (state.me && state.me.id) : msg.target;
          fx.splats.push({ id, x: msg.x, y: msg.y, dmg: msg.dmg | 0, t0: performance.now(), ox: (Math.random() - 0.5) * 8, oy: (Math.random() - 0.5) * 4 });
          sfx(msg.onMe ? "hurt" : (msg.dmg > 0 ? "hit" : "miss"));
        } else onFx(msg);
        break;
      case "stepReject":
        if (msg.facing) { state.facing = msg.facing; state.facingUntil = performance.now() + 600; }
        predReject(msg);
        break;
      case "renamed":
        if (msg.me) state.me = Object.assign(state.me || {}, msg.me);
        else if (state.me && msg.name) state.me.name = msg.name;
        rememberName(msg.name || (state.me && state.me.name));
        closeRenameBox();
        hideNamePrompt();
        refreshHud();
        refreshTabs();
        break;
      case "chat":
        addChat(msg, true);
        if (!state.me || msg.name !== state.me.name) sfx("chat", { vol: 0.8 });
        break;
      case "toast":
        toast(msg.text);
        break;
      case "examine":
        showExamine(msg.text);
        if (performance.now() - (state.npcTalkAt || 0) < 6000) { sfx("meow"); PG.npcMetAt = performance.now(); }
        break;
      case "open":
        openTab(msg.panel);
        break;
      case "error":
        if (!$("login").hidden) showLoginError(msg.text);
        else toast(msg.text);
        break;
      case "levelup":
        sfx("levelup");
        showFanfare((msg.name || msg.skill) + " level " + msg.level + "!");
        break;
      case "zone":
        showZoneBanner(msg.zone && msg.zone.name);
        break;
    }
  }

  // HUD writes only touch the DOM when a value actually changed (called at most ~5x/s from the loop).
  const HUDC = {};
  function setText(id, v) { if (HUDC[id] === v) return; HUDC[id] = v; const el = $(id); if (el) el.textContent = v; }
  function setHidden(id, h) { const key = "h:" + id; if (HUDC[key] === h) return; HUDC[key] = h; const el = $(id); if (el) el.hidden = h; }
  function refreshHud() {
    const me = state.me;
    if (!me) return;
    setText("player-name", me.name || "");
    setText("profile-name", me.name || "");
    setText("gold", (me.gold | 0) + " gold");
    setText("hp", String(me.hp | 0));
    setHidden("holder-badge", !me.holder);
    setHidden("nihala-badge", !me.nihala);
    setText("connect-wallet", me.wallet ? "Refresh holder check" : "Sign in / link Solana wallet");
    const label = me.action ? ({ gather: "Working…", cook: "Cooking…", smelt: "Smelting…", smith: "Smithing…", combat: "Fighting…" }[me.action] || "Busy…") : "";
    setHidden("action-label", !me.action);
    const st = MGC.streak | 0;
    setHidden("streak", st < 2);
    if (st >= 2) setText("streak", "Combo ×" + st);
    if (me.action) setText("action-label", label);
  }

  const RANK_BOARDS = [
    { id: "fishing", name: "Fishing" },
    { id: "yarn", name: "Yarn-gathering" },
    { id: "woodcutting", name: "Woodcutting" },
    { id: "mining", name: "Mining" },
    { id: "smithing", name: "Smithing" },
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
    if (isMobileLayout() && document.body.classList.contains("panel-collapsed")) {
      document.body.classList.remove("panel-collapsed");
      const toggle = $("panel-toggle");
      if (toggle) toggle.textContent = "Hide panel";
      resize();
    }
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
      d.innerHTML = `<div class="row"><span class="skill-name"><img class="px-icon" src="${G.iconURL("skill", def.id)}" alt="">${esc(def.name)}</span><span class="lvl">lvl ${info.level}</span></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="fine">${info.into}/${info.need} xp to next · ${info.xp | 0} total</div>`;
      sk.appendChild(d);
    }

    const inv = $("tab-inv");
    inv.innerHTML = `<p class="fine">Tap a tool or piece of gear to equip it, food to eat, or other items to sell at Merchant Mao. Right-click / long-press inventory to bank.</p>`;
    const grid = document.createElement("div");
    grid.className = "slots";
    (me.inventory || []).forEach((it) => {
      const b = document.createElement("div");
      b.className = "slot";
      const def = state.items[it.id] || {};
      b.innerHTML = `<img class="px-icon" src="${G.iconURL("item", it.id)}" alt=""><span class="qty">${it.qty > 1 ? it.qty : ""}</span><span class="slot-name">${esc(def.name || it.id)}</span>`;
      if (me.equipped && Object.values(me.equipped).includes(it.id)) b.classList.add("worn");
      b.title = def.desc || it.id;
      b.addEventListener("click", () => {
        if (def.slot) send({ type: "equip", itemId: it.id });
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

    renderDaily(me);
    renderJournal();
    if (state.tab === "log") renderLog();
    const qlist = $("quests-list");
    if (qlist) {
      const defs = state.quests || [];
      const progress = (me.quests) || {};
      qlist.innerHTML = defs.length ? "" : `<p class="fine">No quests yet. Talk to Old Maneki or Chef Chou.</p>`;
      for (const q of defs) {
        const st = progress[q.id] || { step: 0, done: false };
        const div = document.createElement("div");
        div.className = "quest" + (st.done ? " done" : "");
        const stepIndex = st.done ? (q.steps || []).length : Math.max(0, (st.step || 0) - 1);
        const steps = (q.steps || []).map((line, i) => {
          const cls = st.done || i < stepIndex ? "done" : (i === stepIndex && st.step > 0 ? "current" : "");
          return `<li class="${cls}">${esc(line)}</li>`;
        }).join("");
        const status = st.done ? "Complete" : st.step > 0 ? "In progress" : "Not started — talk to the giver";
        div.innerHTML = `<h3>${esc(q.name)}</h3><p class="fine">${esc(status)}</p><ol>${steps}</ol>`;
        qlist.appendChild(div);
      }
    }

    const shop = $("tab-shop");
    shop.innerHTML = `<p class="fine">Walk to Merchant Mao in the east building. Prices are in-game gold earned by grinding. Sell resources from your inventory.</p>`;
    for (const offer of state.shop) {
      const def = state.items[offer.itemId] || { name: offer.itemId };
      const row = document.createElement("div");
      row.className = "shop-row";
      row.innerHTML = `<img class="px-icon" src="${G.iconURL("item", offer.itemId)}" alt=""><div class="shop-info"><strong>${esc(def.name)}</strong><div class="fine">${esc(def.desc || "")}</div></div>`;
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
      row.innerHTML = `<img class="px-icon" src="${G.iconURL("item", id)}" alt=""><div class="shop-info">${esc(itemName(id))}</div><div class="qty">${piles[id]}</div>`;
      row.style.cursor = "pointer";
      row.addEventListener("click", () => send({ type: "bank", op: "withdraw", itemId: id, qty: 1 }));
      bank.appendChild(row);
    });

    renderNihala();
  }

  // $nihala holder perks + holder shop. Read-only: no buy, swap or transfer controls exist anywhere.
  function renderNihala() {
    const me = state.me;
    if (!me) return;
    const st = me.nihalaStatus || { signedIn: !!me.wallet, holder: false, tools: [], shop: [] };
    const status = $("nihala-status");
    const tools = $("nihala-tools");
    const shop = $("nihala-shop");
    tools.innerHTML = "";
    if (shop) shop.innerHTML = "";
    if (!st.signedIn) {
      status.textContent = "Sign in with a Solana wallet (login message only) to check for $nihala holder perks and the holder shop.";
    } else if (st.checking && !st.checkedAt) {
      status.textContent = "Checking your $nihala balance (read-only)…";
    } else if (st.holder) {
      status.innerHTML = `<span class="nihala-badge">nihala holder</span> Perks active. Balance ${esc(fmtAmount(st.balance))} $nihala.`;
    } else {
      status.textContent = st.error ? st.error : "No $nihala found in your signed-in wallet, so holder perks are off. That's fine, the whole game is free to play.";
    }
    for (const t of st.tools || []) {
      const row = document.createElement("div");
      row.className = "shop-row";
      const def = state.items[t.id] || {};
      row.innerHTML = `<img class="px-icon" src="${G.iconURL("item", t.id)}" alt=""><div class="shop-info"><strong>${esc(t.name)}</strong><div class="fine">${esc(def.desc || "")}</div></div>`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "holder-claim";
      btn.textContent = t.owned ? "Owned" : st.holder ? "Claim (free)" : "Holders only";
      btn.disabled = !!t.owned || !st.holder;
      if (!st.holder && !t.owned) btn.title = "Holder perk";
      btn.addEventListener("click", () => send({ type: "holderClaim", itemId: t.id }));
      row.appendChild(btn);
      tools.appendChild(row);
    }
    if (!shop) return;
    const catalog = (st.shop && st.shop.length) ? st.shop : (state.holderShop || []).map((o) => ({
      itemId: o.itemId, name: (state.items[o.itemId] || {}).name || o.itemId, hold: o.hold, owned: false, unlocked: false,
    }));
    if (!st.signedIn) {
      const p = document.createElement("p");
      p.className = "fine";
      p.textContent = "Sign in with a Solana wallet to check $nihala. The shop is visible, but items stay locked until you sign in.";
      shop.appendChild(p);
    }
    for (const o of catalog) {
      const row = document.createElement("div");
      row.className = "shop-row" + (o.owned || o.unlocked ? "" : " locked");
      const def = state.items[o.itemId] || {};
      const need = "Hold " + fmtHold(o.hold) + " $nihala to unlock";
      row.innerHTML = `<img class="px-icon" src="${G.iconURL("item", o.itemId)}" alt=""><div class="shop-info"><strong>${esc(o.name)}</strong><div class="fine">${esc(def.desc || "")}</div><div class="hold-need">${esc(need)}</div></div>`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "holder-unlock";
      if (o.owned) { btn.textContent = "Unlocked"; btn.disabled = true; }
      else if (!st.signedIn) { btn.textContent = "Sign in to check $nihala"; btn.disabled = true; }
      else if (o.unlocked) { btn.textContent = "Unlock by holding"; btn.disabled = false; }
      else { btn.textContent = "Locked"; btn.disabled = true; btn.title = need; }
      btn.addEventListener("click", () => send({ type: "holderShopUnlock", itemId: o.itemId }));
      row.appendChild(btn);
      shop.appendChild(row);
    }
  }
  function fmtHold(n) {
    n = Math.floor(Number(n) || 0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function fmtAmount(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(Math.round(n * 100) / 100);
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
      name.className = entry.holder || entry.nihala ? "holder-name" : (state.me && entry.from === state.me.name ? "me" : "");
      name.textContent = entry.from;
      line.append(`[${hh}:${mm}] `);
      line.appendChild(name);
      if (entry.nihala) {
        const b = document.createElement("span");
        b.className = "nihala-badge chat-badge";
        b.textContent = "nihala holder";
        line.append(" ");
        line.appendChild(b);
      }
      line.append(": " + entry.text);
    }
    log.appendChild(line);
    if (atBottom || stick) log.scrollTop = log.scrollHeight;
    if (document.body.classList.contains("chat-collapsed") && stick) {
      state.chatUnread = (state.chatUnread || 0) + 1;
      updateChatUnread();
    }
  }

  function toast(text) {
    const box = $("toasts");
    const d = document.createElement("div");
    d.textContent = text;
    box.appendChild(d);
    setTimeout(() => d.remove(), 2800);
  }

  function tilePx() {
    return TILE * (state.zoom || 1);
  }

  function setZoom(z) {
    state.zoom = Math.max(0.6, Math.min(1.8, Math.round(z * 20) / 20));
  }

  function isMobileLayout() {
    return window.matchMedia && window.matchMedia("(max-width: 820px), (orientation: landscape) and (max-height: 540px)").matches;
  }

  function applyMobileChrome(forceDefaults) {
    const mobile = isMobileLayout();
    const crossed = applyMobileChrome.wasMobile !== mobile;
    applyMobileChrome.wasMobile = mobile;
    if (forceDefaults || crossed) {
      if (mobile) {
        document.body.classList.add("chat-collapsed", "panel-collapsed");
      } else {
        document.body.classList.remove("chat-collapsed", "panel-collapsed");
      }
    }
    document.body.classList.toggle("playing", !$("game").hidden);
    const toggle = $("panel-toggle");
    if (toggle) {
      toggle.hidden = !mobile;
      toggle.textContent = document.body.classList.contains("panel-collapsed") ? "Skills & items" : "Hide panel";
    }
    updateChatUnread();
    resize();
  }

  function updateChatUnread() {
    const badge = $("chat-unread");
    if (!badge) return;
    const n = state.chatUnread || 0;
    badge.hidden = n <= 0;
    badge.textContent = n > 9 ? "9+" : String(n);
  }

  function showZoneBanner(name) {
    const el = $("zone-banner");
    if (!el || !name) return;
    el.textContent = name;
    el.hidden = false;
    el.classList.add("show");
    clearTimeout(showZoneBanner.timer);
    showZoneBanner.timer = setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => { el.hidden = true; }, 300);
    }, 1800);
  }

  function showFanfare(text) {
    const el = $("levelup-fanfare");
    const tx = $("fanfare-text");
    if (!el) return;
    if (tx) tx.textContent = text;
    el.hidden = false;
    clearTimeout(showFanfare.timer);
    showFanfare.timer = setTimeout(() => { el.hidden = true; }, 2200);
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
    const dpr = maxDpr();
    canvas.width = Math.max(320, r.width) * dpr;
    canvas.height = Math.max(240, r.height) * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", () => { applyMobileChrome(); });

  function tileAt(sx, sy) {
    if (!state.world) return null;
    const rect = canvas.getBoundingClientRect();
    const T = tilePx();
    const x = (sx - rect.left) + state.camX;
    const y = (sy - rect.top) + state.camY;
    const tx = Math.floor(x / T);
    const ty = Math.floor(y / T);
    if (tx < 0 || ty < 0 || tx >= state.world.W || ty >= state.world.H) return null;
    return { tx, ty, x, y };
  }

  function entityAt(tx, ty) {
    const near = (e) => Math.round(e.x) === tx && Math.round(e.y) === ty;
    const npc = state.npcs.find((n) => n.x === tx && n.y === ty);
    if (npc) return { kind: "npc", e: npc };
    const node = state.nodes.find((n) => n.x === tx && n.y === ty) || state.nodes.find((n) => n.rockX === tx && n.rockY === ty);
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

  function actOnEntity(ent, t) {
    if (ent && ent.kind === "player") {
      showExamine(ent.e.name, { pin: true, reportName: ent.e.name, reportAvatar: ent.e.avatar });
      return;
    }
    if (ent) send({ type: "interact", id: ent.e.id });
    else if (t) send({ type: "move", x: t.tx, y: t.ty });
  }

  function hideContextMenu() {
    const menu = $("context-menu");
    if (menu) { menu.hidden = true; menu.innerHTML = ""; }
  }

  function showContextMenu(clientX, clientY, ent, t) {
    const menu = $("context-menu");
    if (!menu) return;
    const items = [];
    if (ent && ent.kind === "node") {
      items.push({ label: nodeActionName(ent.e), fn: () => send({ type: "interact", id: ent.e.id }) });
      if (ent.e.type === "furnace") {
        for (const r of state.smeltRecipes || []) {
          items.push({ label: r.label || r.product, fn: () => send({ type: "interact", id: ent.e.id, recipe: r.id || r.product }) });
        }
      }
      if (ent.e.type === "anvil") {
        for (const r of (state.smithRecipes || []).slice(0, 8)) {
          items.push({ label: r.label || r.product, fn: () => send({ type: "interact", id: ent.e.id, recipe: r.product }) });
        }
      }
      items.push({ label: "Examine", fn: () => showExamine(nodeLabel(ent.e) + (ent.e.depleted ? " (depleted)" : ""), { pin: true }) });
    } else if (ent && ent.kind === "npc") {
      items.push({ label: "Talk", fn: () => send({ type: "interact", id: ent.e.id }) });
      items.push({ label: "Examine", fn: () => showExamine(ent.e.name + " — " + (ent.e.examine || ""), { pin: true }) });
    } else if (ent && ent.kind === "mob") {
      items.push({ label: "Attack", fn: () => send({ type: "interact", id: ent.e.id }) });
      items.push({ label: "Examine", fn: () => showExamine(ent.e.name + " (lvl " + (ent.e.level || 1) + ", " + ent.e.hp + "/" + ent.e.maxHp + ")", { pin: true }) });
    } else if (ent && ent.kind === "player") {
      items.push({ label: "Examine", fn: () => showExamine(ent.e.name, { pin: true, reportName: ent.e.name, reportAvatar: ent.e.avatar }) });
    } else {
      items.push({ label: "Walk here", fn: () => send({ type: "move", x: t.tx, y: t.ty }) });
    }
    menu.innerHTML = "";
    for (const it of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = it.label;
      b.addEventListener("click", (ev) => { ev.stopPropagation(); hideContextMenu(); it.fn(); });
      menu.appendChild(b);
    }
    menu.hidden = false;
    const pad = 8;
    const x = Math.min(clientX, window.innerWidth - 180 - pad);
    const y = Math.min(clientY, window.innerHeight - items.length * 44 - pad);
    menu.style.left = Math.max(pad, x) + "px";
    menu.style.top = Math.max(pad, y) + "px";
  }

  function tapAt(clientX, clientY) {
    if (chanceArmed(performance.now(), true)) { sendHit(); return; }
    hideContextMenu();
    const t = tileAt(clientX, clientY);
    if (!t) return;
    state.clickFx = { x: t.tx, y: t.ty, t: performance.now() };
    state.facing = null;
    actOnEntity(entityAt(t.tx, t.ty), t);
  }

  canvas.addEventListener("click", (e) => {
    if (state.suppressClick) { state.suppressClick = false; return; }
    // A touch tap is handled in touchend; ignore any synthetic click that follows it.
    if (performance.now() - (state.lastTouchTap || 0) < 700) return;
    tapAt(e.clientX, e.clientY);
  });

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const t = tileAt(e.clientX, e.clientY);
    if (!t) return;
    showContextMenu(e.clientX, e.clientY, entityAt(t.tx, t.ty), t);
  });

  document.addEventListener("click", (e) => {
    const menu = $("context-menu");
    if (menu && !menu.hidden && !menu.contains(e.target)) hideContextMenu();
  });

  // Long-press = context menu; pinch = zoom. Prevent the following click.
  // touchstart calls preventDefault (so the page doesn't scroll/zoom), which also stops the
  // browser from sending a click. Taps are therefore detected here and walked/acted on in touchend.
  let pressTimer = 0, pressStart = null, pinchStart = null, tapCandidate = null;
  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      clearTimeout(pressTimer);
      pressStart = null;
      tapCandidate = null;
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      pinchStart = { dist: d, zoom: state.zoom || 1 };
      e.preventDefault();
      return;
    }
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      pressStart = { x: touch.clientX, y: touch.clientY };
      tapCandidate = { x: touch.clientX, y: touch.clientY, t: performance.now() };
      pressTimer = setTimeout(() => {
        tapCandidate = null;
        const t = tileAt(touch.clientX, touch.clientY);
        if (!t) return;
        state.suppressClick = true;
        showContextMenu(touch.clientX, touch.clientY, entityAt(t.tx, t.ty), t);
      }, 450);
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 2 && pinchStart) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      setZoom(pinchStart.zoom * (d / (pinchStart.dist || 1)));
      return;
    }
    if (pressStart && e.touches[0]) {
      const dx = e.touches[0].clientX - pressStart.x;
      const dy = e.touches[0].clientY - pressStart.y;
      if (Math.hypot(dx, dy) > 12) { clearTimeout(pressTimer); pressStart = null; tapCandidate = null; }
    }
  }, { passive: false });
  canvas.addEventListener("touchend", (e) => {
    clearTimeout(pressTimer);
    e.preventDefault();
    const tap = tapCandidate;
    tapCandidate = null;
    if (e.touches.length === 0) pinchStart = null;
    if (tap && e.touches.length === 0 && !state.suppressClick && performance.now() - tap.t < 600) {
      state.lastTouchTap = performance.now();
      tapAt(tap.x, tap.y);
    }
    if (state.suppressClick && e.touches.length === 0) setTimeout(() => { state.suppressClick = false; }, 400);
  }, { passive: false });
  canvas.addEventListener("touchcancel", () => { clearTimeout(pressTimer); tapCandidate = null; pinchStart = null; pressStart = null; });

  function nodeLabel(n) {
    if (n.label) return n.label + (n.level ? " (lvl " + n.level + ")" : "");
    if (n.type === "fish") return "Fishing spot";
    if (n.type === "yarn") return "Yarn bush";
    if (n.type === "ore") return "Ore rock";
    if (n.type === "tree") return "Tree";
    if (n.type === "range") return "Cooking range";
    if (n.type === "furnace") return "Furnace";
    if (n.type === "anvil") return "Anvil";
    return n.type;
  }

  function nodeActionName(n) {
    if (n.action) return n.action;
    if (n.type === "tree") return "Chop";
    if (n.type === "ore") return "Mine";
    if (n.type === "fish") return "Fish";
    if (n.type === "yarn") return "Gather";
    if (n.type === "range") return "Cook";
    if (n.type === "furnace") return "Smelt";
    if (n.type === "anvil") return "Smith";
    return "Use";
  }

  // ===================== Pixel-art renderer =====================
  const G = window.NHLGfx;
  const fx = {
    warm: { pending: false, cx0: 0, cx1: 0, cy0: 0, cy1: 0, W: 0, H: 0 },
    floats: [], splats: [], particles: [], rpos: new Map(), lastFrame: 0, analyzed: null,
    fps: 0, frames: 0, fpsT: 0, frameMs: 0, todOverride: null, lm: null, lg: null, fishWater: new Map(), nodeAnim: new Map(),
  };
  (() => {
    const q = new URLSearchParams(location.search);
    if (q.has("tod")) { const h = Number(q.get("tod")); if (isFinite(h)) fx.todOverride = ((h % 24) + 24) % 24; }
  })();

  const TUNICS = [
    ["#c8432f", "#9c2b20", "#e86a52"], ["#2f7a8a", "#1f5a66", "#4aa0b0"], ["#5a4aa8", "#3e3280", "#7a6ac8"],
    ["#d49a2a", "#a8741a", "#f0c050"], ["#3d8a4a", "#2a6634", "#5aae66"], ["#a84a7a", "#803258", "#c86a9a"],
  ];
  const ROLE_TUNIC = {
    bank: ["#2a3e6a", "#1c2a4a", "#3e5a90"], shop: ["#c08a2a", "#94661a", "#e0ac4a"], cook: ["#ecebe4", "#c8c6bc", "#ffffff"],
    smith: ["#7a4a2a", "#5a341c", "#9a6a44"], greet: ["#b8322a", "#8a2018", "#e05a4a"],
  };
  const MAIL = { bronze_mail: ["#c98a3e", "#8a5a24", "#f0b870"], iron_mail: ["#9aa2ae", "#5a626e", "#d6dde6"], jade_mail: ["#3fbf74", "#1f7a46", "#a4f0c0"] };

  function ensureAnalyzed() {
    if (fx.analyzed !== state.world) {
      G.analyze(state.world, state.npcs);
      fx.analyzed = state.world;
      fx.fishWater.clear();
    }
  }

  // ===================== Smooth networking =====================
  // Remote players and mobs: snapshot interpolation ~110 ms behind the server clock (no snapping between ticks).
  // Local player: client-side prediction of keyboard/joystick steps, reconciled against the server.
  const NET = { offset: null, delay: 110, buf: new Map(), walk: null, speed: 4.2, playerIdx: new Map(), mobIdx: new Map(), nodeIdx: new Map() };
  const NB = 10; // samples per entity (ring buffer, preallocated)
  function netTime(t) {
    const off = performance.now() - t;
    if (NET.offset == null || off < NET.offset) NET.offset = off; // lowest latency seen
    else NET.offset += (off - NET.offset) * 0.01; // slow drift upward
  }
  function netSample(id, t, x, y) {
    if (!t) t = NET.offset != null ? performance.now() - NET.offset : 0;
    let b = NET.buf.get(id);
    if (!b) {
      b = { n: 0, head: 0, t: new Float64Array(NB), x: new Float32Array(NB), y: new Float32Array(NB), r: { x, y, dist: 0, moving: -1e9, facing: "down", hface: "right", seen: 0 } };
      NET.buf.set(id, b);
    }
    if (b.n) {
      const li = (b.head + NB - 1) % NB;
      const lt = b.t[li], lx = b.x[li], ly = b.y[li];
      if (t <= lt) { b.x[li] = x; b.y[li] = y; return; }
      if (Math.abs(x - lx) + Math.abs(y - ly) > 6) { b.n = 0; b.r.x = x; b.r.y = y; } // teleport / respawn: snap
      else if (t - lt > 250 && (x !== lx || y !== ly)) pushRaw(b, t - 100, lx, ly); // was idle: start moving now, not slow-mo
    }
    pushRaw(b, t, x, y);
  }
  function pushRaw(b, t, x, y) {
    b.t[b.head] = t; b.x[b.head] = x; b.y[b.head] = y;
    b.head = (b.head + 1) % NB; if (b.n < NB) b.n++;
  }
  function netReset(msg) {
    NET.buf.clear();
    if (msg.world && msg.world.walk) NET.walk = new Set(msg.world.walk);
    if (msg.world && msg.world.speed) NET.speed = msg.world.speed;
    if (msg.t) { NET.offset = null; netTime(msg.t); }
    for (const p of state.players) netSample(p.id, msg.t, p.x, p.y);
    for (const m of state.mobs) netSample(m.id, msg.t, m.x, m.y);
    reindex();
    PRED.active = false; PRED.tx = null; PRED.qx = null;
    fx.cam = null;
  }
  function reindex() {
    NET.playerIdx.clear(); NET.mobIdx.clear(); NET.nodeIdx.clear();
    for (const p of state.players) NET.playerIdx.set(p.id, p);
    for (const m of state.mobs) NET.mobIdx.set(m.id, m);
    for (const n of state.nodes) NET.nodeIdx.set(n.id, n);
  }
  const FACES = ["down", "up", "left", "right"];
  function applyDelta(msg) {
    const t = msg.t;
    if (t) netTime(t);
    let pChanged = false, mChanged = false, nChanged = false;
    if (msg.p) for (const p of msg.p) {
      const old = NET.playerIdx.get(p.id);
      if (old) Object.assign(old, p); else { NET.playerIdx.set(p.id, p); pChanged = true; }
      netSample(p.id, t, p.x, p.y);
    }
    if (msg.q) for (const q of msg.q) {
      const p = NET.playerIdx.get(q[0]);
      if (!p) continue;
      p.x = q[1]; p.y = q[2]; p.facing = FACES[q[3]] || "down"; p.action = q[4] || null; p.hp = q[5];
      netSample(p.id, t, p.x, p.y);
    }
    if (msg.pr) for (const id of msg.pr) { if (NET.playerIdx.delete(id)) pChanged = true; NET.buf.delete(id); }
    if (msg.m) for (const m of msg.m) {
      const old = NET.mobIdx.get(m.id);
      if (old) Object.assign(old, m); else { NET.mobIdx.set(m.id, m); mChanged = true; }
      netSample(m.id, t, m.x, m.y);
    }
    if (msg.mq) for (const q of msg.mq) { const m = NET.mobIdx.get(q[0]); if (m) { m.x = q[1]; m.y = q[2]; netSample(m.id, t, m.x, m.y); } }
    if (msg.mr) for (const id of msg.mr) { if (NET.mobIdx.delete(id)) mChanged = true; NET.buf.delete(id); }
    if (msg.n) for (const n of msg.n) { const old = NET.nodeIdx.get(n.id); if (old) Object.assign(old, n); else { NET.nodeIdx.set(n.id, n); nChanged = true; } }
    if (msg.nr) for (const id of msg.nr) if (NET.nodeIdx.delete(id)) nChanged = true;
    // arrays are only rebuilt when membership changes
    if (pChanged) state.players = Array.from(NET.playerIdx.values());
    if (mChanged) state.mobs = Array.from(NET.mobIdx.values());
    if (nChanged) state.nodes = Array.from(NET.nodeIdx.values());
    const mine = state.me && NET.playerIdx.get(state.me.id);
    if (mine) syncMine(mine);
    if (msg.p || msg.q || msg.pr) state.hudDirty = true;
  }
  function syncMine(mine) {
    const me = state.me;
    me.x = mine.x; me.y = mine.y; me.hp = mine.hp; me.action = mine.action;
    me.holder = mine.holder; me.nihala = mine.nihala;
    if (mine.zone && mine.zone !== state.zoneShown) { state.zoneShown = mine.zone; $("zone-name").textContent = mine.zone; }
  }
  // Interpolated render position for a networked entity (players, mobs).
  function interpPos(id, fallbackX, fallbackY, now) {
    let b = NET.buf.get(id);
    if (!b) { netSample(id, 0, fallbackX, fallbackY); b = NET.buf.get(id); }
    const r = b.r;
    let x = fallbackX, y = fallbackY;
    if (b.n && NET.offset != null) {
      const rt = now - NET.offset - NET.delay;
      const last = (b.head + NB - 1) % NB;
      if (b.n === 1 || rt >= b.t[last]) { x = b.x[last]; y = b.y[last]; }
      else {
        const first = (b.head + NB - b.n) % NB;
        if (rt <= b.t[first]) { x = b.x[first]; y = b.y[first]; }
        else {
          for (let i = b.n - 1; i > 0; i--) {
            const i1 = (first + i) % NB, i0 = (first + i - 1) % NB;
            if (rt >= b.t[i0]) {
              const span = b.t[i1] - b.t[i0];
              const a = span > 0 ? (rt - b.t[i0]) / span : 1;
              x = b.x[i0] + (b.x[i1] - b.x[i0]) * a; y = b.y[i0] + (b.y[i1] - b.y[i0]) * a;
              break;
            }
          }
        }
      }
    }
    moveR(r, x, y, now);
    return r;
  }
  function moveR(r, x, y, now) {
    const dx = x - r.x, dy = y - r.y, d = Math.abs(dx) + Math.abs(dy);
    if (d > 0.0005) {
      r.dist += Math.hypot(dx, dy);
      r.moving = now;
      if (Math.abs(dx) > Math.abs(dy) + 0.0001) { r.facing = dx > 0 ? "right" : "left"; r.hface = r.facing; }
      else if (Math.abs(dy) > 0.0001) r.facing = dy > 0 ? "down" : "up";
    }
    r.x = x; r.y = y; r.seen = now;
  }

  // ---- local prediction ----
  const PRED = { active: false, x: 0, y: 0, tx: null, ty: null, qx: null, qy: null, idleSince: 0, ex: 0, ey: 0, r: { x: 0, y: 0, dist: 0, moving: -1e9, facing: "down", hface: "right", seen: 0 } };
  function walkableAt(x, y) {
    const w = state.world;
    if (!w || x < 0 || y < 0 || x >= w.W || y >= w.H) return false;
    const k = w.tiles[y][x];
    return NET.walk ? NET.walk.has(k) : k !== "water" && k !== "deepwater" && k !== "wall";
  }
  function canStep(fx0, fy0, dx, dy) {
    if (!walkableAt(fx0 + dx, fy0 + dy)) return false;
    if (PRED.bUntil && performance.now() < PRED.bUntil && fx0 + dx === PRED.bx && fy0 + dy === PRED.by) return false;
    if (dx && dy && (!walkableAt(fx0 + dx, fy0) || !walkableAt(fx0, fy0 + dy))) return false;
    return true;
  }
  function predReject(msg) {
    if (!PRED.active) return;
    // server said no: drop pending steps and glide back to the authoritative tile
    PRED.tx = msg.x != null ? msg.x : Math.round(state.me.x);
    PRED.ty = msg.y != null ? msg.y : Math.round(state.me.y);
    PRED.qx = null; PRED.qy = null;
    // don't keep predicting into the tile the server refused (gate / wall the client didn't know about)
    if (msg.reason !== "rate" && PRED.ldx != null) { PRED.bx = PRED.tx + PRED.ldx; PRED.by = PRED.ty + PRED.ldy; PRED.bUntil = performance.now() + 2500; }
  }
  // Called every frame. Returns the local player's render position.
  function selfPos(dt, now, dir) {
    const me = state.me;
    const dx = dir ? dir[0] : 0, dy = dir ? dir[1] : 0;
    const speed = NET.speed;
    if (!PRED.active && (dx || dy)) {
      const cur = interpPos(me.id || "me", me.x, me.y, now);
      PRED.active = true;
      PRED.x = cur.x; PRED.y = cur.y; PRED.tx = null; PRED.qx = null;
      Object.assign(PRED.r, { x: cur.x, y: cur.y, dist: cur.dist, facing: cur.facing, hface: cur.hface });
    }
    if (!PRED.active) {
      const r = interpPos(me.id || "me", me.x, me.y, now);
      if (PRED.ex || PRED.ey) { // decay any leftover prediction error so the hand-off is seamless
        const f = Math.exp(-dt * 12);
        PRED.ex *= f; PRED.ey *= f;
        if (Math.abs(PRED.ex) + Math.abs(PRED.ey) < 0.002) { PRED.ex = 0; PRED.ey = 0; }
        PRED.r.x = r.x + PRED.ex; PRED.r.y = r.y + PRED.ey;
        PRED.r.dist = r.dist; PRED.r.moving = r.moving; PRED.r.facing = r.facing; PRED.r.hface = r.hface;
        return PRED.r;
      }
      return r;
    }
    // choose targets
    if (PRED.tx == null && (dx || dy)) {
      const bx = Math.round(PRED.x), by = Math.round(PRED.y);
      if (canStep(bx, by, dx, dy)) { PRED.tx = bx + dx; PRED.ty = by + dy; sendStep(dx, dy, now); }
      else { PRED.tx = bx; PRED.ty = by; sendStep(dx, dy, now); } // let the server confirm the bump + facing
    } else if (PRED.tx != null && PRED.qx == null && (dx || dy)) {
      const rem = Math.hypot(PRED.tx - PRED.x, PRED.ty - PRED.y);
      if (rem < 0.5 && canStep(PRED.tx, PRED.ty, dx, dy)) { PRED.qx = PRED.tx + dx; PRED.qy = PRED.ty + dy; sendStep(dx, dy, now); }
    }
    // advance
    let budget = speed * dt;
    while (PRED.tx != null && budget > 0) {
      const ddx = PRED.tx - PRED.x, ddy = PRED.ty - PRED.y, d = Math.hypot(ddx, ddy);
      if (d <= budget) {
        PRED.x = PRED.tx; PRED.y = PRED.ty; budget -= d;
        if (PRED.qx != null) { PRED.tx = PRED.qx; PRED.ty = PRED.qy; PRED.qx = null; }
        else { PRED.tx = null; break; }
      } else { PRED.x += (ddx / d) * budget; PRED.y += (ddy / d) * budget; budget = 0; }
    }
    // reconcile: if the server disagrees by more than ~1.6 tiles (gate, lag spike), pull toward it
    const ex = me.x - PRED.x, ey = me.y - PRED.y;
    if (Math.abs(ex) + Math.abs(ey) > 2.2) { PRED.x += ex * Math.min(1, dt * 6); PRED.y += ey * Math.min(1, dt * 6); }
    moveR(PRED.r, PRED.x, PRED.y, now);
    if (dx || dy) PRED.idleSince = 0;
    // finish: no input, no target, and the interpolated server position has caught up (or timeout)
    if (!dx && !dy && PRED.tx == null) {
      if (!PRED.idleSince) PRED.idleSince = now;
      const srv = interpPos(me.id || "me", me.x, me.y, now);
      const gap = Math.abs(srv.x - PRED.x) + Math.abs(srv.y - PRED.y);
      if (gap < 0.02 || now - PRED.idleSince > 1200) {
        PRED.active = false; PRED.ex = PRED.x - srv.x; PRED.ey = PRED.y - srv.y;
      }
    }
    return PRED.r;
  }
  function predCancel() { // tap-to-walk / interactions: hand control back to the server path
    if (!PRED.active || !state.me) return;
    const srv = interpPos(state.me.id || "me", state.me.x, state.me.y, performance.now());
    PRED.active = false; PRED.tx = null; PRED.qx = null; PRED.ex = PRED.x - srv.x; PRED.ey = PRED.y - srv.y;
  }

  function smoothPos(id, x, y, dt, now) {
    let r = fx.rpos.get(id);
    if (!r) { r = { x, y, dist: 0, moving: -1e9, facing: "down", hface: "right" }; fx.rpos.set(id, r); }
    const dx = x - r.x, dy = y - r.y, d = Math.hypot(dx, dy);
    if (d > 4) { r.x = x; r.y = y; }
    else if (d > 0.002) {
      const stepLen = Math.min(d, Math.max(4.4 * dt, d * Math.min(1, dt * 7)));
      r.x += (dx / d) * stepLen; r.y += (dy / d) * stepLen; r.dist += stepLen;
      r.moving = now;
      if (Math.abs(dx) > Math.abs(dy) + 0.01) { r.facing = dx > 0 ? "right" : "left"; r.hface = r.facing; }
      else if (Math.abs(dy) > 0.01) r.facing = dy > 0 ? "down" : "up";
    }
    r.seen = now;
    return r;
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
  function avatarKey(id) {
    if (id && String(id).startsWith("u:") && !state.images[id]) return "classic-paw";
    return id || "classic-paw";
  }

  function nameHash(s) { let h = 7; for (const ch of String(s || "")) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); }

  function drawSpr(c, s, wx, wy, k, alpha) {
    if (alpha != null && alpha < 1) c.globalAlpha = alpha;
    c.drawImage(s.c, Math.round(wx - s.ax * k), Math.round(wy - s.ay * k), Math.round(s.c.width * k), Math.round(s.c.height * k));
    if (alpha != null && alpha < 1) c.globalAlpha = 1;
  }
  function shadow(c, x, y, rx, ry, a) {
    c.globalAlpha = a || 0.25;
    c.fillStyle = "#140c06";
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1;
  }
  // Pre-rendered radial glow sprites (drawn scaled with globalAlpha instead of a new gradient per light per frame).
  const GLOWS = {};
  function glowSprite(key, rgb, mid) {
    let cv = GLOWS[key];
    if (cv) return cv;
    cv = document.createElement("canvas"); cv.width = cv.height = 64;
    const g = cv.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${rgb},1)`);
    if (mid) gr.addColorStop(0.55, `rgba(${rgb},0.5)`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    GLOWS[key] = cv;
    return cv;
  }
  function drawGlow(c, key, rgb, mid, x, y, r, alpha) {
    if (alpha <= 0.003 || r <= 0) return;
    c.globalAlpha = Math.min(1, alpha);
    c.drawImage(glowSprite(key, rgb, mid), x - r, y - r, r * 2, r * 2);
    c.globalAlpha = 1;
  }

  const ROCKMAP = new Map();
  let rockMapFor = null;
  function nodeAtRock() {
    if (rockMapFor === state.nodes) return ROCKMAP; // node objects are mutated in place by deltas
    rockMapFor = state.nodes;
    ROCKMAP.clear();
    for (const n of state.nodes) if (n.rockX != null && n.rockY != null) ROCKMAP.set(n.rockY * 4096 + n.rockX, n);
    return ROCKMAP;
  }

  // ---- pooled per-frame structures (no garbage in the hot path) ----
  const K_TREE = 1, K_ORE = 2, K_LANTERN = 3, K_ROOF = 4, K_TORII = 5, K_YARN = 6, K_FURNACE = 7, K_ANVIL = 8, K_RANGE = 9, K_NPC = 10, K_MOB = 11, K_PLAYER = 12, K_BOARD = 13;
  const DL = { items: [], n: 0 };
  const LP = { items: [], n: 0 };
  const TG = { items: [], n: 0 };
  const F = { T: 0, k: 0, now: 0, t: 0 };
  const CO = new Map(); // cached character option objects per player id
  const VIEW = { x0: 0, y0: 0, x1: 0, y1: 0, water: { n: 0, xs: new Int16Array(4096), ys: new Int16Array(4096) }, cherry: { n: 0, xs: new Int16Array(2048), ys: new Int16Array(2048) }, leafy: { n: 0, xs: new Int16Array(2048), ys: new Int16Array(2048) }, fires: [] };
  function viewAdd(list, x, y) { if (list.n < list.xs.length) { list.xs[list.n] = x; list.ys[list.n] = y; list.n++; } }
  function charOpts(id) { let o = CO.get(id); if (!o) { o = {}; CO.set(id, o); } return o; }
  function dlAdd(y, kind, a, b, c, d) {
    let it = DL.items[DL.n];
    if (!it) { it = { y: 0, kind: 0, a: null, b: 0, c: 0, d: null }; DL.items[DL.n] = it; }
    DL.n++;
    it.y = y; it.kind = kind; it.a = a; it.b = b; it.c = c; it.d = d;
  }
  function lightAdd(x, y, r, a, warm) {
    let it = LP.items[LP.n];
    if (!it) { it = { x: 0, y: 0, r: 0, a: 0, warm: 0 }; LP.items[LP.n] = it; }
    LP.n++;
    it.x = x; it.y = y; it.r = r; it.a = a || undefined; it.warm = warm || 0;
  }
  function tagAdd(sx, sy, name, flags, self, npc) {
    let it = TG.items[TG.n];
    if (!it) { it = { sx: 0, sy: 0, name: "", flags: null, self: false, npc: false }; TG.items[TG.n] = it; }
    TG.n++;
    it.sx = sx; it.sy = sy; it.name = name; it.flags = flags; it.self = self; it.npc = npc;
  }
  function dlSort() { // insertion sort: the list is nearly sorted (built row by row), and it doesn't allocate
    const a = DL.items;
    for (let i = 1; i < DL.n; i++) {
      const v = a[i]; let j = i - 1;
      while (j >= 0 && a[j].y > v.y) { a[j + 1] = a[j]; j--; }
      a[j + 1] = v;
    }
  }
  function dlDraw(it) {
    const T = F.T, k = F.k, now = F.now, t = F.t, c = ctx;
    switch (it.kind) {
      case K_TREE: {
        const kd = it.a, x = it.b, y = it.c, node = it.d;
        const variant = G.hash(x, y, 2) % 3, jit = ((G.hash(x, y, 4) % 5) - 2) * k;
        const an = node ? nodeFlip(node, now) : null;
        if (node && node.depleted) {
          drawSpr(c, G.stumpSprite(kd), (x + 0.5) * T, (y + 0.95) * T, k);
          const age = an ? (now - an.t) / 750 : 2;
          if (age < 1) { // tree falls over
            const side = node.x < x ? 1 : -1;
            const ang = side * (Math.PI / 2) * age * age;
            c.save();
            c.translate((x + 0.5) * T + jit, (y + 1) * T - k);
            c.rotate(ang);
            drawSpr(c, G.treeSprite(kd, variant), 0, 0, k, age > 0.7 ? (1 - age) / 0.3 : 1);
            c.restore();
          }
          return;
        }
        shadow(c, (x + 0.5) * T + jit, (y + 0.9) * T, (kd === "bamboo" ? 0.4 : 0.6) * T, 0.18 * T, 0.22);
        const grow = an ? (now - an.t) / 900 : 2;
        if (grow < 1) { // regrows from a sapling
          const sc = 0.3 + 0.7 * (1 - Math.pow(1 - grow, 3));
          c.save();
          c.translate((x + 0.5) * T + jit, (y + 1) * T - k);
          c.scale(sc, sc);
          drawSpr(c, G.treeSprite(kd, variant), 0, 0, k);
          c.restore();
        } else drawSpr(c, G.treeSprite(kd, variant), (x + 0.5) * T + jit, (y + 1) * T - k, k);
        return;
      }
      case K_ORE: {
        const kd = it.a, x = it.b, y = it.c, node = it.d;
        if (node) nodeFlip(node, now);
        shadow(c, (x + 0.5) * T, (y + 0.88) * T, 0.5 * T, 0.16 * T, 0.25);
        drawSpr(c, G.rockSprite(kd, node && node.depleted, G.hash(x, y, 3) % 3), (x + 0.5) * T, (y + 1) * T - 1 * k, k);
        if (node && !node.depleted && Math.sin(t * 2 + x * 3 + y) > 0.97) {
          const oc = G.ORE_COL[kd] || G.ORE_COL.ore;
          c.fillStyle = oc[1]; c.fillRect(Math.round((x + 0.5) * T), Math.round((y + 0.45) * T), Math.ceil(k), Math.ceil(k));
        }
        return;
      }
      case K_LANTERN: {
        const x = it.b, y = it.c;
        shadow(c, (x + 0.5) * T, (y + 0.9) * T, 0.25 * T, 0.1 * T, 0.25);
        drawSpr(c, G.lanternPostSprite(), (x + 0.5) * T, (y + 1) * T - k, k);
        drawLanternGlow(c, (x + 0.3) * T, (y + 0.2) * T, 0.7 * T, now);
        return;
      }
      case K_ROOF: drawRoof(c, it.a, T, now); return;
      case K_TORII: drawTorii(c, it.b, it.c, T, now); return;
      case K_BOARD: { drawBoard(c, it.a, T, k, t); return; }
      case K_YARN: {
        const n = it.a;
        nodeFlip(n, now);
        shadow(c, (n.x + 0.5) * T, (n.y + 0.82) * T, 0.42 * T, 0.12 * T, 0.22);
        drawSpr(c, G.bushSprite(n.depleted, G.hash(n.x, n.y, 6) % 3), (n.x + 0.5) * T, (n.y + 0.9) * T, k);
        return;
      }
      case K_FURNACE: {
        const n = it.a;
        shadow(c, (n.x + 0.5) * T, (n.y + 0.92) * T, 0.6 * T, 0.16 * T, 0.28);
        drawSpr(c, G.furnaceSprite(), (n.x + 0.5) * T, (n.y + 1) * T, k);
        const fx0 = (n.x + 0.5) * T - 13 * k + 8 * k, fy0 = (n.y + 1) * T - 31 * k + 19 * k;
        for (let i = 0; i < 8; i++) {
          const hgt = (3 + Math.abs(Math.sin(t * 9 + i * 1.7)) * 5) * k;
          c.fillStyle = i % 3 === 0 ? "#ffe07a" : i % 3 === 1 ? "#ff9a3a" : "#e8483a";
          c.fillRect(Math.round(fx0 + (1 + i) * k), Math.round(fy0 + 9 * k - hgt), Math.ceil(k), Math.round(hgt));
        }
        drawLanternGlow(c, (n.x + 0.5) * T, (n.y + 0.65) * T, 0.9 * T, now);
        return;
      }
      case K_ANVIL: {
        const n = it.a;
        shadow(c, (n.x + 0.5) * T, (n.y + 0.9) * T, 0.45 * T, 0.12 * T, 0.25);
        drawSpr(c, G.anvilSprite(), (n.x + 0.5) * T, (n.y + 0.95) * T, k);
        return;
      }
      case K_RANGE: {
        const n = it.a;
        shadow(c, (n.x + 0.5) * T, (n.y + 0.92) * T, 0.55 * T, 0.14 * T, 0.25);
        drawSpr(c, G.rangeSprite(), (n.x + 0.5) * T, (n.y + 0.95) * T, k);
        c.fillStyle = RANGE_FIRE[(Math.sin(t * 8) * 7.99 + 8) | 0];
        c.fillRect(Math.round((n.x + 0.5) * T - 3 * k), Math.round((n.y + 0.95) * T - 6 * k), Math.round(6 * k), Math.round(3 * k));
        if (Math.random() < 0.04) fx.particles.push({ kind: "smoke", x: n.x + 0.5, y: n.y + 0.3, vx: 0.05, vy: -0.35, t: 0, life: 1.6, s: 0.08 });
        return;
      }
      case K_NPC: {
        const npc = it.a, o = charOpts("npc:" + npc.id);
        o.name = npc.name; o.avatar = npc.avatar; o.npc = true; o.role = npc.role; o.quest = questMarkFor(npc); o.facing = "down";
        drawCharacter(c, it.d, o, now, T, TG);
        return;
      }
      case K_MOB: drawMob(c, it.a, it.d, now, T, TG); return;
      case K_PLAYER: drawCharacter(c, it.d, it.a, now, T, TG); return;
    }
  }
  const RANGE_FIRE = Array.from({ length: 16 }, (_, i) => `rgb(255,${80 + Math.round(i * 100 / 15)},40)`);

  function fishWaterTile(n) {
    let w = fx.fishWater.get(n.id);
    if (w !== undefined && (w === null ? fx.fishWater.get(n.id + "@") !== n.x + "," + n.y : w.nx !== n.x || w.ny !== n.y)) w = undefined;
    if (w === undefined) {
      w = null;
      let best = 99;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (G.isWater(G.T(n.x + dx, n.y + dy))) { const d = Math.abs(dx) + Math.abs(dy) + (dx && dy ? 0.5 : 0); if (d < best) { best = d; w = { x: n.x + dx, y: n.y + dy, nx: n.x, ny: n.y }; } }
      }
      fx.fishWater.set(n.id, w);
      if (!w) fx.fishWater.set(n.id + "@", n.x + "," + n.y);
    }
    return w;
  }

  // ----- characters -----
  function charPainter(c, fxp, fyp, k, bob) {
    return (x, y, w, h, col) => {
      c.fillStyle = col;
      c.fillRect(Math.round(fxp + x * k), Math.round(fyp + (y - bob) * k), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
    };
  }

  function actionTarget(r, kind) {
    // nearest relevant node / mob next to the actor
    const rx = Math.round(r.x), ry = Math.round(r.y);
    let best = null, bd = 9;
    if (kind === "combat") {
      for (const m of state.mobs) { if (!m.alive) continue; const d = Math.hypot(m.x - r.x, m.y - r.y); if (d < bd && d < 2.2) { bd = d; best = { x: m.x, y: m.y, type: "mob" }; } }
      return best;
    }
    for (const n of state.nodes) {
      const tx = n.rockX != null ? n.rockX : n.x, ty = n.rockY != null ? n.rockY : n.y;
      const want = kind === "cook" ? n.type === "range" : kind === "smelt" ? n.type === "furnace" : kind === "smith" ? n.type === "anvil" : ["fish", "ore", "tree", "yarn"].includes(n.type);
      if (!want) continue;
      const d = Math.max(Math.abs(n.x - rx), Math.abs(n.y - ry));
      if (d <= 1 && d < bd) {
        bd = d;
        let t = { x: tx, y: ty, type: n.type };
        if (n.type === "fish") { const w = fishWaterTile(n); if (w) t = { x: w.x, y: w.y, type: "fish" }; }
        best = t;
      }
    }
    return best;
  }

  function faceToward(r, t) {
    const dx = t.x - r.x, dy = t.y - r.y;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
    return dy > 0 ? "down" : "up";
  }

  function drawTool(c, kind, tgt, fxp, fyp, k, facing, now, bob, T) {
    const side = facing === "left" ? -1 : 1;
    const hx = fxp + side * 5 * k, hy = fyp + (-8 - bob) * k;
    const swing = 0.5 + 0.5 * Math.sin(now / 110);
    const P = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x * k), Math.round(y * k), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))); };
    if (kind === "fish" && tgt) {
      // rod + line + bobber
      const tx = (tgt.x + 0.5) * T, ty = (tgt.y + 0.5) * T + Math.sin(now / 300) * 1.5 * k;
      const tipX = hx + side * 9 * k, tipY = hy - 10 * k;
      c.strokeStyle = "#8a5a33"; c.lineWidth = Math.max(1, 1.5 * k);
      c.beginPath(); c.moveTo(hx, hy); c.lineTo(tipX, tipY); c.stroke();
      c.strokeStyle = "rgba(240,240,240,.8)"; c.lineWidth = Math.max(1, 0.6 * k);
      c.beginPath(); c.moveTo(tipX, tipY); c.quadraticCurveTo((tipX + tx) / 2, Math.max(tipY, ty) + 4 * k, tx, ty); c.stroke();
      c.fillStyle = "#e8483a"; c.fillRect(Math.round(tx - 1.5 * k), Math.round(ty - 2 * k), Math.round(3 * k), Math.round(2 * k));
      c.fillStyle = "#fff"; c.fillRect(Math.round(tx - 1.5 * k), Math.round(ty), Math.round(3 * k), Math.round(1 * k));
      return;
    }
    let ang = 0;
    c.save();
    c.translate(hx, hy);
    if (kind === "ore" || kind === "tree" || kind === "smith" || kind === "combat") {
      ang = (-1.6 + swing * 2.0) * side;
      c.rotate(ang);
      if (kind === "combat") { P(-0.5, -12, 2, 11, "#d6dde6"); P(0, -12, 1, 10, "#ffffff"); P(-2.5, -2, 6, 1.5, "#e6b84a"); P(-0.5, 0, 2, 3, "#6b4426"); }
      else {
        P(-0.5, -11, 1.5, 12, "#8a5a33");
        if (kind === "ore") { P(-5, -12, 11, 2, "#9aa2ae"); P(-5, -12, 2, 3, "#9aa2ae"); P(4, -12, 2, 3, "#9aa2ae"); P(-4, -12, 8, 1, "#d6dde6"); }
        else if (kind === "tree") { P(side > 0 ? 0.5 : -4.5, -12, 4, 5, "#9aa2ae"); P(side > 0 ? 3.5 : -4.5, -12, 1, 5, "#d6dde6"); }
        else { P(-3, -13, 6, 3, "#5a626e"); P(-3, -13, 6, 1, "#9aa2ae"); }
      }
    } else if (kind === "cook") {
      P(-1, -2, 8 * side, 1.5, "#6b4426"); P(side > 0 ? 6 : -11, -3, 5, 3, "#2e3236");
    } else if (kind === "yarn") {
      const t = Math.sin(now / 160) * 2;
      P(-1 + t, -4, 3, 3, "#e8578a"); P(-1 + t, -4, 1, 1, "#ffb3cc");
    }
    c.restore();
    if ((kind === "smith" || kind === "smelt") && tgt && swing > 0.85) {
      const sx = (tgt.x + 0.5) * T, sy = (tgt.y + 0.3) * T;
      for (let i = 0; i < 4; i++) { c.fillStyle = i % 2 ? "#ffd27a" : "#ff8a3a"; c.fillRect(Math.round(sx + (Math.random() - 0.5) * 14 * k), Math.round(sy - Math.random() * 10 * k), Math.ceil(k), Math.ceil(k)); }
    }
    if (kind === "ore" && tgt && swing > 0.9) {
      const sx = (tgt.x + 0.5) * T, sy = (tgt.y + 0.5) * T;
      for (let i = 0; i < 3; i++) { c.fillStyle = "#d8d0c0"; c.fillRect(Math.round(sx + (Math.random() - 0.5) * 12 * k), Math.round(sy - Math.random() * 8 * k), Math.ceil(k), Math.ceil(k)); }
    }
    if (kind === "tree" && tgt && swing > 0.9) {
      const sx = (tgt.x + 0.5) * T, sy = (tgt.y + 0.6) * T;
      for (let i = 0; i < 2; i++) { c.fillStyle = "#e0b47a"; c.fillRect(Math.round(sx + (Math.random() - 0.5) * 10 * k), Math.round(sy - Math.random() * 6 * k), Math.ceil(k * 1.5), Math.ceil(k)); }
    }
  }

  function drawCharacter(c, r, o, now, T, tags) {
    const k = T / G.BT;
    const fxp = (r.x + 0.5) * T, fyp = (r.y + 0.5) * T + 0.3 * T;
    const moving = now - r.moving < 150;
    const phase = r.dist * Math.PI * 1.6;
    const st = moving ? Math.sin(phase) : 0;
    let facing = o.facing || r.facing;
    let tgt = null, toolKind = null;
    if (o.action) {
      tgt = actionTarget(r, o.action);
      if (tgt) { facing = faceToward(r, tgt); toolKind = o.action === "gather" ? tgt.type : o.action; }
      else toolKind = o.action === "gather" ? null : o.action;
    }
    const bob = moving ? Math.abs(Math.sin(phase)) * 1.2 : o.action ? Math.abs(Math.sin(now / 160)) * 0.8 : (Math.sin(now / 520 + r.x * 3) + 1) * 0.25;
    shadow(c, fxp, fyp, 6.5 * k, 2.4 * k, 0.28);
    if (o.self) {
      c.strokeStyle = "rgba(255,236,150,.75)"; c.lineWidth = Math.max(1, k * 0.8);
      c.beginPath(); c.ellipse(fxp, fyp, 8.5 * k, 3.4 * k, 0, 0, Math.PI * 2); c.stroke();
    }
    const P = charPainter(c, fxp, fyp, k, bob);
    const eq = o.equipped || {};
    let tun = o.role ? (ROLE_TUNIC[o.role] || TUNICS[0]) : TUNICS[nameHash(o.name) % TUNICS.length];
    if (eq.body && MAIL[eq.body]) tun = MAIL[eq.body];
    const side = facing === "left" || facing === "right";
    const dir = facing === "left" ? -1 : 1;
    const shoe = "#3a2618", pants = "#4a3a30";
    const tool = toolKind && (facing === "up");
    if (tool) drawTool(c, toolKind, tgt, fxp, fyp, k, facing, now, bob, T);
    // legs
    if (side) {
      P(-2 + st * 1.5, -4, 2, 3, pants); P(-2 + st * 1.5, -1, 3 * dir > 0 ? 3 : 3, 1, shoe);
      P(0 - st * 1.5, -4, 2, 3, G.shade(pants, -0.2)); P(0 - st * 1.5, -1, 3, 1, shoe);
    } else {
      const l = Math.max(0, st), rr = Math.max(0, -st);
      P(-3, -4 - l, 2, 3, pants); P(-3, -1 - l, 2, 1, shoe);
      P(1, -4 - rr, 2, 3, pants); P(1, -1 - rr, 2, 1, shoe);
    }
    // body
    const bw = side ? 6 : 8, bx = -bw / 2;
    P(bx, -10, bw, 6, tun[0]);
    P(bx, -10, side ? 2 : 2, 6, tun[2]);
    P(bx + bw - 2, -10, 2, 6, tun[1]);
    P(bx, -5, bw, 1, o.role === "cook" ? "#c8c6bc" : "#3a2414");
    if (o.role === "cook") P(bx + 1, -9, bw - 2, 5, "#ffffff");
    if (o.role === "smith") P(bx + 1, -9, bw - 2, 5, "#5a3a22");
    if (o.role === "greet") { P(bx - 1, -5, bw + 2, 2, tun[1]); }
    if (o.role === "bank") P(-0.5, -10, 1, 5, "#e6b84a");
    // arms
    const swingA = moving ? st * 1.5 : 0;
    if (side) {
      P(-1 + swingA * dir, -10, 2, 5, tun[1]); P(-1 + swingA * dir, -5, 2, 1, "#f0c8a0");
    } else {
      P(-6, -10 + swingA * 0.6, 2, 5, tun[1]); P(-6, -5 + swingA * 0.6, 2, 1, "#f0c8a0");
      P(4, -10 - swingA * 0.6, 2, 5, tun[1]); P(4, -5 - swingA * 0.6, 2, 1, "#f0c8a0");
    }
    // neck items
    if (eq.body === "red_scarf" || eq.neck === "red_scarf") { P(-4, -11, 8, 2, "#d23a2a"); P(side ? -dir * 3 : 2, -9, 2, 4, "#d23a2a"); }
    if (eq.neck === "gold_collar") P(-3, -11, 6, 1, "#e6b84a");
    if (eq.neck === "lucky_bell") { P(-3, -11, 6, 1, "#c8322a"); P(-1, -10, 2, 2, "#e6b84a"); }
    if (eq.neck === "maneki_ribbon") { P(-3, -11, 6, 1, "#c8322a"); P(-2, -10, 1.5, 2, "#c8322a"); P(0.5, -10, 1.5, 2, "#c8322a"); }
    if (eq.neck === "koi_charm") { P(-3, -11, 6, 1, "#3a2a1c"); P(-1.5, -10, 3, 2.5, "#f08a3a"); P(-0.5, -10, 1, 1, "#fff3c8"); P(-1, -7.5, 2, 1, "#e85a2a"); }
    if (eq.neck === "shrine_sash") { P(-4, -11, 2, 2, "#f4ead0"); P(-2, -9, 2, 2, "#f4ead0"); P(0, -7, 2, 2, "#f4ead0"); P(2, -5, 2, 2, "#f4ead0"); P(-3.5, -10.2, 1, 1, "#c8322a"); P(0.5, -6.2, 1, 1, "#c8322a"); P(2.5, -4, 2, 2, "#e6b84a"); }
    // head token
    const R = 7.5;
    const hcx = fxp + (side ? dir * 0.8 : 0) * k, hcy = fyp + (-17.5 - bob) * k;
    const ring = o.holder || o.nihala ? "#e6b84a" : o.self ? "#fff3a0" : o.npc ? "#f0c96a" : "#2a1c12";
    const tok = G.tokenFor(avatarImg(o.avatar), avatarKey(o.avatar), ring);
    if (tok) {
      c.save();
      c.imageSmoothingEnabled = true;
      c.drawImage(tok, Math.round(hcx - R * k), Math.round(hcy - R * k), Math.round(2 * R * k), Math.round(2 * R * k));
      c.restore();
      c.imageSmoothingEnabled = false;
    } else {
      c.fillStyle = "#d48a3a"; c.beginPath(); c.arc(hcx, hcy, R * k, 0, Math.PI * 2); c.fill();
    }
    if (facing === "up") { c.fillStyle = "rgba(30,20,10,.18)"; c.beginPath(); c.arc(hcx, hcy, R * k, 0, Math.PI * 2); c.fill(); }
    if (o.holder) {
      const sp = (now / 300) % (Math.PI * 2);
      c.fillStyle = "#fff0a8";
      c.fillRect(Math.round(hcx + Math.cos(sp) * (R + 1.5) * k), Math.round(hcy + Math.sin(sp) * (R + 1.5) * k), Math.ceil(k * 1.2), Math.ceil(k * 1.2));
    }
    // head gear
    const helm = eq.head && /_helm$/.test(eq.head) ? (G.METAL[eq.head.split("_")[0]] || G.METAL.iron) : null;
    if (helm) {
      c.fillStyle = helm[0];
      c.beginPath(); c.arc(hcx, hcy - 1 * k, (R + 0.6) * k, Math.PI * 1.05, Math.PI * 1.95); c.lineTo(hcx, hcy - 1 * k); c.fill();
      c.fillStyle = helm[1]; c.fillRect(Math.round(hcx - 4 * k), Math.round(hcy - (R + 0.2) * k), Math.round(3 * k), Math.round(1 * k));
      c.fillStyle = helm[2]; c.fillRect(Math.round(hcx - (R + 0.6) * k), Math.round(hcy - 2 * k), Math.round((2 * R + 1.2) * k), Math.round(1.2 * k));
    }
    if (eq.head === "bamboo_hat") {
      const hy = hcy - (R - 1.5) * k;
      c.fillStyle = "#a8843a"; c.fillRect(Math.round(hcx - (R + 3.5) * k), Math.round(hy), Math.round((2 * R + 7) * k), Math.round(1.6 * k));
      c.fillStyle = "#e0c070"; c.fillRect(Math.round(hcx - (R + 2.5) * k), Math.round(hy - 1.4 * k), Math.round((2 * R + 5) * k), Math.round(1.6 * k));
      c.fillRect(Math.round(hcx - 6 * k), Math.round(hy - 3 * k), Math.round(12 * k), Math.round(1.8 * k));
      c.fillStyle = "#c8a050"; c.fillRect(Math.round(hcx - 3.5 * k), Math.round(hy - 4.6 * k), Math.round(7 * k), Math.round(1.8 * k));
      c.fillStyle = "#e0c070"; c.fillRect(Math.round(hcx - 1.2 * k), Math.round(hy - 6 * k), Math.round(2.4 * k), Math.round(1.6 * k));
      c.fillStyle = "#c8322a"; c.fillRect(Math.round(hcx - 6 * k), Math.round(hy - 1.3 * k), Math.round(12 * k), Math.round(0.9 * k));
    }
    if (eq.head === "lantern_hat") {
      const lx = hcx - 2.5 * k, ly = hcy - (R + 6) * k;
      c.fillStyle = "#e6b84a"; c.fillRect(Math.round(lx - 0.5 * k), Math.round(ly - 1 * k), Math.round(6 * k), Math.round(1 * k));
      c.fillStyle = "#c8322a"; c.fillRect(Math.round(lx), Math.round(ly), Math.round(5 * k), Math.round(5 * k));
      c.fillStyle = "#e85a4a"; c.fillRect(Math.round(lx), Math.round(ly), Math.round(2 * k), Math.round(5 * k));
    }
    if (toolKind && !tool) drawTool(c, toolKind, tgt, fxp, fyp, k, facing, now, bob, T);
    // quest marker
    if (o.quest) {
      const qy = hcy - (R + 9 + Math.abs(Math.sin(now / 300)) * 2) * k;
      c.fillStyle = "#2a1c12"; c.fillRect(Math.round(hcx - 2 * k), Math.round(qy - 1 * k), Math.round(4 * k), Math.round(9 * k));
      c.fillStyle = o.quest === "!" ? "#ffd84a" : "#bfe6ff";
      c.fillRect(Math.round(hcx - 1 * k), Math.round(qy), Math.round(2 * k), Math.round(5 * k));
      c.fillRect(Math.round(hcx - 1 * k), Math.round(qy + 6 * k), Math.round(2 * k), Math.round(1.5 * k));
    }
    if (tags) {
      if (o._ln !== o.name || o._lc !== o.combatLevel) { o._ln = o.name; o._lc = o.combatLevel; o._label = o.name + (o.combatLevel ? "  (lvl " + o.combatLevel + ")" : ""); }
      tagAdd(hcx, hcy - (R + 3) * k - (o.quest ? 10 * k : 0), o._label, o, !!o.self, !!o.npc);
    }
  }

  function drawMob(c, m, r, now, T, tags) {
    const k = T / G.BT;
    const fxp = (r.x + 0.5) * T, fyp = (r.y + 0.5) * T + 0.25 * T;
    const moving = now - r.moving < 150;
    const kind = m.kind || "dog";
    const sc = kind === "rat" ? 0.75 : kind === "hound" ? 1.2 : 1;
    const kk = k * sc;
    const dir = r.hface === "left" ? -1 : 1;
    const ph = r.dist * Math.PI * 2.4;
    const st = moving ? Math.sin(ph) : 0;
    const bob = moving ? Math.abs(st) * 0.8 : 0;
    shadow(c, fxp, fyp, 8 * kk, 2.4 * kk, 0.25);
    const pal = kind === "rat" ? ["#8c8a86", "#6a6864", "#b0aea8", "#f0a0a8"] : kind === "hound" ? ["#4a4048", "#2e282e", "#6a5e68", "#c83a2a"] : ["#c9a26b", "#94703e", "#e6c48e", "#3a2a1c"];
    const P = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(fxp + (dir > 0 ? x : -x - w) * kk), Math.round(fyp + (y - bob) * kk), Math.max(1, Math.round(w * kk)), Math.max(1, Math.round(h * kk))); };
    // tail
    const wag = Math.sin(now / (kind === "rat" ? 300 : 120)) * 1.5;
    if (kind === "rat") { P(-12, -4 + wag * 0.3, 5, 1, pal[3]); P(-14, -5 + wag * 0.3, 2, 1, pal[3]); }
    else P(-9, -10 + wag, 2, 4, pal[1]);
    // legs
    P(-6 + st, -3, 2, 3, pal[1]); P(4 - st, -3, 2, 3, pal[1]);
    P(-4 - st, -3, 2, 3, pal[0]); P(6 + st, -3, 2, 3, pal[0]);
    // body
    P(-7, -9, 14, 6, pal[0]); P(-7, -9, 14, 1, pal[2]); P(-7, -4, 14, 1, pal[1]);
    // head
    P(5, -13, 6, 6, pal[0]); P(5, -13, 6, 1, pal[2]); P(10, -10, 3, 3, pal[0]); P(12, -10, 1, 1, "#1a1a1a");
    P(8, -11, 1, 1, kind === "hound" ? "#ff4a3a" : "#1a1a1a");
    if (kind === "rat") { P(5, -15, 2, 2, pal[3]); P(8, -15, 2, 2, pal[3]); }
    else { P(5, -15, 2, 3, pal[1]); P(8, -15, 2, 3, pal[1]); }
    if (kind === "hound") P(4, -8, 2, 4, "#e6b84a");
    const yTop = fyp - 18 * kk;
    if (m.hp < m.maxHp) {
      const w = 18 * k;
      c.fillStyle = "#2a1c12"; c.fillRect(Math.round(fxp - w / 2 - 1), Math.round(yTop - 4 * k), Math.round(w + 2), Math.round(3 * k));
      c.fillStyle = "#c8322a"; c.fillRect(Math.round(fxp - w / 2), Math.round(yTop - 3.5 * k), Math.round(w), Math.round(2 * k));
      c.fillStyle = "#5ad04a"; c.fillRect(Math.round(fxp - w / 2), Math.round(yTop - 3.5 * k), Math.round(w * Math.max(0, m.hp / m.maxHp)), Math.round(2 * k));
    }
    if (tags) {
      if (m._ln !== m.name || m._ll !== m.level) { m._ln = m.name; m._ll = m.level; m._label = (m.name || "Rival Dog") + (m.level ? "  (lvl " + m.level + ")" : ""); }
      tagAdd(fxp, yTop - 6 * k, m._label, MOB_FLAGS, false, false);
    }
  }

  // ----- static/dynamic world objects -----
  function drawLanternGlow(c, x, y, r, now) {
    const flick = 0.85 + Math.sin(now / 130 + x * 7) * 0.08;
    drawGlow(c, "lantern", "255,180,80", false, x, y, r, 0.35 * flick);
  }
  function drawHangingLantern(c, x, y, k, now) {
    const sw = Math.sin(now / 700 + x) * 0.6 * k;
    c.fillStyle = "#3a2414"; c.fillRect(Math.round(x), Math.round(y - 3 * k), Math.max(1, Math.round(k * 0.6)), Math.round(3 * k));
    const lx = x - 3 * k + sw, ly = y;
    c.fillStyle = "#e6b84a"; c.fillRect(Math.round(lx + 1 * k), Math.round(ly), Math.round(4 * k), Math.round(1 * k));
    c.fillStyle = "#c8322a"; c.fillRect(Math.round(lx), Math.round(ly + 1 * k), Math.round(6 * k), Math.round(6 * k));
    c.fillStyle = "#ff7a5a"; c.fillRect(Math.round(lx + 1 * k), Math.round(ly + 1 * k), Math.round(2 * k), Math.round(6 * k));
    c.fillStyle = "#e6b84a"; c.fillRect(Math.round(lx + 1 * k), Math.round(ly + 7 * k), Math.round(4 * k), Math.round(1 * k));
    c.fillRect(Math.round(lx + 2.5 * k), Math.round(ly + 8 * k), Math.max(1, Math.round(1 * k)), Math.round(2 * k));
  }
  function drawRoof(c, b, T, now, lights) {
    const k = T / G.BT;
    const s = G.roofSprite(b);
    const x = b.x0 * T - 8 * k, y = b.y0 * T + 0.62 * T - 34 * k;
    c.drawImage(s.c, Math.round(x), Math.round(y), Math.round(s.c.width * k), Math.round(s.c.height * k));
    const ly = b.y0 * T + 0.62 * T;
    drawHangingLantern(c, b.x0 * T + 0.2 * T, ly, k, now);
    drawHangingLantern(c, (b.x1 + 1) * T - 0.2 * T, ly, k, now);
    lightAdd(b.x0 + 0.2, b.y0 + 0.95, 2.6, 0, 1); lightAdd(b.x1 + 0.8, b.y0 + 0.95, 2.6, 0, 1);
    const ch = G.SIGN[b.role];
    if (ch) {
      const cx = (b.x0 + b.x1 + 1) / 2 * T, cy = b.y0 * T + 0.62 * T - 8 * k;
      c.fillStyle = "#3a1a10"; c.fillRect(Math.round(cx - 7 * k), Math.round(cy - 7 * k), Math.round(14 * k), Math.round(13 * k));
      c.fillStyle = "#9c2b20"; c.fillRect(Math.round(cx - 6 * k), Math.round(cy - 6 * k), Math.round(12 * k), Math.round(11 * k));
      c.strokeStyle = "#e6b84a"; c.lineWidth = Math.max(1, k * 0.7); c.strokeRect(Math.round(cx - 5 * k) + 0.5, Math.round(cy - 5 * k) + 0.5, Math.round(10 * k), Math.round(9 * k));
      c.fillStyle = "#ffe08a"; c.font = `bold ${Math.round(8 * k)}px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`;
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(ch, cx, cy);
      c.textBaseline = "alphabetic";
    }
    if (b.role === "smith") {
      if (Math.random() < 0.05) fx.particles.push({ kind: "smoke", x: b.x1 - 0.5, y: b.y0 - 0.6, vx: 0.15, vy: -0.4, t: 0, life: 2.6, s: 0.15 });
    }
  }
  function drawTorii(c, x, y, T, now, lights) {
    const k = T / G.BT;
    const left = x * T, right = (x + 5) * T, top = y * T - 30 * k, base = (y + 0.9) * T;
    const red = "#c8322a", dark = "#8a2018";
    c.fillStyle = "rgba(20,12,6,.25)"; c.fillRect(Math.round(left + 6 * k), Math.round(base - 1 * k), Math.round(5 * k), Math.round(2 * k)); c.fillRect(Math.round(right - 11 * k), Math.round(base - 1 * k), Math.round(5 * k), Math.round(2 * k));
    for (const px_ of [left + 6 * k, right - 11 * k]) {
      c.fillStyle = red; c.fillRect(Math.round(px_), Math.round(top + 6 * k), Math.round(4 * k), Math.round(base - top - 6 * k));
      c.fillStyle = "#e85a4a"; c.fillRect(Math.round(px_), Math.round(top + 6 * k), Math.round(1 * k), Math.round(base - top - 6 * k));
      c.fillStyle = "#2a1c12"; c.fillRect(Math.round(px_ - 1 * k), Math.round(base - 3 * k), Math.round(6 * k), Math.round(3 * k));
    }
    c.fillStyle = "#2a1c12"; c.fillRect(Math.round(left), Math.round(top), Math.round(right - left), Math.round(3 * k));
    c.fillStyle = red; c.fillRect(Math.round(left + 1 * k), Math.round(top + 3 * k), Math.round(right - left - 2 * k), Math.round(3 * k));
    c.fillStyle = dark; c.fillRect(Math.round(left + 4 * k), Math.round(top + 11 * k), Math.round(right - left - 8 * k), Math.round(2.5 * k));
    c.fillStyle = "#e6b84a"; c.fillRect(Math.round((left + right) / 2 - 3 * k), Math.round(top + 5 * k), Math.round(6 * k), Math.round(6 * k));
    c.fillStyle = "#3a1a10"; c.font = `bold ${Math.round(5 * k)}px sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("猫", (left + right) / 2, top + 8 * k); c.textBaseline = "alphabetic";
    drawHangingLantern(c, left + 8 * k, top + 13.5 * k, k, now);
    drawHangingLantern(c, right - 9 * k, top + 13.5 * k, k, now);
    lightAdd(x + 0.45, y - 0.6, 2.6, 0, 1); lightAdd(x + 4.55, y - 0.6, 2.6, 0, 1);
  }

  function questMarkFor(npc) {
    const me = state.me;
    const sm = storyMarkFor(npc);
    if (sm) return sm;
    if (!me || !state.quests) return null;
    const q = state.quests.find((qq) => qq.giver === npc.id);
    if (!q) return null;
    const st = (me.quests || {})[q.id] || { step: 0, done: false };
    if (st.done) return null;
    return st.step > 0 ? "?" : "!";
  }

  function spawnParticles(dt, now, view, T) {
    const P = fx.particles;
    const h = G.hourNow(fx.todOverride), dark = G.darknessAt(h);
    // ripples
    if (Math.random() < dt * 3 && view.water.n) {
      const wi = (Math.random() * view.water.n) | 0, wx = view.water.xs[wi], wy = view.water.ys[wi];
      P.push({ kind: "ripple", x: wx + 0.2 + Math.random() * 0.6, y: wy + 0.2 + Math.random() * 0.6, t: 0, life: 1.4 });
    }
    // petals
    for (let ci = 0; ci < view.cherry.n; ci++) if (Math.random() < dt * 0.7) P.push({ kind: "petal", x: view.cherry.xs[ci] + Math.random(), y: view.cherry.ys[ci] - 1.2 + Math.random() * 0.8, vx: 0.25 + Math.random() * 0.2, vy: 0.3 + Math.random() * 0.15, t: 0, life: 3.2, ph: Math.random() * 6 });
    // drifting leaves in the forest by day
    if (dark < 0.5 && view.leafy.n && Math.random() < dt * 0.8) {
      const li = (Math.random() * view.leafy.n) | 0;
      P.push({ kind: "leaf", x: view.leafy.xs[li] + Math.random(), y: view.leafy.ys[li] - 1, vx: 0.2, vy: 0.35, t: 0, life: 2.6, ph: Math.random() * 6 });
    }
    // fireflies
    const ffCount = P.reduce((n, p) => n + (p.kind === "firefly"), 0);
    if (dark > 0.2 && ffCount < 34 && Math.random() < dt * 8) {
      const x = view.x0 + Math.random() * (view.x1 - view.x0), y = view.y0 + Math.random() * (view.y1 - view.y0);
      const z = G.zoneIdAt(x | 0, y | 0);
      if ((z === "forest" || z === "bamboo" || z === "shrine" || z === "pond" || z === "shrine-inner") && !G.isWater(G.T(x | 0, y | 0))) {
        P.push({ kind: "firefly", x, y, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3, t: 0, life: 4 + Math.random() * 3, ph: Math.random() * 6 });
      }
    }
    // furnace smoke & range steam
    for (const n of view.fires) {
      if (Math.random() < dt * 2) P.push({ kind: "smoke", x: n.x + 0.62, y: n.y - 0.95, vx: 0.1, vy: -0.45, t: 0, life: 2.4, s: 0.12 });
    }
    if (P.length > 260) P.splice(0, P.length - 260);
  }
  function updateParticles(dt) {
    const P = fx.particles;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.t += dt;
      if (p.t >= p.life) { P[i] = P[P.length - 1]; P.pop(); continue; }
      if (p.kind === "firefly") { p.vx += (Math.random() - 0.5) * dt * 0.8; p.vy += (Math.random() - 0.5) * dt * 0.8; p.vx *= 0.98; p.vy *= 0.98; }
      if (p.g) p.vy += p.g * dt;
      if (p.vx != null) { p.x += p.vx * dt; p.y += p.vy * dt; }
    }
  }
  function drawParticles(c, T, now, glowPass) {
    const k = T / G.BT;
    for (const p of fx.particles) {
      const a = Math.min(1, p.t / 0.3, (p.life - p.t) / 0.6);
      const x = p.x * T, y = p.y * T;
      if (glowPass) {
        if (p.kind !== "firefly") continue;
        const pulse = 0.5 + 0.5 * Math.sin(now / 250 + p.ph);
        drawGlow(c, "firefly", "220,255,140", false, x, y, 6 * k, 0.55 * a * pulse);
        c.globalAlpha = a * (0.4 + 0.6 * pulse);
        c.fillStyle = "#faffc8"; c.fillRect(Math.round(x), Math.round(y), Math.ceil(k), Math.ceil(k));
        c.globalAlpha = 1;
        continue;
      }
      if (p.kind === "ripple") {
        const rr = (0.1 + p.t / p.life * 0.4) * T;
        c.globalAlpha = 0.5 * (1 - p.t / p.life);
        c.strokeStyle = "#dcf5ff"; c.lineWidth = Math.max(1, k * 0.7);
        c.beginPath(); c.ellipse(x, y, rr, rr * 0.45, 0, 0, Math.PI * 2); c.stroke();
        c.globalAlpha = 1;
      } else if (p.kind === "petal") {
        const sx = x + Math.sin(p.t * 3 + p.ph) * 3 * k;
        c.globalAlpha = a;
        c.fillStyle = "#ffbed7"; c.fillRect(Math.round(sx), Math.round(y), Math.ceil(k * 1.5), Math.ceil(k));
        c.fillStyle = "#fff0f5"; c.fillRect(Math.round(sx), Math.round(y), Math.ceil(k * 0.8), Math.ceil(k * 0.8));
        c.globalAlpha = 1;
      } else if (p.kind === "leaf") {
        const sx = x + Math.sin(p.t * 3 + p.ph) * 3 * k;
        c.globalAlpha = a;
        c.fillStyle = "#78b450"; c.fillRect(Math.round(sx), Math.round(y), Math.ceil(k * 1.6), Math.ceil(k));
        c.globalAlpha = 1;
      } else if (p.kind === "spark") {
        c.globalAlpha = a;
        c.fillStyle = p.col;
        const sz = Math.ceil(k * (p.sz || 1.2));
        c.fillRect(Math.round(x), Math.round(y), sz, sz);
        c.globalAlpha = 1;
      } else if (p.kind === "ring") {
        const rr = (0.2 + p.t / p.life * 0.9) * T;
        c.globalAlpha = 0.8 * (1 - p.t / p.life);
        c.strokeStyle = p.col; c.lineWidth = Math.max(1, k);
        c.beginPath(); c.ellipse(x, y, rr, rr * 0.55, 0, 0, Math.PI * 2); c.stroke();
        c.globalAlpha = 1;
      } else if (p.kind === "smoke") {
        const s = (p.s || 0.12) + p.t * 0.12;
        c.globalAlpha = 0.35 * a;
        c.fillStyle = "#c8c3be";
        c.beginPath(); c.arc(x, y, s * T, 0, Math.PI * 2); c.fill();
        c.globalAlpha = 1;
      }
    }
  }

  function drawLighting(viewW, viewH, T, lights, now) {
    const h = G.hourNow(fx.todOverride);
    const dark = G.darknessAt(h), dusk = G.duskAt(h);
    if (dusk > 0.01) { ctx.globalAlpha = 0.12 * dusk; ctx.fillStyle = "#ff8c46"; ctx.fillRect(0, 0, viewW, viewH); ctx.globalAlpha = 1; }
    if (dark < 0.01) return 0;
    const LS = 4;
    const lw = Math.ceil(viewW / LS), lh = Math.ceil(viewH / LS);
    if (!fx.lm || fx.lm.width !== lw || fx.lm.height !== lh) { fx.lm = document.createElement("canvas"); fx.lm.width = lw; fx.lm.height = lh; fx.lg = fx.lm.getContext("2d"); }
    const g = fx.lg;
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, lw, lh);
    g.globalAlpha = 0.58 * dark;
    g.fillStyle = "#0c1234";
    g.fillRect(0, 0, lw, lh);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "destination-out";
    for (let li = 0; li < LP.n; li++) {
      const L = LP.items[li];
      const x = (L.x * T - state.camX) / LS, y = (L.y * T - state.camY) / LS, r = (L.r * T) / LS;
      if (x < -r || y < -r || x > lw + r || y > lh + r) continue;
      const flick = L.warm ? 0.92 + Math.sin(now / 140 + L.x * 5) * 0.06 : 1;
      drawGlow(g, "cut", "0,0,0", true, x, y, r * flick, L.a != null ? L.a : 0.95);
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fx.lm, 0, 0, lw * LS, lh * LS);
    ctx.globalCompositeOperation = "lighter";
    for (let li = 0; li < LP.n; li++) {
      const L = LP.items[li];
      if (!L.warm) continue;
      const x = L.x * T - state.camX, y = L.y * T - state.camY, r = L.r * T * 0.7;
      if (x < -r || y < -r || x > viewW + r || y > viewH + r) continue;
      drawGlow(ctx, "warm", "255,140,55", false, x, y, r, 0.22 * dark);
    }
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
    return dark;
  }

  function warmChunks(deadline) {
    const w = fx.warm;
    w.pending = false;
    if (!state.world) return;
    const ncx = Math.ceil(w.W / G.CH), ncy = Math.ceil(w.H / G.CH);
    let built = 0;
    for (let ring = 1; ring <= 2; ring++) {
      for (let cy = Math.max(0, w.cy0 - ring); cy <= Math.min(ncy - 1, w.cy1 + ring); cy++) for (let cx = Math.max(0, w.cx0 - ring); cx <= Math.min(ncx - 1, w.cx1 + ring); cx++) {
        if (G.hasChunk(cx, cy)) continue;
        if (built && deadline && deadline.timeRemaining && deadline.timeRemaining() < 6) return;
        if (built >= 2) return;
        G.chunk(cx, cy); built++;
      }
    }
  }
  function drawWorld(now, dir) {
    if (!state.world || !state.me) return;
    ensureAnalyzed();
    const t0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - (fx.lastFrame || now)) / 1000));
    fx.lastFrame = now;
    fx.frames++;
    if (now - fx.fpsT > 1000) { fx.fps = Math.round((fx.frames * 1000) / (now - fx.fpsT)); fx.frames = 0; fx.fpsT = now; }

    const W = state.world.W, H = state.world.H;
    const tiles = state.world.tiles;
    const T = tilePx();
    const k = T / G.BT;
    const viewW = canvas.clientWidth || 800;
    const viewH = canvas.clientHeight || 600;
    const meR = selfPos(dt, now, dir);
    fx.meR = meR;
    const manualFacing = state.facing && now < (state.facingUntil || 0) ? state.facing : null;
    if (manualFacing) meR.facing = manualFacing;
    // smooth camera follow (frame-rate independent lerp, in tile units so zoom doesn't matter)
    if (!fx.cam) fx.cam = { x: meR.x, y: meR.y };
    const cdx = meR.x - fx.cam.x, cdy = meR.y - fx.cam.y;
    if (Math.abs(cdx) + Math.abs(cdy) > 12) { fx.cam.x = meR.x; fx.cam.y = meR.y; }
    else { const a = 1 - Math.exp(-dt * 9); fx.cam.x += cdx * a; fx.cam.y += cdy * a; }
    const px_ = fx.cam.x * T + T / 2;
    const py_ = fx.cam.y * T + T / 2;
    const dpr = maxDpr();
    state.camX = Math.round(Math.max(0, Math.min(Math.max(0, W * T - viewW), px_ - viewW / 2)) * dpr) / dpr;
    state.camY = Math.round(Math.max(0, Math.min(Math.max(0, H * T - viewH), py_ - viewH / 2)) * dpr) / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#24331c";
    ctx.fillRect(0, 0, viewW + 2, viewH + 2);
    ctx.save();
    ctx.translate(-state.camX, -state.camY);

    const x0 = Math.max(0, Math.floor(state.camX / T) - 1);
    const y0 = Math.max(0, Math.floor(state.camY / T) - 1);
    const x1 = Math.min(W - 1, Math.ceil((state.camX + viewW) / T) + 1);
    const y1 = Math.min(H - 1, Math.ceil((state.camY + viewH) / T) + 1);
    const t = now / 1000;

    // ground (cached chunks)
    const span = G.CH * T;
    const cx0 = Math.floor(x0 / G.CH), cx1 = Math.floor(x1 / G.CH), cy0 = Math.floor(y0 / G.CH), cy1 = Math.floor(y1 / G.CH);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const ax = Math.round(cx * span * dpr) / dpr, ay = Math.round(cy * span * dpr) / dpr;
      const bx = Math.round((cx + 1) * span * dpr) / dpr, by = Math.round((cy + 1) * span * dpr) / dpr;
      ctx.drawImage(G.chunk(cx, cy), ax, ay, bx - ax, by - ay);
    }
    // pre-warm neighbouring ground chunks in idle time so walking never waits on a chunk build
    fx.warm.cx0 = cx0; fx.warm.cx1 = cx1; fx.warm.cy0 = cy0; fx.warm.cy1 = cy1; fx.warm.W = W; fx.warm.H = H;
    if (!fx.warm.pending) { fx.warm.pending = true; (window.requestIdleCallback || ((f) => setTimeout(f, 50)))(warmChunks); }

    // animated water sparkle
    const view = VIEW;
    view.x0 = x0; view.y0 = y0; view.x1 = x1; view.y1 = y1;
    view.water.n = 0; view.cherry.n = 0; view.leafy.n = 0; view.fires.length = 0;
    for (let y = y0; y <= y1; y++) {
      const row = tiles[y];
      for (let x = x0; x <= x1; x++) {
        const kd = row[x];
        if (kd !== "water" && kd !== "deepwater") continue;
        viewAdd(view.water, x, y);
        const hh = G.hash(x, y, 5);
        const ph = (t * 0.35 + (hh % 100) / 100) % 1;
        const a = Math.sin(ph * Math.PI);
        ctx.globalAlpha = 0.32 * a;
        ctx.fillStyle = "#d2f0ff";
        const wx = x * T + ((hh >> 3) % 12) * k + Math.sin(t + hh) * 2 * k, wy = y * T + ((hh >> 7) % 16 + 2) * k;
        ctx.fillRect(Math.round(wx), Math.round(wy), Math.round(4 * k), Math.max(1, Math.round(k)));
        if (hh % 3 === 0) ctx.fillRect(Math.round(wx + 6 * k), Math.round(wy + 5 * k), Math.round(2 * k), Math.max(1, Math.round(k)));
      }
    }

    ctx.globalAlpha = 1;
    // fishing spots
    for (const n of state.nodes) {
      if (n.type !== "fish" || n.depleted) continue;
      const w = fishWaterTile(n);
      if (!w) continue;
      const cx = (w.x + 0.5) * T, cy = (w.y + 0.5) * T;
      for (let i = 0; i < 2; i++) {
        const ph = ((t * 0.8 + i * 0.5) % 1);
        ctx.globalAlpha = 0.55 * (1 - ph);
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1, k * 0.7);
        ctx.beginPath(); ctx.ellipse(cx, cy, (2 + ph * 6) * k, (1 + ph * 3) * k, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const bub = G.hash(n.x, n.y, Math.floor(t * 3));
      ctx.fillStyle = "rgba(255,255,255,.8)";
      ctx.fillRect(Math.round(cx + ((bub % 9) - 4) * k), Math.round(cy - ((bub >> 4) % 4) * k), Math.ceil(k), Math.ceil(k));
      if (n.resource === "golden_koi" || n.resource === "koi") {
        const jump = (t * 0.5 + (G.hash(n.x, n.y, 1) % 10) / 10) % 3;
        if (jump < 0.5) {
          const jy = Math.sin(jump / 0.5 * Math.PI) * 6 * k;
          ctx.fillStyle = n.resource === "golden_koi" ? "#f0c040" : "#f0904a";
          ctx.fillRect(Math.round(cx - 2 * k), Math.round(cy - 2 * k - jy), Math.round(4 * k), Math.round(2 * k));
          ctx.fillStyle = "#fff"; ctx.fillRect(Math.round(cx - 2 * k), Math.round(cy - 2 * k - jy), Math.ceil(k), Math.ceil(k));
        }
      }
    }

    // objects, depth sorted by y — pooled draw list, no per-frame closures
    DL.n = 0; LP.n = 0; TG.n = 0;
    F.T = T; F.k = k; F.now = now; F.t = t;
    const rockMap = nodeAtRock();
    const yEnd = Math.min(H - 1, y1 + 3);
    for (let y = y0; y <= yEnd; y++) {
      const row = tiles[y];
      for (let x = x0; x <= x1; x++) {
        const kd = row[x];
        if (G.TREES.has(kd)) {
          if (kd === "cherry") viewAdd(view.cherry, x, y);
          if (kd === "tree" || kd === "pine") { if (G.hash(x, y, 8) % 4 === 0) viewAdd(view.leafy, x, y); }
          dlAdd(y + 0.9, K_TREE, kd, x, y, rockMap.get(y * 4096 + x) || null);
        } else if (G.ORES.has(kd)) {
          dlAdd(y + 0.8, K_ORE, kd, x, y, rockMap.get(y * 4096 + x) || null);
        } else if (kd === "lantern") {
          lightAdd(x + 0.3, y + 0.2, 3.4, 0, 1);
          dlAdd(y + 0.85, K_LANTERN, null, x, y, null);
        }
      }
    }
    for (const b of G.buildings) {
      if (b.x1 < x0 - 1 || b.x0 > x1 + 1 || b.y1 < y0 - 1 || b.y0 > y1 + 2) continue;
      dlAdd(b.y0 + 0.95, K_ROOF, b, 0, 0, null);
    }
    if (x0 <= 103 && x1 >= 96 && y0 <= 38 && y1 >= 33) dlAdd(36.9, K_TORII, null, 97, 36, null);
    for (const n of state.nodes) {
      if (n.x < x0 - 1 || n.x > x1 + 1 || n.y < y0 - 1 || n.y > y1 + 2) continue;
      if (n.type === "yarn") dlAdd(n.y + 0.5, K_YARN, n, 0, 0, null);
      else if (n.type === "furnace") { view.fires.push(n); lightAdd(n.x + 0.5, n.y + 0.6, 3.2, 0, 1); dlAdd(n.y + 0.8, K_FURNACE, n, 0, 0, null); }
      else if (n.type === "anvil") dlAdd(n.y + 0.8, K_ANVIL, n, 0, 0, null);
      else if (n.type === "board") dlAdd(n.y + 0.8, K_BOARD, n, 0, 0, null);
      else if (n.type === "fish") nodeFlip(n, now);
      else if (n.type === "range") { lightAdd(n.x + 0.5, n.y + 0.7, 2.2, 0, 1); dlAdd(n.y + 0.8, K_RANGE, n, 0, 0, null); }
    }

    for (const npc of state.npcs) {
      if (npc.x < x0 - 2 || npc.x > x1 + 2 || npc.y < y0 - 2 || npc.y > y1 + 3) continue;
      const r = smoothPos(npc.id, npc.x, npc.y, dt, now);
      dlAdd(r.y + 0.6, K_NPC, npc, 0, 0, r);
    }
    for (const m of state.mobs) {
      if (!m.alive) continue;
      if (m.x < x0 - 3 || m.x > x1 + 3 || m.y < y0 - 3 || m.y > y1 + 4) continue;
      const r = interpPos(m.id, m.x, m.y, now);
      dlAdd(r.y + 0.6, K_MOB, m, 0, 0, r);
    }
    let selfDrawn = false;
    for (const p of state.players) {
      const self = state.me && p.id === state.me.id;
      if (!self && (p.x < x0 - 3 || p.x > x1 + 3 || p.y < y0 - 3 || p.y > y1 + 4)) continue;
      const r = self ? meR : interpPos(p.id, p.x, p.y, now);
      if (self) selfDrawn = true;
      const moving = now - r.moving < 150;
      const o = charOpts(p.id);
      o.name = p.name; o.avatar = self ? (state.me.avatar || p.avatar) : p.avatar; o.self = self;
      o.holder = p.holder; o.nihala = p.nihala; o.action = p.action; o.combatLevel = p.combatLevel;
      o.title = self ? ((state.me.progress && state.me.progress.title) || "") : (p.title || "");
      o.equipped = self ? (state.me.equipped || p.equipped) : p.equipped;
      o.facing = self ? (manualFacing || (moving ? r.facing : p.facing) || r.facing) : (moving ? r.facing : (p.facing || r.facing));
      if (self) lightAdd(r.x + 0.5, r.y + 0.4, 3.6, 0.85, 0);
      else lightAdd(r.x + 0.5, r.y + 0.4, 1.6, 0.5, 0);
      dlAdd(r.y + 0.6 + (self ? 0.001 : 0), K_PLAYER, o, 0, 0, r);
    }
    if (!selfDrawn) {
      const o = charOpts("__me");
      o.name = state.me.name; o.avatar = state.me.avatar; o.self = true; o.holder = state.me.holder; o.nihala = state.me.nihala;
      o.action = state.me.action; o.equipped = state.me.equipped; o.facing = manualFacing || meR.facing; o.combatLevel = state.me.combatLevel;
      o.title = (state.me.progress && state.me.progress.title) || "";
      dlAdd(meR.y + 0.6, K_PLAYER, o, 0, 0, meR);
    }
    if (now - (fx.gcAt || 0) > 5000) { // occasional cleanup of entities that left
      fx.gcAt = now;
      for (const [id, b] of NET.buf) if (!NET.playerIdx.has(id) && !NET.mobIdx.has(id) && now - (b.r.seen || 0) > 10000 && !(state.me && id === state.me.id)) NET.buf.delete(id);
      for (const id of CO.keys()) if (id !== "__me" && !NET.playerIdx.has(id) && !state.players.some((p) => p.id === id)) CO.delete(id);
    }

    // click marker & hover go on the ground, under objects
    if (state.clickFx && now - state.clickFx.t < 600) {
      const a = 1 - (now - state.clickFx.t) / 600;
      const cx = (state.clickFx.x + 0.5) * T, cy = (state.clickFx.y + 0.5) * T, s = (0.25 + (1 - a) * 0.2) * T;
      ctx.strokeStyle = `rgba(255,224,120,${a})`; ctx.lineWidth = Math.max(1, k);
      ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy); ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s, cy); ctx.closePath(); ctx.stroke();
    }
    if (state.hover && !isMobileLayout()) {
      const hx = state.hover.tx * T, hy = state.hover.ty * T, L = 0.25 * T;
      ctx.strokeStyle = "rgba(255,246,216,.55)"; ctx.lineWidth = Math.max(1, k * 0.7);
      ctx.beginPath();
      ctx.moveTo(hx, hy + L); ctx.lineTo(hx, hy); ctx.lineTo(hx + L, hy);
      ctx.moveTo(hx + T - L, hy); ctx.lineTo(hx + T, hy); ctx.lineTo(hx + T, hy + L);
      ctx.moveTo(hx + T, hy + T - L); ctx.lineTo(hx + T, hy + T); ctx.lineTo(hx + T - L, hy + T);
      ctx.moveTo(hx + L, hy + T); ctx.lineTo(hx, hy + T); ctx.lineTo(hx, hy + T - L);
      ctx.stroke();
    }

    // ripples belong under objects
    updateParticles(dt);
    spawnParticles(dt, now, view, T);
    dlSort();
    for (let i = 0; i < DL.n; i++) dlDraw(DL.items[i]);
    drawParticles(ctx, T, now, false);

    ctx.restore();
    // lighting & ambience (screen space)
    drawLighting(viewW, viewH, T, LP, now);
    ctx.save();
    ctx.translate(-state.camX, -state.camY);
    ctx.globalCompositeOperation = "lighter";
    drawParticles(ctx, T, now, true);
    ctx.globalCompositeOperation = "source-over";
    drawChance(ctx, T, now);
    drawFloaters(ctx, T, now);
    drawNametags(ctx, TG, T);
    ctx.restore();
    drawMinimap(meR);
    fx.frameMs = fx.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  function drawFloaters(c, T, now) {
    const k = T / G.BT;
    for (let i = fx.floats.length - 1; i >= 0; i--) {
      const f = fx.floats[i];
      const age = (now - f.t0) / 1600;
      if (age >= 1) { fx.floats.splice(i, 1); continue; }
      const r = entityR(f.id) || f;
      const x = (r.x + 0.5) * T, y = (r.y - 0.9 - age * 1.1 - f.slot * 0.45) * T;
      c.globalAlpha = Math.min(1, (1 - age) * 2);
      if (f.icon) {
        const img = f.iconImg || (f.iconImg = Object.assign(new Image(), { src: f.icon }));
        if (img.complete) c.drawImage(img, Math.round(x - 30 * k / 2 - 8 * k), Math.round(y - 7 * k), Math.round(8 * k), Math.round(8 * k));
      }
      c.font = `bold ${Math.round(Math.max(11, 6.5 * k))}px "Trebuchet MS", sans-serif`;
      c.textAlign = "center";
      c.lineWidth = 3; c.strokeStyle = "rgba(30,16,8,.9)";
      c.strokeText(f.text, x, y); c.fillStyle = f.color; c.fillText(f.text, x, y);
      c.globalAlpha = 1;
    }
    for (let i = fx.splats.length - 1; i >= 0; i--) {
      const s = fx.splats[i];
      const age = (now - s.t0) / 900;
      if (age >= 1) { fx.splats.splice(i, 1); continue; }
      const r = entityR(s.id) || s;
      const x = (r.x + 0.5) * T + s.ox * k, y = (r.y + 0.1) * T + s.oy * k - age * 4 * k;
      c.globalAlpha = age < 0.7 ? 1 : (1 - age) / 0.3;
      const R = 6 * k * (age < 0.1 ? 0.6 + age * 4 : 1);
      c.fillStyle = s.dmg > 0 ? "#b81e1e" : "#2a5ab8";
      c.beginPath();
      for (let j = 0; j < 10; j++) { const a = (j / 10) * Math.PI * 2, rr = j % 2 ? R * 0.7 : R; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      c.closePath(); c.fill();
      c.strokeStyle = "#3a0a0a"; c.lineWidth = 1; c.stroke();
      c.fillStyle = "#fff"; c.font = `bold ${Math.round(Math.max(10, 6 * k))}px sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(String(s.dmg), x, y + 0.5);
      c.textBaseline = "alphabetic";
      c.globalAlpha = 1;
    }
  }

  function spawnFloat(text, color, icon) {
    if (!state.me) return;
    const slot = fx.floats.filter((f) => performance.now() - f.t0 < 500).length;
    fx.floats.push({ id: state.me.id || "me", x: state.me.x, y: state.me.y, text, color, icon, t0: performance.now(), slot });
  }
  function noteMeUpdate(prev, next) {
    if (!prev || !next || !next.skills || !prev.skills) return;
    for (const sk of state.skills) {
      const a = prev.skills[sk.id], b = next.skills[sk.id];
      if (!a || !b) continue;
      const d = (b.xp | 0) - (a.xp | 0);
      if (d > 0) spawnFloat("+" + d + " " + sk.name + " xp", "#bff0a0", G.iconURL("skill", sk.id));
    }
    if (prev.gold != null && next.gold != null && next.gold > prev.gold) spawnFloat("+" + (next.gold - prev.gold) + " gold", "#ffe08a");
    if (prev.invQty != null && invTotal(next) > prev.invQty && performance.now() - (state.lastGatherSfx || 0) > 400) sfx("pop", { vol: 0.8 });
    if (prev.questsDone != null && questsDone(next) > prev.questsDone) sfx("quest");
  }

  const MOB_FLAGS = { mob: true };
  const VIS = [], SEEN = [];
  const USED_X = new Float32Array(512), USED_Y = new Float32Array(512);
  const tagCmp = (a, b) => a.sy - b.sy || a.sx - b.sx;
  function entityR(id) {
    if (state.me && id === state.me.id && fx.meR) return fx.meR;
    const b = NET.buf.get(id);
    return b ? b.r : fx.rpos.get(id);
  }
  function drawNametags(c, tags, T) {
    if (!tags || !tags.n || !state.me) return;
    const maxDist = isMobileLayout() ? 7 : 10;
    const meR = fx.meR || state.me;
    VIS.length = 0; SEEN.length = 0;
    for (let i = 0; i < tags.n; i++) {
      const tag = tags.items[i];
      const dx = tag.sx / T - 0.5 - meR.x;
      const dy = tag.sy / T + 0.2 - meR.y;
      if (!tag.self && !tag.npc && dx * dx + dy * dy > maxDist * maxDist) continue;
      VIS.push(tag);
    }
    VIS.sort(tagCmp);
    let nUsed = 0;
    c.font = "bold 11px \"Trebuchet MS\", sans-serif";
    c.textAlign = "center";
    for (let vi = 0; vi < VIS.length; vi++) {
      const tag = VIS[vi];
      let dup = false;
      for (let j = 0; j < SEEN.length; j++) { const u = SEEN[j]; if (u.name === tag.name && Math.abs(u.sx - tag.sx) < 10 && Math.abs(u.sy - tag.sy) < 10) { dup = true; break; } }
      if (dup) continue;
      SEEN.push(tag);
      let y = tag.sy;
      let guard = 0;
      for (;;) {
        if (guard++ >= 8) break;
        let hit = false;
        for (let j = 0; j < nUsed; j++) if (Math.abs(USED_X[j] - tag.sx) < 80 && Math.abs(USED_Y[j] - y) < 13) { hit = true; break; }
        if (!hit) break;
        y -= 13;
      }
      if (nUsed < USED_X.length) { USED_X[nUsed] = tag.sx; USED_Y[nUsed] = y; nUsed++; }
      c.lineWidth = 3;
      c.strokeStyle = "rgba(24,14,8,.85)";
      c.fillStyle = tag.flags.holder ? "#ffe08a" : tag.flags.npc ? "#f3cf6a" : tag.flags.mob ? "#ffb0a0" : tag.self ? "#fff6c8" : "#ffffff";
      if (tag.flags.nihala) {
        // "nihala holder" pill right after the name
        const tw = c.measureText(tag.name).width;
        const label = "nihala holder";
        c.font = "bold 9px \"Trebuchet MS\", sans-serif";
        const pw = Math.ceil(c.measureText(label).width) + 8;
        const nx = Math.round(tag.sx - (tw + pw + 4) / 2);
        c.textAlign = "left";
        c.lineWidth = 3;
        c.strokeText(tag.name, nx, Math.round(y));
        c.fillText(tag.name, nx, Math.round(y));
        const bx = nx + Math.ceil(tw) + 4, by = Math.round(y) - 10;
        c.fillStyle = "#3a1a08"; c.fillRect(bx - 1, by - 1, pw + 2, 13);
        c.fillStyle = "#e6b84a"; c.fillRect(bx, by, pw, 11);
        c.fillStyle = "#fff0a8"; c.fillRect(bx, by, pw, 1);
        c.fillStyle = "#3a1a08"; c.fillText(label, bx + 4, by + 9);
        c.font = "bold 11px \"Trebuchet MS\", sans-serif";
        c.textAlign = "center";
        drawTagTitle(c, tag, y);
        continue;
      }
      c.strokeText(tag.name, Math.round(tag.sx), Math.round(y));
      c.fillText(tag.name, Math.round(tag.sx), Math.round(y));
      drawTagTitle(c, tag, y);
    }
  }

  function drawMinimap(meR) {
    if (!state.world) return;
    const W = state.world.W, H = state.world.H;
    const mw = mini.width, mh = mini.height;
    const sx = mw / W, sy = mh / H;
    mctx.imageSmoothingEnabled = false;
    mctx.drawImage(G.miniBase(), 0, 0, mw, mh);
    const dark = G.darknessAt(G.hourNow(fx.todOverride));
    if (dark > 0.01) { mctx.fillStyle = `rgba(12,18,52,${0.35 * dark})`; mctx.fillRect(0, 0, mw, mh); }
    mctx.font = "bold 8px sans-serif";
    mctx.textAlign = "center";
    const labels = [
      { name: "Village", x: 32, y: 30 }, { name: "Pond", x: 8, y: 22 }, { name: "Mine", x: 33, y: 9 },
      { name: "Forest", x: 55, y: 36 }, { name: "Harbor", x: 14, y: 52 }, { name: "Bamboo", x: 48, y: 76 },
      { name: "Quarry", x: 95, y: 14 }, { name: "Shrine", x: 108, y: 64 },
    ];
    for (const z of labels) {
      mctx.lineWidth = 2.5; mctx.strokeStyle = "rgba(30,18,10,.85)"; mctx.strokeText(z.name, z.x * sx, z.y * sy);
      mctx.fillStyle = "#fff3d0"; mctx.fillText(z.name, z.x * sx, z.y * sy);
    }
    for (const n of state.npcs) { mctx.fillStyle = "#ffd84a"; mctx.fillRect(n.x * sx - 1, n.y * sy - 1, 2, 2); }
    for (const m of state.mobs) { if (!m.alive) continue; mctx.fillStyle = "#e8483a"; mctx.fillRect(m.x * sx - 1, m.y * sy - 1, 2, 2); }
    for (const p of state.players) {
      if (state.me && p.id === state.me.id) continue;
      mctx.fillStyle = "#ffffff"; mctx.fillRect(p.x * sx - 1, p.y * sy - 1, 3, 3);
    }
    const T = tilePx();
    const vw = (canvas.clientWidth || 800) / T, vh = (canvas.clientHeight || 600) / T;
    mctx.strokeStyle = "rgba(255,246,216,.7)"; mctx.lineWidth = 1;
    mctx.strokeRect(Math.round(state.camX / T * sx) + 0.5, Math.round(state.camY / T * sy) + 0.5, Math.round(vw * sx), Math.round(vh * sy));
    const me = meR || state.me;
    if (me) {
      mctx.fillStyle = "#2a1c12"; mctx.fillRect(me.x * sx - 2.5, me.y * sy - 2.5, 5, 5);
      mctx.fillStyle = "#fff36a"; mctx.fillRect(me.x * sx - 1.5, me.y * sy - 1.5, 3, 3);
    }
  }


  let raf = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dir = pumpMovement(now);
    drawWorld(now, dir);
    audioTick(now);
    heatTick(now);
    if (state.hudDirty && now - (state.hudAt || 0) > 200) { state.hudDirty = false; state.hudAt = now; refreshHud(); }
    adaptDpr(now);
  }
  // Phones: cap devicePixelRatio at 2, and drop to 1.5 if frames stay slow.
  function maxDpr() { return Math.min(window.devicePixelRatio || 1, state.dprCap || 2); }
  function adaptDpr(now) {
    if (!fx.fps || now - (state.dprCheckAt || 0) < 3000) return;
    state.dprCheckAt = now;
    if (fx.fps < 45 && (state.dprCap || 2) > 1.5 && (window.devicePixelRatio || 1) > 1.5) { state.dprCap = 1.5; resize(); }
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

  function rememberName(name) {
    if (!name) return;
    localStorage.setItem("nhl-name", name);
    if ($("name")) $("name").value = name;
    if (state.me) state.me.name = name;
    if ($("player-name")) $("player-name").textContent = name;
    if ($("profile-name")) $("profile-name").textContent = name;
  }

  function renameHintText(me) {
    if (!me) return "You can change your name once every 24 hours.";
    if (me.needsName) return "Your first name change is free because this character still uses a wallet label.";
    if (me.nextRenameAt && me.nextRenameAt > Date.now()) {
      const hours = Math.max(1, Math.ceil((me.nextRenameAt - Date.now()) / 3600000));
      return "You can change your name again in about " + hours + " hour" + (hours === 1 ? "" : "s") + ".";
    }
    return "You can change your name once every 24 hours.";
  }

  function showRenameError(id, text) {
    const el = $(id);
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
  }

  function openRenameBox() {
    const box = $("rename-box");
    if (!box) return;
    box.hidden = false;
    const input = $("rename-input");
    if (input) {
      input.value = (state.me && state.me.name) || "";
      input.focus();
      input.select();
    }
    const hint = $("rename-hint");
    if (hint) hint.textContent = renameHintText(state.me);
    showRenameError("rename-error", "");
  }

  function closeRenameBox() {
    const box = $("rename-box");
    if (box) box.hidden = true;
    showRenameError("rename-error", "");
  }

  function hideNamePrompt() {
    const el = $("name-prompt");
    if (el) el.hidden = true;
    showRenameError("name-prompt-error", "");
  }

  function maybeNamePrompt() {
    const me = state.me;
    if (!me || !me.needsName || state.namePrompted) return;
    state.namePrompted = true;
    const el = $("name-prompt");
    if (!el) return;
    el.hidden = false;
    const input = $("name-prompt-input");
    if (input) {
      input.value = "";
      input.focus();
    }
    showRenameError("name-prompt-error", "");
  }

  async function submitRename(name, errorId) {
    const trimmed = String(name || "").trim();
    const token = (state.me && state.me.token) || localStorage.getItem("nhl-token");
    if (!trimmed) {
      showRenameError(errorId, "Pick a name.");
      return false;
    }
    if (!token) {
      showRenameError(errorId, "Sign in first.");
      return false;
    }
    showRenameError(errorId, "");
    // Prefer the HTTP API so a rename still works if the socket blips; also notify via ws when connected.
    try {
      const r = await fetch("/api/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: trimmed }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showRenameError(errorId, j.error || "Couldn't change that name.");
        return false;
      }
      rememberName(j.name || trimmed);
      if (state.me) {
        state.me.needsName = false;
        if (j.nextRenameAt) state.me.nextRenameAt = j.nextRenameAt;
      }
      closeRenameBox();
      hideNamePrompt();
      refreshHud();
      return true;
    } catch {
      if (state.ws && state.ws.readyState === 1) {
        send({ type: "rename", name: trimmed });
        return true;
      }
      showRenameError(errorId, "Couldn't change that name.");
      return false;
    }
  }

  if ($("change-name-btn")) {
    $("change-name-btn").addEventListener("click", () => {
      const box = $("rename-box");
      if (box && !box.hidden) closeRenameBox();
      else openRenameBox();
    });
  }
  if ($("rename-save")) {
    $("rename-save").addEventListener("click", () => submitRename($("rename-input").value, "rename-error"));
  }
  if ($("rename-cancel")) $("rename-cancel").addEventListener("click", closeRenameBox);
  if ($("rename-input")) {
    $("rename-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitRename($("rename-input").value, "rename-error");
      }
      if (e.key === "Escape") closeRenameBox();
    });
  }
  if ($("name-prompt-save")) {
    $("name-prompt-save").addEventListener("click", () => submitRename($("name-prompt-input").value, "name-prompt-error"));
  }
  if ($("name-prompt-later")) $("name-prompt-later").addEventListener("click", hideNamePrompt);
  if ($("name-prompt-input")) {
    $("name-prompt-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitRename($("name-prompt-input").value, "name-prompt-error");
      }
    });
  }

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

  const nca = $("copy-nihala-ca");
  if (nca) nca.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(nca.textContent.trim()); toast("$nihala CA copied."); } catch { toast(nca.textContent.trim()); }
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

  if ($("zoom-in")) $("zoom-in").addEventListener("click", () => setZoom((state.zoom || 1) + 0.15));
  if ($("zoom-out")) $("zoom-out").addEventListener("click", () => setZoom((state.zoom || 1) - 0.15));
  if ($("panel-toggle")) {
    $("panel-toggle").addEventListener("click", () => {
      document.body.classList.toggle("panel-collapsed");
      $("panel-toggle").textContent = document.body.classList.contains("panel-collapsed") ? "Skills & items" : "Hide panel";
      resize();
    });
  }
  if ($("chat-toggle")) {
    $("chat-toggle").addEventListener("click", () => {
      const collapsed = document.body.classList.toggle("chat-collapsed");
      if (!collapsed) {
        state.chatUnread = 0;
        updateChatUnread();
        const log = $("chat-log");
        if (log) log.scrollTop = log.scrollHeight;
      }
    });
  }

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

  // ===================== Direct movement controls =====================
  // Keyboard (WASD / arrows) and the on-screen joystick send one-tile "step" intents.
  // The server validates walls, corners, zone gates and walk speed.
  const KEYDIR = {
    KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
  };
  const KEYALIAS = { w: "KeyW", a: "KeyA", s: "KeyS", d: "KeyD", W: "KeyW", A: "KeyA", S: "KeyS", D: "KeyD" };
  const held = new Set();
  const joy = { id: null, active: false, dx: 0, dy: 0 };
  const moveState = { lastSent: 0, lastDir: null, active: false };
  const STEP_SPEED = 4.2;

  function typingTarget(el) {
    return !!(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
  }
  function inGame() { return !!state.me && !$("game").hidden; }

  function focusChat() {
    if (document.body.classList.contains("chat-collapsed")) {
      document.body.classList.remove("chat-collapsed");
      state.chatUnread = 0;
      updateChatUnread();
    }
    const input = $("chat-input");
    if (input) input.focus();
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideContextMenu();
      if (typingTarget(document.activeElement)) { document.activeElement.blur(); return; }
      if (inGame()) send({ type: "stop" });
      return;
    }
    if (typingTarget(e.target) || !inGame()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!$("name-prompt").hidden) return;
    if (e.key === "Enter") { e.preventDefault(); focusChat(); return; }
    const code = KEYDIR[e.code] ? e.code : KEYALIAS[e.key];
    if (code && KEYDIR[code]) {
      e.preventDefault();
      held.add(code);
      return;
    }
    if ((e.code === "KeyM" || e.key === "m" || e.key === "M") && !e.repeat) { e.preventDefault(); toggleMute(); return; }
    if (e.code === "Space" || e.code === "KeyE" || e.key === "e" || e.key === "E") {
      e.preventDefault();
      if (!e.repeat) interactNearby();
    }
  });
  window.addEventListener("keyup", (e) => {
    held.delete(e.code);
    if (KEYALIAS[e.key]) held.delete(KEYALIAS[e.key]);
  });
  window.addEventListener("blur", () => held.clear());
  document.addEventListener("focusin", (e) => { if (typingTarget(e.target)) held.clear(); });

  function currentDir() {
    let dx = 0, dy = 0;
    for (const c of held) { const d = KEYDIR[c]; if (d) { dx += d[0]; dy += d[1]; } }
    dx = Math.sign(dx); dy = Math.sign(dy);
    if (!dx && !dy && joy.active) { dx = joy.dx; dy = joy.dy; }
    return [dx, dy];
  }
  function facingOf(dx, dy) {
    if (dx && Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
    if (dy) return dy > 0 ? "down" : "up";
    return null;
  }

  // Movement intents are sent from the prediction step (selfPos) exactly when the predicted
  // character needs its next tile, so the server's one-step buffer is always fed in time.
  const DIR = [0, 0];
  function pumpMovement(now) {
    if (!inGame()) { DIR[0] = 0; DIR[1] = 0; return DIR; }
    const [dx, dy] = currentDir();
    DIR[0] = dx; DIR[1] = dy;
    if (dx || dy) {
      state.facing = facingOf(dx, dy);
      state.facingUntil = now + 450;
    } else if (moveState.active) {
      moveState.active = false;
      moveState.lastDir = null;
    }
    return DIR;
  }
  function sendStep(dx, dy, now) {
    const key = dx + "," + dy;
    const blocked = PRED.tx === Math.round(PRED.x) && PRED.ty === Math.round(PRED.y) && PRED.qx == null;
    if (blocked && key === moveState.lastDir && now - moveState.lastSent < 300) return; // bumping a wall: don't spam
    send({ type: "step", dx, dy });
    PRED.ldx = dx; PRED.ldy = dy;
    if (!moveState.active) { hideContextMenu(); state.clickFx = null; }
    moveState.lastSent = now;
    moveState.lastDir = key;
    moveState.active = true;
  }

  function interactNearby() {
    if (!inGame()) return;
    if (chanceArmed(performance.now(), false)) { sendHit(); return; }
    const mx = Math.round(state.me.x), my = Math.round(state.me.y);
    const r = fx.meR;
    const facing = (state.facing && performance.now() < (state.facingUntil || 0) + 4000 ? state.facing : null) || (r && r.facing) || "down";
    const fv = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[facing] || [0, 1];
    const fxT = mx + fv[0], fyT = my + fv[1];
    let best = null, bestScore = 1e9;
    const consider = (id, tx, ty, base) => {
      const d = Math.max(Math.abs(tx - mx), Math.abs(ty - my));
      if (d > 1) return;
      let score = d + base;
      if (tx === fxT && ty === fyT) score -= 2;
      if (score < bestScore) { bestScore = score; best = id; }
    };
    for (const n of state.nodes) {
      const pen = n.depleted ? 1.5 : 0;
      consider(n.id, n.x, n.y, pen);
      if (n.rockX != null) consider(n.id, n.rockX, n.rockY, pen);
      if (n.type === "fish") { const w = fishWaterTile(n); if (w) consider(n.id, w.x, w.y, pen); }
    }
    for (const npc of state.npcs) consider(npc.id, npc.x, npc.y, 0);
    for (const m of state.mobs) if (m.alive) consider(m.id, Math.round(m.x), Math.round(m.y), -0.5);
    if (!best) { toast("Nothing to use here. Face a tree, rock, fishing spot or person and press E."); return; }
    hideContextMenu();
    send({ type: "interact", id: best });
  }

  // ----- on-screen joystick (phones) -----
  function touchControlsDefault() {
    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const fine = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
    return coarse || (("ontouchstart" in window) && !fine);
  }
  function touchControlsOn() {
    const pref = localStorage.getItem("nhl-touch");
    if (pref === "on") return true;
    if (pref === "off") return false;
    return touchControlsDefault();
  }
  function applyTouchControls() {
    const on = touchControlsOn();
    document.body.classList.toggle("touch-on", on);
    const tc = $("touch-controls");
    if (tc) tc.hidden = !on;
    const btn = $("controls-toggle");
    if (btn) { btn.classList.toggle("on", on); btn.title = on ? "Hide on-screen joystick" : "Show on-screen joystick"; btn.setAttribute("aria-pressed", on ? "true" : "false"); }
    if (!on) resetJoy();
  }
  function resetJoy() {
    joy.id = null; joy.active = false; joy.dx = 0; joy.dy = 0;
    const knob = $("joystick-knob");
    if (knob) knob.style.transform = "translate(-50%, -50%)";
    const base = $("joystick");
    if (base) base.classList.remove("held");
  }
  const JOY_DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  function updateJoy(e) {
    const base = $("joystick");
    const knob = $("joystick-knob");
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let vx = e.clientX - cx, vy = e.clientY - cy;
    const max = rect.width / 2 - 8;
    const mag = Math.hypot(vx, vy);
    if (mag > max) { vx = (vx / mag) * max; vy = (vy / mag) * max; }
    knob.style.transform = `translate(calc(-50% + ${vx}px), calc(-50% + ${vy}px))`;
    if (mag / max < 0.3) { joy.dx = 0; joy.dy = 0; return; }
    const oct = (Math.round(Math.atan2(vy, vx) / (Math.PI / 4)) + 8) % 8;
    joy.dx = JOY_DIRS[oct][0]; joy.dy = JOY_DIRS[oct][1];
  }
  (() => {
    const base = $("joystick");
    if (base) {
      base.addEventListener("pointerdown", (e) => {
        if (joy.id != null) return;
        e.preventDefault();
        joy.id = e.pointerId;
        joy.active = true;
        base.classList.add("held");
        try { base.setPointerCapture(e.pointerId); } catch {}
        updateJoy(e);
      });
      base.addEventListener("pointermove", (e) => { if (e.pointerId === joy.id) { e.preventDefault(); updateJoy(e); } });
      const end = (e) => { if (e.pointerId === joy.id) resetJoy(); };
      base.addEventListener("pointerup", end);
      base.addEventListener("pointercancel", end);
      base.addEventListener("lostpointercapture", end);
      base.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    const act = $("action-btn");
    if (act) {
      act.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        act.classList.add("held");
        interactNearby();
      });
      const up = () => act.classList.remove("held");
      act.addEventListener("pointerup", up);
      act.addEventListener("pointercancel", up);
      act.addEventListener("pointerleave", up);
      act.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    const tog = $("controls-toggle");
    if (tog) tog.addEventListener("click", () => {
      localStorage.setItem("nhl-touch", touchControlsOn() ? "off" : "on");
      applyTouchControls();
    });
    applyTouchControls();
  })();

  function showControlsHint() {
    const el = $("key-hint");
    if (!el) return;
    const touch = touchControlsOn();
    const flag = touch ? "nhl-hint-touch" : "nhl-hint-keys";
    if (localStorage.getItem(flag)) return;
    localStorage.setItem(flag, "1");
    el.textContent = touch ? "Drag the stick to move · tap Use to interact" : "WASD / arrows to move, E to interact";
    el.hidden = false;
    el.classList.add("show");
    clearTimeout(showControlsHint.timer);
    showControlsHint.timer = setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => { el.hidden = true; }, 400);
    }, 7000);
  }


  // ================= mini-games (server-timed windows) =================
  const MGC = { ch: null, streak: 0, result: null };
  function onChance(m) {
    const now = performance.now();
    MGC.ch = { id: m.id, kind: m.kind, t0: now, openAt: now + (m.in || 0), closeAt: now + (m.in || 0) + (m.win || 0), lead: m.lead || 0, node: m.node || state.actNode || null, period: m.period || 0, center: m.center || 0.5, perfect: m.perfect || 0.07, fine: m.fine || 0.17, done: false, cued: false };
    if (m.kind === "heat") showHeat(MGC.ch);
  }
  function chanceArmed(now, fromCanvas) {
    const c = MGC.ch;
    if (!c || c.done) return false;
    if (c.kind === "heat") return !fromCanvas && now < c.closeAt + 150;
    if (fromCanvas) return now >= c.openAt - (c.lead || 0) - 150 && now < c.closeAt + 250;
    return now < c.closeAt + 250;
  }
  function sendHit() {
    const c = MGC.ch;
    if (!c || c.done) return;
    c.done = true;
    c.tapAt = performance.now();
    if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: "hit", id: c.id }));
    const act = $("action-btn");
    if (act) { act.classList.add("held"); setTimeout(() => act.classList.remove("held"), 120); }
  }
  const GOOD_WORDS = { bite: "Great catch!", sparkle: "Weak point!", chop: "Clean chop!", heat: "Nice!" };
  function chanceTarget(c) {
    const n = c && c.node && state.nodes.find((x) => x.id === c.node);
    if (!n) return state.me ? { x: state.me.x, y: state.me.y } : null;
    if (n.type === "fish") { const w = fishWaterTile(n); if (w) return { x: w.x, y: w.y }; }
    if (n.rockX != null) return { x: n.rockX, y: n.rockY };
    return { x: n.x, y: n.y };
  }
  function burst(x, y, cols, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (0.6 + Math.random()) * (speed || 1.6);
      fx.particles.push({ kind: "spark", x: x + 0.5, y: y + 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2, g: 4, t: 0, life: 0.6 + Math.random() * 0.4, col: cols[i % cols.length], sz: 1 + Math.random() });
    }
  }
  function onChanceEnd(m) {
    const now = performance.now();
    const c = MGC.ch && MGC.ch.id === m.id ? MGC.ch : null;
    MGC.streak = m.streak | 0;
    state.hudDirty = true;
    if (c) c.done = true;
    if (m.cancelled) { hideHeat(); return; }
    const kind = m.kind || (c && c.kind);
    MGC.result = { ok: !!m.ok, quality: m.quality || null, kind, t: now, missed: !!m.missed };
    if (m.missed) return; // AFK players don't get nagged
    const tgt = chanceTarget(c);
    if (m.ok) {
      const perfect = m.quality === "perfect";
      sfx(perfect || kind !== "heat" ? "perfect" : "good", { streak: MGC.streak });
      const word = kind === "heat" ? (perfect ? "Perfect!" : "Fine!") : GOOD_WORDS[kind] || "Nice!";
      spawnFloat(word + (MGC.streak >= 2 ? " ×" + MGC.streak : ""), perfect ? "#ffe066" : "#bff0a0");
      if (tgt) { burst(tgt.x, tgt.y, perfect ? ["#ffe066", "#fff6c0", "#ffb347"] : ["#bff0a0", "#ffffff", "#7fd0ff"], perfect ? 22 : 14); fx.particles.push({ kind: "ring", x: tgt.x + 0.5, y: tgt.y + 0.6, t: 0, life: 0.6, col: perfect ? "#ffe066" : "#bff0a0" }); }
    } else {
      sfx("bad");
      spawnFloat(kind === "heat" ? "Off the mark" : kind === "chop" ? "Off beat" : "Too early", "#ffb0a0");
    }
    if (kind === "heat") { const hid = m.id; setTimeout(() => { if (!MGC.ch || MGC.ch.id === hid) hideHeat(); }, 450); }
  }
  // Heat bar (smithing / cooking): marker bounces; the gold zone is the server's sweet spot.
  function showHeat(c) {
    const el = $("heat-bar");
    if (!el) return;
    const fine = $("hb-fine"), perf = $("hb-perfect");
    fine.style.left = ((c.center - c.fine) * 100).toFixed(1) + "%"; fine.style.width = (c.fine * 200).toFixed(1) + "%";
    perf.style.left = ((c.center - c.perfect) * 100).toFixed(1) + "%"; perf.style.width = (c.perfect * 200).toFixed(1) + "%";
    $("hb-label").textContent = (touchControlsOn() ? "Tap Use" : "Press E") + " when the marker is in the gold";
    el.hidden = false;
    el.classList.remove("ok", "bad");
  }
  function hideHeat() { const el = $("heat-bar"); if (el) el.hidden = true; }
  function heatTick(now) {
    const c = MGC.ch;
    if (!c || c.kind !== "heat") return;
    const el = $("heat-bar");
    if (!el || el.hidden) return;
    if (!c.done && now > c.closeAt + 300) { hideHeat(); return; }
    const t = c.done && c.tapAt ? c.tapAt : now;
    const ph = Math.max(0, t - c.openAt) / c.period, f = ph % 2, pos = f <= 1 ? f : 2 - f;
    $("hb-marker").style.left = (pos * 100).toFixed(2) + "%";
    if (c.done && MGC.result && MGC.result.kind === "heat") el.classList.toggle("ok", MGC.result.ok), el.classList.toggle("bad", !MGC.result.ok);
  }
  (() => {
    const el = $("heat-bar");
    if (el) el.addEventListener("pointerdown", (e) => { e.preventDefault(); if (chanceArmed(performance.now(), false)) sendHit(); });
  })();
  function star(c, x, y, r, col) {
    c.fillStyle = col;
    c.beginPath();
    for (let j = 0; j < 8; j++) { const a = (j / 8) * Math.PI * 2, rr = j % 2 ? r * 0.28 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    c.closePath(); c.fill();
  }
  function tapHint(c, x, y, k, col) {
    const label = touchControlsOn() ? "TAP!" : "E!";
    const fs = Math.round(Math.max(16, 9 * k));
    const bob = Math.sin(performance.now() / 90) * k;
    c.font = `900 ${fs}px "Trebuchet MS", sans-serif`;
    c.textAlign = "center";
    const w = c.measureText(label).width + fs * 0.7;
    c.fillStyle = "rgba(30,16,8,.85)";
    c.fillRect(Math.round(x - w / 2), Math.round(y - fs * 0.95 + bob), Math.round(w), Math.round(fs * 1.25));
    c.strokeStyle = col || "#ffe066"; c.lineWidth = 2;
    c.strokeRect(Math.round(x - w / 2) + 0.5, Math.round(y - fs * 0.95 + bob) + 0.5, Math.round(w), Math.round(fs * 1.25));
    c.fillStyle = col || "#ffe066"; c.fillText(label, x, y + bob);
  }
  function drawChance(c, T, now) {
    const k = T / G.BT;
    const me = state.me;
    // idle bobber while fishing
    const fishing = me && me.action === "gather" && state.actNode && (state.nodes.find((n) => n.id === state.actNode) || {}).type === "fish";
    const ch = MGC.ch;
    if (fishing) {
      const n = state.nodes.find((x) => x.id === state.actNode);
      const w = n && fishWaterTile(n);
      if (w) {
        const bite = ch && ch.kind === "bite" && !ch.done && now >= ch.openAt && now <= ch.closeAt;
        const bx = (w.x + 0.5) * T, by = (w.y + 0.45) * T + (bite ? 3 * k : Math.sin(now / 300) * 1.2 * k);
        const mr = fx.meR || me;
        c.globalAlpha = 0.7; c.strokeStyle = "#f4f0e8"; c.lineWidth = Math.max(1, k * 0.4);
        c.beginPath(); c.moveTo((mr.x + 0.75) * T, (mr.y - 0.35) * T); c.quadraticCurveTo((mr.x + w.x) / 2 * T + T * 0.5, Math.min(mr.y, w.y) * T - 0.3 * T, bx, by - 2 * k); c.stroke();
        c.globalAlpha = 1;
        if (bite) {
          const p = (now - ch.openAt) / (ch.closeAt - ch.openAt);
          c.globalAlpha = 0.9 - p * 0.6; c.strokeStyle = "#ffffff"; c.lineWidth = Math.max(1, k * 0.8);
          for (let i = 0; i < 2; i++) { const rr = (0.2 + ((p * 2 + i * 0.5) % 1) * 0.5) * T; c.beginPath(); c.ellipse(bx, by + k, rr, rr * 0.45, 0, 0, Math.PI * 2); c.stroke(); }
          c.globalAlpha = 1;
          c.fillStyle = "#c8322a"; c.fillRect(Math.round(bx - 1.5 * k), Math.round(by), Math.ceil(3 * k), Math.ceil(1.5 * k));
          tapHint(c, bx, by - 10 * k, k);
          const mr2 = fx.meR || me;
          c.font = `900 ${Math.round(Math.max(18, 11 * k))}px "Trebuchet MS", sans-serif`; c.textAlign = "center";
          c.lineWidth = 4; c.strokeStyle = "#3a1008"; c.strokeText("!", (mr2.x + 0.5) * T, (mr2.y - 1.3) * T); c.fillStyle = "#ffe066"; c.fillText("!", (mr2.x + 0.5) * T, (mr2.y - 1.3) * T);
          if (!ch.cued) { ch.cued = true; sfx("bite"); }
        } else {
          c.fillStyle = "#c8322a"; c.fillRect(Math.round(bx - 1.5 * k), Math.round(by - 2 * k), Math.ceil(3 * k), Math.ceil(2 * k));
          c.fillStyle = "#f4f0e8"; c.fillRect(Math.round(bx - 1.5 * k), Math.round(by), Math.ceil(3 * k), Math.ceil(1.5 * k));
        }
      }
    }
    if (!ch || ch.done) return;
    if (ch.kind === "sparkle" && now >= ch.openAt && now <= ch.closeAt) {
      const tg = chanceTarget(ch);
      if (!tg) return;
      const p = (now - ch.openAt) / (ch.closeAt - ch.openAt);
      const ox = ((ch.id * 37) % 7 - 3) * 0.08, oy = ((ch.id * 53) % 5 - 2) * 0.06;
      const x = (tg.x + 0.5 + ox) * T, y = (tg.y + 0.35 + oy) * T;
      const pulse = 0.75 + 0.25 * Math.sin(now / 60);
      drawGlow(c, "spark", "255,230,120", false, x, y, 16 * k, 0.8 - p * 0.4);
      c.globalAlpha = 1 - p * 0.4;
      star(c, x, y, 11 * k * pulse, "#fff6c0");
      star(c, x, y, 5 * k * pulse, "#ffd040");
      c.globalAlpha = 1;
      tapHint(c, x, y - 14 * k, k);
      if (!ch.cued) { ch.cued = true; sfx("glint"); }
    } else if (ch.kind === "chop") {
      const tg = chanceTarget(ch);
      if (!tg) return;
      const start = ch.openAt - ch.lead, mid = (ch.openAt + ch.closeAt) / 2;
      if (now < start || now > ch.closeAt) return;
      const x = (tg.x + 0.5) * T, y = (tg.y + 0.35) * T;
      const target = 0.42 * T;
      const r = now < mid ? target + (1.7 * T - target) * ((mid - now) / (mid - start)) : target;
      const inWin = now >= ch.openAt;
      c.globalAlpha = 0.55; c.strokeStyle = "#fff6c0"; c.lineWidth = Math.max(1, k * 0.8);
      c.beginPath(); c.arc(x, y, target, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = 0.95; c.strokeStyle = inWin ? "#9cf07a" : "#ffffff"; c.lineWidth = Math.max(2, k * 1.4);
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = 1;
      if (inWin) { tapHint(c, x, y - target - 4 * k, k, "#9cf07a"); if (!ch.cued) { ch.cued = true; sfx("beat"); } }
    }
  }
  // depletion / respawn transitions (trees fall, rocks crumble, fish scatter)
  function nodeFlip(n, now) {
    let a = fx.nodeAnim.get(n.id);
    if (!a) { a = { dep: !!n.depleted, t: -1e9, x: n.x, y: n.y }; fx.nodeAnim.set(n.id, a); return a; }
    if (a.dep !== !!n.depleted) {
      a.dep = !!n.depleted; a.t = now;
      const tx = n.rockX != null ? n.rockX : n.x, ty = n.rockY != null ? n.rockY : n.y;
      const near = state.me && Math.hypot(tx - state.me.x, ty - state.me.y) < 10;
      if (n.depleted) {
        if (n.type === "ore") burst(tx, ty, ["#8a7f72", "#5a524a", "#b0a494"], 14, 1.2);
        else if (n.type === "tree" && near) sfx("timber", { x: tx, y: ty, other: n.id !== state.actNode });
        else if (n.type === "fish") { const w = fishWaterTile(n); if (w) fx.particles.push({ kind: "ring", x: w.x + 0.5, y: w.y + 0.5, t: 0, life: 0.8, col: "#dcf5ff" }); }
      } else if (near) {
        burst(tx, ty, n.type === "tree" ? ["#9cd070", "#d8f0a0"] : ["#fff6c0", "#ffe066"], 8, 0.9);
      }
    }
    return a;
  }
  function drawBoard(c, n, T, k, t) {
    const x = (n.x + 0.5) * T, y = (n.y + 0.95) * T;
    shadow(c, x, y - k, 0.5 * T, 0.12 * T, 0.25);
    c.fillStyle = "#5a3a1e"; c.fillRect(Math.round(x - 7 * k), Math.round(y - 15 * k), Math.ceil(2 * k), Math.round(15 * k)); c.fillRect(Math.round(x + 5 * k), Math.round(y - 15 * k), Math.ceil(2 * k), Math.round(15 * k));
    c.fillStyle = "#8a5a2e"; c.fillRect(Math.round(x - 9 * k), Math.round(y - 17 * k), Math.round(18 * k), Math.round(10 * k));
    c.fillStyle = "#b8322a"; c.fillRect(Math.round(x - 10 * k), Math.round(y - 19 * k), Math.round(20 * k), Math.round(3 * k));
    c.fillStyle = "#f4ead0"; c.fillRect(Math.round(x - 7 * k), Math.round(y - 15 * k), Math.round(4 * k), Math.round(5 * k)); c.fillRect(Math.round(x - 2 * k), Math.round(y - 16 * k), Math.round(4 * k), Math.round(6 * k)); c.fillRect(Math.round(x + 3 * k), Math.round(y - 15 * k), Math.round(4 * k), Math.round(5 * k));
    const d = state.me && state.me.daily;
    const left = d ? d.tasks.filter((x2) => !x2.done).length : 0;
    if (left) { const bob = Math.sin(t * 3) * k; c.fillStyle = "#ffe066"; c.fillRect(Math.round(x - k), Math.round(y - 26 * k + bob), Math.ceil(2 * k), Math.round(4 * k)); c.fillRect(Math.round(x - k), Math.round(y - 21 * k + bob), Math.ceil(2 * k), Math.ceil(2 * k)); }
  }
  function renderDaily(me) {
    const box = $("daily-list");
    if (!box) return;
    const d = me.daily;
    if (!d || !d.tasks) { box.innerHTML = ""; return; }
    const rows = d.tasks.map((t) => {
      const pct = Math.round((Math.min(t.goal, t.prog) / t.goal) * 100);
      const xp = Object.entries(t.xp || {}).map(([k2, v]) => `${v} ${k2} xp`).join(", ");
      return `<div class="daily${t.done ? " done" : ""}"><div class="row"><span>${t.done ? "✔ " : ""}${esc(t.label)}</span><span class="fine">${Math.min(t.goal, t.prog)}/${t.goal}</span></div><div class="bar"><i style="width:${pct}%"></i></div><div class="fine">Reward: ${t.gold} gold${xp ? ", " + esc(xp) : ""}</div></div>`;
    }).join("");
    box.innerHTML = `<h3>Daily tasks <span class="fine">(new ones at 00:00 UTC · board by Old Maneki)</span></h3>${rows}<p class="fine">Best timing combo: ${me.bestStreak | 0}. Timing mini-games are optional — AFK gathering still works.</p>`;
  }

  // ================= sound wiring =================
  const AU = () => window.NHLAudio || null;
  function sfx(name, o) { const a = AU(); if (a) a.play(name, o || {}); }
  function toggleMute() { const a = AU(); if (!a) return; a.unlock(); const m = a.toggleMute(); toast(m ? "Sound muted (press M to unmute)" : "Sound on"); }
  function invTotal(me) { let n = 0; for (const it of (me && me.inventory) || []) n += it.qty || 1; return n; }
  function questsDone(me) { let n = 0; for (const v of Object.values((me && me.quests) || {})) if (v && v.done) n++; return n; }
  function noteInteract(id) {
    state.actNode = state.nodes.some((n) => n.id === id) ? id : state.actNode;
    if (state.npcs.some((n) => n.id === id)) state.npcTalkAt = performance.now();
    state.actStart = performance.now();
  }
  function onFx(m) {
    const now = performance.now();
    if (m.kind === "gather") {
      state.lastGatherSfx = now;
      const s2 = m.skill;
      if (s2 === "fishing") sfx("catch"); else if (s2 === "mining") sfx(m.shower ? "shower" : "clink"); else if (s2 === "woodcutting") sfx(m.shower ? "timber" : "chop"); else sfx("pop");
      if (m.rare) { sfx("sparkle"); burst(m.x, m.y - 0.3, ["#fff6c0", "#ffe066", "#a8f0ff"], 18, 1.4); }
      if (m.shower && m.skill === "mining") { const n = state.nodes.find((x) => x.id === m.node); const tx = n && n.rockX != null ? n.rockX : m.x, ty = n && n.rockY != null ? n.rockY : m.y; for (let i = 0; i < 12; i++) fx.particles.push({ kind: "spark", x: tx + Math.random(), y: ty - 1.5 - Math.random(), vx: (Math.random() - 0.5) * 0.6, vy: 0.5, g: 6, t: 0, life: 0.9, col: i % 2 ? "#8a7f72" : "#c8bca8", sz: 2 }); }
      if (!m.good) burst(m.x, m.y - 0.2, s2 === "fishing" ? ["#dcf5ff", "#a8d8f0"] : s2 === "woodcutting" ? ["#c8a060", "#8a6a3a"] : s2 === "mining" ? ["#a09382", "#72675b"] : ["#ff8ab8", "#ffd6e8"], 6, 0.9);
    } else if (m.kind === "craft") {
      if (m.quality === "burnt") { sfx("burnt"); burst(state.me.x, state.me.y - 0.6, ["#3a3430", "#6a625a"], 10, 0.8); spawnFloat("Burnt!", "#ffb0a0"); }
      else { sfx(m.verb === "smith" ? "anvil" : m.verb === "smelt" ? "whoosh" : "pop"); if (m.quality === "perfect" || m.quality === "fine") burst(state.me.x, state.me.y - 0.6, ["#ffe066", "#fff6c0"], 12, 1.1); }
    } else if (m.kind === "death") {
      sfx("death");
      MGC.ch = null; MGC.streak = 0; hideHeat();
    } else if (m.kind === "achv") {
      showAchv(m);
    } else if (m.kind === "task") {
      sfx("quest");
      burst(state.me.x, state.me.y - 0.8, ["#ffe066", "#ff8ab8", "#9cf07a", "#7fd0ff"], 26, 1.8);
      showFanfare("Daily task complete!");
    }
  }
  const SURF = { dock: "wood", plank: "wood", bridge: "wood", sand: "sand", stone: "stone", quarry: "stone", floor: "wood", rug: "wood", shrine: "stone" };
  const AUD = { lastTile: -1, tick: 0, nextAct: 0, others: new Map(), actKind: null };
  const ACT_SFX = { mining: ["clink", 900], woodcutting: ["chop", 950], yarn: ["step", 1100], cook: ["sizzle", 1100], smelt: ["whoosh", 1500], smith: ["anvil", 1000] };
  function audioTick(now) {
    const a = AU();
    if (!a || !state.me || !inGame()) return;
    const mr = fx.meR || state.me;
    // own footsteps on tile change
    const tile = Math.round(mr.y) * 4096 + Math.round(mr.x);
    if (tile !== AUD.lastTile) {
      if (AUD.lastTile >= 0 && !state.me.action) a.play("step", { surface: SURF[G.T(Math.round(mr.x), Math.round(mr.y))] || "grass", vol: 0.7 });
      AUD.lastTile = tile;
    }
    // action loops (mine / chop / cook / smelt / smith); fishing casts once when it starts
    const act = state.me.action;
    let key = null;
    if (act === "gather") { const n = state.nodes.find((x) => x.id === state.actNode); key = n ? n.skill : null; }
    else if (act === "cook" || act === "smelt" || act === "smith") key = act;
    if (key !== AUD.actKind) { AUD.actKind = key; AUD.nextAct = now + 250; if (key === "fishing") a.play("cast"); }
    if (key && ACT_SFX[key] && now >= AUD.nextAct) { AUD.nextAct = now + ACT_SFX[key][1]; a.play(ACT_SFX[key][0], { vol: key === "yarn" ? 0.5 : 0.75, surface: "sand" }); }
    if (now - AUD.tick < 250) return;
    AUD.tick = now;
    // others nearby: quieter footsteps and work sounds
    for (const p of state.players) {
      if (p.id === state.me.id) continue;
      const r = entityR(p.id) || p;
      const d = Math.hypot(r.x - mr.x, r.y - mr.y);
      let o = AUD.others.get(p.id);
      if (!o) { o = { x: r.x, y: r.y, next: 0 }; AUD.others.set(p.id, o); }
      if (d < 10) {
        if (Math.abs(r.x - o.x) + Math.abs(r.y - o.y) > 0.8) a.play("step", { x: r.x, y: r.y, other: true, src: p.id });
        if (p.action && now > o.next) {
          o.next = now + 1100;
          const n = state.nodes.find((x) => Math.abs(x.x - r.x) <= 1.5 && Math.abs(x.y - r.y) <= 1.5);
          const sk = p.action === "gather" ? (n && n.skill) : p.action;
          if (sk && ACT_SFX[sk]) a.play(ACT_SFX[sk][0], { x: r.x, y: r.y, other: true, src: p.id });
          else if (p.action === "combat") a.play("hit", { x: r.x, y: r.y, other: true, src: p.id });
        }
      }
      o.x = r.x; o.y = r.y;
    }
    if (AUD.others.size > state.players.length + 20) { const ids = new Set(state.players.map((p) => p.id)); for (const id of AUD.others.keys()) if (!ids.has(id)) AUD.others.delete(id); }
    // ambience by zone: water nearby, birds by day in green zones, crickets at night
    const h = G.hourNow(fx.todOverride);
    const night = G.darknessAt(h);
    let water = 0;
    const cx = Math.round(mr.x), cy = Math.round(mr.y);
    for (let dy = -6; dy <= 6; dy += 2) for (let dx = -6; dx <= 6; dx += 2) if (G.isWater(G.T(cx + dx, cy + dy))) water++;
    const z = G.zoneIdAt(cx, cy);
    const t0 = G.T(cx, cy);
    a.update({ x: mr.x, y: mr.y, night, water: Math.min(1, water / 12), indoors: t0 === "floor" || t0 === "rug", green: z === "mine" || z === "quarry" || z === "tunnel" ? 0.15 : 1 });
  }
  // speaker button + settings popover
  (() => {
    const btn = $("sound-btn"), gear = $("sound-settings"), pop = $("sound-pop");
    const mus = $("vol-music"), eff = $("vol-sfx"), mute = $("sound-mute");
    const sync = () => {
      const a = AU();
      if (!a) return;
      const st = a.settings();
      if (btn) { btn.classList.toggle("muted", st.muted); btn.setAttribute("aria-pressed", st.muted ? "true" : "false"); btn.title = st.muted ? "Unmute (M)" : "Mute (M)"; btn.setAttribute("aria-label", st.muted ? "Unmute sound" : "Mute sound"); }
      if (mus && document.activeElement !== mus) mus.value = Math.round(st.music * 100);
      if (eff && document.activeElement !== eff) eff.value = Math.round(st.sfx * 100);
      if ($("vol-music-v")) $("vol-music-v").textContent = Math.round(st.music * 100) + "%";
      if ($("vol-sfx-v")) $("vol-sfx-v").textContent = Math.round(st.sfx * 100) + "%";
      if (mute) mute.textContent = st.muted ? "Unmute" : "Mute all";
    };
    const a = AU();
    if (a) a.onChange(sync);
    sync();
    if (btn) btn.addEventListener("click", (e) => { e.stopPropagation(); const au = AU(); if (au) { au.unlock(); au.toggleMute(); } });
    if (gear && pop) gear.addEventListener("click", (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; if (!pop.hidden) { const zc = $("zoom-controls"), host = pop.offsetParent; if (zc && host) { const zr = zc.getBoundingClientRect(), hr = host.getBoundingClientRect(); pop.style.left = Math.round(zr.right - hr.left + 8) + "px"; } } gear.setAttribute("aria-expanded", pop.hidden ? "false" : "true"); const au = AU(); if (au) au.unlock(); sync(); });
    if (mute) mute.addEventListener("click", () => { const au = AU(); if (au) au.toggleMute(); });
    if (mus) mus.addEventListener("input", () => { const au = AU(); if (au) au.set({ music: mus.value / 100, muted: false }); });
    if (eff) eff.addEventListener("input", () => { const au = AU(); if (au) { au.set({ sfx: eff.value / 100, muted: false }); au.play("pop"); } });
    document.addEventListener("pointerdown", (e) => { if (pop && !pop.hidden && !pop.contains(e.target) && e.target !== gear && !(gear && gear.contains(e.target))) { pop.hidden = true; if (gear) gear.setAttribute("aria-expanded", "false"); } });
    // UI click / tab sounds
    document.addEventListener("click", (e) => {
      const b = e.target && e.target.closest && e.target.closest("button, .slot");
      if (!b || b.id === "sound-btn" || b.id === "action-btn") return;
      sfx(b.closest(".tabs") ? "tab" : "click");
    }, true);
  })();


  // ================= progression UI: first-visit guide, journal, collection log, achievements, share =================
  const PG = { npcMetAt: 0, gStep: 0, gDone: true, gInit: false, from: null, metFrom: 0, logKey: "", jKey: "", ev: null, evAt: 0, evTimer: null };
  const STORY_PLACES = ["Ni Hao Village", "Fish Pond", "Woods & Bamboo Grove", "Mine & Quarry", "Lantern Harbor", "Shrine Plains", "Inner Shrine"];
  const FISH_IDS = ["raw_minnow", "raw_fish", "raw_koi", "raw_golden_koi", "raw_moon_koi", "raw_lucky_koi"];
  function prog() { return (state.me && state.me.progress) || null; }
  function touchOn() { return document.body.classList.contains("touch-on"); }
  function welcomeProgress(msg) {
    state.story = msg.story || [];
    state.collection = msg.collection || [];
    state.collMilestones = msg.collMilestones || [];
    state.eventTiers = msg.eventTiers || [];
    PG.logKey = ""; PG.jKey = "";
    const p = prog();
    PG.gInit = true;
    PG.gDone = !p || !!p.guide.done;
    PG.gStep = p ? Math.min(GUIDE.length - 1, p.guide.step | 0) : 0;
    refreshTabs();
    setTimeout(guideSync, 600);
  }
  function rewardText(r) {
    const bits = [];
    if (r.gold) bits.push(r.gold + " gold");
    for (const [k2, v] of Object.entries(r.xp || {})) bits.push(v + " " + k2 + " xp");
    if (r.item) bits.push(itemName(r.item));
    if (r.title) bits.push("title “" + r.title + "”");
    return bits.join(" · ");
  }
  // --- first-visit guide (5 short tips, skippable, stored per character on the server)
  const GUIDE = [
    { t: "Ni hao, friend!", b: () => "Welcome to Ni Hao Lands: a free, unofficial fan game for the $mihao community. Nothing here costs money and nothing here is financial advice. Five quick tips?", next: "Show me" },
    { t: "Walk around", b: () => touchOn() ? "Drag the joystick (bottom left) to walk, or tap the ground where you want to go." : "Walk with WASD or the arrow keys, or click the ground where you want to go.", auto: "move" },
    { t: "Say 你好", b: () => (touchOn() ? "Stand next to something and tap Use, or tap it directly" : "Stand next to something and press E or Space, or click it") + ". Old Maneki, the cat with the gold ! near the square, has your first story chapter.", auto: "npc" },
    { t: "Catch a fish", b: () => "Walk to the Fish Pond (west of the village, see the map) and tap a fishing spot. When the float dips, " + (touchOn() ? "tap Use" : "press E / Space") + " for a bonus. Waiting works too.", auto: "fish" },
    { t: "Make it yours", b: () => "The Quests tab holds your story Journal, daily tasks, visit streak and this week's village event. The Log tab tracks everything you find. The $nihala tab has optional holder perks and a holder shop (unlock by holding, nothing is spent); the whole game is free. Have fun!", next: "Let's play", last: true },
  ];
  function guideSync() {
    const el = $("guide");
    if (!el || !PG.gInit || !state.me) return;
    if (PG.gDone) { if (!el.hidden) hideGuide(); return; }
    if (el.hidden || +el.dataset.step !== PG.gStep) renderGuide(PG.gStep);
  }
  function hideGuide() {
    const el = $("guide");
    el.hidden = true;
    document.body.classList.remove("guide-on");
  }
  function renderGuide(i) {
    const el = $("guide"), g = GUIDE[i];
    if (!el || !g) return;
    PG.gStep = i;
    el.dataset.step = String(i);
    $("guide-step").textContent = `Tip ${i + 1} of ${GUIDE.length}`;
    $("guide-title").textContent = g.t;
    $("guide-body").textContent = g.b();
    $("guide-next").textContent = g.next || "Next tip";
    $("guide-skip").textContent = g.last ? "Close" : "Skip guide";
    $("guide-dots").innerHTML = GUIDE.map((_, j) => `<i class="${j === i ? "on" : j < i ? "done" : ""}"></i>`).join("");
    el.hidden = false;
    document.body.classList.add("guide-on");
    const mr = fx.meR || state.me;
    PG.from = mr ? { x: mr.x, y: mr.y } : null;
    PG.metFrom = PG.npcMetAt;
    requestAnimationFrame(() => { const st = el.offsetParent; if (st) st.style.setProperty("--guide-h", el.offsetHeight + "px"); });
  }
  function guideAdvance() {
    if (PG.gDone) return;
    if (PG.gStep >= GUIDE.length - 1) return guideFinish();
    PG.gStep += 1;
    send({ type: "guide", op: "step", step: PG.gStep });
    renderGuide(PG.gStep);
    sfx("pop");
  }
  function guideFinish(skipped) {
    PG.gDone = true;
    send({ type: "guide", op: "done" });
    hideGuide();
    if (skipped) toast("Guide hidden. Replay it any time from the settings button.");
  }
  function guideReplay() {
    PG.gDone = false; PG.gStep = 0;
    send({ type: "guide", op: "reset" });
    renderGuide(0);
  }
  function guideTick() {
    if (PG.gDone || !state.me) return;
    const el = $("guide");
    if (!el || el.hidden) return;
    const g = GUIDE[PG.gStep];
    const mr = fx.meR || state.me;
    if (!g || !g.auto) return;
    if (g.auto === "move" && PG.from && Math.hypot(mr.x - PG.from.x, mr.y - PG.from.y) >= 3) guideAdvance();
    else if (g.auto === "npc" && PG.npcMetAt > PG.metFrom) guideAdvance();
    else if (g.auto === "fish") { const p = prog(); if (p && FISH_IDS.some((id) => (p.coll[id] || 0) > 0)) guideAdvance(); }
  }
  setInterval(guideTick, 400);
  (() => {
    const nx = $("guide-next"), sk = $("guide-skip");
    if (nx) nx.addEventListener("click", (e) => { e.stopPropagation(); guideAdvance(); });
    if (sk) sk.addEventListener("click", (e) => { e.stopPropagation(); if (PG.gStep >= GUIDE.length - 1) guideFinish(); else guideFinish(true); });
    const gd = $("guide");
    if (gd) ["pointerdown", "touchstart", "mousedown"].forEach((ev) => gd.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));
  })();
  // --- achievement toasts (feed the collection log, story, streak, event)
  function showAchv(m) {
    const box = $("toasts");
    if (!box) return;
    const d = document.createElement("div");
    d.className = "achv";
    d.innerHTML = `<span class="achv-ico" aria-hidden="true"></span><span class="achv-txt"><strong>${esc(m.title || "")}</strong>${m.sub ? `<small>${esc(m.sub)}</small>` : ""}</span>`;
    box.appendChild(d);
    const all = box.querySelectorAll(".achv");
    if (all.length > 3) all[0].remove();
    setTimeout(() => d.classList.add("out"), 3800);
    setTimeout(() => d.remove(), 4200);
    sfx(/Chapter|Collection \d|points/.test(m.title || "") ? "quest" : "sparkle");
    if (state.me) burst(state.me.x, state.me.y - 0.8, ["#ffe066", "#fff6c0", "#ff8ab8"], 14, 1.2);
  }
  // --- story quest markers on NPCs
  function storyMarkFor(npc) {
    const p = prog();
    if (!p || !state.story || p.story.ch >= state.story.length) return null;
    const defs = state.story[p.story.ch].objectives, live = p.story.objectives || [];
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      if (d.type !== "talk" || d.npc !== npc.id) continue;
      if (d.final) return live.filter((o) => !o.final).every((o) => o.done) ? "!" : null;
      if (!(live[i] && live[i].done)) return "!";
    }
    return null;
  }
  // --- nameplate titles
  function drawTagTitle(c, tag, y) {
    const f = tag.flags;
    const t = f && f.title;
    if (!t || f.npc || f.mob) return;
    c.save();
    c.font = "bold 9px \"Trebuchet MS\", sans-serif";
    c.textAlign = "center";
    c.lineWidth = 3;
    c.strokeStyle = "rgba(24,14,8,.85)";
    c.fillStyle = "#f0c96a";
    const s2 = "« " + t + " »";
    c.strokeText(s2, Math.round(tag.sx), Math.round(y - 11));
    c.fillText(s2, Math.round(tag.sx), Math.round(y - 11));
    c.restore();
  }
  // --- journal (story chapters, visit streak, weekly event, titles)
  function renderJournal() {
    const p = prog();
    const sb = $("story-box"), rb = $("return-box");
    if (!p || !sb || !rb) return;
    const key = JSON.stringify([p.story, p.login, p.event, p.titles, p.title, (state.story || []).length, PG.evAt]);
    if (key === PG.jKey) return;
    PG.jKey = key;
    const story = state.story || [];
    const ch = p.story.ch;
    let h = `<h3 class="jr-h">Lantern Festival <span class="fine">${Math.min(ch, story.length)}/${story.length} chapters</span></h3>`;
    if (ch < story.length) {
      const c = story[ch];
      const objs = p.story.objectives || [];
      h += `<div class="chapter"><p class="eyebrow">Chapter ${c.n} · ${esc(STORY_PLACES[ch] || c.zone || "")}</p><h4>${esc(c.name)}</h4><p class="fine">${esc(c.intro)}</p><ul class="objs">` +
        objs.map((o) => `<li class="${o.done ? "done" : ""}${o.final ? " final" : ""}"><span>${o.done ? "✔" : o.final ? "➜" : "○"} ${esc(o.label)}</span>${o.goal > 1 ? `<span class="fine">${Math.min(o.prog, o.goal)}/${o.goal}</span>` : ""}</li>`).join("") +
        `</ul><p class="fine reward">Reward: ${esc(rewardText(c.reward))}</p></div>`;
      if (story[ch + 1]) h += `<p class="fine ch-next">Next up: Chapter ${story[ch + 1].n} · ${esc(story[ch + 1].name)}</p>`;
    } else {
      h += `<div class="chapter all-done"><h4>The festival is lit!</h4><p class="fine">Every chapter is finished. Thank you, friend.</p></div>`;
    }
    if (ch > 0) h += `<p class="fine ch-done">Finished: ${story.slice(0, ch).map((c) => "✔ " + esc(c.name)).join(" · ")}</p>`;
    if (p.titles && p.titles.length) h += `<label class="title-pick">Title shown above your name <select id="title-pick"><option value="">(none)</option>${p.titles.map((t) => `<option value="${esc(t)}"${t === p.title ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
    sb.innerHTML = h;
    const sel = $("title-pick");
    if (sel) sel.addEventListener("change", () => send({ type: "setTitle", title: sel.value }));
    const L = p.login, E = p.event, tiers = state.eventTiers || [];
    const top = tiers.length ? tiers[tiers.length - 1].pts : 1;
    const nextTier = tiers.find((t) => E.score < t.pts);
    rb.innerHTML = `<div class="streak-card"><div class="streak-num" aria-hidden="true">${L.streak | 0}</div><div><strong>Day ${L.streak | 0} visit streak</strong><p class="fine">Next visit: +${L.next.gold} gold${L.next.item ? " and a River Pearl" : ""}. A skipped day won't break it. Best: ${L.best | 0} day${(L.best | 0) === 1 ? "" : "s"}.</p></div></div>
      <div class="event-card"><p class="eyebrow">This week in the village</p><h4>${esc(E.name)}</h4><p class="fine">${esc(E.desc)}</p>
      <div class="row"><span>Your points: <b>${E.score | 0}</b></span><span class="fine">${nextTier ? "next reward at " + nextTier.pts : "all rewards earned!"}</span></div>
      <div class="bar"><i style="width:${Math.min(100, ((E.score | 0) / top) * 100)}%"></i></div>
      <div class="tiers">${tiers.map((t, i) => `<span class="${(E.claimed || []).includes(i) ? "on" : ""}">${t.pts} pts · ${t.gold}g${t.title ? " · " + esc(t.title) : ""}</span>`).join("")}</div>
      <div class="event-top">${eventTopHtml()}</div><p class="fine">New event every Monday 00:00 Helsinki time. Rewards are in-game only.</p></div>`;
  }
  function eventTopHtml() {
    const ev = PG.ev;
    if (!ev) return `<p class="fine">Loading this week's top players…</p>`;
    if (!ev.top.length) return `<p class="fine">No points yet this week. Be the first!</p>`;
    const meName = state.me && state.me.name;
    return `<ol class="ev-list">${ev.top.map((r) => `<li class="${r.name === meName ? "me" : ""}"><span>${r.rank}. ${esc(r.name)}</span><b>${r.score}</b></li>`).join("")}</ol>` + (ev.you && ev.you.rank > ev.top.length ? `<p class="fine">You: #${ev.you.rank} (${ev.you.score})</p>` : "");
  }
  async function loadEventBoard() {
    try {
      const tok = localStorage.getItem("nhl-token") || "";
      const r = await fetch("/api/event" + (tok ? "?viewer=" + encodeURIComponent(tok) : ""), { cache: "no-store" });
      if (!r.ok) return;
      PG.ev = await r.json();
      PG.evAt = Date.now();
      renderJournal();
    } catch {}
  }
  // --- collection log
  function renderLog() {
    const box = $("tab-log"), p = prog();
    if (!box || !p) return;
    const key = JSON.stringify(p.coll) + "|" + p.collPct + "|" + (state.collection || []).length;
    if (key === PG.logKey) return;
    PG.logKey = key;
    const miles = state.collMilestones || [];
    let h = `<div class="log-head"><div class="row"><strong>Collection log</strong><span class="fine">${p.collHave}/${p.collTotal} found · ${p.collPct}%</span></div><div class="bar"><i style="width:${p.collPct}%"></i></div><div class="log-miles">${miles.map((c) => `<span class="${p.collPct >= c.pct ? "on" : ""}">${c.pct}% · ${c.gold}g${c.title ? " · " + esc(c.title) : ""}</span>`).join("")}</div></div>`;
    for (const g of state.collection || []) {
      const base = g.items.filter((it) => !it.holder);
      const have = base.filter((it) => (p.coll[it.id] || 0) > 0).length;
      h += `<section class="log-group"><h3>${esc(g.name)} <span class="fine">${have}/${base.length}</span></h3><p class="fine">${esc(g.hint)}</p><div class="log-grid">`;
      for (const it of g.items) {
        const n = p.coll[it.id] || 0;
        const def = state.items[it.id] || {};
        const info = n ? `${def.name || it.id}: ${def.desc || ""} (found ${n})` : `Not found yet.${it.holder ? " A $nihala holder bonus find." : " " + g.hint}`;
        h += `<button type="button" class="log-cell${n ? " got" : ""}${it.holder ? " holder" : ""}" data-info="${esc(info)}" aria-label="${esc(n ? def.name || it.id : "Undiscovered")}"><img class="px-icon" src="${G.iconURL("item", it.id)}" alt="">${n ? `<span class="qty">${n > 999 ? "999+" : n}</span>` : ""}<span class="log-name">${n ? esc(def.name || it.id) : "???"}</span>${it.holder ? `<span class="log-tag">holder</span>` : ""}</button>`;
      }
      h += `</div></section>`;
    }
    h += `<p class="fine">Holder finds are a bonus and don't count toward 100%. Everything else comes from normal play.</p>`;
    box.innerHTML = h;
  }
  (() => {
    const lg = $("tab-log");
    if (lg) lg.addEventListener("click", (e) => { const c = e.target.closest && e.target.closest(".log-cell"); if (c) showExamine(c.dataset.info || "", { pin: true }); });
  })();
  // load the event board while the Quests tab is open
  const _openTab = openTab;
  openTab = function (id) {
    _openTab(id);
    clearInterval(PG.evTimer);
    if (id === "quests") { if (Date.now() - PG.evAt > 20000) loadEventBoard(); PG.evTimer = setInterval(loadEventBoard, 60000); }
  };
  // settings popover extras: replay guide, copy share link
  (() => {
    const rp = $("guide-replay"), sh = $("share-link"), pop = $("sound-pop");
    if (rp) rp.addEventListener("click", () => { if (pop) pop.hidden = true; guideReplay(); });
    if (sh) sh.addEventListener("click", async () => {
      const url = location.origin + "/";
      let ok = false;
      try { await navigator.clipboard.writeText(url); ok = true; } catch {}
      if (!ok) { try { const ta = document.createElement("textarea"); ta.value = url; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); ok = document.execCommand("copy"); ta.remove(); } catch {} }
      toast(ok ? "Link copied: " + url + " — share it wherever you like." : "Copy this link: " + url);
    });
  })();

  window.__nhl = {
    send,
    getState: () => state,
    setZoom,
    interactNearby,
    setTime: (h) => { fx.todOverride = h == null ? null : ((Number(h) % 24) + 24) % 24; },
    getFps: () => ({ fps: fx.fps, frameMs: Math.round(fx.frameMs * 100) / 100 }),
    getFx: () => fx,
    setTouchControls: (on) => { localStorage.setItem("nhl-touch", on ? "on" : "off"); applyTouchControls(); },
    getChance: () => ({ ch: MGC.ch, streak: MGC.streak, result: MGC.result }),
    sendHit,
    audio: () => window.NHLAudio || null,
    guide: () => ({ step: PG.gStep, done: PG.gDone, visible: !$("guide").hidden }),
    openTab: (id) => openTab(id),
    loadEventBoard,
  };

  bootLogin().then(() => {
    requestAnimationFrame(loop);
    applyMobileChrome();
  });
})();
