export interface PrepareRestoreOptions {
  environment?: Record<string, string | undefined>;
}

export interface PreparedRestoreEvidence {
  schemaVersion: 1;
  status: "prepared";
  recoveryId: string;
  snapshotId: string;
  backupRunId: string;
  preparedAt: string;
  sourceRoot: string;
  manifestSha256: string;
}

export function prepareRestore(options?: PrepareRestoreOptions): Promise<PreparedRestoreEvidence>;
