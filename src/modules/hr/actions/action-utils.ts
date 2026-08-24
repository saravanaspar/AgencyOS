import type { HrActionState } from "@/modules/hr/schemas/hr";

export class HrActionError extends Error {}

export function stateError(message: string, fieldErrors?: Record<string, string[]>): HrActionState {
  return { status: "error", message, fieldErrors };
}

export function formText(formData: FormData, key: string): FormDataEntryValue | null {
  return formData.get(key);
}

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}
