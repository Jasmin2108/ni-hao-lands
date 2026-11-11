#!/usr/bin/env python3
"""Headless two-client smoke test for Ni Hao Lands. Writes screenshot.png."""
import sys
import time
import json
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent
SHOT = ROOT / "screenshot.png"
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
CHROME = "/usr/bin/google-chrome"

def wait_health(timeout=20):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        try:
            with urllib.request.urlopen(BASE + "/health", timeout=2) as r:
                data = json.loads(r.read().decode())
                if data.get("ok"):
                    return data
        except Exception as e:
            last = e
        time.sleep(0.3)
    raise SystemExit(f"Server not healthy at {BASE}/health: {last}")

def enter_world(page, name, avatar_index=0):
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector("#enter")
    page.wait_for_selector("#avatar-grid button")
    page.fill("#name", name)
    buttons = page.query_selector_all("#avatar-grid button")
    if buttons:
        buttons[min(avatar_index, len(buttons) - 1)].click()
    page.click("#enter")
    page.wait_for_selector("#game:not([hidden])", timeout=15000)
    page.wait_for_selector("#chat-log")

def chat_text(page):
    return page.inner_text("#chat-log")

def main():
    health = wait_health()
    print("health", health)
    stamp = str(int(time.time()))[-6:]
    name_a = "Scout" + stamp
    name_b = "Jasmin" + stamp

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path=CHROME,
            args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
        )
        ctx_a = browser.new_context(viewport={"width": 1400, "height": 900})
        ctx_b = browser.new_context(viewport={"width": 1400, "height": 900})
        a = ctx_a.new_page()
        b = ctx_b.new_page()
        errors = []
        for label, page in (("A", a), ("B", b)):
            page.on("pageerror", lambda err, label=label: errors.append(f"{label} js: {err}"))
            page.on("console", lambda msg, label=label: errors.append(f"{label} console.{msg.type}: {msg.text}") if msg.type == "error" else None)

        print("entering A", name_a)
        enter_world(a, name_a, 0)
        print("entering B", name_b)
        enter_world(b, name_b, 3)

        # both should appear in system chat
        a.wait_for_function(
            """([na, nb]) => document.getElementById('chat-log').innerText.includes(na) && document.getElementById('chat-log').innerText.includes(nb)""",
            arg=[name_a, name_b],
            timeout=15000,
        )

        # move A a little by clicking the canvas (village plaza)
        box = a.locator("#view").bounding_box()
        if box:
            a.mouse.click(box["x"] + box["width"] * 0.55, box["y"] + box["height"] * 0.55)

        a.fill("#chat-input", "ni hao from the pond, friend!")
        a.click("#chat-form button")
        b.fill("#chat-input", "你好, Scout — Yarn Forest is this way")
        b.click("#chat-form button")

        a.wait_for_function(
            """() => document.getElementById('chat-log').innerText.includes('ni hao from the pond') && document.getElementById('chat-log').innerText.includes('Yarn Forest')""",
            timeout=15000,
        )
        b.wait_for_function(
            """() => document.getElementById('chat-log').innerText.includes('ni hao from the pond') && document.getElementById('chat-log').innerText.includes('Yarn Forest')""",
            timeout=15000,
        )

        # keep chat dock visible; wait a frame for avatars to draw
        a.wait_for_timeout(800)
        a.screenshot(path=str(SHOT), full_page=False)
        print("screenshot", SHOT, "size", SHOT.stat().st_size)

        text_a = chat_text(a)
        text_b = chat_text(b)
        print("--- chat A ---")
        print(text_a)
        print("--- chat B ---")
        print(text_b)

        js_errors = [e for e in errors if "js:" in e or "console.error" in e]
        # filter favicon / benign
        js_errors = [e for e in js_errors if "favicon" not in e.lower()]
        if js_errors:
            print("JS ERRORS:")
            for e in js_errors:
                print(" ", e)

        ok_chat = ("ni hao from the pond" in text_a and "Yarn Forest" in text_a
                   and "ni hao from the pond" in text_b and "Yarn Forest" in text_b)
        ok_names = name_a in text_a and name_b in text_a
        browser.close()

        if not ok_chat or not ok_names:
            raise SystemExit(f"FAIL chat sync ok_chat={ok_chat} ok_names={ok_names}")
        if js_errors:
            print("TEST PASSED WITH JS ERRORS (see above)")
            # still fail if real exceptions
            if any("js:" in e for e in js_errors):
                raise SystemExit("FAIL page errors")
        print("TEST PASSED")
        print(f"players visible and chat synced for {name_a} and {name_b}")

if __name__ == "__main__":
    main()
