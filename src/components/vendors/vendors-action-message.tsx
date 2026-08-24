import { ActionMessage } from "@/components/forms/action-message";
import type { VendorActionState } from "@/modules/vendors/schemas/vendors";

export function VendorActionMessage({ state }: { state: VendorActionState }) {
  return <ActionMessage state={state} />;
}
