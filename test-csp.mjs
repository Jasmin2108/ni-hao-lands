// CSP frame-ancestors: Cherry can embed the game; other sites cannot.
import { startServer, assert } from "./test-helpers.mjs";

const EXPECTED =
  "frame-ancestors 'self' https://chat.cherry.fun https://cherry.fun https://*.cherry.fun";

const { base, stop } = await startServer("nhl-csp-", 3490);
try {
  for (const path of ["/", "/health", "/styles.css"]) {
    const r = await fetch(base + path);
    assert(r.ok, path + " ok");
    assert(
      r.headers.get("content-security-policy") === EXPECTED,
      path + " has Cherry frame-ancestors CSP"
    );
  }
  console.log("all csp checks passed");
} finally {
  await stop();
}
