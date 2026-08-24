export const legalCompliancePermissionKeys = {
  view: "legal.record.view",
  create: "legal.record.create",
  update: "legal.record.update",
  manageLifecycle: "legal.record.manage_lifecycle",
  download: "legal.record.download",
  managePrivileged: "legal.record.manage_privileged",
} as const;

export const legalComplianceRecordTypes = [
  "privacy_document",
  "corporate_registration",
  "gst_record",
  "pan_record",
  "licence",
  "insurance_policy",
  "intellectual_property",
  "compliance_certificate",
  "board_resolution",
  "legal_notice",
  "dispute_record",
] as const;

export const legalComplianceStatuses = ["active", "closed", "archived"] as const;
export const legalComplianceConfidentialityLevels = [
  "internal",
  "confidential",
  "restricted",
] as const;

export type LegalComplianceRecordType = (typeof legalComplianceRecordTypes)[number];
export type LegalComplianceStatus = (typeof legalComplianceStatuses)[number];
export type LegalComplianceConfidentiality = (typeof legalComplianceConfidentialityLevels)[number];

export const legalComplianceRecordTypeLabels: Record<LegalComplianceRecordType, string> = {
  privacy_document: "Privacy document",
  corporate_registration: "Corporate registration",
  gst_record: "GST record",
  pan_record: "PAN record",
  licence: "Licence",
  insurance_policy: "Insurance policy",
  intellectual_property: "Intellectual-property record",
  compliance_certificate: "Compliance certificate",
  board_resolution: "Board resolution",
  legal_notice: "Legal notice",
  dispute_record: "Dispute record",
};

export const legalComplianceStatusLabels: Record<LegalComplianceStatus, string> = {
  active: "Active",
  closed: "Closed",
  archived: "Archived",
};

export const legalComplianceConfidentialityLabels: Record<LegalComplianceConfidentiality, string> =
  {
    internal: "Internal",
    confidential: "Confidential",
    restricted: "Restricted",
  };

export function legalComplianceTimingState(input: {
  status: LegalComplianceStatus;
  expiryDate: string | null;
  renewalDate: string | null;
  reviewDate: string | null;
  responseDueDate: string | null;
  today?: string;
}): "archived" | "closed" | "expired" | "response_due" | "review_due" | "renewal_due" | "current" {
  if (input.status === "archived") return "archived";
  if (input.status === "closed") return "closed";
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  if (input.expiryDate && input.expiryDate < today) return "expired";
  if (input.responseDueDate && input.responseDueDate <= today) return "response_due";
  if (input.reviewDate && input.reviewDate <= today) return "review_due";
  if (input.renewalDate && input.renewalDate <= today) return "renewal_due";
  return "current";
}
