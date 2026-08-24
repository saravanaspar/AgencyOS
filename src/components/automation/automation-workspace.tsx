"use client";

import { useActionState } from "react";
import {
  Activity,
  Ban,
  Bot,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  KeyRound,
  Link2,
  LockKeyhole,
  Play,
  Plus,
  RotateCcw,
  Send,
  ShieldAlert,
  Power,
  ShieldCheck,
  Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  createAutomationDefinitionAction,
  createVaultwardenLinkAction,
  revokeVaultwardenLinkAction,
  retryAutomationDispatchAction,
  setAutomationEnabledAction,
} from "@/modules/automation/actions/automation";
import type { AutomationWorkspaceData } from "@/modules/automation/automation";
import type { AutomationActionState } from "@/modules/automation/schemas/automation";
import { getDateTimeFormatter } from "@/lib/intl-formatters";

const initialState: AutomationActionState = { status: "idle" };
const allowedModules = [
  "crm",
  "projects",
  "calendar",
  "finance",
  "hr",
  "support",
  "documents",
  "legal",
  "assets",
  "vendors",
  "approvals",
  "reports",
] as const;

function ActionMessage({ state }: { state: AutomationActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <div
      className={`automation-message${state.status === "success" ? " is-success" : ""}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.status === "success" ? (
        <CheckCircle2 size={15} aria-hidden="true" />
      ) : (
        <CircleAlert size={15} aria-hidden="true" />
      )}
      <span>{state.message}</span>
    </div>
  );
}

function formatDate(value: string | null): string {
  return value
    ? getDateTimeFormatter(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      )
    : "Never";
}

function Summary({ data }: { data: AutomationWorkspaceData }) {
  const deadLetters = data.dispatches.filter(
    (dispatch) => dispatch.status === "dead_letter",
  ).length;
  const pendingApprovals = data.aiIntents.filter(
    (intent) => intent.status === "pending_approval" && intent.approvalStatus === "pending",
  ).length;
  return (
    <section className="automation-summary" aria-label="Automation summary">
      <div>
        <Workflow size={18} aria-hidden="true" />
        <span>Enabled workflows</span>
        <strong>{data.definitions.filter((item) => item.enabled).length}</strong>
      </div>
      <div>
        <Send size={18} aria-hidden="true" />
        <span>Recent dispatches</span>
        <strong>{data.dispatches.length}</strong>
      </div>
      <div>
        <ShieldAlert size={18} aria-hidden="true" />
        <span>Dead letters</span>
        <strong>{deadLetters}</strong>
      </div>
      <div>
        <Bot size={18} aria-hidden="true" />
        <span>AI approvals pending</span>
        <strong>{pendingApprovals}</strong>
      </div>
      <div>
        <KeyRound size={18} aria-hidden="true" />
        <span>Vault references</span>
        <strong>{data.vaultwardenLinks.length}</strong>
      </div>
    </section>
  );
}

function WorkerConfiguration({ data }: { data: AutomationWorkspaceData }) {
  return (
    <section className="automation-card automation-card--wide">
      <header>
        <div>
          <ShieldCheck size={19} aria-hidden="true" />
          <div>
            <h2>AgencyOS worker</h2>
            <p>Runs scheduled jobs and internal automation handlers from this codebase.</p>
          </div>
        </div>
        <StatusBadge tone={data.workerConfigured ? "success" : "warning"}>
          {data.workerConfigured ? "Configured" : "Needs secret"}
        </StatusBadge>
      </header>
      <div className="automation-endpoint">
        <span>Worker command</span>
        <code>npm run worker</code>
      </div>
      <div className="automation-contract-grid">
        <div>
          <strong>Authentication</strong>
          <code>INTERNAL_WORKER_SECRET</code>
          <p>One server-only bearer secret protects every scheduled job.</p>
        </div>
        <div>
          <strong>Execution</strong>
          <code>Redis lease + bounded batch</code>
          <p>Duplicate worker processes safely skip jobs already running.</p>
        </div>
      </div>
      {!data.workerConfigured ? (
        <p className="automation-warning">
          <LockKeyhole size={15} aria-hidden="true" />
          Generate a 32+ character secret, set it in the app and worker environment, then start the
          worker process.
        </p>
      ) : null}
    </section>
  );
}

function DefinitionForm({ data }: { data: AutomationWorkspaceData }) {
  const [state, action, pending] = useActionState(createAutomationDefinitionAction, initialState);
  return (
    <section className="automation-card">
      <header>
        <div>
          <Plus size={19} aria-hidden="true" />
          <div>
            <h2>Create automation record</h2>
            <p>Choose a built-in handler for matching AgencyOS domain events.</p>
          </div>
        </div>
      </header>
      <form action={action} className="automation-form">
        <label className="field">
          <span>Name</span>
          <input name="name" maxLength={160} required />
        </label>
        <label className="field">
          <span>Trigger key</span>
          <input
            name="triggerKey"
            placeholder="projects.project_created"
            pattern="[a-z][a-z0-9._-]{2,119}"
            required
          />
        </label>
        <label className="field">
          <span>Handler</span>
          <select name="handlerKey" required defaultValue="">
            <option value="" disabled>
              Select an internal handler
            </option>
            {data.handlers.map((handler) => (
              <option key={handler.key} value={handler.key}>
                {handler.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="automation-module-picker">
          <legend>Allowed modules</legend>
          {allowedModules.map((module) => (
            <label key={module}>
              <input type="checkbox" name="allowedModules" value={module} /> <span>{module}</span>
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span>Conditions JSON</span>
          <textarea name="conditions" defaultValue="{}" rows={4} spellCheck={false} />
        </label>
        <Button type="submit" disabled={pending}>
          <Plus size={15} aria-hidden="true" />
          {pending ? "Creating" : "Create automation"}
        </Button>
        <ActionMessage state={state} />
      </form>
    </section>
  );
}

function DefinitionList({ data }: { data: AutomationWorkspaceData }) {
  return (
    <section className="automation-card automation-card--wide">
      <header>
        <div>
          <Workflow size={19} aria-hidden="true" />
          <div>
            <h2>Automation definitions</h2>
            <p>Only enabled records route matching events to registered internal handlers.</p>
          </div>
        </div>
      </header>
      {data.definitions.length === 0 ? (
        <div className="automation-empty">
          <Workflow size={22} aria-hidden="true" />
          <p>No automation definitions are registered.</p>
        </div>
      ) : (
        <div className="automation-definition-list">
          {data.definitions.map((definition) => (
            <AutomationDefinitionRow
              key={definition.id}
              definition={definition}
              canManage={data.capabilities.canManageDefinitions}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AutomationDefinitionRow({
  definition,
  canManage,
}: {
  definition: AutomationWorkspaceData["definitions"][number];
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(setAutomationEnabledAction, initialState);
  return (
    <article className="automation-definition">
      <div className="automation-definition__main">
        <div>
          <strong>{definition.name}</strong>
          <small>
            {definition.triggerKey} · handler {definition.handlerKey}
          </small>
        </div>
        <StatusBadge tone={definition.enabled ? "success" : "neutral"}>
          {definition.enabled ? "Enabled" : "Disabled"}
        </StatusBadge>
      </div>
      <dl>
        <div>
          <dt>Owner</dt>
          <dd>{definition.ownerName}</dd>
        </div>
        <div>
          <dt>Last execution</dt>
          <dd>{formatDate(definition.lastExecutionAt)}</dd>
        </div>
        <div>
          <dt>Last result</dt>
          <dd>{definition.lastResult ?? "None"}</dd>
        </div>
        <div>
          <dt>Error count</dt>
          <dd>{definition.errorCount}</dd>
        </div>
      </dl>
      <div className="automation-definition__footer">
        <span>
          {definition.allowedModules.length
            ? definition.allowedModules.join(", ")
            : "No module payloads allowed"}
        </span>
        {canManage ? (
          <form action={action}>
            <input type="hidden" name="automationId" value={definition.id} />
            <input type="hidden" name="enabled" value={String(!definition.enabled)} />
            <Button type="submit" size="sm" variant="secondary" disabled={pending}>
              {definition.enabled ? (
                <Ban size={14} aria-hidden="true" />
              ) : (
                <Power size={14} aria-hidden="true" />
              )}
              {pending ? "Updating" : definition.enabled ? "Disable" : "Enable"}
            </Button>
            <ActionMessage state={state} />
          </form>
        ) : null}
      </div>
    </article>
  );
}

function ExecutionHistory({ data }: { data: AutomationWorkspaceData }) {
  if (!data.capabilities.canViewExecutions) return null;
  return (
    <section className="automation-card automation-card--wide">
      <header>
        <div>
          <Activity size={19} aria-hidden="true" />
          <div>
            <h2>Execution history</h2>
            <p>
              Append-only final results from AgencyOS-owned handlers. Event payloads and secrets are
              not displayed.
            </p>
          </div>
        </div>
      </header>
      {data.executions.length === 0 ? (
        <div className="automation-empty">
          <Activity size={22} aria-hidden="true" />
          <p>No automation executions have completed.</p>
        </div>
      ) : (
        <div className="automation-execution-list">
          {data.executions.map((execution) => (
            <article key={execution.id}>
              <div>
                <strong>{execution.automationName}</strong>
                <small>
                  {execution.executionId} · {execution.sourceModule}
                </small>
              </div>
              <StatusBadge
                tone={
                  execution.status === "succeeded"
                    ? "success"
                    : execution.status === "failed"
                      ? "error"
                      : "info"
                }
              >
                {execution.status}
              </StatusBadge>
              <span>{execution.resultSummary ?? "No result summary"}</span>
              <time dateTime={execution.completedAt}>{formatDate(execution.completedAt)}</time>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function DispatchHistory({ data }: { data: AutomationWorkspaceData }) {
  if (!data.capabilities.canViewExecutions) return null;
  return (
    <section className="automation-card automation-card--wide">
      <header>
        <div>
          <Send size={19} aria-hidden="true" />
          <div>
            <h2>Event dispatch</h2>
            <p>
              Transactional domain events, registered handlers, bounded retries, and dead-letter
              recovery.
            </p>
          </div>
        </div>
        <StatusBadge tone={data.workerConfigured ? "success" : "warning"}>
          {data.workerConfigured ? "Worker ready" : "Worker stopped"}
        </StatusBadge>
      </header>
      {!data.workerConfigured ? (
        <p className="automation-warning">
          <LockKeyhole size={15} aria-hidden="true" />
          Set INTERNAL_WORKER_SECRET and start npm run worker before relying on scheduled execution.
        </p>
      ) : null}
      {data.dispatches.length === 0 ? (
        <div className="automation-empty">
          <Send size={22} aria-hidden="true" />
          <p>No domain events have been routed to an enabled automation.</p>
        </div>
      ) : (
        <div className="automation-dispatch-list">
          {data.dispatches.map((dispatch) => (
            <DispatchRow
              key={dispatch.id}
              dispatch={dispatch}
              canRetry={data.capabilities.canRetryDispatches}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DispatchRow({
  dispatch,
  canRetry,
}: {
  dispatch: AutomationWorkspaceData["dispatches"][number];
  canRetry: boolean;
}) {
  const [state, action, pending] = useActionState(retryAutomationDispatchAction, initialState);
  const tone =
    dispatch.status === "delivered"
      ? "success"
      : dispatch.status === "dead_letter"
        ? "error"
        : dispatch.status === "retry"
          ? "warning"
          : "info";
  return (
    <article className="automation-dispatch">
      <div className="automation-dispatch__identity">
        <strong>{dispatch.eventKey}</strong>
        <small>
          {dispatch.automationName} · handler {dispatch.handlerKey}
        </small>
      </div>
      <StatusBadge tone={tone}>{dispatch.status.replace("_", " ")}</StatusBadge>
      <dl>
        <div>
          <dt>Record</dt>
          <dd>
            {dispatch.entityType} · {dispatch.entityId}
          </dd>
        </div>
        <div>
          <dt>Attempts</dt>
          <dd>
            {dispatch.attemptCount}/{dispatch.maxAttempts}
          </dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd>{formatDate(dispatch.availableAt)}</dd>
        </div>
        <div>
          <dt>Result</dt>
          <dd>
            {dispatch.lastErrorCode ?? (dispatch.status === "delivered" ? "Completed" : "Pending")}
          </dd>
        </div>
      </dl>
      {dispatch.lastErrorSummary ? <p>{dispatch.lastErrorSummary}</p> : null}
      {dispatch.status === "dead_letter" && canRetry ? (
        <form action={action} className="automation-dispatch__retry">
          <input type="hidden" name="dispatchId" value={dispatch.id} />
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            <RotateCcw size={14} aria-hidden="true" />
            {pending ? "Queueing" : "Retry dispatch"}
          </Button>
          <ActionMessage state={state} />
        </form>
      ) : null}
    </article>
  );
}

function AiGovernance({ data }: { data: AutomationWorkspaceData }) {
  if (!data.capabilities.canViewAiExecutions) return null;
  return (
    <section className="automation-card automation-card--wide">
      <header>
        <div>
          <Bot size={19} aria-hidden="true" />
          <div>
            <h2>Permission-aware AI</h2>
            <p>
              MCP reauthorizes every call, bounds model data, redacts evidence, and gates sensitive
              mutations through Approvals.
            </p>
          </div>
        </div>
        <StatusBadge tone={data.aiApprovalPolicyConfigured ? "success" : "warning"}>
          {data.aiApprovalPolicyConfigured ? "Approval policy active" : "Policy required"}
        </StatusBadge>
      </header>
      {!data.aiApprovalPolicyConfigured ? (
        <p className="automation-warning">
          <ShieldAlert size={15} aria-hidden="true" />
          Create an active approval policy with key <code>ai_sensitive_operation</code>, source
          module <code>automation</code>, and entity type <code>ai_tool_call</code>.
        </p>
      ) : null}
      <div className="automation-ai-grid">
        <section>
          <h3>Sensitive mutation intents</h3>
          {data.aiIntents.length === 0 ? (
            <p className="automation-empty-copy">No sensitive AI mutation requests recorded.</p>
          ) : (
            <div className="automation-ai-list">
              {data.aiIntents.map((intent) => (
                <article key={intent.id}>
                  <div>
                    <strong>{intent.toolName}</strong>
                    <small>
                      {intent.requesterName} · {formatDate(intent.createdAt)}
                    </small>
                  </div>
                  <StatusBadge
                    tone={
                      intent.status === "executed"
                        ? "success"
                        : intent.status === "failed"
                          ? "error"
                          : "warning"
                    }
                  >
                    {intent.approvalStatus ?? intent.status.replace("_", " ")}
                  </StatusBadge>
                </article>
              ))}
            </div>
          )}
        </section>
        <section>
          <h3>Recent governed executions</h3>
          {data.aiExecutions.length === 0 ? (
            <p className="automation-empty-copy">No MCP execution evidence recorded.</p>
          ) : (
            <div className="automation-ai-list">
              {data.aiExecutions.map((execution) => (
                <article key={execution.id}>
                  <div>
                    <strong>{execution.toolName}</strong>
                    <small>
                      {execution.actorName} · {execution.operationMode.replace("_", " ")}
                    </small>
                  </div>
                  <StatusBadge
                    tone={
                      execution.status === "succeeded"
                        ? "success"
                        : execution.status === "failed"
                          ? "error"
                          : "info"
                    }
                  >
                    {execution.status.replace("_", " ")}
                  </StatusBadge>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function VaultwardenSection({ data }: { data: AutomationWorkspaceData }) {
  const [linkState, linkAction, linking] = useActionState(
    createVaultwardenLinkAction,
    initialState,
  );
  const [vendorState, vendorAction, vendorLinking] = useActionState(
    createVaultwardenLinkAction,
    initialState,
  );
  return (
    <section className="automation-card automation-card--wide">
      <header>
        <div>
          <KeyRound size={19} aria-hidden="true" />
          <div>
            <h2>Vaultwarden item links</h2>
            <p>
              AgencyOS stores only item UUID references. Vault contents and sessions remain in
              Vaultwarden.
            </p>
          </div>
        </div>
        <StatusBadge tone={data.vaultwardenConfigured ? "success" : "warning"}>
          {data.vaultwardenConfigured ? "Open links ready" : "Base URL missing"}
        </StatusBadge>
      </header>
      {data.capabilities.canManageVaultwardenLinks ? (
        <div className="vaultwarden-form-grid">
          <form action={linkAction} className="automation-form">
            <h3>Link a project or client</h3>
            <label className="field">
              <span>Record</span>
              <select name="entityTarget" required defaultValue="">
                <option value="">Choose a record</option>
                <optgroup label="Projects">
                  {data.entityOptions
                    .filter((item) => item.entityType === "project")
                    .map((item) => (
                      <option key={item.id} value={`project:${item.id}`}>
                        {item.label}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Clients">
                  {data.entityOptions
                    .filter((item) => item.entityType === "client")
                    .map((item) => (
                      <option key={item.id} value={`client:${item.id}`}>
                        {item.label}
                      </option>
                    ))}
                </optgroup>
              </select>
            </label>
            <label className="field">
              <span>Vaultwarden item UUID</span>
              <input
                name="itemReference"
                required
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </label>
            <Button type="submit" disabled={linking}>
              <Link2 size={14} aria-hidden="true" />
              {linking ? "Linking" : "Link item"}
            </Button>
            <ActionMessage state={linkState} />
          </form>
          <form action={vendorAction} className="automation-form">
            <h3>Link a vendor reference</h3>
            <input type="hidden" name="entityType" value="vendor" />
            <label className="field">
              <span>Vendor record UUID</span>
              <input name="entityId" required />
            </label>
            <label className="field">
              <span>Vendor label</span>
              <input name="entityLabel" maxLength={180} required />
            </label>
            <label className="field">
              <span>Vaultwarden item UUID</span>
              <input name="itemReference" required />
            </label>
            <Button type="submit" disabled={vendorLinking}>
              <Link2 size={14} aria-hidden="true" />
              {vendorLinking ? "Linking" : "Link vendor item"}
            </Button>
            <ActionMessage state={vendorState} />
          </form>
        </div>
      ) : null}
      {!data.vaultwardenConfigured ? (
        <p className="automation-warning">
          <LockKeyhole size={15} aria-hidden="true" />
          Set <code>VAULTWARDEN_URL</code> to enable Open Vaultwarden buttons. References can still
          be recorded.
        </p>
      ) : null}
      {data.vaultwardenLinks.length === 0 ? (
        <div className="automation-empty">
          <KeyRound size={22} aria-hidden="true" />
          <p>No authorized Vaultwarden references are linked.</p>
        </div>
      ) : (
        <div className="vaultwarden-link-list">
          {data.vaultwardenLinks.map((link) => (
            <VaultLinkRow
              key={link.id}
              link={link}
              canManage={data.capabilities.canManageVaultwardenLinks}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function VaultLinkRow({
  link,
  canManage,
}: {
  link: AutomationWorkspaceData["vaultwardenLinks"][number];
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(revokeVaultwardenLinkAction, initialState);
  return (
    <article>
      <div>
        <strong>{link.entityLabel}</strong>
        <small>
          {link.entityType} · item {link.itemReference}
        </small>
      </div>
      <div className="vaultwarden-link-actions">
        {link.openUrl ? (
          <a
            className="button button--secondary button--sm"
            href={link.openUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={14} aria-hidden="true" />
            Open Vaultwarden
          </a>
        ) : null}
        {canManage ? (
          <form action={action}>
            <input type="hidden" name="linkId" value={link.id} />
            <Button type="submit" size="sm" variant="ghost" disabled={pending}>
              <Ban size={14} aria-hidden="true" />
              {pending ? "Removing" : "Remove"}
            </Button>
            <ActionMessage state={state} />
          </form>
        ) : null}
      </div>
    </article>
  );
}

export function AutomationWorkspace({ data }: { data: AutomationWorkspaceData }) {
  return (
    <div className="automation-workspace">
      <Summary data={data} />
      <WorkerConfiguration data={data} />
      <div className="automation-grid">
        {data.capabilities.canManageDefinitions ? <DefinitionForm data={data} /> : null}
        <DefinitionList data={data} />
      </div>
      <DispatchHistory data={data} />
      <ExecutionHistory data={data} />
      <AiGovernance data={data} />
      <VaultwardenSection data={data} />
      <section className="automation-security-note">
        <Play size={18} aria-hidden="true" />
        <div>
          <strong>Execution boundary</strong>
          <p>
            AgencyOS handlers receive only bounded domain-event data and run under fixed registry
            keys. MCP never accepts files, credentials, secrets, or raw private payloads, and
            sensitive mutations remain blocked until approved.
          </p>
        </div>
      </section>
    </div>
  );
}
