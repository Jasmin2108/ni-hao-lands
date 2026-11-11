// Usage: node test-audio.mjs [baseUrl]  (spawns a temporary server when no URL is given; needs python3 + playwright + Chrome)
import { spawn } from "node:child_process";
import { startServer } from "./test-helpers.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
let base = process.argv[2], srv = null;
if (!base) { srv = await startServer("nhl-audio-", Number(process.env.TEST_PORT || 3280)); base = srv.base; }
const child = spawn("python3", [path.join(dir, "test-audio.py"), base], { stdio: "inherit" });
child.on("exit", async (code) => { if (srv) await srv.stop(); process.exit(code ?? 1); });
