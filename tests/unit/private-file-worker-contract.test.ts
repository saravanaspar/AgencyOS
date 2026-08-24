import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { handlesOwnApiAuthentication } from "@/lib/server/self-authenticated-api-paths";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("private-file scan worker contracts", () => {
  it("registers scanning behind the single constant-time bearer-authenticated route", () => {
    const route = source("src/app/api/internal/workers/run/route.ts");
    const registry = source("src/modules/workers/server/worker-registry.ts");
    const boundary = source("src/lib/server/internal-worker.ts");
    expect(route).toContain("runInternalWorkerRequest");
    expect(route).toContain("INTERNAL_WORKER_SECRET");
    expect(registry).toContain('key === "private-files"');
    expect(registry).toContain("getPrivateFileScanConfiguration");
    expect(registry).toContain("runPrivateFileScanWorker");
    expect(boundary).toContain("hasValidBearerSecret");
    expect(handlesOwnApiAuthentication("/api/internal/workers/run", "POST")).toBe(true);
    expect(handlesOwnApiAuthentication("/api/internal/workers/run/extra")).toBe(false);
  });

  it("uses bounded, lock-safe scans and prevents scanner redirect SSRF", () => {
    const worker = source("src/modules/private-files/server/scan-worker.ts");
    const client = source("src/integrations/clamav/client.ts");
    const compose = source("compose.scanner.yaml");
    expect(worker).toContain("MAX_FILES_PER_RUN = 20");
    expect(worker).toContain("SCAN_CONCURRENCY = 2");
    expect(worker).toContain("MAX_ATTEMPTS = 5");
    expect(worker).toContain("for update skip locked");
    expect(worker).toContain('redirect: "error"');
    expect(worker).toContain("AbortSignal.timeout");
    expect(worker).toContain("SCANNER_RESPONSE_LIMIT_BYTES");
    expect(worker).toContain("scanBufferWithClamav");
    expect(client).toContain('Buffer.from("zINSTREAM\\0"');
    expect(client).toContain("writeUInt32BE");
    expect(compose).toContain('"127.0.0.1:3310:3310"');
    expect(compose).toContain("/var/lib/clamav");
  });

  it("rechecks checksum, releases only clean files, and quarantines failures", () => {
    const worker = source("src/modules/private-files/server/scan-worker.ts");
    expect(worker).toContain("digest !== row.sha256");
    expect(worker).toContain('verdict.verdict === "infected"');
    expect(worker).toContain("status = 'available'");
    expect(worker).toContain("status = 'rejected'");
    expect(worker).toContain("status = 'scan_failed'");
    expect(worker).toContain("PRIVATE_FILE_CLEAN_BUCKET");
    expect(worker).toContain("readMinioObject");
    expect(worker).toContain("putMinioObject");
    expect(worker).toContain("removeMinioObject");
    expect(worker).not.toContain(".storage.from(");
    expect(worker).toContain('status === "available"');
    expect(worker).toContain("file.quarantine_purged");
  });
});
