import { ActionMessage } from "@/components/forms/action-message";
import type { SupportActionState } from "@/modules/support/schemas/support";

export function SupportActionMessage({ state }: { state: SupportActionState }) {
  return <ActionMessage state={state} />;
}
