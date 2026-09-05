import { spawn } from "node:child_process";

import chromium from "@sparticuz/chromium";
import { createClient } from "redis";

async function clearIsolatedLoginRateLimits() {
  if (process.env.AGENCYOS_E2E_CONFIRM_ISOLATED !== "1") return;
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) return;

  const client = createClient({ url: redisUrl });
  try {
    await client.connect();
    let deleted = 0;
    for await (const batch of client.scanIterator({
      MATCH: "agencyos:v1:rate:security:login:*",
      COUNT: 100,
    })) {
      const keys = Array.isArray(batch) ? batch : [batch];
      if (keys.length > 0) deleted += await client.del(keys);
    }
    if (deleted > 0) console.log(`Cleared ${deleted} isolated E2E login rate-limit buckets.`);
  } finally {
    client.destroy();
  }
}

await clearIsolatedLoginRateLimits();

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
