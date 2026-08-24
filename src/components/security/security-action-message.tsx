"use client";

import type { SecurityActionState } from "@/modules/security/schemas/security";

export function SecurityActionMessage({ state }: { state: SecurityActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      className={`action-message action-message--${state.status}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}
