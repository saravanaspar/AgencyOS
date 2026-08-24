import type { CalendarActionState } from "@/modules/calendar/schemas/calendar";

export function CalendarActionMessage({ state }: { state: CalendarActionState }) {
  if (state.status === "idle") return null;
  return (
    <p className={`form-message form-message--${state.status}`} role="status">
      {state.message}
    </p>
  );
}
