import { redirect } from "next/navigation";

import type { CrmOAuthResult } from "@/components/crm/crm-import-center";
import { CrmWorkspace } from "@/components/crm/crm-workspace";
import { AccessCheckRetry } from "@/components/feedback/access-check-retry";
import { crmFiltersSchema } from "@/modules/crm/schemas/crm";
import { getCrmWorkspaceData } from "@/modules/crm/server/crm";

export const metadata = { title: "CRM" };

interface CrmPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CrmPage({ searchParams }: CrmPageProps) {
  const raw = await searchParams;
  const filters = crmFiltersSchema.parse({
    q: firstValue(raw.q),
    stage: firstValue(raw.stage),
    owner: firstValue(raw.owner),
    status: firstValue(raw.status),
    currency: firstValue(raw.currency),
    scope: firstValue(raw.scope),
    page: firstValue(raw.page),
  });
  const rawOAuthResult = firstValue(raw.oauth);
  const oauthResult: CrmOAuthResult | null = [
    "connected",
    "cancelled",
    "failed",
    "configuration-error",
  ].includes(rawOAuthResult ?? "")
    ? (rawOAuthResult as CrmOAuthResult)
    : null;
  const requestedTab = firstValue(raw.tab);
  const initialTab = oauthResult
    ? "imports"
    : requestedTab &&
        ["pipeline", "forecast", "companies", "contacts", "activity", "imports"].includes(
          requestedTab,
        )
      ? (requestedTab as
          "pipeline" | "forecast" | "companies" | "contacts" | "activity" | "imports")
      : firstValue(raw.company)
        ? "companies"
        : firstValue(raw.contact)
          ? "contacts"
          : "pipeline";
  const result = await getCrmWorkspaceData(filters);

  if (!result.allowed) {
    if (result.reason === "access-check-failed") return <AccessCheckRetry />;
    if (result.reason === "signed-out") redirect("/login?next=/crm");
    redirect(`/access-denied?reason=${result.reason}`);
  }

  return (
    <div className="module-page crm-page">
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Relationship operations</p>
          <h1>CRM pipeline</h1>
          <p>
            Manage companies, contacts, qualified opportunities, ownership, conversion, and the
            activity history available to your role scope.
          </p>
        </div>
      </section>
      <CrmWorkspace data={result.data} initialTab={initialTab} oauthResult={oauthResult} />
    </div>
  );
}
