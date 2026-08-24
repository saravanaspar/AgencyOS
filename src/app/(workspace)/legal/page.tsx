import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { LegalWorkspace } from "@/components/legal/legal-workspace";
import { getLegalAccessReviewWorkspaceData } from "@/modules/legal/server/access-review";
import { getLegalComplianceWorkspaceData } from "@/modules/legal/server/compliance";
import { getLegalDeletionWorkspaceData } from "@/modules/legal/server/deletion";
import { getLegalWorkspaceData } from "@/modules/legal/server/legal";

export const metadata = { title: "Legal" };

type LegalPageProps = {
  searchParams: Promise<{
    q?: string;
    status?: string;
    recordType?: string;
    recordStatus?: string;
  }>;
};

export default async function LegalPage({ searchParams }: LegalPageProps) {
  const filters = await searchParams;
  const [result, complianceResult, deletionResult, accessReviewResult] = await Promise.all([
    getLegalWorkspaceData({ query: filters.q, status: filters.status }),
    getLegalComplianceWorkspaceData({
      query: filters.q,
      type: filters.recordType,
      status: filters.recordStatus,
    }),
    getLegalDeletionWorkspaceData(),
    getLegalAccessReviewWorkspaceData(),
  ]);
  if (!result.allowed) {
    return <PageAccessFailure reason={result.reason} nextPath="/legal" />;
  }
  if (!complianceResult.allowed) {
    return <PageAccessFailure reason={complianceResult.reason} nextPath="/legal" />;
  }
  return (
    <div className="module-page">
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Contract governance</p>
          <h1>Legal</h1>
          <p>
            Create contract requests, select immutable templates, track commercial and legal
            metadata, route sequential reviews, preserve every version, manage signatures, and
            control activation, renewal, termination, and expiry, govern corporate, tax, licence,
            insurance, IP, notice, and dispute records, and enforce controlled retention-aware
            deletion.
          </p>
        </div>
      </section>
      <LegalWorkspace
        data={result.data}
        complianceData={complianceResult.data}
        deletionData={deletionResult.allowed ? deletionResult.data : null}
        accessReviewData={accessReviewResult.allowed ? accessReviewResult.data : null}
      />
    </div>
  );
}
