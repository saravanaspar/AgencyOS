import { ActionMessage } from "@/components/forms/action-message";
import type { AssetActionState } from "@/modules/assets/schemas/assets";

export function AssetActionMessage({ state }: { state: AssetActionState }) {
  return <ActionMessage state={state} />;
}
