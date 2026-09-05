import { AiWorkspace } from "@/components/ai/ai-workspace";
import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { getAiProviderOptions } from "@/modules/ai/server/config";
import { modulePermissionKeys } from "@/modules/permissions/module-access";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

export const metadata = { title: "AI workspace" };

export default async function AiPage() {
  const access = await authorizeCurrentUser([modulePermissionKeys.ai]);
  if (!access.allowed) {
    return <PageAccessFailure reason={access.reason} nextPath="/ai" />;
  }
  const providers = await getAiProviderOptions(access.context.membership.organizationId);
  return (
    <div className="module-page ai-page">
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Permission-aware operations assistant</p>
          <h1>AI workspace</h1>
          <p>
            Work with live AgencyOS data through approved MCP tools using Gemini or DeepSeek.
            Provider credentials remain server-side, and every tool call is re-authorized.
          </p>
        </div>
      </section>
      <AiWorkspace providers={providers} />
    </div>
  );
}
