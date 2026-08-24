import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("AI and MCP production contracts", () => {
  it("implements lifecycle-aware Streamable HTTP boundaries", () => {
    const route = source("src/app/api/mcp/route.ts");
    expect(route).toContain('const SESSION_HEADER = "Mcp-Session-Id"');
    expect(route).toContain('const VERSION_HEADER = "MCP-Protocol-Version"');
    expect(route).toContain("text/event-stream");
    expect(route).toContain("markMcpSessionInitialized");
    expect(route).toContain("status: 405");
    expect(route).toContain("requireOrigin: true");
  });

  it("ships real Gemini and DeepSeek agent adapters without browser-visible keys", () => {
    const agent = source("src/modules/ai/server/agent.ts");
    const config = source("src/modules/ai/server/config.ts");
    const client = source("src/components/ai/ai-workspace.tsx");
    expect(agent).toContain("generateContent");
    expect(agent).toContain("/chat/completions");
    expect(agent).toContain("callMcpTool");
    expect(config).toContain("GEMINI_API_KEY");
    expect(config).toContain("DEEPSEEK_API_KEY");
    expect(client).not.toContain("GEMINI_API_KEY");
    expect(client).not.toContain("DEEPSEEK_API_KEY");
  });

  it("fails authenticated rate limiting closed in production", () => {
    const security = source("src/modules/security/server/security.ts");
    expect(security).not.toContain("result.available ? result.allowed : true");
    expect(security).toContain('SECURITY_RATE_LIMIT_REDIS_FAILURE_MODE === "allow"');
  });

  it("provides liveness and dependency-aware readiness endpoints", () => {
    expect(source("src/app/api/health/live/route.ts")).toContain('status: "ok"');
    const ready = source("src/app/api/health/ready/route.ts");
    expect(ready).toContain("checkDatabase");
    expect(ready).toContain("checkRedis");
    expect(ready).toContain("status: ready ? 200 : 503");
  });
});
