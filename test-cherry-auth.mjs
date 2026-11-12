// Cherry launch-token sign-in: verify signature, iss, exp, app id; no spending.
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { startServer, assert } from "./test-helpers.mjs";
import { readFileSync } from "node:fs";
import { ROOT } from "./test-helpers.mjs";
import path from "node:path";

const APP_ID = "9fac6fde-1424-40ea-98db-680c3d724931";
const pair = nacl.sign.keyPair();
const wallet = bs58.encode(pair.publicKey);
const other = bs58.encode(nacl.sign.keyPair().publicKey);
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = await exportJWK(publicKey);
jwk.kid = "nhl-test";
jwk.alg = "RS256";
jwk.use = "sig";
const jwks = { keys: [jwk] };

async function signToken(claims = {}, extra = {}) {
  let jwt = new SignJWT({
    app_id: APP_ID,
    sub: wallet,
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "nhl-test" })
    .setIssuer(extra.issuer || "https://chat.cherry.fun")
    .setIssuedAt()
    .setExpirationTime(extra.exp || "5m");
  if (extra.aud !== null) jwt = jwt.setAudience(extra.aud || APP_ID);
  return jwt.sign(privateKey);
}

const { base, stop } = await startServer("nhl-cherry-", 3510, {
  CHERRY_APP_ID: APP_ID,
  CHERRY_TEST_JWKS: JSON.stringify(jwks),
});

async function auth(token, headers = {}) {
  const h = { ...headers };
  if (token) h.Authorization = "Bearer " + token;
  return fetch(base + "/api/auth/cherry", { method: "POST", headers: h });
}

try {
  const html = await fetch(base + "/");
  const page = await html.text();
  assert(html.ok, "index ok");
  assert(page.includes("/cherry-boot.js"), "index loads cherry-boot.js");
  assert(/inside-cherry/.test(page), "index detects Cherry before paint");

  const boot = await fetch(base + "/cherry-boot.js");
  const bootSrc = await boot.text();
  assert(boot.ok, "cherry-boot.js served");
  assert(/cherry\.init\(|\.init\(/.test(bootSrc), "boot calls cherry.init");

  const htmlFile = readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  assert(htmlFile.includes('src="/cherry-boot.js"'), "boot script is in the document head");

  const missing = await auth(null);
  assert(missing.status === 401, "missing token is 401");

  const badSig = await auth((await signToken()) + "tamper");
  assert(badSig.status === 401, "tampered token is 401");

  const wrongApp = await auth(await signToken({ app_id: "00000000-0000-0000-0000-000000000000", mini_app_id: "00000000-0000-0000-0000-000000000000" }, { aud: "00000000-0000-0000-0000-000000000000" }));
  assert(wrongApp.status === 401, "wrong app id is 401");

  const expired = await auth(await signToken({}, { exp: Math.floor(Date.now() / 1000) - 120 }));
  assert(expired.status === 401, "expired token is 401");

  const wrongIss = await auth(await signToken({}, { issuer: "https://evil.example" }));
  assert(wrongIss.status === 401, "wrong issuer is 401");

  const ok = await auth(await signToken({ cherry_id: "cherry_person_1" }));
  const body = await ok.json();
  assert(ok.ok && body.ok && body.token, "valid launch token issues a session");
  assert(body.wallet === wallet, "session wallet is the verified identity wallet");
  assert(!!body.name, "session includes a character name");

  const again = await auth(await signToken({ cherry_id: "cherry_person_1" }));
  const body2 = await again.json();
  assert(again.ok, "same cherry id can sign in again");
  assert(body2.name === body.name, "same cherry id returns the same character");

  const switched = await auth(await signToken({ cherry_id: "cherry_person_1", payment_wallet: other }));
  const body3 = await switched.json();
  assert(switched.ok && body3.wallet === other, "payment wallet from verified claims is used");
  assert(body3.name === body.name, "wallet switch keeps the same character");

  console.log("all cherry auth checks passed");
} finally {
  await stop();
}
