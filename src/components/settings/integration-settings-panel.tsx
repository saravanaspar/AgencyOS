"use client";

import { BellRing, Bot, CheckCircle2, KeyRound, Save, Vault } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { updateIntegrationSettingsAction } from "@/modules/integrations/actions/integration-settings";
import type {
  IntegrationSettingsActionState,
  IntegrationSettingsData,
} from "@/modules/integrations/integration-settings";

const initialState: IntegrationSettingsActionState = { status: "idle" };

function ErrorText({ errors }: { errors?: string[] }) {
  return errors?.[0] ? <span className="field-error">{errors[0]}</span> : null;
}

export function IntegrationSettingsPanel({ data }: { data: IntegrationSettingsData }) {
  const [state, action, pending] = useActionState(updateIntegrationSettingsAction, initialState);
  const error = (name: string) => state.fieldErrors?.[name];

  return (
    <form className="module-stack" action={action} noValidate>
      {state.message ? (
        <p
          className={`form-message form-message--${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.status === "success" ? <CheckCircle2 size={16} aria-hidden="true" /> : null}
          {state.message}
        </p>
      ) : null}

      <section className="settings-panel">
        <div className="settings-panel__heading">
          <span className="settings-panel__icon">
            <Bot size={20} aria-hidden="true" />
          </span>
          <div>
            <h2>AI providers</h2>
            <p>Keys are encrypted at rest. Blank secret fields keep the current value.</p>
          </div>
        </div>
        <div className="form-grid form-grid--two">
          <label className="field">
            <span>
              Gemini API key{" "}
              <StatusBadge tone={data.geminiConfigured ? "success" : "neutral"}>
                {data.geminiConfigured ? "Configured" : "Not set"}
              </StatusBadge>
            </span>
            <input
              name="geminiApiKey"
              type="password"
              autoComplete="off"
              disabled={pending || !data.canManage}
            />
            <ErrorText errors={error("geminiApiKey")} />
          </label>
          <label className="field">
            <span>Allowed Gemini models</span>
            <input
              name="geminiModels"
              defaultValue={data.geminiModels}
              disabled={pending || !data.canManage}
              required
            />
            <ErrorText errors={error("geminiModels")} />
          </label>
          <label className="field checkbox-field">
            <input
              name="clearGeminiApiKey"
              type="checkbox"
              disabled={pending || !data.canManage || !data.geminiConfigured}
            />
            <span>Remove saved Gemini key</span>
          </label>
          <span />
          <label className="field">
            <span>
              DeepSeek API key{" "}
              <StatusBadge tone={data.deepseekConfigured ? "success" : "neutral"}>
                {data.deepseekConfigured ? "Configured" : "Not set"}
              </StatusBadge>
            </span>
            <input
              name="deepseekApiKey"
              type="password"
              autoComplete="off"
              disabled={pending || !data.canManage}
            />
            <ErrorText errors={error("deepseekApiKey")} />
          </label>
          <label className="field">
            <span>DeepSeek API URL</span>
            <input
              name="deepseekBaseUrl"
              type="url"
              defaultValue={data.deepseekBaseUrl}
              disabled={pending || !data.canManage}
              required
            />
            <ErrorText errors={error("deepseekBaseUrl")} />
          </label>
          <label className="field checkbox-field">
            <input
              name="clearDeepseekApiKey"
              type="checkbox"
              disabled={pending || !data.canManage || !data.deepseekConfigured}
            />
            <span>Remove saved DeepSeek key</span>
          </label>
          <label className="field">
            <span>Allowed DeepSeek models</span>
            <input
              name="deepseekModels"
              defaultValue={data.deepseekModels}
              disabled={pending || !data.canManage}
              required
            />
            <ErrorText errors={error("deepseekModels")} />
          </label>
        </div>
      </section>

      <section className="settings-panel">
        <div className="settings-panel__heading">
          <span className="settings-panel__icon">
            <BellRing size={20} aria-hidden="true" />
          </span>
          <div>
            <h2>Browser push</h2>
            <p>Configure payloadless browser notifications for this organization.</p>
          </div>
        </div>
        <div className="form-grid form-grid--two">
          <label className="field">
            <span>
              VAPID public key{" "}
              <StatusBadge tone={data.browserPushConfigured ? "success" : "neutral"}>
                {data.browserPushConfigured ? "Configured" : "Not set"}
              </StatusBadge>
            </span>
            <input
              name="vapidPublicKey"
              defaultValue={data.vapidPublicKey}
              autoComplete="off"
              disabled={pending || !data.canManage}
            />
            <ErrorText errors={error("vapidPublicKey")} />
          </label>
          <label className="field">
            <span>VAPID private key</span>
            <input
              name="vapidPrivateKey"
              type="password"
              autoComplete="off"
              disabled={pending || !data.canManage}
            />
            <ErrorText errors={error("vapidPrivateKey")} />
          </label>
          <label className="field">
            <span>VAPID subject</span>
            <input
              name="vapidSubject"
              defaultValue={data.vapidSubject}
              placeholder="mailto:notifications@example.com"
              disabled={pending || !data.canManage}
            />
            <ErrorText errors={error("vapidSubject")} />
          </label>
          <label className="field checkbox-field">
            <input
              name="clearVapidKeys"
              type="checkbox"
              disabled={pending || !data.canManage || !data.browserPushConfigured}
            />
            <span>Remove saved VAPID keys</span>
          </label>
        </div>
      </section>

      <section className="settings-panel">
        <div className="settings-panel__heading">
          <span className="settings-panel__icon">
            <Vault size={20} aria-hidden="true" />
          </span>
          <div>
            <h2>Vaultwarden</h2>
            <p>Optional public web-vault address used to open linked credential records.</p>
          </div>
        </div>
        <label className="field">
          <span>Vaultwarden URL</span>
          <input
            name="vaultwardenUrl"
            type="url"
            defaultValue={data.vaultwardenUrl}
            placeholder="https://vault.example.com"
            disabled={pending || !data.canManage}
          />
          <ErrorText errors={error("vaultwardenUrl")} />
        </label>
      </section>

      {data.canManage ? (
        <div className="form-actions">
          <Button type="submit" disabled={pending}>
            {pending ? (
              <KeyRound size={16} aria-hidden="true" />
            ) : (
              <Save size={16} aria-hidden="true" />
            )}
            {pending ? "Encrypting and saving…" : "Save integrations"}
          </Button>
          <span>
            {data.managedInApplication
              ? "Managed in AgencyOS"
              : "Using application defaults until first save"}
          </span>
        </div>
      ) : null}
    </form>
  );
}
