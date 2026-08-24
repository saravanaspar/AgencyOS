import { ArrowLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageNavigationProps {
  backHref: string;
  backLabel: string;
  items: readonly BreadcrumbItem[];
}

export function PageNavigation({ backHref, backLabel, items }: PageNavigationProps) {
  return (
    <div className="subpage-navigation">
      <Link className="subpage-back" href={backHref}>
        <ArrowLeft size={15} aria-hidden="true" />
        {backLabel}
      </Link>

      <nav className="page-breadcrumbs" aria-label="Breadcrumb">
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;

          return (
            <span
              className="page-breadcrumbs__item"
              key={`${item.href ?? "current"}:${item.label}`}
            >
              {index > 0 ? <ChevronRight size={13} aria-hidden="true" /> : null}
              {item.href && !isCurrent ? (
                <Link href={item.href}>{item.label}</Link>
              ) : (
                <span aria-current={isCurrent ? "page" : undefined}>{item.label}</span>
              )}
            </span>
          );
        })}
      </nav>
    </div>
  );
}
