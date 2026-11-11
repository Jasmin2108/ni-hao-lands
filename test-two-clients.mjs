import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || "http://127.0.0.1:3000";
const child = spawn("python3", [path.join(dir, "test-two-clients.py"), url], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
