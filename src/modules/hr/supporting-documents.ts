export const hrSupportingDocumentCategories = [
  "identification",
  "education",
  "certificate",
  "visa_work_permit",
  "background_check",
  "exit_document",
] as const;

export type HrSupportingDocumentCategory = (typeof hrSupportingDocumentCategories)[number];
export type HrSupportingDocumentReviewStatus = "pending" | "verified" | "rejected";
export type HrSupportingDocumentStatus = "current" | "superseded" | "withdrawn";

export interface HrSupportingDocumentCategoryDefinition {
  category: HrSupportingDocumentCategory;
  label: string;
  description: string;
  selfUploadAllowed: boolean;
  defaultEmployeeVisible: boolean;
  identifierSuffixAllowed: boolean;
}

export const hrSupportingDocumentCategoryDefinitions: readonly HrSupportingDocumentCategoryDefinition[] =
  [
    {
      category: "identification",
      label: "Identification",
      description:
        "Government or organization-issued identity evidence. Store only the final four identifier characters as metadata.",
      selfUploadAllowed: true,
      defaultEmployeeVisible: true,
      identifierSuffixAllowed: true,
    },
    {
      category: "education",
      label: "Education",
      description: "Degrees, diplomas, transcripts, and other education evidence.",
      selfUploadAllowed: true,
      defaultEmployeeVisible: true,
      identifierSuffixAllowed: false,
    },
    {
      category: "certificate",
      label: "Certificates",
      description: "Professional certificates, licences, and training completion evidence.",
      selfUploadAllowed: true,
      defaultEmployeeVisible: true,
      identifierSuffixAllowed: true,
    },
    {
      category: "visa_work_permit",
      label: "Visa or work permit",
      description: "Visa, residence, immigration, or work-authorization evidence.",
      selfUploadAllowed: true,
      defaultEmployeeVisible: true,
      identifierSuffixAllowed: true,
    },
    {
      category: "background_check",
      label: "Background check",
      description:
        "Restricted screening, verification, and background-check evidence managed by HR.",
      selfUploadAllowed: false,
      defaultEmployeeVisible: false,
      identifierSuffixAllowed: false,
    },
    {
      category: "exit_document",
      label: "Exit document",
      description:
        "Resignation, clearance, handover, settlement, or exit-interview evidence managed by HR.",
      selfUploadAllowed: false,
      defaultEmployeeVisible: true,
      identifierSuffixAllowed: false,
    },
  ] as const;

const categoryByKey = new Map(
  hrSupportingDocumentCategoryDefinitions.map((definition) => [definition.category, definition]),
);

export function getHrSupportingDocumentCategoryDefinition(
  category: HrSupportingDocumentCategory,
): HrSupportingDocumentCategoryDefinition {
  const definition = categoryByKey.get(category);
  if (!definition) throw new Error("Unknown supporting-document category.");
  return definition;
}

export function humanizeHrSupportingDocumentCategory(
  category: HrSupportingDocumentCategory,
): string {
  return getHrSupportingDocumentCategoryDefinition(category).label;
}

export function maskHrSupportingDocumentIdentifier(suffix: string | null): string {
  return suffix ? `•••• ${suffix}` : "Not recorded";
}

export function buildHrSupportingDocumentReference(
  category: HrSupportingDocumentCategory,
  title: string,
): string {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, " ");
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const categoryCode = category
    .split("_")
    .map((part) => part.slice(0, 3).toUpperCase())
    .join("-");
  return `SUP-${categoryCode}-${(hash >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

export function containsLikelyFullIdentifier(value: string): boolean {
  const tokens = value.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  return tokens.some((token) => token.length >= 7 && token.length <= 24 && /[0-9]/.test(token));
}
