import { ActionMessage } from "@/components/forms/action-message";
import type { HrActionState } from "@/modules/hr/schemas/hr";

export function HrActionMessage({ state }: { state: HrActionState }) {
  return <ActionMessage state={state} variant="inline" showSuccessIcon />;
}
