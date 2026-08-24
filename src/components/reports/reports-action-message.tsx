"use client";

import type { ReportActionState } from "@/modules/reports/schemas/reports";

export function ReportsActionMessage({ state }: { state: ReportActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      className={`action-message action-message--${state.status === "error" ? "error" : "success"}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}
