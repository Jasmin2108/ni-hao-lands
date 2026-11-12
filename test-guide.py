# First-visit guide + new panels in a real browser (needs a local server with NHL_TEST_HOOKS=1).
# Walks through all 5 tips on desktop (keyboard) and phone (joystick), checks Skip/Show guide, the Log and
# Journal panels, and that nothing overlaps the phone controls. Usage: python3 test-guide.py BASE
import sys, time, os
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]
res = []
def ok(c, m): res.append(bool(c)); print(("ok - " if c else "FAIL - ") + m, flush=True)
def wait(fn, t=10):
    t0 = time.time()
    while time.time() - t0 < t:
        try:
            if fn(): return True
        except Exception: pass
        time.sleep(0.2)
    return False
def guide(pg): return pg.evaluate("() => window.__nhl.guide()")
def send(pg, m): pg.evaluate("m => window.__nhl.send(m)", m)
def overlap(a, b): return a and b and not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])
def rect(pg, sel): return pg.evaluate("s => { const e = document.querySelector(s); if (!e || e.hidden || e.offsetParent === null) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }", sel)
def run(br, kind, vp):
    phone = kind.startswith("phone")
    ctx = br.new_context(viewport=vp, is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "/?tod=12"); pg.wait_for_selector("#avatar-grid button")
    pg.fill("#name", ("Gp" if phone else "Gd") + str(int(time.time() * 1000))[-8:]); pg.locator("#avatar-grid button").nth(1).click(); pg.click("#enter")
    pg.wait_for_selector("#game:not([hidden])"); time.sleep(1.2)
    ok(wait(lambda: guide(pg)["visible"], 5) and guide(pg)["step"] == 0, f"[{kind}] guide shows for a brand-new character")
    ok("unofficial" in pg.inner_text("#guide-body") and "financial advice" in pg.inner_text("#guide-body"), f"[{kind}] welcome tip carries the fan-game disclaimer")
    pg.click("#guide-next"); time.sleep(0.3)
    body = pg.inner_text("#guide-body")
    ok(("joystick" in body) if phone else ("WASD" in body), f"[{kind}] move tip matches the device ({body[:40]}…)")
    if phone:
        for sel in ["#joystick", "#action-btn", ".tabs", "#zoom-controls"]:
            ok(not overlap(rect(pg, "#guide"), rect(pg, sel)), f"[{kind}] guide card doesn't cover {sel}")
        j = rect(pg, "#joystick"); cx, cy = (j[0] + j[2]) / 2, (j[1] + j[3]) / 2
        pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx, cy + 50, steps=5); time.sleep(2.2); pg.mouse.up()
    else:
        pg.keyboard.down("s"); time.sleep(1.6); pg.keyboard.up("s")
    ok(wait(lambda: guide(pg)["step"] == 2, 4), f"[{kind}] walking a few steps advances the guide")
    send(pg, {"type": "interact", "id": "npc-greeter"})
    ok(wait(lambda: guide(pg)["step"] == 3, 15), f"[{kind}] talking to Old Maneki advances the guide")
    send(pg, {"type": "__test", "op": "give", "item": "raw_fish", "qty": 1})
    ok(wait(lambda: guide(pg)["step"] == 4, 4), f"[{kind}] first fish advances the guide")
    pg.click("#guide-next"); time.sleep(0.4)
    ok(guide(pg)["done"] and not guide(pg)["visible"], f"[{kind}] last tip closes the guide")
    pg.reload(); pg.wait_for_selector("#avatar-grid button, #game:not([hidden])")
    if pg.is_visible("#enter") and not pg.is_visible("#game"): pg.click("#enter")
    pg.wait_for_selector("#game:not([hidden])"); time.sleep(1.5)
    ok(not guide(pg)["visible"], f"[{kind}] guide stays hidden after a reload (once only)")
    pg.click("#sound-settings"); pg.click("#guide-replay"); time.sleep(0.3)
    ok(guide(pg)["visible"] and guide(pg)["step"] == 0, f"[{kind}] Show guide in settings replays it")
    pg.click("#guide-skip"); time.sleep(0.3)
    ok(not guide(pg)["visible"] and guide(pg)["done"], f"[{kind}] Skip guide hides it")
    # tabs fit, panels render
    tabs = pg.evaluate("() => [...document.querySelectorAll('.tabs button')].map(b => [b.scrollWidth <= b.clientWidth + 1, b.textContent])")
    ok(all(t[0] for t in tabs), f"[{kind}] all {len(tabs)} tab labels fit ({[t[1] for t in tabs if not t[0]]})")
    pg.click(".tabs button[data-tab=log]"); time.sleep(0.4)
    ok(pg.locator(".log-cell").count() >= 44 and pg.locator(".log-cell.got").count() >= 1, f"[{kind}] Log tab shows the collection with silhouettes and the found fish")
    pg.click(".tabs button[data-tab=quests]"); time.sleep(1.2)
    ok("Lantern Festival" in pg.inner_text("#story-box") and "visit streak" in pg.inner_text("#return-box"), f"[{kind}] Journal shows the story chapter, streak and weekly event")
    if phone:
        pg.evaluate("() => { document.body.classList.add('panel-collapsed'); window.dispatchEvent(new Event('resize')); }"); time.sleep(0.5)
        for a, b in [("#joystick", "#action-btn"), ("#joystick", ".tabs"), ("#action-btn", ".tabs"), ("#zoom-controls", "#joystick")]:
            ok(not overlap(rect(pg, a), rect(pg, b)), f"[{kind}] {a} and {b} don't overlap")
    pg.click("#sound-settings"); pg.click("#share-link"); time.sleep(0.4)
    ok("ni-hao-lands" in pg.inner_text("#toasts") or "127.0.0.1" in pg.inner_text("#toasts"), f"[{kind}] Copy game link shows the link (no posting)")
    ok(not errs, f"[{kind}] no page errors {errs[:2]}")
    ctx.close()
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get("CHROME", "/usr/bin/google-chrome"), args=["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    run(br, "desktop", {"width": 1280, "height": 800})
    run(br, "phone", {"width": 390, "height": 844})
    run(br, "phone-540", {"width": 540, "height": 960})
    br.close()
print(f"\n{sum(res)}/{len(res)} passed")
sys.exit(0 if all(res) else 1)
