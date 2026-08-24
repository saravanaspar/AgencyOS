import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="standalone-state">
      <span className="brand-mark" aria-hidden="true">
        AO
      </span>
      <p className="standalone-state__code">404</p>
      <h1>Page not found</h1>
      <p>The address does not match an AgencyOS page, or your role no longer has access.</p>
      <Link className="button button--primary button--md" href="/dashboard">
        <ArrowLeft size={16} />
        Return to dashboard
      </Link>
    </main>
  );
}
