import type { ObjectStorageConfiguration } from "../../src/integrations/object-storage/config.mjs";

export interface BackupCommandCall {
  command: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface BackupCommandResult {
  status: string;
  stdoutText: string;
  stderrText?: string;
}

export function captureObjectStorage(
  configuration: {
    objectStorage: ObjectStorageConfiguration;
    commandTimeoutMs: number;
  },
  target: string,
  options?: {
    runCommand?: (call: BackupCommandCall) => Promise<BackupCommandResult>;
  },
): Promise<Array<Record<string, unknown>>>;

export function runBackup(options?: {
  environment?: Record<string, string | undefined>;
  reason?: string;
}): Promise<Record<string, unknown>>;
