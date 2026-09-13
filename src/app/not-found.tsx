import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { BrandLogo } from "@/components/brand/brand-logo";

export default function NotFound() {
  return (
    <main className="standalone-state">
      <BrandLogo className="standalone-state__brand" priority />
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
