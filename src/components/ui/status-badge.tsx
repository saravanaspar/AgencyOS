import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type StatusTone = "success" | "warning" | "error" | "info" | "neutral";

interface StatusBadgeProps {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
}

export function StatusBadge({ children, tone = "neutral", className }: StatusBadgeProps) {
  return <span className={cn("status-badge", `status-badge--${tone}`, className)}>{children}</span>;
}
