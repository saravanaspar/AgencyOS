export function localRepository(environment?: Record<string, string | undefined>): string;
export function remoteRepository(environment?: Record<string, string | undefined>): string;
export function publishRepository(
  configuration: { commandTimeoutMs: number; restic: Record<string, string> },
  environment: Record<string, string>,
  snapshotId: string,
): Promise<void>;
