import { ArrowRight, CheckCircle2, Construction, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { moduleRegistry } from "@/modules/module-registry";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

interface ModulePageProps {
  params: Promise<{ module: string }>;
}

export default async function ModulePage({ params }: ModulePageProps) {
  const { module } = await params;
  const definition = moduleRegistry[module];

  if (!definition) notFound();

  const access = await authorizeCurrentUser(definition.requiredPermissions);
  if (!access.allowed) {
    return <PageAccessFailure reason={access.reason} nextPath={`/${module}`} />;
  }

  return (
    <div className="module-page">
      <section className="page-heading module-page__heading">
        <div>
          <div className="module-page__status">
            <StatusBadge tone="info">{definition.stage}</StatusBadge>
            <span>Foundation route active</span>
          </div>
          <h1>{definition.label}</h1>
          <p>{definition.summary}</p>
        </div>
        <Button disabled aria-describedby="module-foundation-note">
          {definition.primaryAction}
        </Button>
      </section>

      <section className="module-foundation" id="module-foundation-note">
        <div className="module-foundation__main">
          <span className="module-foundation__icon">
            <Construction size={24} aria-hidden="true" />
          </span>
          <div>
            <h2>The shared platform is ready for this module</h2>
            <p>
              Navigation, responsive layout, design tokens, loading and error states, and the typed
              permission-key foundation are in place. Business data and server adapters will be
              added in the stage shown above.
            </p>
          </div>
        </div>

        <div className="module-foundation__grid">
          <div>
            <h3>First capabilities</h3>
            <ul>
              {definition.firstCapabilities.map((capability) => (
                <li key={capability}>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  {capability}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Release gate</h3>
            <p>
              <ShieldCheck size={17} aria-hidden="true" />
              This module will not ship until authorization, validation, audit, loading, empty,
              error, and permission tests are complete.
            </p>
            <Link className="text-link" href="/dashboard">
              Return to operations overview <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
