import { spawn } from "node:child_process";

import chromium from "@sparticuz/chromium";

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || (await chromium.executablePath());
const args = ["playwright", "test", ...process.argv.slice(2)];
const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", args, {
  stdio: "inherit",
  env: {
    ...process.env,
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: executablePath,
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
