#!/usr/bin/env node

import { spawn } from "node:child_process";

const mode = process.argv[2] ?? "dev";

const MODE_ARGS = {
  dev: ["run", "dev", "--filter=t3", "--filter=@t3tools/mobile", "--parallel"],
  "dev:server": ["run", "dev", "--filter=t3"],
  "dev:mobile": ["run", "dev", "--filter=@t3tools/mobile"],
} as const;

if (!(mode in MODE_ARGS)) {
  console.error(`Unknown dev mode: ${mode}`);
  process.exit(1);
}

const child = spawn("bun", ["x", "turbo", ...MODE_ARGS[mode as keyof typeof MODE_ARGS]], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
