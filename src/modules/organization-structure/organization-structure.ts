export interface ReportingLine {
  membershipId: string;
  managerMembershipId: string | null;
}

export function wouldCreateManagerCycle(
  reportingLines: readonly ReportingLine[],
  membershipId: string,
  proposedManagerMembershipId: string | null,
): boolean {
  if (!proposedManagerMembershipId) return false;
  if (membershipId === proposedManagerMembershipId) return true;

  const managerByMember = new Map(
    reportingLines.map((line) => [line.membershipId, line.managerMembershipId]),
  );
  managerByMember.set(membershipId, proposedManagerMembershipId);

  const visited = new Set<string>();
  let current: string | null = membershipId;

  while (current) {
    if (visited.has(current)) return true;
    visited.add(current);
    current = managerByMember.get(current) ?? null;
  }

  return false;
}

export function normalizeStructureName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function structureAuditSnapshot<T extends Record<string, unknown>>(value: T): T {
  return { ...value };
}
