"use client";

import { useActionState, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BellRing,
  CheckCircle2,
  Clipboard,
  CloudDownload,
  FileSpreadsheet,
  KeyRound,
  Link2,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  acknowledgeCrmConnectionNotificationAction,
  checkCrmConnectionHealthAction,
  createCrmConnectionAction,
  deleteCrmConnectionAction,
  rotateCrmConnectionCredentialsAction,
  setCrmConnectionStatusAction,
  syncCrmConnectionAction,
  updateCrmConnectionScheduleAction,
} from "@/modules/crm/actions/imports";
import {
  crmImportProviderLabels,
  crmImportProviders,
  crmPullAuthenticationMethodLabels,
  crmPullProviderAuthenticationMethods,
  crmPullProviderDefaultAuthenticationMethod,
  isCrmPullProvider,
  type CrmImportProvider,
  type CrmPullAuthenticationMethod,
} from "@/modules/crm/crm-import-providers";
import { crmSyncIntervalOptions } from "@/modules/crm/crm-connector-sync";
import type { CrmImportActionState } from "@/modules/crm/schemas/imports";
import type { CrmWorkspaceData } from "@/modules/crm/server/crm";
import type {
  CrmConnectionNotification,
  CrmImportConnection,
  CrmImportErrorSummary,
} from "@/modules/crm/server/imports";
import { getDateTimeFormatter } from "@/lib/intl-formatters";

const initialState: CrmImportActionState = { status: "idle" };

export type CrmOAuthResult = "connected" | "cancelled" | "failed" | "configuration-error";

function OAuthResultMessage({ result }: { result: CrmOAuthResult | null }) {
  if (!result) return null;
  const connected = result === "connected";
  const message = connected
    ? "CRM OAuth authorization completed. The connection is ready for health checks and sync."
    : result === "cancelled"
      ? "OAuth authorization was cancelled. The connection remains paused."
      : result === "configuration-error"
        ? "OAuth could not start. Verify the saved client-owned app credentials, callback URL, and APP_URL."
        : "OAuth authorization failed or expired. Start the connection flow again.";
  return (
    <div
      className={`crm-action-message${connected ? " is-success" : ""}`}
      role={connected ? "status" : "alert"}
    >
      {connected ? <CheckCircle2 size={15} aria-hidden="true" /> : null}
      <p>{message}</p>
    </div>
  );
}

function ActionMessage({ state }: { state: CrmImportActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <div
      className={`crm-action-message${state.status === "success" ? " is-success" : ""}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.status === "success" ? <CheckCircle2 size={15} aria-hidden="true" /> : null}
      <div>
        <p>{state.message}</p>
        {state.oneTimeSecret ? (
          <div className="crm-import-secret">
            <strong>Copy this one-time webhook secret now</strong>
            <code>{state.oneTimeSecret}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(state.oneTimeSecret ?? "")}
            >
              <Clipboard size={14} aria-hidden="true" /> Copy secret
            </button>
          </div>
        ) : null}
        {state.oauthStartPath ? (
          <a className="button button--primary button--sm" href={state.oauthStartPath}>
            <KeyRound size={14} aria-hidden="true" /> Authorize with OAuth
          </a>
        ) : null}
      </div>
    </div>
  );
}

function FileImportForm({ data }: { data: CrmWorkspaceData }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    status: "idle" | "error" | "success";
    message?: string;
  }>({ status: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setResult({ status: "idle" });
    try {
      const response = await fetch("/api/crm/imports/file", {
        method: "POST",
        body: new FormData(form),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        outcome?: {
          createdCount: number;
          mergedCount: number;
          skippedCount: number;
          failedCount: number;
        };
      };
      if (!response.ok || !payload.ok || !payload.outcome) {
        setResult({ status: "error", message: payload.message ?? "The import failed." });
        return;
      }
      setResult({
        status: "success",
        message: `${payload.outcome.createdCount} created, ${payload.outcome.mergedCount} merged, ${payload.outcome.skippedCount} duplicates skipped, ${payload.outcome.failedCount} failed.`,
      });
      form.reset();
      router.refresh();
    } catch {
      setResult({ status: "error", message: "The import request could not reach AgencyOS." });
    } finally {
      setPending(false);
    }
  }

  const firstOpenStage = data.stages.find((stage) => stage.isActive && stage.state === "open");

  return (
    <section className="crm-import-card" aria-labelledby="crm-file-import-title">
      <header>
        <span className="crm-import-card__icon">
          <FileSpreadsheet size={19} aria-hidden="true" />
        </span>
        <div>
          <h3 id="crm-file-import-title">CSV or Excel import</h3>
          <p>
            Upload a .csv or .xlsx file with a header row. Files are limited to 5 MB and 5,000
            leads.
          </p>
        </div>
      </header>
      <form className="crm-import-form" onSubmit={submit}>
        <label className="field crm-import-file-field">
          <span>Lead file</span>
          <input
            type="file"
            name="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
          />
          <small>
            Recognized columns include name, first name, last name, email, phone, company, source,
            value, currency, expected close date, and notes.
          </small>
        </label>
        <label className="field">
          <span>Import source label</span>
          <input name="sourceName" defaultValue="Spreadsheet import" maxLength={100} required />
        </label>
        <label className="field">
          <span>Pipeline stage</span>
          <select name="stageId" defaultValue={firstOpenStage?.id ?? ""} required>
            <option value="" disabled>
              Select a stage
            </option>
            {data.stages
              .filter((stage) => stage.isActive)
              .map((stage) => (
                <option value={stage.id} key={stage.id}>
                  {stage.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Owner</span>
          <select name="ownerMembershipId" defaultValue="">
            <option value="">Assign to me</option>
            {data.capabilities.canAssignLeads
              ? data.members.map((member) => (
                  <option value={member.membershipId} key={member.membershipId}>
                    {member.displayName}
                  </option>
                ))
              : null}
          </select>
        </label>
        <label className="field">
          <span>Duplicate handling</span>
          <select name="duplicatePolicy" defaultValue="skip">
            <option value="skip">Skip matching active leads</option>
            <option value="merge">Fill missing fields on matching leads</option>
          </select>
        </label>
        <div className="crm-import-guardrail">
          <ShieldCheck size={17} aria-hidden="true" />
          <p>
            Anti-duplicate checks always run against normalized email, phone, external source IDs,
            and company names for company-only rows. Imports never create a second active lead when
            a match is found.
          </p>
        </div>
        <Button type="submit" disabled={pending || !firstOpenStage}>
          <Upload size={15} aria-hidden="true" /> {pending ? "Importing" : "Import leads"}
        </Button>
        {result.status !== "idle" ? (
          <div
            className={`crm-action-message${result.status === "success" ? " is-success" : ""}`}
            role={result.status === "error" ? "alert" : "status"}
          >
            {result.message}
          </div>
        ) : null}
      </form>
    </section>
  );
}

function formatConnectionTime(value: string | null): string {
  if (!value) return "Not yet";
  return getDateTimeFormatter("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function ConnectionCreateForm() {
  const [provider, setProvider] = useState<CrmImportProvider>("hubspot");
  const [authenticationMethod, setAuthenticationMethod] =
    useState<CrmPullAuthenticationMethod>("api_token");
  const [state, action, pending] = useActionState(createCrmConnectionAction, initialState);
  const needsToken = provider === "meta_lead_ads";
  const isPull = isCrmPullProvider(provider);
  const clientAuthenticationMethods = isPull
    ? crmPullProviderAuthenticationMethods[provider].filter((method) => method !== "agency_oauth")
    : [];
  const usesApiToken = isPull && authenticationMethod === "api_token";
  const usesClientOAuth = isPull && authenticationMethod === "client_oauth";

  function changeProvider(nextProvider: CrmImportProvider) {
    setProvider(nextProvider);
    if (isCrmPullProvider(nextProvider)) {
      setAuthenticationMethod(crmPullProviderDefaultAuthenticationMethod[nextProvider]);
    }
  }

  return (
    <section className="crm-import-card" aria-labelledby="crm-connection-title">
      <header>
        <span className="crm-import-card__icon">
          <Link2 size={19} aria-hidden="true" />
        </span>
        <div>
          <h3 id="crm-connection-title">Connect a lead source</h3>
          <p>
            Client-managed credentials are the default. The client creates the CRM token or OAuth
            app, then AgencyOS encrypts and uses it for bounded incremental sync.
          </p>
        </div>
      </header>
      <form action={action} className="crm-import-form crm-import-form--connection">
        <label className="field">
          <span>Provider</span>
          <select
            name="provider"
            value={provider}
            onChange={(event) => changeProvider(event.target.value as CrmImportProvider)}
          >
            {crmImportProviders.map((value) => (
              <option value={value} key={value}>
                {crmImportProviderLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Connection name</span>
          <input name="name" placeholder="Client sales account" maxLength={100} required />
        </label>
        <label className="field">
          <span>Account or page reference</span>
          <input name="accountReference" placeholder="Optional account, page, or portal ID" />
        </label>

        {isPull ? (
          <label className="field crm-import-form__wide">
            <span>Authentication</span>
            <select
              name="authenticationMethod"
              value={authenticationMethod}
              onChange={(event) =>
                setAuthenticationMethod(event.target.value as CrmPullAuthenticationMethod)
              }
            >
              {clientAuthenticationMethods.map((method) => (
                <option value={method} key={method}>
                  {crmPullAuthenticationMethodLabels[method]}
                  {method === crmPullProviderDefaultAuthenticationMethod[provider]
                    ? " (recommended)"
                    : ""}
                </option>
              ))}
            </select>
            <small>
              The credential belongs to the client organization. AgencyOS never returns it after
              saving.
            </small>
          </label>
        ) : null}

        {usesApiToken ? (
          <label className="field crm-import-form__wide">
            <span>
              {provider === "hubspot" ? "HubSpot private-app token" : "Pipedrive API token"}
            </span>
            <input
              name="accessToken"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              required
            />
            <small>
              Ask the client to generate this token in their own CRM account with read-only lead or
              contact scopes.
            </small>
          </label>
        ) : null}

        {usesClientOAuth ? (
          <>
            <label className="field">
              <span>Client-owned OAuth app ID</span>
              <input name="oauthClientId" autoComplete="off" spellCheck={false} required />
            </label>
            <label className="field">
              <span>Client-owned OAuth app secret</span>
              <input
                name="oauthClientSecret"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                required
              />
            </label>
            <p className="crm-import-form-note crm-import-form__wide">
              The client registers <code>/api/crm/oauth/{provider}/callback</code> on this AgencyOS
              deployment, then approves access after the connection is saved.
            </p>
          </>
        ) : null}

        {needsToken ? (
          <label className="field crm-import-form__wide">
            <span>Meta Page access token</span>
            <input
              name="accessToken"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              required
            />
            <small>The token is encrypted at rest and never shown again.</small>
          </label>
        ) : null}

        {provider === "meta_lead_ads" ? (
          <>
            <label className="field">
              <span>Meta app secret</span>
              <input
                name="secondarySecret"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                required
              />
            </label>
            <label className="field">
              <span>Webhook verify token</span>
              <input name="webhookKey" type="password" autoComplete="new-password" />
              <small>Leave empty to generate a strong one-time value.</small>
            </label>
            <label className="field">
              <span>Graph API version</span>
              <input name="apiVersion" defaultValue="v23.0" pattern="v[0-9]+\.[0-9]+" />
            </label>
          </>
        ) : null}

        {provider === "google_ads" ? (
          <label className="field crm-import-form__wide">
            <span>Google webhook key</span>
            <input name="webhookKey" type="password" autoComplete="new-password" />
            <small>
              Leave empty to generate a one-time key for the Google Ads lead form settings.
            </small>
          </label>
        ) : null}

        {provider === "salesforce" ? (
          <>
            {usesClientOAuth ? (
              <label className="field">
                <span>Salesforce login environment</span>
                <select name="salesforceLoginUrl" defaultValue="https://login.salesforce.com">
                  <option value="https://login.salesforce.com">Production</option>
                  <option value="https://test.salesforce.com">Sandbox</option>
                </select>
              </label>
            ) : null}
            <label className="field">
              <span>Salesforce instance URL</span>
              <input name="instanceUrl" type="url" placeholder="Filled automatically after OAuth" />
              <small>Optional. Only approved salesforce.com hosts are accepted.</small>
            </label>
            <label className="field">
              <span>REST API version</span>
              <input name="apiVersion" defaultValue="v61.0" pattern="v[0-9]+\.[0-9]+" />
            </label>
          </>
        ) : null}

        {provider === "zoho" ? (
          <label className="field">
            <span>Zoho data center</span>
            <select name="region" defaultValue="us">
              <option value="us">United States</option>
              <option value="eu">Europe</option>
              <option value="in">India</option>
              <option value="au">Australia</option>
              <option value="jp">Japan</option>
              <option value="ca">Canada</option>
            </select>
          </label>
        ) : null}

        {isPull ? (
          <>
            <label className="field">
              <span>Automatic sync interval</span>
              <select name="syncIntervalMinutes" defaultValue="60">
                {crmSyncIntervalOptions.map((option) => (
                  <option value={option.minutes} key={option.minutes}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="crm-check-field crm-import-form__wide">
              <input type="checkbox" name="syncEnabled" />
              <span>Enable scheduled sync after the credential is verified</span>
            </label>
          </>
        ) : null}

        <div className="crm-import-guardrail crm-import-form__wide">
          <ShieldCheck size={17} aria-hidden="true" />
          <p>
            Credentials stay server-side in an AES-256-GCM envelope. Client secrets are never sent
            to MCP, logs, URLs, or later browser responses. Provider hosts and response sizes remain
            allowlisted and bounded.
          </p>
        </div>
        <Button type="submit" disabled={pending}>
          <Link2 size={15} aria-hidden="true" /> {pending ? "Saving" : "Save connection"}
        </Button>
        <ActionMessage state={state} />
      </form>
    </section>
  );
}

function ConnectionActions({ connection }: { connection: CrmImportConnection }) {
  const [syncState, syncAction, syncing] = useActionState(syncCrmConnectionAction, initialState);
  const [healthState, healthAction, checking] = useActionState(
    checkCrmConnectionHealthAction,
    initialState,
  );
  const [statusState, statusAction, changing] = useActionState(
    setCrmConnectionStatusAction,
    initialState,
  );
  const [scheduleState, scheduleAction, scheduling] = useActionState(
    updateCrmConnectionScheduleAction,
    initialState,
  );
  const [rotationState, rotationAction, rotating] = useActionState(
    rotateCrmConnectionCredentialsAction,
    initialState,
  );
  const [deleteState, deleteAction, deleting] = useActionState(
    deleteCrmConnectionAction,
    initialState,
  );

  return (
    <div className="crm-connection-actions">
      <div className="crm-connection-action-row">
        {connection.mode === "pull" && connection.oauthStartPath ? (
          <a className="button button--secondary button--sm" href={connection.oauthStartPath}>
            <KeyRound size={14} aria-hidden="true" />
            {connection.status === "paused" && !connection.lastSuccessAt
              ? "Authorize OAuth"
              : "Reconnect OAuth"}
          </a>
        ) : null}
        {connection.mode === "pull" ? (
          <form action={syncAction}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <Button size="sm" type="submit" disabled={syncing || connection.status === "paused"}>
              <RefreshCw size={14} aria-hidden="true" /> {syncing ? "Syncing" : "Sync now"}
            </Button>
          </form>
        ) : null}
        <form action={healthAction}>
          <input type="hidden" name="connectionId" value={connection.id} />
          <Button size="sm" variant="secondary" type="submit" disabled={checking}>
            <Activity size={14} aria-hidden="true" /> {checking ? "Checking" : "Health check"}
          </Button>
        </form>
        <form action={statusAction}>
          <input type="hidden" name="connectionId" value={connection.id} />
          <input
            type="hidden"
            name="status"
            value={connection.status === "active" ? "paused" : "active"}
          />
          <Button size="sm" variant="secondary" type="submit" disabled={changing}>
            {connection.status === "active" ? (
              <Pause size={14} aria-hidden="true" />
            ) : (
              <Play size={14} aria-hidden="true" />
            )}
            {connection.status === "active" ? "Pause" : "Activate"}
          </Button>
        </form>
        <form action={deleteAction}>
          <input type="hidden" name="connectionId" value={connection.id} />
          <Button size="sm" variant="danger" type="submit" disabled={deleting}>
            <Trash2 size={14} aria-hidden="true" /> Remove
          </Button>
        </form>
      </div>

      {connection.mode === "pull" ? (
        <details className="crm-connection-editor">
          <summary>
            <Settings2 size={14} aria-hidden="true" /> Automatic sync schedule
          </summary>
          <form action={scheduleAction} className="crm-connection-editor__form">
            <input type="hidden" name="connectionId" value={connection.id} />
            <label className="field">
              <span>Interval</span>
              <select
                name="syncIntervalMinutes"
                defaultValue={String(connection.syncIntervalMinutes)}
              >
                {crmSyncIntervalOptions.map((option) => (
                  <option value={option.minutes} key={option.minutes}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="crm-check-field">
              <input type="checkbox" name="syncEnabled" defaultChecked={connection.syncEnabled} />
              <span>Enable automatic sync</span>
            </label>
            <Button size="sm" type="submit" disabled={scheduling}>
              {scheduling ? "Saving" : "Save schedule"}
            </Button>
          </form>
          <ActionMessage state={scheduleState} />
        </details>
      ) : (
        <details className="crm-connection-editor">
          <summary>
            <KeyRound size={14} aria-hidden="true" /> Rotate webhook credentials
          </summary>
          <form action={rotationAction} className="crm-connection-editor__form">
            <input type="hidden" name="connectionId" value={connection.id} />
            {connection.provider === "meta_lead_ads" ? (
              <>
                <label className="field">
                  <span>New Page token</span>
                  <input name="accessToken" type="password" autoComplete="new-password" />
                </label>
                <label className="field">
                  <span>New app secret</span>
                  <input name="secondarySecret" type="password" autoComplete="new-password" />
                </label>
              </>
            ) : null}
            <label className="field">
              <span>New webhook key</span>
              <input name="webhookKey" type="password" autoComplete="new-password" />
              <small>Google Ads can generate a new one-time key when left empty.</small>
            </label>
            <Button size="sm" type="submit" disabled={rotating}>
              {rotating ? "Rotating" : "Rotate credentials"}
            </Button>
          </form>
          <ActionMessage state={rotationState} />
        </details>
      )}

      {connection.mode === "pull" && connection.authenticationMethod === "api_token" ? (
        <details className="crm-connection-editor">
          <summary>
            <KeyRound size={14} aria-hidden="true" /> Replace client API token
          </summary>
          <form action={rotationAction} className="crm-connection-editor__form">
            <input type="hidden" name="connectionId" value={connection.id} />
            <label className="field crm-import-form__wide">
              <span>
                New {connection.provider === "hubspot" ? "HubSpot private-app" : "Pipedrive API"}
                token
              </span>
              <input
                name="accessToken"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                required
              />
              <small>The previous saved token is replaced immediately inside AgencyOS.</small>
            </label>
            <Button size="sm" type="submit" disabled={rotating}>
              {rotating ? "Replacing" : "Replace token"}
            </Button>
          </form>
          <ActionMessage state={rotationState} />
        </details>
      ) : null}

      <ActionMessage state={syncState} />
      <ActionMessage state={healthState} />
      <ActionMessage state={statusState} />
      <ActionMessage state={deleteState} />
    </div>
  );
}

function ConnectionAlerts({ notifications }: { notifications: CrmConnectionNotification[] }) {
  if (!notifications.length) return null;
  return (
    <section
      className="crm-import-section crm-connection-alerts"
      aria-labelledby="crm-alerts-title"
    >
      <div className="crm-import-section__heading">
        <div>
          <h3 id="crm-alerts-title">Connector alerts</h3>
          <p>
            Rate limits, authorization failures, and repeated sync errors are deduplicated here.
          </p>
        </div>
        <BellRing size={20} aria-hidden="true" />
      </div>
      <div className="crm-connection-alert-list">
        {notifications.map((notification) => (
          <ConnectionAlert key={notification.id} notification={notification} />
        ))}
      </div>
    </section>
  );
}

function ConnectionAlert({ notification }: { notification: CrmConnectionNotification }) {
  const [state, action, pending] = useActionState(
    acknowledgeCrmConnectionNotificationAction,
    initialState,
  );
  return (
    <article className={`crm-connection-alert is-${notification.severity}`}>
      <div>
        <strong>{notification.connectionName}</strong>
        <p>{notification.message}</p>
        <small>
          {notification.occurrenceCount} occurrence{notification.occurrenceCount === 1 ? "" : "s"}
          {" · "}
          {formatConnectionTime(notification.lastOccurredAt)}
        </small>
      </div>
      <form action={action}>
        <input type="hidden" name="notificationId" value={notification.id} />
        <Button size="sm" variant="secondary" type="submit" disabled={pending}>
          {pending ? "Saving" : "Acknowledge"}
        </Button>
      </form>
      <ActionMessage state={state} />
    </article>
  );
}

function ConnectionList({ data }: { data: CrmWorkspaceData }) {
  return (
    <>
      <ConnectionAlerts notifications={data.imports.notifications} />
      <section className="crm-import-section" aria-labelledby="crm-connections-list-title">
        <div className="crm-import-section__heading">
          <div>
            <h3 id="crm-connections-list-title">Configured connections</h3>
            <p>
              Pull connections use client-managed credentials, bounded cursor pagination,
              incremental checkpoints, health checks, and backoff-aware schedules.
            </p>
          </div>
          <StatusBadge tone="neutral">{data.imports.connections.length} connections</StatusBadge>
        </div>
        <div className="crm-connection-list">
          {data.imports.connections.length ? (
            data.imports.connections.map((connection) => (
              <article className="crm-connection-card" key={connection.id}>
                <header>
                  <div>
                    <strong>{connection.name}</strong>
                    <span>
                      {connection.providerLabel} · {connection.authenticationLabel}
                    </span>
                  </div>
                  <div className="crm-connection-card__badges">
                    <StatusBadge
                      tone={
                        connection.lastHealthStatus === "healthy"
                          ? "success"
                          : connection.lastHealthStatus === "unhealthy"
                            ? "error"
                            : connection.lastHealthStatus === "degraded"
                              ? "warning"
                              : "neutral"
                      }
                    >
                      {connection.lastHealthStatus}
                    </StatusBadge>
                    <StatusBadge
                      tone={
                        connection.status === "active"
                          ? "success"
                          : connection.status === "error"
                            ? "error"
                            : "neutral"
                      }
                    >
                      {connection.status}
                    </StatusBadge>
                  </div>
                </header>
                <dl>
                  <div>
                    <dt>Account</dt>
                    <dd>{connection.accountReference ?? "Not specified"}</dd>
                  </div>
                  <div>
                    <dt>Last success</dt>
                    <dd>{formatConnectionTime(connection.lastSuccessAt)}</dd>
                  </div>
                  <div>
                    <dt>Automatic sync</dt>
                    <dd>
                      {connection.mode === "pull"
                        ? connection.syncEnabled
                          ? `Every ${connection.syncIntervalMinutes} minutes`
                          : "Disabled"
                        : "Webhook"}
                    </dd>
                  </div>
                  <div>
                    <dt>Next sync</dt>
                    <dd>
                      {formatConnectionTime(connection.nextSyncAt ?? connection.backoffUntil)}
                    </dd>
                  </div>
                  <div>
                    <dt>Checkpoint</dt>
                    <dd>
                      {connection.checkpoint.modifiedAfter
                        ? formatConnectionTime(connection.checkpoint.modifiedAfter)
                        : "Initial sync"}
                    </dd>
                  </div>
                  <div>
                    <dt>Credential version</dt>
                    <dd>{connection.credentialVersion}</dd>
                  </div>
                </dl>
                {connection.webhookPath ? (
                  <div className="crm-webhook-url">
                    <span>Webhook URL</span>
                    <code>{connection.webhookPath}</code>
                    <button
                      type="button"
                      onClick={() =>
                        navigator.clipboard.writeText(
                          `${window.location.origin}${connection.webhookPath}`,
                        )
                      }
                    >
                      <Clipboard size={13} aria-hidden="true" /> Copy URL
                    </button>
                  </div>
                ) : null}
                {connection.lastHealthMessage ? (
                  <p className="crm-connection-health-copy">{connection.lastHealthMessage}</p>
                ) : null}
                {connection.lastError ? (
                  <p className="crm-connection-error">{connection.lastError}</p>
                ) : null}
                {data.capabilities.canManageConnections ? (
                  <ConnectionActions connection={connection} />
                ) : null}
              </article>
            ))
          ) : (
            <p className="empty-state-copy">
              No external CRM or advertising source is connected yet.
            </p>
          )}
        </div>
      </section>
    </>
  );
}

function ImportHistory({ data }: { data: CrmWorkspaceData }) {
  const errorsByRun = useMemo(() => {
    const map = new Map<string, CrmImportErrorSummary[]>();
    data.imports.errors.forEach((error) => {
      map.set(error.importRunId, [...(map.get(error.importRunId) ?? []), error]);
    });
    return map;
  }, [data.imports.errors]);

  return (
    <section className="crm-import-section" aria-labelledby="crm-import-history-title">
      <div className="crm-import-section__heading">
        <div>
          <h3 id="crm-import-history-title">Import history</h3>
          <p>Review counts and duplicate decisions without exposing original sensitive payloads.</p>
        </div>
        <CloudDownload size={20} aria-hidden="true" />
      </div>
      <div className="crm-import-history">
        {data.imports.runs.length ? (
          data.imports.runs.map((run) => {
            const errors = errorsByRun.get(run.id) ?? [];
            return (
              <article key={run.id}>
                <header>
                  <div>
                    <strong>{run.sourceName}</strong>
                    <span>{run.fileName ?? run.sourceType.replaceAll("_", " ")}</span>
                  </div>
                  <StatusBadge tone={run.failedCount ? "warning" : "success"}>
                    {run.status}
                  </StatusBadge>
                </header>
                <div className="crm-import-counts">
                  <span>
                    <b>{run.createdCount}</b> created
                  </span>
                  <span>
                    <b>{run.mergedCount}</b> merged
                  </span>
                  <span>
                    <b>{run.skippedCount}</b> skipped
                  </span>
                  <span>
                    <b>{run.failedCount}</b> failed
                  </span>
                </div>
                <small>
                  {getDateTimeFormatter("en", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(run.startedAt))}
                  {" · "}
                  {run.duplicatePolicy} duplicates
                </small>
                {errors.length ? (
                  <details>
                    <summary>Show latest row issues ({errors.length})</summary>
                    <ul>
                      {errors.slice(0, 8).map((error) => (
                        <li key={error.id}>
                          {error.rowNumber ? `Row ${error.rowNumber}: ` : ""}
                          {error.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            );
          })
        ) : (
          <p className="empty-state-copy">No CRM imports have been run yet.</p>
        )}
      </div>
    </section>
  );
}

export function CrmImportCenter({
  data,
  oauthResult = null,
}: {
  data: CrmWorkspaceData;
  oauthResult?: CrmOAuthResult | null;
}) {
  if (!data.capabilities.canViewImports) {
    return (
      <p className="structure-read-only-note">
        CRM import history and connections are not granted to your current role.
      </p>
    );
  }

  return (
    <div className="crm-import-center">
      <OAuthResultMessage result={oauthResult} />
      <div className="crm-import-intro">
        <ShieldCheck size={21} aria-hidden="true" />
        <div>
          <h2>Lead import and source connections</h2>
          <p>
            Bring leads into the same CRM pipeline from spreadsheets, advertising lead forms, and
            external CRMs. Every path uses tenant checks, audit history, idempotency, and mandatory
            duplicate prevention.
          </p>
        </div>
      </div>
      <div className="crm-import-grid">
        {data.capabilities.canExecuteImports ? <FileImportForm data={data} /> : null}
        {data.capabilities.canManageConnections ? <ConnectionCreateForm /> : null}
      </div>
      <ConnectionList data={data} />
      <ImportHistory data={data} />
    </div>
  );
}
