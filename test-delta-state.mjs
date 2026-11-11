// Delta state protocol (hello {proto: 2}): nearby-only, compact position updates, removal when out of range,
// and full "state" still served to legacy clients. Usage: node test-delta-state.mjs [baseUrl]
import { spawn } from "node:child_process";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(c, m) { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m); }
const nm = () => "Scout" + String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
async function freePort(start) {
  for (let p = start; p < start + 100; p++) {
    const ok = await new Promise((res) => { const s = net.createServer(); s.once("error", () => res(false)); s.listen(p, "127.0.0.1", () => s.close(() => res(true))); });
    if (ok) return p;
  }
}
function client(base, proto) {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws");
  const c = { ws, msgs: [], bytes: 0, players: new Map(), welcome: null };
  ws.on("message", (raw) => {
    c.bytes += raw.length;
    const m = JSON.parse(raw.toString()); c.msgs.push(m);
    if (m.type === "welcome") { c.welcome = m; for (const p of m.players) c.players.set(p.id, { ...p }); }
    if (m.type === "delta") {
      for (const p of m.p || []) c.players.set(p.id, { ...p });
      for (const q of m.q || []) { const p = c.players.get(q[0]); if (p) { p.x = q[1]; p.y = q[2]; } }
      for (const id of m.pr || []) c.players.delete(id);
    }
  });
  c.open = new Promise((res) => ws.on("open", () => { const h = { type: "hello", name: nm() }; if (proto) h.proto = proto; ws.send(JSON.stringify(h)); res(); }));
  c.send = (m) => ws.send(JSON.stringify(m));
  return c;
}
async function main() {
  let base = process.argv[2], srv, dataDir;
  if (!base) {
    const port = await freePort(Number(process.env.TEST_PORT || 3180));
    dataDir = await mkdtemp(path.join(tmpdir(), "nhl-delta-"));
    srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "" }, stdio: "ignore" });
    base = "http://127.0.0.1:" + port;
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/health")).ok) break; } catch {} await sleep(150); }
  }
  try {
    const a = client(base, 2), b = client(base, 2), legacy = client(base, 0);
    await Promise.all([a.open, b.open, legacy.open]);
    await sleep(800);
    const bid = b.welcome.me.id;
    assert(a.msgs.some((m) => m.type === "delta") && !a.msgs.some((m) => m.type === "state"), "proto 2 client gets deltas, not full state");
    assert(legacy.msgs.some((m) => m.type === "state"), "legacy client still gets full state");
    await sleep(300);
    a.bytes = 0; legacy.bytes = 0;
    const start = { x: b.welcome.me.x, y: b.welcome.me.y };
    b.send({ type: "move", x: start.x + 6, y: start.y });
    await sleep(2200);
    const seen = a.players.get(bid);
    assert(seen && Math.abs(seen.x - (start.x + 6)) < 0.01, `delta-reconstructed position of the other player is exact (${seen && seen.x})`);
    assert(a.msgs.some((m) => m.type === "delta" && (m.q || []).some((q) => q[0] === bid)), "movement arrives as compact [id,x,y,...] arrays");
    console.log(`   bytes while one player walked 6 tiles: delta ${a.bytes} vs legacy full state ${legacy.bytes}`);
    assert(a.bytes * 5 < legacy.bytes, "delta traffic is at least 5x smaller than full state");
    // walk far away -> removed from A's view
    b.send({ type: "move", x: 64, y: 88 });
    let gone = false;
    for (let i = 0; i < 60 && !gone; i++) { await sleep(500); gone = !a.players.has(bid); }
    assert(gone, "player leaving the nearby radius is removed (pr)");
    a.ws.close(); b.ws.close(); legacy.ws.close();
    console.log("\nALL DELTA STATE TESTS PASSED");
  } finally {
    if (srv) { srv.kill("SIGTERM"); await sleep(300); await rm(dataDir, { recursive: true, force: true }); }
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
