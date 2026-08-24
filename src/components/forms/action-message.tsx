import { CheckCircle2 } from "lucide-react";

export interface ActionMessageState {
  status: "idle" | "success" | "error";
  message?: string;
}

interface ActionMessageProps {
  state: ActionMessageState;
  variant?: "form" | "inline";
  showSuccessIcon?: boolean;
}

export function ActionMessage({
  state,
  variant = "form",
  showSuccessIcon = false,
}: ActionMessageProps) {
  if (state.status === "idle" || !state.message) return null;

  const className =
    variant === "inline"
      ? `inline-action-message${state.status === "success" ? " is-success" : ""}`
      : `form-message form-message--${state.status}`;

  return (
    <p className={className} role={state.status === "error" ? "alert" : "status"}>
      {showSuccessIcon && state.status === "success" ? (
        <CheckCircle2 size={14} aria-hidden="true" />
      ) : null}
      {state.message}
    </p>
  );
}
