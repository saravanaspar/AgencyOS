import { ActionMessage } from "@/components/forms/action-message";
import type { LegalActionState } from "@/modules/legal/schemas/legal";

export function LegalActionMessage({ state }: { state: LegalActionState }) {
  return <ActionMessage state={state} variant="inline" showSuccessIcon />;
}
