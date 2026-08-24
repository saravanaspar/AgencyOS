"use client";

import { RefreshCw, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

export function AccessCheckRetry({
  title = "Access check temporarily unavailable",
  message = "AgencyOS could not verify your current permissions after several attempts. Your account has not been locked. Retry the request in a moment.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <main className="access-check-retry">
      <span className="access-check-retry__icon">
        <ShieldAlert size={24} aria-hidden="true" />
      </span>
      <div>
        <h1>{title}</h1>
        <p>{message}</p>
        <Button type="button" onClick={() => window.location.reload()}>
          <RefreshCw size={15} aria-hidden="true" />
          Retry access check
        </Button>
      </div>
    </main>
  );
}
