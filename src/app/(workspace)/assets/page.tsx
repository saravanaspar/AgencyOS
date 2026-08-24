import { AssetsWorkspace } from "@/components/assets/assets-workspace";
import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { getAssetWorkspaceData } from "@/modules/assets/server/assets";
import { assetStatusLabels, assetStatuses } from "@/modules/assets/assets";

export const metadata = { title: "Assets" };

type AssetsPageProps = {
  searchParams: Promise<{ q?: string; status?: string; category?: string }>;
};

export default async function AssetsPage({ searchParams }: AssetsPageProps) {
  const filters = await searchParams;
  const result = await getAssetWorkspaceData(filters);
  if (!result.allowed) {
    return <PageAccessFailure reason={result.reason} nextPath="/assets" />;
  }
  return (
    <div className="module-page">
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Equipment custody and lifecycle</p>
          <h1>Assets</h1>
          <p>
            Register company equipment, assign it to employees, preserve checkout and return
            condition history, monitor warranties and maintenance, record depreciation metadata,
            document disposal, and attach scanner-gated files.
          </p>
        </div>
      </section>
      <form className="asset-filter-bar" method="get">
        <label>
          Search
          <input
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Tag, serial, name, model, or assignee"
          />
        </label>
        <label>
          Status
          <select name="status" defaultValue={filters.status ?? "all"}>
            <option value="all">All statuses</option>
            {assetStatuses.map((status) => (
              <option key={status} value={status}>
                {assetStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select name="category" defaultValue={filters.category ?? "all"}>
            <option value="all">All categories</option>
            {result.data.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="button button--secondary">
          Apply filters
        </button>
      </form>
      <AssetsWorkspace data={result.data} />
    </div>
  );
}
