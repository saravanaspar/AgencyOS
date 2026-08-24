import { ActionMessage } from "@/components/forms/action-message";
import type { DocumentActionState } from "@/modules/documents/schemas/documents";

export function DocumentActionMessage({ state }: { state: DocumentActionState }) {
  return <ActionMessage state={state} variant="inline" showSuccessIcon />;
}
