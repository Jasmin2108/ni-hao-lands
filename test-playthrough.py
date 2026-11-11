# Headless end-to-end playthrough (no test hooks, safe on live): desktop + phone.
# guest sign-in + picture upload, walk, chat, rename, quests, shop, fish (+timing mini-game), cook, mine, smelt, smith,
# chop, yarn, fight, bank, leaderboard, daily board, sound controls. Usage: python3 test-playthrough.py BASE [desktop|phone|both]
import sys, time, json, zlib, struct, os, tempfile
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]; MODE = sys.argv[2] if len(sys.argv) > 2 else "both"
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
results = []
def ok(c, m):
    results.append((bool(c), m)); print(("ok - " if c else "FAIL - ") + m, flush=True)
    return c
def png(path, w=64, h=64):
    rows = b"".join(b"\x00" + b"".join(bytes([(x * 4) % 256, (y * 4) % 256, 160]) for x in range(w)) for y in range(h))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))
JS_HELPERS = """
window.__pt = {
  me: () => window.__nhl.getState().me,
  inv: (id) => { const me = window.__nhl.getState().me; return (me.inventory || []).filter(e => e.id === id || e.id.startsWith(id + '_')).reduce((t, e) => t + (e.qty || 1), 0); },
  send: (m) => window.__nhl.send(m),
};
"""
def inv(pg, item): return pg.evaluate("id => window.__pt.inv(id)", item)
def me(pg): return pg.evaluate("() => { const m = window.__pt.me(); return { x: m.x, y: m.y, hp: m.hp, gold: m.gold, name: m.name, action: m.action, quests: m.quests || {}, avatar: m.avatar, bank: m.bank || {} }; }")
def send(pg, m): pg.evaluate("m => window.__pt.send(m)", m)
def wait(pg, fn, timeout=30, step=0.25):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if fn(): return True
        except Exception: pass
        time.sleep(step)
    return False
def gather(pg, node_id, item, n=1, timeout=45, play_timing=False):
    before = inv(pg, item)
    send(pg, {"type": "interact", "id": node_id})
    hits = []
    def done():
        if play_timing:
            r = pg.evaluate("""() => { const c = window.__nhl.getChance().ch; const now = performance.now(); if (c && !c.done && c.kind !== 'heat' && now >= c.openAt + (c.closeAt - c.openAt) * 0.35) { window.__nhl.sendHit(); return c.id; } return null; }""")
            if r: hits.append(r)
        return inv(pg, item) >= before + n
    got = wait(pg, done, timeout, 0.03 if play_timing else 0.25)
    return got, hits
WS_LOG = """(() => { const O = WebSocket; window.__sent = []; window.__toasts = [];
  const W = function (u, p) { const w = new O(u, p); const s = w.send.bind(w);
    w.send = (d) => { try { const m = JSON.parse(d); if (m.type !== 'pong' && m.type !== 'step') window.__sent.push(m.type + ':' + (m.id || m.op || '')); } catch (e) {} return s(d); };
    w.addEventListener('message', (e) => { try { const m = JSON.parse(e.data); if (m.type === 'toast') window.__toasts.push(m.text); } catch (_) {} }); return w; };
  W.prototype = O.prototype; Object.assign(W, O); window.WebSocket = W; })()"""
def recent(pg): return pg.evaluate("({toasts: window.__toasts.slice(-8), sent: window.__sent.slice(-8)})")
def login(pg, name, upload=None):
    pg.add_init_script(WS_LOG)
    pg.goto(BASE + "/?tod=12"); pg.wait_for_selector("#avatar-grid button")
    if upload: pg.set_input_files("#upload-avatar-input", upload); time.sleep(0.5)
    pg.fill("#name", name)
    if not upload: pg.locator("#avatar-grid button").nth(3).click()
    pg.click("#enter"); pg.wait_for_selector("#game:not([hidden])", timeout=20000); time.sleep(1.5)
    pg.evaluate(JS_HELPERS)
    pg.evaluate("void(document.getElementById('key-hint') && (document.getElementById('key-hint').hidden = true))")

def desktop(br):
    ctx = br.new_context(viewport={"width": 1280, "height": 800}); pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and "favicon" not in m.text and errs.append(m.text))
    pic = os.path.join(tempfile.gettempdir(), "nhl-pt.png"); png(pic)
    name = "Pt" + str(int(time.time() * 1000))[-7:]
    login(pg, name, upload=pic)
    ok(me(pg)["name"] == name, "guest sign-in")
    ok(wait(pg, lambda: str(me(pg)["avatar"]).startswith("u:"), 10), "custom picture upload is used in the world")
    p0 = me(pg); pg.mouse.click(300, 300); pg.keyboard.down("ArrowDown"); time.sleep(0.9); pg.keyboard.up("ArrowDown"); time.sleep(0.6)
    p1 = me(pg); ok(abs(p1["y"] - p0["y"]) >= 1, f"keyboard walk ({p0['y']} -> {p1['y']})")
    msg = "hello from playthrough " + name[-4:]
    pg.fill("#chat-input", msg); pg.press("#chat-input", "Enter")
    ok(wait(pg, lambda: msg in pg.inner_text("#chat-log"), 8), "chat message appears")
    new = name[:-1] + "R"
    pg.click("#change-name-btn"); pg.fill("#rename-input", new); pg.click("#rename-save")
    renamed = wait(pg, lambda: me(pg)["name"] == new, 8)
    ok(renamed, f"rename ({me(pg)['name']}; hint: {pg.inner_text('#rename-hint')[:80]} {pg.inner_text('#rename-error')[:80]})")
    send(pg, {"type": "interact", "id": "npc-chef"}); wait(pg, lambda: (me(pg)["quests"].get("chef_catch") or {}).get("step", 0) >= 1, 25)
    send(pg, {"type": "interact", "id": "npc-chef"})
    ok(wait(pg, lambda: (me(pg)["quests"].get("chef_catch") or {}).get("done"), 15), "chef quest completes (2 cooked carp)")
    send(pg, {"type": "interact", "id": "npc-merchant"})
    ok(wait(pg, lambda: pg.is_visible("#tab-shop"), 25), "merchant opens the shop")
    send(pg, {"type": "shopBuy", "itemId": "bronze_pickaxe"}); time.sleep(0.3); send(pg, {"type": "shopBuy", "itemId": "bronze_axe"})
    ok(wait(pg, lambda: inv(pg, "bronze_pickaxe") >= 1 and inv(pg, "bronze_axe") >= 1, 8), "bought bronze pickaxe + axe")
    got, hits = gather(pg, "n1", "raw_fish", 2, 60, play_timing=True)
    ok(got, f"fishing catches carp ({inv(pg, 'raw_fish')})")
    res = pg.evaluate("window.__nhl.getChance()")
    ok(len(hits) == 0 or res["result"] is not None, f"timing taps judged by the server (taps {len(hits)}, last {res['result']}, combo {res['streak']})")
    c0 = inv(pg, "cooked_fish") + inv(pg, "burnt_fish")
    rng = pg.evaluate("(() => { const n = window.__nhl.getState().nodes.find(n => n.type === 'range'); return n ? n.id : null; })()")
    ok(rng is not None, "range node known")
    if rng:
        send(pg, {"type": "interact", "id": rng})
        ok(wait(pg, lambda: inv(pg, "cooked_fish") + inv(pg, "burnt_fish") > c0, 40), "cooking at the range")
    ok(gather(pg, "n32", "ore", 1, 60)[0], "mining copper")
    ok(gather(pg, "n38", "tin_ore", 1, 60)[0], "mining tin")
    send(pg, {"type": "move", "x": 39, "y": 34}); wait(pg, lambda: abs(me(pg)["x"] - 39) + abs(me(pg)["y"] - 34) < 2, 30)
    fur = pg.evaluate("(() => { const s = window.__nhl.getState(); return { f: (s.nodes.find(n => n.type === 'furnace') || {}).id, a: (s.nodes.find(n => n.type === 'anvil') || {}).id }; })()")
    send(pg, {"type": "interact", "id": fur["f"], "recipe": "bronze"})
    ok(wait(pg, lambda: inv(pg, "bronze_bar") >= 1, 30), "smelting a bronze bar")
    send(pg, {"type": "interact", "id": fur["a"], "product": "bronze_sword"})
    ok(wait(pg, lambda: inv(pg, "bronze_sword") >= 1, 30), "smithing a bronze sword")
    sw = pg.evaluate("(() => (window.__pt.me().inventory.find(e => e.id.startsWith('bronze_sword')) || {}).id)()")
    if sw: send(pg, {"type": "equip", "itemId": sw})
    ok(gather(pg, "n62", "bamboo", 1, 80)[0], "chopping bamboo")
    send(pg, {"type": "interact", "id": "npc-greeter"})
    ok(wait(pg, lambda: (me(pg)["quests"].get("maneki_yarn") or {}).get("step", 0) >= 1, 40), "Old Maneki quest started")
    ok(gather(pg, "n13", "yarn", 3, 120)[0] or gather(pg, "n14", "yarn", 3, 90)[0], f"gathered yarn ({inv(pg, 'yarn')})")
    send(pg, {"type": "interact", "id": "npc-greeter"})
    ok(wait(pg, lambda: (me(pg)["quests"].get("maneki_yarn") or {}).get("done"), 45), "Old Maneki quest complete")
    t0 = inv(pg, "rat_tail")
    send(pg, {"type": "interact", "id": "rat-1"})
    killed = wait(pg, lambda: inv(pg, "rat_tail") > t0, 90)
    if not killed:
        send(pg, {"type": "interact", "id": "rat-2"}); killed = wait(pg, lambda: inv(pg, "rat_tail") > t0, 60)
    ok(killed, f"defeated a temple rat (hp {me(pg)['hp']}) {'' if killed else recent(pg)}")
    send(pg, {"type": "interact", "id": "npc-banker"})
    ok(wait(pg, lambda: pg.is_visible("#tab-bank"), 60), "banker opens the bank")
    send(pg, {"type": "bank", "op": "deposit", "itemId": "rat_tail", "qty": 1})
    ok(wait(pg, lambda: (me(pg)["bank"].get("rat_tail") or 0) >= 1, 8), "deposited a rat tail")
    pg.click(".tabs button[data-tab='ranks']")
    ok(wait(pg, lambda: len(pg.inner_text("#ranks-list").strip()) > 20, 12), "leaderboard loads")
    board = pg.evaluate("(() => { const n = window.__nhl.getState().nodes.find(n => n.type === 'board'); return n ? n.id : 'n109'; })()")
    send(pg, {"type": "interact", "id": board})
    ok(wait(pg, lambda: pg.is_visible("#daily-list") and "Daily tasks" in pg.inner_text("#daily-list"), 40), "daily tasks board opens the task list")
    pg.click("#sound-settings"); ok(pg.is_visible("#sound-pop"), "sound popover opens")
    ok(not errs, f"desktop: no JS errors {errs[:3]}")
    ctx.close()

def phone(br):
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and "favicon" not in m.text and errs.append(m.text))
    name = "Ph" + str(int(time.time() * 1000))[-7:]
    login(pg, name)
    ok(pg.is_visible("#joystick") and pg.is_visible("#action-btn") and pg.is_visible("#sound-btn"), "phone: joystick, Use and speaker visible")
    p0 = me(pg)
    jb = pg.locator("#joystick").bounding_box(); cx, cy = jb["x"] + jb["width"] / 2, jb["y"] + jb["height"] / 2
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx + 40, cy, steps=4); time.sleep(1.0); pg.mouse.up(); time.sleep(0.5)
    p1 = me(pg); ok(abs(p1["x"] - p0["x"]) >= 1, f"phone: joystick walk ({p0['x']} -> {p1['x']})")
    cb = pg.locator("#game canvas").first.bounding_box()
    p0 = me(pg); pg.touchscreen.tap(cb["x"] + cb["width"] / 2 + 70, cb["y"] + cb["height"] / 2 - 40); time.sleep(2.0)
    p1 = me(pg); ok(abs(p1["x"] - p0["x"]) + abs(p1["y"] - p0["y"]) >= 1, f"phone: tap-to-walk ({p0['x']},{p0['y']} -> {p1['x']},{p1['y']})")
    send(pg, {"type": "interact", "id": "n2"})
    wait(pg, lambda: me(pg)["action"] == "gather", 40)
    st = {"tapped": False, "res": None}
    def use_tap():
        c = pg.evaluate("(() => { const c = window.__nhl.getChance().ch; const now = performance.now(); return !!(c && !c.done && c.kind === 'bite' && now >= c.openAt + 120 && now <= c.closeAt - 120); })()")
        if c and not st["tapped"]:
            pg.locator("#action-btn").dispatch_event("pointerdown"); st["tapped"] = True
        if st["tapped"]:
            st["res"] = pg.evaluate("window.__nhl.getChance().result")
            return st["res"] is not None
        return False
    wait(pg, use_tap, 40, 0.03)
    ok(st["tapped"] and st["res"] and st["res"].get("ok"), f"phone: Use button lands the bite window ({st['res']})")
    pg.click("#sound-settings"); ok(pg.is_visible("#sound-pop"), "phone: sound popover opens")
    pg.click("#sound-btn"); ok(pg.evaluate("window.NHLAudio.settings().muted"), "phone: speaker button mutes")
    pg.click("#sound-btn")
    if pg.is_visible("#chat-toggle"): pg.click("#chat-toggle")
    pg.fill("#chat-input", "phone hello " + name[-3:]); pg.press("#chat-input", "Enter")
    ok(wait(pg, lambda: ("phone hello " + name[-3:]) in pg.inner_text("#chat-log"), 8), "phone: chat works")
    ok(not errs, f"phone: no JS errors {errs[:3]}")
    ctx.close()

with sync_playwright() as p:
    br = p.chromium.launch(headless=True, executable_path=CHROME, args=["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    if MODE in ("both", "desktop"): desktop(br)
    if MODE in ("both", "phone"): phone(br)
    br.close()
fails = [m for c, m in results if not c]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
if fails: print("FAILED:", json.dumps(fails, indent=1)); sys.exit(1)
print("PLAYTHROUGH PASSED")
