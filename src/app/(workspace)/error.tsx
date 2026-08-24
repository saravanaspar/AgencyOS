"use client";

import { CircleAlert, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function WorkspaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="error-state" role="alert">
      <span className="error-state__icon">
        <CircleAlert size={24} />
      </span>
      <div>
        <h1>We could not load this workspace</h1>
        <p>
          The request failed before AgencyOS could show the page. Retry the request. If it fails
          again, contact your administrator with the time of the error.
        </p>
        <Button onClick={reset}>
          <RotateCcw size={16} />
          Retry request
        </Button>
      </div>
    </section>
  );
}
