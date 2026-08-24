export const hrDocumentTypes = [
  "offer_letter",
  "appointment_letter",
  "employment_agreement",
  "nda",
  "experience_letter",
  "relieving_letter",
  "promotion_letter",
  "salary_revision_letter",
  "warning_letter",
  "performance_letter",
] as const;

export type HrDocumentType = (typeof hrDocumentTypes)[number];
export type HrDocumentTemplateSource = "builtin" | "minio";

export interface HrBuiltinDocumentTemplate {
  key: HrDocumentType;
  documentType: HrDocumentType;
  name: string;
  description: string;
  fileName: string;
  customFields: readonly string[];
}

export const hrBuiltinDocumentTemplates: readonly HrBuiltinDocumentTemplate[] = [
  {
    key: "offer_letter",
    documentType: "offer_letter",
    name: "AgencyOS starter offer letter",
    description:
      "A clearly marked starter offer letter intended to be replaced or reviewed by counsel.",
    fileName: "offer-letter.html",
    customFields: ["compensation_summary", "conditions", "acceptance_deadline"],
  },
  {
    key: "appointment_letter",
    documentType: "appointment_letter",
    name: "AgencyOS starter appointment letter",
    description:
      "A general appointment-letter structure with replaceable commercial and policy clauses.",
    fileName: "appointment-letter.html",
    customFields: [
      "probation_terms",
      "compensation_summary",
      "working_terms",
      "confidentiality_terms",
      "termination_terms",
      "additional_terms",
    ],
  },
  {
    key: "employment_agreement",
    documentType: "employment_agreement",
    name: "AgencyOS starter employment agreement",
    description:
      "A neutral employment-agreement outline with counsel-review warnings and custom clause placeholders.",
    fileName: "employment-agreement.html",
    customFields: [
      "continuity_terms",
      "working_terms",
      "compensation_summary",
      "probation_terms",
      "leave_terms",
      "confidentiality_terms",
      "policy_terms",
      "termination_terms",
      "governing_law_terms",
      "entire_agreement_terms",
    ],
  },
  {
    key: "nda",
    documentType: "nda",
    name: "AgencyOS starter employee NDA",
    description:
      "A starter employee confidentiality and non-disclosure structure for later replacement.",
    fileName: "nda.html",
    customFields: [
      "confidential_information_definition",
      "recipient_obligations",
      "exclusions",
      "security_and_return_terms",
      "intellectual_property_terms",
      "duration_terms",
      "remedies_and_law",
      "general_terms",
    ],
  },
  {
    key: "experience_letter",
    documentType: "experience_letter",
    name: "AgencyOS starter experience letter",
    description:
      "A factual employment-service confirmation with replaceable role, conduct, and closing wording.",
    fileName: "experience-letter.html",
    customFields: [
      "last_working_date",
      "employment_summary",
      "responsibility_summary",
      "conduct_summary",
      "closing_statement",
    ],
  },
  {
    key: "relieving_letter",
    documentType: "relieving_letter",
    name: "AgencyOS starter relieving letter",
    description:
      "A starter separation confirmation covering release date, handover, clearance, and settlement status.",
    fileName: "relieving-letter.html",
    customFields: [
      "separation_request_date",
      "last_working_date",
      "handover_status",
      "clearance_status",
      "final_settlement_status",
      "continuing_obligations",
      "closing_statement",
    ],
  },
  {
    key: "promotion_letter",
    documentType: "promotion_letter",
    name: "AgencyOS starter promotion letter",
    description:
      "A starter promotion notification with replaceable role, responsibility, compensation, and review terms.",
    fileName: "promotion-letter.html",
    customFields: [
      "current_designation",
      "new_designation",
      "reporting_manager",
      "responsibility_summary",
      "compensation_change_summary",
      "review_terms",
      "acceptance_terms",
    ],
  },
  {
    key: "salary_revision_letter",
    documentType: "salary_revision_letter",
    name: "AgencyOS starter salary revision letter",
    description:
      "A private compensation-revision notice with replaceable previous, revised, and conditional terms.",
    fileName: "salary-revision-letter.html",
    customFields: [
      "review_period",
      "previous_compensation_summary",
      "revised_compensation_summary",
      "component_summary",
      "conditions",
      "confidentiality_note",
    ],
  },
  {
    key: "warning_letter",
    documentType: "warning_letter",
    name: "AgencyOS starter warning letter",
    description:
      "A procedurally neutral starter warning notice requiring organization-specific policy and legal review.",
    fileName: "warning-letter.html",
    customFields: [
      "incident_summary",
      "policy_reference",
      "prior_discussions",
      "required_improvement",
      "review_period",
      "support_available",
      "consequences",
      "employee_response_terms",
    ],
  },
  {
    key: "performance_letter",
    documentType: "performance_letter",
    name: "AgencyOS starter performance letter",
    description:
      "A starter performance-review letter with achievements, development areas, goals, support, and review dates.",
    fileName: "performance-letter.html",
    customFields: [
      "review_period",
      "performance_summary",
      "achievements",
      "development_areas",
      "goals",
      "rating",
      "support_plan",
      "next_review_date",
    ],
  },
] as const;

const builtinByKey = new Map(
  hrBuiltinDocumentTemplates.map((template) => [template.key, template]),
);

export function getHrBuiltinDocumentTemplate(key: string): HrBuiltinDocumentTemplate {
  const template = builtinByKey.get(key as HrDocumentType);
  if (!template) throw new Error("Unknown HR document template.");
  return template;
}

export function humanizeHrDocumentType(type: HrDocumentType): string {
  return type
    .split("_")
    .map((word) => (word === "nda" ? "NDA" : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`))
    .join(" ");
}

export const hrDocumentPlaceholderKeys = [
  "organization.legal_name",
  "organization.display_name",
  "organization.registered_address",
  "employee.legal_name",
  "employee.preferred_name",
  "employee.employee_number",
  "employee.work_email",
  "employee.personal_address",
  "employee.designation",
  "employee.department",
  "employee.manager_name",
  "employee.joining_date",
  "employee.work_location",
  "employee.work_mode",
  "document.title",
  "document.reference",
  "document.issue_date",
  "document.effective_date",
  "document.expiry_date",
  "document.signatory_name",
  "document.signatory_title",
  "template.name",
  "template.version",
] as const;

const fixedPlaceholderSet = new Set<string>(hrDocumentPlaceholderKeys);

export function isSupportedHrDocumentPlaceholder(key: string): boolean {
  return fixedPlaceholderSet.has(key) || /^custom\.[a-z][a-z0-9_]{0,63}$/.test(key);
}

export function parseCustomDocumentFields(value: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = value.split(/\r?\n/);
  if (lines.length > 40) throw new Error("Custom fields are limited to 40 lines.");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("Custom fields must use key = value format.");
    const key = line.slice(0, separator).trim().toLowerCase();
    const fieldValue = line.slice(separator + 1).trim();
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) {
      throw new Error(`Invalid custom field key: ${key || "blank"}.`);
    }
    if (Object.hasOwn(fields, key)) throw new Error(`Duplicate custom field key: ${key}.`);
    if (fieldValue.length > 4000) throw new Error(`Custom field ${key} is too long.`);
    fields[key] = fieldValue;
  }
  return fields;
}
