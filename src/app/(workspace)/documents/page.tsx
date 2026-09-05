import { DocumentWorkspace } from "@/components/documents/document-workspace";
import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { getDocumentWorkspaceData } from "@/modules/documents/server/documents";

export const metadata = { title: "Documents" };

type DocumentsPageProps = {
  searchParams: Promise<{ q?: string; status?: string; folder?: string }>;
};

export default async function DocumentsPage({ searchParams }: DocumentsPageProps) {
  const filters = await searchParams;
  const result = await getDocumentWorkspaceData({
    query: filters.q,
    status: filters.status,
    folderId: filters.folder,
  });
  if (!result.allowed) {
    return <PageAccessFailure reason={result.reason} nextPath="/documents" />;
  }
  return (
    <div className="module-page">
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Private document library</p>
          <h1>Documents</h1>
          <p>
            Store scanner-gated private files with immutable versions, folders, categories, tags,
            business-record links, controlled access, retention dates, legal holds, comments, and
            complete preview and download history.
          </p>
        </div>
      </section>
      <DocumentWorkspace data={result.data} />
    </div>
  );
}
