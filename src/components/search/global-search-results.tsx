import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";

import { globalSearchKindLabels, type GlobalSearchResponse } from "@/modules/search/search";

export function GlobalSearchResults({ data }: { data: GlobalSearchResponse }) {
  if (data.query.length < 2) {
    return (
      <section className="global-search-empty">
        <Search aria-hidden="true" size={28} />
        <h2>Search authorized records</h2>
        <p>
          Enter at least two characters. Results are filtered before display by your effective
          permissions and record scope.
        </p>
      </section>
    );
  }
  if (data.items.length === 0) {
    return (
      <section className="global-search-empty">
        <Search aria-hidden="true" size={28} />
        <h2>No authorized results for “{data.query}”</h2>
        <p>
          Try a record name, identifier, project code, ticket number, asset tag, vendor, estimate,
          or invoice reference.
        </p>
      </section>
    );
  }

  const groups = data.items.reduce<Map<string, typeof data.items>>((result, item) => {
    const items = result.get(item.module) ?? [];
    items.push(item);
    result.set(item.module, items);
    return result;
  }, new Map());
  return (
    <div className="global-search-results">
      {[...groups.entries()].map(([module, items]) => (
        <section className="global-search-group" key={module}>
          <header>
            <h2>{module}</h2>
            <span>
              {items.length} result{items.length === 1 ? "" : "s"}
            </span>
          </header>
          <div>
            {items.map((item) => (
              <Link
                className="global-search-result"
                href={item.href}
                key={`${item.kind}:${item.id}`}
              >
                <span className="global-search-result__kind">
                  {globalSearchKindLabels[item.kind]}
                </span>
                <span className="global-search-result__copy">
                  <strong>{item.title}</strong>
                  {item.subtitle ? <small>{item.subtitle}</small> : null}
                </span>
                {item.badge ? (
                  <span className="status-chip">{item.badge.replaceAll("_", " ")}</span>
                ) : null}
                <ArrowRight aria-hidden="true" size={16} />
              </Link>
            ))}
          </div>
        </section>
      ))}
      {data.truncated ? (
        <p className="search-truncated">
          More authorized matches exist. Refine the query to narrow the results.
        </p>
      ) : null}
    </div>
  );
}
