import { ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { AccessCheckRetry } from "@/components/feedback/access-check-retry";
import { ApprovalWorkspace } from "@/components/approvals/approval-workspace";
import { approvalFiltersSchema } from "@/modules/approvals/schemas/approvals";
import { getApprovalWorkspaceData } from "@/modules/approvals/server/approvals";

export const metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

interface ApprovalsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ApprovalsPage({ searchParams }: ApprovalsPageProps) {
  const parsed = approvalFiltersSchema.safeParse(await searchParams);
  if (!parsed.success) redirect("/approvals");

  const result = await getApprovalWorkspaceData(parsed.data);
  if (!result.allowed) {
    if (result.reason === "access-check-failed") return <AccessCheckRetry />;
    if (result.reason === "signed-out") redirect("/login?next=/approvals");
    redirect(`/access-denied?reason=${result.reason}`);
  }

  const { data } = result;
  if (data.filters.page !== data.pagination.page || data.filters.view !== parsed.data.view) {
    const params = new URLSearchParams();
    if (data.filters.view !== "inbox") params.set("view", data.filters.view);
    if (data.filters.status !== "all") params.set("status", data.filters.status);
    if (data.filters.q) params.set("q", data.filters.q);
    if (data.pagination.page > 1) params.set("page", String(data.pagination.page));
    redirect(params.size ? `/approvals?${params.toString()}` : "/approvals");
  }

  return (
    <div className="module-page approval-page">
      <section className="page-heading module-page__heading">
        <div>
          <span className="page-heading__eyebrow">
            <ShieldCheck size={16} aria-hidden="true" /> Shared platform
          </span>
          <h1>Approvals</h1>
          <p>
            Submit immutable record snapshots, route sequential or parallel decisions, and retain
            complete approval history across every AgencyOS module.
          </p>
        </div>
      </section>
      <ApprovalWorkspace data={data} />
    </div>
  );
}
