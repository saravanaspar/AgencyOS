export interface DatabaseStatusResult {
  applied: number | null;
  local: number | null;
  pending: number | null;
  drift: number | null;
}

export function parseDatabaseStatusOutput(output: string): DatabaseStatusResult;
export function databaseStatusIsCurrent(status: DatabaseStatusResult): boolean;
export function verifyHttpDeployment(appUrl: string): Promise<unknown[]>;
export function runDeploymentVerification(
  options: Record<string, unknown>,
  root?: string,
): Promise<Record<string, unknown>>;
