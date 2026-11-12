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
  const proof = await fetch(base + "/.well-known/cherry-app.json");
  assert(proof.ok, "cherry-app.json ok");
  assert((proof.headers.get("content-type") || "").includes("application/json"), "cherry-app.json is JSON");
  const body = await proof.json();
  assert(body.appId === "9fac6fde-1424-40ea-98db-680c3d724931", "cherry-app.json names this Cherry app");
  console.log("all csp and cherry proof checks passed");
} finally {
  await stop();
}
