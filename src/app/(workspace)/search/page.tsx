import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { GlobalSearchResults } from "@/components/search/global-search-results";
import { normalizeGlobalSearchQuery } from "@/modules/search/search";
import { searchAuthorizedRecords } from "@/modules/search/server/search";

export const metadata = { title: "Search" };

type SearchPageProps = { searchParams: Promise<{ q?: string | string[] }> };

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = normalizeGlobalSearchQuery(Array.isArray(params.q) ? params.q[0] : params.q);
  const result = await searchAuthorizedRecords(query, 50);
  if (!result.allowed) {
    const nextPath = query ? `/search?q=${encodeURIComponent(query)}` : "/search";
    return <PageAccessFailure reason={result.reason} nextPath={nextPath} />;
  }

  return (
    <div className="module-page search-page">
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Permission-filtered metadata retrieval</p>
          <h1>Global search</h1>
          <p>
            Search business records without exposing restricted record existence, sensitive titles,
            salary data, restricted legal files, or another employee’s private HR documents.
          </p>
        </div>
      </section>
      <form className="search-page-form" method="get">
        <label>
          Search records
          <input
            name="q"
            defaultValue={query}
            minLength={2}
            maxLength={120}
            placeholder="Project, client, ticket, asset, vendor, invoice…"
          />
        </label>
        <button className="button" type="submit">
          Search
        </button>
      </form>
      <GlobalSearchResults data={result.data} />
    </div>
  );
}
