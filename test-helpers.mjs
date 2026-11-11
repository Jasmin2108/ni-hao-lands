// Shared helpers for server tests that need the NHL_TEST_HOOKS=1 debug messages.
import { spawn } from "node:child_process";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function assert(c, m) { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m); }
const nm = () => "Tester" + String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
async function freePort(start) {
  for (let p = start; p < start + 100; p++) {
    const ok = await new Promise((res) => { const s = net.createServer(); s.once("error", () => res(false)); s.listen(p, "127.0.0.1", () => s.close(() => res(true))); });
    if (ok) return p;
  }
}
export async function startServer(prefix, portBase) {
  const port = await freePort(portBase);
  const dataDir = await mkdtemp(path.join(tmpdir(), prefix));
  const srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, DATABASE_URL: "", NHL_TEST_HOOKS: "1" }, stdio: "ignore" });
  const base = "http://127.0.0.1:" + port;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/health")).ok) break; } catch {} await sleep(150); }
  return { base, stop: async () => { srv.kill("SIGTERM"); await sleep(300); await rm(dataDir, { recursive: true, force: true }); } };
}
export function client(base) {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws");
  const c = { ws, msgs: [], me: null, waiters: [] };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    m._at = Date.now();
    c.msgs.push(m);
    if (m.type === "welcome") c.me = m.me;
    if (m.type === "me") c.me = m.me;
    if (m.type === "ping") ws.send(JSON.stringify({ type: "pong", t: m.t }));
    for (const w of c.waiters.slice()) if (w.pred(m)) { c.waiters.splice(c.waiters.indexOf(w), 1); w.res(m); }
  });
  c.open = new Promise((res) => ws.on("open", () => { ws.send(JSON.stringify({ type: "hello", name: nm(), proto: 2 })); res(); }));
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = (pred, ms = 8000, label = "message") => new Promise((res, rej) => {
    const w = { pred, res };
    c.waiters.push(w);
    setTimeout(() => { const i = c.waiters.indexOf(w); if (i >= 0) { c.waiters.splice(i, 1); rej(new Error("timeout waiting for " + label)); } }, ms);
  });
  c.ask = async (op, extra = {}, type) => { const p = c.wait((m) => m.type === type, 4000, type); c.send({ type: "__test", op, ...extra }); return p; };
  c.mobs = () => c.ask("mobs", {}, "__mobs");
  c.ready = () => c.wait((m) => m.type === "welcome", 8000, "welcome");
  return c;
}
