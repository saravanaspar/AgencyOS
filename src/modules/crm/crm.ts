export const crmPermissionKeys = {
  workspaceView: "crm.workspace.view",
  companyView: "crm.company.view",
  companyCreate: "crm.company.create",
  companyUpdate: "crm.company.update",
  contactView: "crm.contact.view",
  contactCreate: "crm.contact.create",
  contactUpdate: "crm.contact.update",
  leadView: "crm.lead.view",
  leadCreate: "crm.lead.create",
  leadUpdate: "crm.lead.update",
  leadDelete: "crm.lead.delete",
  leadAssign: "crm.lead.assign",
  activityCreate: "crm.activity.create",
  activityUpdate: "crm.activity.update",
  pipelineManage: "crm.pipeline.manage",
  importView: "crm.import.view",
  importExecute: "crm.import.execute",
  connectionManage: "crm.connection.manage",
} as const;

export const crmLeadTypes = ["person", "company"] as const;
export const crmLeadStatuses = ["new", "qualified", "unqualified", "converted", "lost"] as const;
export const crmActivityTypes = [
  "call",
  "email",
  "meeting",
  "note",
  "follow_up",
  "proposal_sent",
  "contract_sent",
  "client_response",
  "status_change",
] as const;
export const crmPipelineStates = ["open", "won", "lost"] as const;

export const crmStageRequiredFields = [
  "source",
  "estimated_value",
  "expected_close_date",
  "owner_membership_id",
  "email",
  "phone",
  "company_name",
  "follow_up_at",
  "notes",
] as const;

export type CrmStageRequiredField = (typeof crmStageRequiredFields)[number];

export function normalizeCrmEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized || null;
}

export function normalizeCrmPhone(value: string | null | undefined): string | null {
  const normalized = value?.replace(/[^0-9+]/g, "").trim() ?? "";
  return normalized || null;
}

export function normalizeCrmCompanyName(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
  return normalized || null;
}

export function normalizeCrmPipelineSlug(value: string): string | null {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || null;
}

export function calculateLeadQualificationScore(input: {
  hasEmail: boolean;
  hasPhone: boolean;
  hasEstimatedValue: boolean;
  hasExpectedCloseDate: boolean;
  hasOwner: boolean;
  hasCompanyName: boolean;
}): number {
  const weights = {
    hasEmail: 20,
    hasPhone: 15,
    hasEstimatedValue: 20,
    hasExpectedCloseDate: 15,
    hasOwner: 20,
    hasCompanyName: 10,
  } as const;

  return (Object.keys(weights) as Array<keyof typeof weights>).reduce(
    (score, key) => score + (input[key] ? weights[key] : 0),
    0,
  );
}

export function leadQualificationLabel(score: number): "cold" | "warm" | "qualified" {
  if (score >= 70) return "qualified";
  if (score >= 40) return "warm";
  return "cold";
}
