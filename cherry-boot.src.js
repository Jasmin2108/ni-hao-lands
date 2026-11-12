// Runs in <head> so Cherry's handshake starts immediately, before game.js.
// Inside Cherry the person is already signed in — no connect button, no login signature.
import { CherryMiniApp, isInsideCherry } from "@cherrydotfun/miniapp-sdk";

const embedded = isInsideCherry({ strict: true });
const hook = { embedded, ready: Promise.resolve(null) };
window.__nhlCherry = hook;

if (embedded) {
  document.documentElement.classList.add("inside-cherry");
  hook.ready = (async () => {
    const cherry = new CherryMiniApp({ strict: true });
    await cherry.init();
    const launchToken = cherry.launchToken;
    if (!launchToken) throw new Error("Cherry did not provide a launch token.");
    const r = await fetch("/api/auth/cherry", {
      method: "POST",
      headers: { Authorization: "Bearer " + launchToken },
    });
    const session = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(session.error || "Cherry sign-in failed.");
    if (session.token) localStorage.setItem("nhl-token", session.token);
    if (session.name) localStorage.setItem("nhl-name", session.name);
    return { cherry, session };
  })();
}
