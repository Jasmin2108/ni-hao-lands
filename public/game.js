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
        state.quests = msg.quests || [];
        state.smeltRecipes = msg.smeltRecipes || [];
        state.smithRecipes = msg.smithRecipes || [];
        maybeNamePrompt();
        applyMobileChrome();
        applyTouchControls();
        showControlsHint();
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
        rememberName(state.me && state.me.name);
        refreshHud();
        refreshTabs();
        break;
      case "stepReject":
        if (msg.facing) { state.facing = msg.facing; state.facingUntil = performance.now() + 600; }
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
      case "levelup":
        showFanfare((msg.name || msg.skill) + " level " + msg.level + "!");
        break;
      case "zone":
        showZoneBanner(msg.zone && msg.zone.name);
        break;
    }
  }

  function refreshHud() {
    const me = state.me;
    if (!me) return;
    $("player-name").textContent = me.name || "";
    const pn = $("profile-name");
    if (pn) pn.textContent = me.name || "";
    $("gold").textContent = (me.gold | 0) + " gold";
    $("hp").textContent = me.hp | 0;
    $("holder-badge").hidden = !me.holder;
    const wb = $("connect-wallet");
    if (wb) wb.textContent = me.wallet ? "Refresh holder check" : "Sign in / link Solana wallet";
    const al = $("action-label");
    if (me.action) {
      al.hidden = false;
      const actionLabel = { gather: "Working…", cook: "Cooking…", smelt: "Smelting…", smith: "Smithing…", combat: "Fighting…" };
      al.textContent = actionLabel[me.action] || "Busy…";
    } else al.hidden = true;
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
      d.innerHTML = `<div class="row"><span>${def.icon || ""} ${esc(def.name)}</span><span>lvl ${info.level}</span></div>
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
      b.innerHTML = `${esc(def.name || it.id)}<span class="qty">${it.qty > 1 ? it.qty : ""}</span>`;
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
    const T = tilePx();
    const viewW = canvas.clientWidth || 800;
    const viewH = canvas.clientHeight || 600;
    const px = state.me.x * T + T / 2;
    const py = state.me.y * T + T / 2;
    state.camX = Math.max(0, Math.min(Math.max(0, W * T - viewW), px - viewW / 2));
    state.camY = Math.max(0, Math.min(Math.max(0, H * T - viewH), py - viewH / 2));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewW + 2, viewH + 2);
    ctx.save();
    ctx.translate(-state.camX, -state.camY);

    const x0 = Math.max(0, Math.floor(state.camX / T) - 1);
    const y0 = Math.max(0, Math.floor(state.camY / T) - 1);
    const x1 = Math.min(W - 1, Math.ceil((state.camX + viewW) / T) + 1);
    const y1 = Math.min(H - 1, Math.ceil((state.camY + viewH) / T) + 1);

    const t = now / 1000;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const kind = tiles[y][x];
        const sx = x * T, sy = y * T;
        drawTile(ctx, kind, sx, sy, hash(x, y), t, x, y, T);
      }
    }

    // resource markers
    for (const n of state.nodes) {
      const sx = n.x * T, sy = n.y * T;
      if (n.type === "yarn") drawBush(ctx, sx, sy, n.depleted, T);
      if (n.type === "fish") drawRipple(ctx, sx, sy, t, n.depleted, T);
      if (n.type === "ore") drawOreMark(ctx, sx, sy, n.depleted, T);
      if (n.type === "tree") drawChopMark(ctx, sx, sy, n.depleted, T);
      if (n.type === "range") drawRange(ctx, sx, sy, t, T);
      if (n.type === "furnace") drawFurnace(ctx, sx, sy, t, T);
      if (n.type === "anvil") drawAnvil(ctx, sx, sy, T);
    }

    const tags = [];
    for (const npc of state.npcs) drawActor(ctx, npc.x, npc.y, npc.avatar, npc.name, { npc: true }, now, T, tags);
    for (const mob of state.mobs) {
      if (!mob.alive) continue;
      drawDog(ctx, mob.x, mob.y, mob, now, T, tags);
    }
    const others = state.players.filter((p) => !state.me || p.id !== state.me.id);
    for (const p of others) drawActor(ctx, p.x, p.y, p.avatar, p.name, { holder: p.holder, action: p.action, combatLevel: p.combatLevel }, now, T, tags);
    if (state.me) drawActor(ctx, state.me.x, state.me.y, state.me.avatar, state.me.name, { self: true, holder: state.me.holder, action: state.me.action, combatLevel: state.me.combatLevel }, now, T, tags);
    drawNametags(ctx, tags, T);

    if (state.clickFx && now - state.clickFx.t < 500) {
      const a = 1 - (now - state.clickFx.t) / 500;
      ctx.strokeStyle = `rgba(255,230,120,${a})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(state.clickFx.x * T + 4, state.clickFx.y * T + 4, T - 8, T - 8);
    }
    if (state.hover) {
      ctx.strokeStyle = "rgba(255,255,255,.25)";
      ctx.strokeRect(state.hover.tx * T, state.hover.ty * T, T, T);
    }

    ctx.restore();
    drawMinimap();
  }

  function drawTile(c, kind, sx, sy, h, t, x, y, T = TILE) {
    const v = (h % 18) - 9;
    const mid = T / 2;
    if (kind === "water" || kind === "deepwater") {
      const wave = Math.sin(t * 2 + x * 0.4 + y * 0.3) * 8;
      const deep = kind === "deepwater";
      c.fillStyle = deep
        ? `rgb(${30 + wave / 2}, ${70 + wave}, ${110 + wave / 2})`
        : `rgb(${54 + wave}, ${110 + wave}, ${140 + wave / 2})`;
      c.fillRect(sx, sy, T, T);
      c.fillStyle = "rgba(200,230,255,.15)";
      c.fillRect(sx, sy + (h % T), T, 2);
      return;
    }
    if (kind === "stone" || kind === "quarry") {
      c.fillStyle = kind === "quarry" ? `rgb(${64 + v},${80 + v},${70 + v})` : `rgb(${70 + v},${68 + v},${72 + v})`;
      c.fillRect(sx, sy, T, T); stoneNoise(c, sx, sy, h); return;
    }
    if (kind === "wall") { c.fillStyle = "#4a3a32"; c.fillRect(sx, sy, T, T); c.fillStyle = "#2f2620"; c.fillRect(sx, sy, T, 4); c.fillRect(sx, sy, 3, T); return; }
    if (kind === "ore" || kind === "tinore" || kind === "ironore" || kind === "jadeore") {
      c.fillStyle = "#5a5550"; c.fillRect(sx, sy, T, T);
      c.fillStyle = kind === "jadeore" ? "#4caf70" : kind === "ironore" ? "#8a8a96" : kind === "tinore" ? "#c0c4c8" : "#c4843a";
      c.beginPath(); c.arc(sx + mid, sy + mid, T * 0.25, 0, 6.3); c.fill(); return;
    }
    if (kind === "floor") { c.fillStyle = "#7a5a38"; c.fillRect(sx, sy, T, T); c.strokeStyle = "rgba(40,20,8,.3)"; c.strokeRect(sx, sy, T, T / 2); return; }
    if (kind === "rug") { c.fillStyle = "#7a5a38"; c.fillRect(sx, sy, T, T); c.fillStyle = "#a32018"; c.fillRect(sx + 4, sy + 4, T - 8, T - 8); c.strokeStyle = "#d4a017"; c.strokeRect(sx + 6, sy + 6, T - 12, T - 12); return; }
    if (kind === "path" || kind === "bridge" || kind === "plank") { c.fillStyle = `rgb(${168 + v},${140 + v},${90 + v})`; c.fillRect(sx, sy, T, T); return; }
    if (kind === "dock" || kind === "sand") { c.fillStyle = `rgb(${194 + v},${170 + v},${110 + v})`; c.fillRect(sx, sy, T, T); return; }
    if (kind === "shrine") { c.fillStyle = `rgb(${80 + v},${90 + v},${70 + v})`; c.fillRect(sx, sy, T, T); c.fillStyle = "rgba(243,207,106,.2)"; c.fillRect(sx, sy, T, T); return; }
    if (kind === "lantern") {
      c.fillStyle = `rgb(${194 + v},${170 + v},${110 + v})`; c.fillRect(sx, sy, T, T);
      c.fillStyle = "#d44a3a"; c.fillRect(sx + T * 0.35, sy + T * 0.15, T * 0.3, T * 0.45);
      c.fillStyle = "#f3cf6a"; c.beginPath(); c.arc(sx + mid, sy + T * 0.28, T * 0.12, 0, 6.3); c.fill();
      return;
    }
    if (kind === "tree" || kind === "pine" || kind === "cherry" || kind === "bamboo") {
      c.fillStyle = `rgb(${58 + v},${110 + v},${48 + v})`;
      c.fillRect(sx, sy, T, T);
      if (kind === "bamboo") {
        c.fillStyle = "#7cb342";
        c.fillRect(sx + mid - 3, sy + 4, 6, T - 8);
        c.fillStyle = "#558b2f";
        c.fillRect(sx + mid - 8, sy + 8, 6, T * 0.4);
        return;
      }
      c.fillStyle = kind === "cherry" ? "#d46a8a" : kind === "pine" ? "#2e5a28" : "#3d6a2e";
      c.beginPath(); c.arc(sx + mid, sy + T * 0.4, T * 0.4, 0, 6.3); c.fill();
      c.fillStyle = "#6a4428";
      c.fillRect(sx + mid - T * 0.1, sy + T * 0.65, T * 0.2, T * 0.3);
      return;
    }
    if (kind === "flower") {
      c.fillStyle = `rgb(${70 + v},${120 + v},${52 + v})`;
      c.fillRect(sx, sy, T, T);
      c.fillStyle = (h % 2) ? "#d44a3a" : "#f2d66b";
      c.beginPath(); c.arc(sx + T * 0.3, sy + T * 0.35, 3, 0, 6.3); c.fill();
      c.beginPath(); c.arc(sx + T * 0.65, sy + T * 0.55, 3, 0, 6.3); c.fill();
      return;
    }
    c.fillStyle = `rgb(${62 + v},${118 + v},${50 + v})`;
    c.fillRect(sx, sy, T, T);
    c.fillStyle = "rgba(255,255,255,.04)";
    c.fillRect(sx, sy, T, 1);
  }

  function stoneNoise(c, sx, sy, h) {
    c.fillStyle = "rgba(255,255,255,.06)";
    c.fillRect(sx + (h % 10), sy + (h % 13), 6, 3);
  }

  function drawBush(c, sx, sy, depleted, T = TILE) {
    c.fillStyle = depleted ? "#6a6a4a" : "#c45a8a";
    c.beginPath(); c.arc(sx + T * 0.5, sy + T * 0.55, T * (depleted ? 0.18 : 0.28), 0, 6.3); c.fill();
    if (!depleted) {
      c.fillStyle = "#f2d6de";
      c.beginPath(); c.arc(sx + T * 0.4, sy + T * 0.45, 3, 0, 6.3); c.fill();
    }
  }
  function drawRipple(c, sx, sy, t, depleted, T = TILE) {
    if (depleted) return;
    c.strokeStyle = "rgba(255,240,180,.7)";
    c.beginPath();
    c.arc(sx + T * 0.5, sy + T * 0.5, T * 0.15 + (t * 3 % 6), 0, 6.3);
    c.stroke();
  }
  function drawOreMark(c, sx, sy, depleted, T = TILE) {
    c.fillStyle = depleted ? "#888" : "#f0c050";
    c.fillRect(sx + T * 0.4, sy + T * 0.2, T * 0.2, T * 0.15);
  }
  function drawChopMark(c, sx, sy, depleted, T = TILE) {
    if (depleted) return;
    c.strokeStyle = "#fff3a0";
    c.beginPath();
    c.moveTo(sx + T * 0.25, sy + T * 0.7);
    c.lineTo(sx + T * 0.75, sy + T * 0.4);
    c.stroke();
  }
  function drawRange(c, sx, sy, t, T = TILE) {
    c.fillStyle = "#333";
    c.fillRect(sx + T * 0.2, sy + T * 0.35, T * 0.6, T * 0.45);
    c.fillStyle = `rgb(240,${120 + Math.sin(t * 8) * 40},40)`;
    c.fillRect(sx + T * 0.35, sy + T * 0.2, T * 0.3, T * 0.25);
  }
  function drawFurnace(c, sx, sy, t, T = TILE) {
    c.fillStyle = "#3a3a40";
    c.fillRect(sx + T * 0.15, sy + T * 0.25, T * 0.7, T * 0.6);
    c.fillStyle = `rgb(255,${100 + Math.sin(t * 6) * 40},30)`;
    c.fillRect(sx + T * 0.3, sy + T * 0.45, T * 0.4, T * 0.28);
  }
  function drawAnvil(c, sx, sy, T = TILE) {
    c.fillStyle = "#6a6a70";
    c.fillRect(sx + T * 0.15, sy + T * 0.35, T * 0.7, T * 0.18);
    c.fillRect(sx + T * 0.35, sy + T * 0.5, T * 0.3, T * 0.3);
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

  function drawActor(c, x, y, avatar, name, flags, now, T = TILE, tags) {
    const sx = x * T + T / 2;
    const bob = flags.action ? Math.sin(now / 80) * 1.5 : Math.sin(now / 250 + x) * 0.6;
    const sy = y * T + T / 2 + bob;
    const r = Math.max(10, T * 0.4);
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
    if (tags) {
      const label = name + (flags.combatLevel ? "  (lvl " + flags.combatLevel + ")" : "");
      tags.push({ sx, sy: sy - r - 4, name: label, flags, self: !!flags.self, npc: !!flags.npc });
    }
  }

  function drawNametags(c, tags, T) {
    if (!tags || !tags.length || !state.me) return;
    const maxDist = isMobileLayout() ? 7 : 10;
    const visible = [];
    for (const tag of tags) {
      const dx = tag.sx / T - 0.5 - state.me.x;
      const dy = tag.sy / T + 0.2 - state.me.y;
      if (!tag.self && !tag.npc && Math.hypot(dx, dy) > maxDist) continue;
      visible.push(tag);
    }
    visible.sort((a, b) => a.sy - b.sy || a.sx - b.sx);
    const used = [];
    const seen = [];
    for (const tag of visible) {
      if (seen.some((u) => u.name === tag.name && Math.abs(u.sx - tag.sx) < 10 && Math.abs(u.sy - tag.sy) < 10)) continue;
      seen.push(tag);
      let y = tag.sy;
      let guard = 0;
      while (guard++ < 8 && used.some((u) => Math.abs(u.sx - tag.sx) < 80 && Math.abs(u.sy - y) < 13)) {
        y -= 13;
      }
      used.push({ sx: tag.sx, sy: y });
      c.font = "bold 11px sans-serif";
      c.textAlign = "center";
      c.lineWidth = 3;
      c.strokeStyle = "rgba(0,0,0,.7)";
      c.fillStyle = tag.flags.holder ? "#ffe9a0" : tag.flags.npc ? "#f3cf6a" : "#fff";
      c.strokeText(tag.name, tag.sx, y);
      c.fillText(tag.name, tag.sx, y);
    }
  }

  function drawDog(c, x, y, mob, now, T = TILE, tags) {
    const sx = x * T + T / 2;
    const sy = y * T + T / 2;
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
    if (tags) tags.push({ sx, sy: sy - 22, name: (mob.name || "Rival Dog") + (mob.level ? "  (lvl " + mob.level + ")" : ""), flags: {}, self: false, npc: false });
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
          k === "water" || k === "deepwater" ? "#3a6e90" :
          k === "wall" || k === "ore" || k === "tinore" || k === "ironore" || k === "jadeore" || k === "stone" || k === "quarry" ? "#555" :
          k === "tree" || k === "pine" || k === "bamboo" || k === "cherry" ? "#2e5a28" :
          k === "path" || k === "dock" || k === "sand" || k === "bridge" || k === "plank" || k === "shrine" ? "#c2a46a" :
          k === "floor" || k === "rug" ? "#8a5a30" :
          "#4a8a40";
        mctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
      }
    }
    mctx.fillStyle = "rgba(255,246,216,.85)";
    mctx.font = "8px sans-serif";
    mctx.textAlign = "center";
    const labels = [
      { name: "Village", x: 32, y: 28 },
      { name: "Pond", x: 8, y: 29 },
      { name: "Mine", x: 33, y: 8 },
      { name: "Forest", x: 55, y: 30 },
      { name: "Harbor", x: 14, y: 70 },
      { name: "Bamboo", x: 48, y: 72 },
      { name: "Quarry", x: 95, y: 14 },
      { name: "Shrine", x: 108, y: 50 },
    ];
    for (const z of labels) {
      mctx.fillText(z.name, z.x * sx, z.y * sy);
    }
    for (const p of state.players) {
      mctx.fillStyle = state.me && p.id === state.me.id ? "#fff36a" : "#fff";
      mctx.fillRect(p.x * sx - 1, p.y * sy - 1, 3, 3);
    }
  }

  let raf = 0;
  function loop(now) {
    pumpMovement(now);
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

  function pumpMovement(now) {
    if (!inGame()) return;
    const [dx, dy] = currentDir();
    if (!dx && !dy) {
      if (moveState.active) {
        send({ type: "step", dx: 0, dy: 0 });
        moveState.active = false;
        moveState.lastDir = null;
      }
      return;
    }
    const key = dx + "," + dy;
    const interval = ((dx && dy ? 1.414 : 1) / STEP_SPEED) * 1000 * 0.8;
    const changed = key !== moveState.lastDir;
    if ((changed && now - moveState.lastSent > 75) || now - moveState.lastSent > interval) {
      send({ type: "step", dx, dy });
      if (!moveState.active) { hideContextMenu(); state.clickFx = null; }
      moveState.lastSent = now;
      moveState.lastDir = key;
      moveState.active = true;
    }
    state.facing = facingOf(dx, dy);
    state.facingUntil = now + 450;
  }

  function fishWaterTile(n) {
    const tl = state.world && state.world.tiles;
    if (!tl) return null;
    let best = null, bd = 99;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const row = tl[n.y + dy];
      const k = row && row[n.x + dx];
      if (k === "water" || k === "deepwater") { const d = Math.abs(dx) + Math.abs(dy); if (d < bd) { bd = d; best = { x: n.x + dx, y: n.y + dy }; } }
    }
    return best;
  }

  function interactNearby() {
    if (!inGame()) return;
    const mx = Math.round(state.me.x), my = Math.round(state.me.y);
    const mine = state.players.find((p) => p.id === state.me.id);
    const facing = (state.facing && performance.now() < (state.facingUntil || 0) + 4000 ? state.facing : null) || (mine && mine.facing) || "down";
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

  window.__nhl = {
    send,
    getState: () => state,
    setZoom,
    interactNearby,
    setTouchControls: (on) => { localStorage.setItem("nhl-touch", on ? "on" : "off"); applyTouchControls(); },
  };

  bootLogin().then(() => {
    requestAnimationFrame(loop);
    applyMobileChrome();
  });
})();
