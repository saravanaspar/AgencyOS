"use client";

import { CheckCircle2 } from "lucide-react";

import type { ProjectActionState } from "@/modules/projects/schemas/projects";

export function ProjectActionMessage({ state }: { state: ProjectActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <div
      className={`project-action-message${state.status === "success" ? " is-success" : ""}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.status === "success" ? <CheckCircle2 size={15} aria-hidden="true" /> : null}
      <div>
        <p>{state.message}</p>
        {state.fieldErrors ? (
          <ul>
            {Object.entries(state.fieldErrors).flatMap(([field, messages]) =>
              messages.map((message) => <li key={`${field}-${message}`}>{message}</li>),
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
