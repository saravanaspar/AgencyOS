import { redirect } from "next/navigation";

import { FinanceWorkspace } from "@/components/finance/finance-workspace";
import { AccessCheckRetry } from "@/components/feedback/access-check-retry";
import { parseFinanceFilters } from "@/modules/finance/schemas/finance";
import { getFinanceWorkspaceData } from "@/modules/finance/server/finance";

export const metadata = { title: "Finance" };

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFinanceFilters(await searchParams);
  const result = await getFinanceWorkspaceData(filters);

  if (!result.allowed) {
    if (result.reason === "access-check-failed") return <AccessCheckRetry />;
    if (result.reason === "signed-out") redirect("/login?next=/finance");
    redirect(`/access-denied?reason=${result.reason}`);
  }

  return (
    <div className="module-page finance-page">
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Billing operations</p>
          <h1>Finance</h1>
          <p>
            Build estimates and invoices, record payments and expenses, preserve billing evidence,
            and review financial reports and client statements within your permission scope.
          </p>
        </div>
      </section>
      <FinanceWorkspace data={result.data} />
    </div>
  );
}
