export const legalPermissionKeys = {
  workspace: "legal.workspace.view",
  view: "legal.contract.view",
  create: "legal.contract.create",
  update: "legal.contract.update",
  review: "legal.contract.review",
  manageTemplates: "legal.contract.manage_templates",
  manageSignatures: "legal.contract.manage_signatures",
  manageLifecycle: "legal.contract.manage_lifecycle",
  download: "legal.contract.download",
  accessReviewView: "legal.access_review.view",
  accessReviewManage: "legal.access_review.manage_access",
} as const;

export const legalContractTypes = [
  "client_contract",
  "master_service_agreement",
  "statement_of_work",
  "nda",
  "vendor_agreement",
  "contractor_agreement",
  "partnership_agreement",
  "data_processing_agreement",
  "other",
] as const;

export const legalContractStatuses = [
  "request",
  "draft",
  "in_review",
  "approved",
  "awaiting_signature",
  "active",
  "terminated",
  "expired",
  "cancelled",
] as const;

export const legalSignatureStatuses = [
  "not_started",
  "sent",
  "partially_signed",
  "signed",
  "declined",
  "expired",
] as const;

export const legalVersionKinds = ["template", "draft", "counterparty", "final", "signed"] as const;

export type LegalContractType = (typeof legalContractTypes)[number];
export type LegalContractStatus = (typeof legalContractStatuses)[number];
export type LegalSignatureStatus = (typeof legalSignatureStatuses)[number];
export type LegalVersionKind = (typeof legalVersionKinds)[number];

export const legalContractTypeLabels: Record<LegalContractType, string> = {
  client_contract: "Client contract",
  master_service_agreement: "Master service agreement",
  statement_of_work: "Statement of work",
  nda: "Non-disclosure agreement",
  vendor_agreement: "Vendor agreement",
  contractor_agreement: "Contractor agreement",
  partnership_agreement: "Partnership agreement",
  data_processing_agreement: "Data-processing agreement",
  other: "Other agreement",
};

export const legalContractStatusLabels: Record<LegalContractStatus, string> = {
  request: "Request",
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  awaiting_signature: "Awaiting signature",
  active: "Active",
  terminated: "Terminated",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const legalSignatureStatusLabels: Record<LegalSignatureStatus, string> = {
  not_started: "Not started",
  sent: "Sent for signature",
  partially_signed: "Partially signed",
  signed: "Signed",
  declined: "Declined",
  expired: "Signature expired",
};

export function legalContractTimingState(input: {
  status: LegalContractStatus;
  renewalDate: string | null;
  endDate: string | null;
  noticePeriodDays: number | null;
  today?: string;
}): "terminated" | "expired" | "notice_due" | "renewal_due" | "current" {
  if (input.status === "terminated") return "terminated";
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  if (input.endDate && input.endDate < today) return "expired";
  const noticeDate =
    input.endDate && input.noticePeriodDays !== null
      ? new Date(
          new Date(`${input.endDate}T00:00:00Z`).getTime() - input.noticePeriodDays * 86_400_000,
        )
          .toISOString()
          .slice(0, 10)
      : null;
  if (noticeDate && noticeDate <= today) return "notice_due";
  if (input.renewalDate && input.renewalDate <= today) return "renewal_due";
  return "current";
}
