# Headless check: audio module loads without errors, starts only after a gesture, settings persist,
# M toggles mute (not while typing), and the speaker button doesn't overlap touch controls.
import sys, time, json
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
CHROME = "/usr/bin/google-chrome"
def ok(c, m):
    if not c: raise SystemExit("FAIL: " + m)
    print("ok -", m)
def overlap(a, b):
    return a and b and a["width"] and b["width"] and not (a["x"] + a["width"] <= b["x"] or b["x"] + b["width"] <= a["x"] or a["y"] + a["height"] <= b["y"] or b["y"] + b["height"] <= a["y"])
with sync_playwright() as p:
    br = p.chromium.launch(headless=True, executable_path=CHROME, args=["--no-sandbox"])
    for mode in ["desktop", "phone"]:
        ctx = br.new_context(viewport={"width": 1280, "height": 800}) if mode == "desktop" else br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
        pg.goto(BASE + "/"); pg.wait_for_function("!!window.NHLAudio")
        st = pg.evaluate("window.NHLAudio.state()")
        if mode == "desktop":
            ok(st["muted"] is False and abs(st["music"] - 0.4) < 1e-9 and abs(st["sfx"] - 0.7) < 1e-9, f"defaults: effects 70%, music 40% ({st})")
            ok(st["unlocked"] is False and st["running"] is False, "no audio context before a user gesture")
        pg.wait_for_selector("#avatar-grid button")
        pg.fill("#name", "Audio" + str(int(time.time() * 1000))[-6:]); pg.locator("#avatar-grid button").nth(1).click(); pg.click("#enter")
        pg.wait_for_selector("#game:not([hidden])", timeout=20000); time.sleep(1.0)
        st = pg.evaluate("window.NHLAudio.state()")
        ok(st["unlocked"], f"{mode}: audio unlocks after the first gesture")
        boxes = pg.evaluate("""() => { const r = id => { const e = document.getElementById(id); if (!e || e.offsetParent === null) return null; const b = e.getBoundingClientRect(); return {x:b.x,y:b.y,width:b.width,height:b.height}; };
          return { btn: r('sound-btn'), gear: r('sound-settings'), joy: r('joystick'), use: r('action-btn'), tabs: (() => { const e = document.querySelector('.tabs'); const b = e.getBoundingClientRect(); return {x:b.x,y:b.y,width:b.width,height:b.height}; })(), vw: innerWidth, vh: innerHeight }; }""")
        ok(boxes["btn"] and boxes["btn"]["width"] >= 40, f"{mode}: speaker button visible ({boxes['btn']})")
        for k in ["joy", "use", "tabs"]:
            ok(not overlap(boxes["btn"], boxes[k]) and not overlap(boxes["gear"], boxes[k]), f"{mode}: sound buttons don't overlap {k}")
        # popover + sliders persist
        pg.click("#sound-settings"); time.sleep(0.2)
        ok(pg.is_visible("#sound-pop"), f"{mode}: settings popover opens")
        pg.evaluate("""() => { const m = document.getElementById('vol-music'); m.value = 25; m.dispatchEvent(new Event('input', {bubbles:true})); const e = document.getElementById('vol-sfx'); e.value = 55; e.dispatchEvent(new Event('input', {bubbles:true})); }""")
        saved = json.loads(pg.evaluate("localStorage.getItem('nhl-audio')"))
        ok(abs(saved["music"] - 0.25) < 1e-9 and abs(saved["sfx"] - 0.55) < 1e-9, f"{mode}: slider values saved to localStorage")
        if mode == "desktop":
            pg.mouse.click(400, 300); time.sleep(0.1)
            pg.keyboard.press("m"); time.sleep(0.1)
            ok(pg.evaluate("window.NHLAudio.settings().muted") is True, "M key mutes")
            pg.focus("#chat-input"); pg.keyboard.type("mmm"); time.sleep(0.1)
            ok(pg.evaluate("window.NHLAudio.settings().muted") is True and pg.input_value("#chat-input") == "mmm", "typing m in chat doesn't toggle mute")
            pg.evaluate("document.activeElement.blur()"); pg.keyboard.press("m"); time.sleep(0.1)
            ok(pg.evaluate("window.NHLAudio.settings().muted") is False, "M key unmutes")
            pg.click("#sound-btn")
            ok(pg.evaluate("window.NHLAudio.settings().muted") is True, "speaker button mutes")
            pg.reload(); pg.wait_for_function("!!window.NHLAudio")
            st = pg.evaluate("window.NHLAudio.settings()")
            ok(st["muted"] is True and abs(st["music"] - 0.25) < 1e-9 and abs(st["sfx"] - 0.55) < 1e-9, f"settings persist across reload ({st})")
            ok(pg.evaluate("document.getElementById('vol-music').value") == "25", "slider reflects the saved music volume after reload")
            r = pg.evaluate("""async () => { const b = await window.NHLAudio.renderOffline(['chop','meow','levelup'], 2, 22050); let pk = 0, nan = false; for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = d[i]; if (v !== v) nan = true; const a = Math.abs(v); if (a > pk) pk = a; } } return { pk, nan }; }""")
            ok(r["pk"] > 0.01 and r["pk"] < 1 and not r["nan"], f"offline-rendered SFX are audible and unclipped (peak {r['pk']:.3f})")
            m = pg.evaluate("""async () => { const t0 = performance.now(); const b = await window.NHLAudio.renderOffline('music-day'); let pk = 0; const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); return { secs: b.duration, pk, ms: performance.now() - t0 }; }""")
            ok(m["secs"] > 30 and m["pk"] < 0.99, f"music loop renders ({m['secs']:.1f}s, peak {m['pk']:.2f}, {m['ms']:.0f} ms)")
        ok(not errs, f"{mode}: no JS errors ({errs[:3]})")
        ctx.close()
    br.close()
print("\nALL AUDIO TESTS PASSED")
