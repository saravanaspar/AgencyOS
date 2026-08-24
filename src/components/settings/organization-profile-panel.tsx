"use client";

import { useActionState, useMemo, useState } from "react";
import {
  Building2,
  CalendarRange,
  CheckCircle2,
  Clock3,
  Coins,
  Edit3,
  Globe2,
  LockKeyhole,
  Save,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  formatCountryLabel,
  formatCurrencyLabel,
  formatTimezoneLabel,
  getCountryDefaults,
  getCountryOptions,
  getCurrencyOptions,
  getTimezoneOptions,
  normalizeTimezone,
} from "@/lib/locale-options";
import { StatusBadge } from "@/components/ui/status-badge";
import { updateOrganizationProfileAction } from "@/modules/organizations/actions/organization-profile";
import type { OrganizationProfileActionState } from "@/modules/organizations/schemas/organization-profile";
import type { OrganizationProfileData } from "@/modules/organizations/server/organization-profile";
import { getDateTimeFormatter } from "@/lib/intl-formatters";

const initialState: OrganizationProfileActionState = { status: "idle" };

const countryOptions = getCountryOptions();

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatUpdatedAt(value: string): string {
  return getDateTimeFormatter("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
}) {
  return (
    <div className="organization-profile-detail">
      <span className="organization-profile-detail__icon">
        <Icon size={18} aria-hidden="true" />
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

export function OrganizationProfilePanel({ data }: { data: OrganizationProfileData }) {
  const [editing, setEditing] = useState(false);
  const [countryCode, setCountryCode] = useState(data.countryCode ?? "");
  const [timezone, setTimezone] = useState(() => normalizeTimezone(data.timezone));
  const [currency, setCurrency] = useState(data.defaultCurrency);
  const recommendedDefaults = useMemo(() => getCountryDefaults(countryCode), [countryCode]);
  const timezoneOptions = useMemo(() => getTimezoneOptions(new Date(), timezone), [timezone]);
  const currencyOptions = useMemo(
    () => getCurrencyOptions("en", recommendedDefaults?.currency ?? currency),
    [currency, recommendedDefaults],
  );

  function startEditing() {
    setCountryCode(data.countryCode ?? "");
    setTimezone(normalizeTimezone(data.timezone));
    setCurrency(data.defaultCurrency);
    setEditing(true);
  }

  function handleCountryChange(nextCountryCode: string) {
    setCountryCode(nextCountryCode);
    const defaults = getCountryDefaults(nextCountryCode);

    if (defaults) {
      setTimezone(defaults.timezone);
      setCurrency(defaults.currency);
    }
  }
  const [state, formAction, pending] = useActionState(
    async (previousState: OrganizationProfileActionState, formData: FormData) => {
      const nextState = await updateOrganizationProfileAction(previousState, formData);

      if (nextState.status === "success") {
        setEditing(false);
      }

      return nextState;
    },
    initialState,
  );

  const legalNameError = state.fieldErrors?.legalName?.[0];
  const displayNameError = state.fieldErrors?.displayName?.[0];
  const countryCodeError = state.fieldErrors?.countryCode?.[0];
  const timezoneError = state.fieldErrors?.timezone?.[0];
  const currencyError = state.fieldErrors?.defaultCurrency?.[0];
  const financialYearError = state.fieldErrors?.financialYearStartMonth?.[0];

  return (
    <section className="settings-panel organization-profile-panel">
      <header className="organization-profile-panel__header">
        <div>
          <div className="organization-profile-panel__title">
            <span className="settings-panel__icon">
              <Building2 size={20} aria-hidden="true" />
            </span>
            <div>
              <h2>{data.displayName || data.legalName}</h2>
              <p>Organization identity and regional operating defaults.</p>
            </div>
          </div>
        </div>
        <div className="organization-profile-panel__header-actions">
          <StatusBadge tone={data.status === "active" ? "success" : "warning"}>
            {data.status}
          </StatusBadge>
          {data.canUpdate && !editing ? (
            <Button variant="secondary" onClick={startEditing}>
              <Edit3 size={15} aria-hidden="true" />
              Edit profile
            </Button>
          ) : null}
        </div>
      </header>

      {state.message ? (
        <p
          className={`organization-profile-message${
            state.status === "success" ? " is-success" : ""
          }${state.conflict ? " is-conflict" : ""}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.status === "success" ? <CheckCircle2 size={16} aria-hidden="true" /> : null}
          {state.message}
        </p>
      ) : null}

      {!editing ? (
        <>
          <div className="organization-profile-grid">
            <Detail icon={Building2} label="Legal name" value={data.legalName} />
            <Detail
              icon={Globe2}
              label="Country"
              value={data.countryCode ? formatCountryLabel(data.countryCode) : "Not set"}
            />
            <Detail icon={Clock3} label="Timezone" value={formatTimezoneLabel(data.timezone)} />
            <Detail
              icon={Coins}
              label="Default currency"
              value={formatCurrencyLabel(data.defaultCurrency)}
            />
            <Detail
              icon={CalendarRange}
              label="Financial year starts"
              value={months[data.financialYearStartMonth - 1] || "January"}
            />
            <Detail icon={LockKeyhole} label="Organization ID" value={data.slug} />
          </div>

          <footer className="organization-profile-panel__footer">
            <span>Last updated {formatUpdatedAt(data.updatedAt)}</span>
            {!data.canUpdate ? (
              <span className="organization-profile-read-only">
                <LockKeyhole size={14} aria-hidden="true" />
                Read-only access
              </span>
            ) : null}
          </footer>
        </>
      ) : (
        <form
          className="organization-profile-form"
          action={formAction}
          key={data.updatedAt}
          noValidate
        >
          <input type="hidden" name="expectedUpdatedAt" value={data.updatedAt} />

          <div className="organization-profile-form__grid">
            <label className="field">
              <span>Legal name</span>
              <input
                name="legalName"
                defaultValue={data.legalName}
                aria-invalid={Boolean(legalNameError)}
                disabled={pending}
                required
              />
              {legalNameError ? <small className="field-error">{legalNameError}</small> : null}
            </label>

            <label className="field">
              <span>Display name</span>
              <input
                name="displayName"
                defaultValue={data.displayName ?? ""}
                placeholder="Optional public-facing name"
                aria-invalid={Boolean(displayNameError)}
                disabled={pending}
              />
              {displayNameError ? <small className="field-error">{displayNameError}</small> : null}
            </label>

            <label className="field">
              <span>Country</span>
              <select
                name="countryCode"
                value={countryCode}
                onChange={(event) => handleCountryChange(event.target.value)}
                aria-invalid={Boolean(countryCodeError)}
                disabled={pending}
              >
                <option value="">Not set</option>
                {countryOptions.map((country) => (
                  <option value={country.value} key={country.value}>
                    {country.label}
                  </option>
                ))}
              </select>
              {countryCodeError ? <small className="field-error">{countryCodeError}</small> : null}
            </label>

            <label className="field">
              <span>Timezone</span>
              <select
                name="timezone"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                aria-invalid={Boolean(timezoneError)}
                disabled={pending}
                required
              >
                {timezoneOptions.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small className="field-hint">
                One canonical timezone is shown for each current UTC offset. Change the country to
                auto-suggest a regional timezone.
              </small>
              {timezoneError ? <small className="field-error">{timezoneError}</small> : null}
            </label>

            <label className="field">
              <span>Default currency</span>
              <select
                name="defaultCurrency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
                aria-invalid={Boolean(currencyError)}
                disabled={pending}
                required
              >
                {currencyOptions.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small className="field-hint">
                Country changes automatically suggest currency and timezone.{" "}
                {recommendedDefaults
                  ? `Recommended here: ${formatCurrencyLabel(recommendedDefaults.currency)}.`
                  : ""}
              </small>
              {currencyError ? <small className="field-error">{currencyError}</small> : null}
            </label>

            <label className="field">
              <span>Financial year starts</span>
              <select
                name="financialYearStartMonth"
                defaultValue={String(data.financialYearStartMonth)}
                aria-invalid={Boolean(financialYearError)}
                disabled={pending}
              >
                {months.map((month, index) => (
                  <option value={index + 1} key={month}>
                    {month}
                  </option>
                ))}
              </select>
              {financialYearError ? (
                <small className="field-error">{financialYearError}</small>
              ) : null}
            </label>
          </div>

          <div className="organization-profile-identifier">
            <LockKeyhole size={16} aria-hidden="true" />
            <div>
              <span>Immutable organization identifier</span>
              <code>{data.slug}</code>
              <small>This identifier is permanent and is never accepted from the edit form.</small>
            </div>
          </div>

          <div className="organization-profile-form__actions">
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
              <X size={15} aria-hidden="true" />
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              <Save size={15} aria-hidden="true" />
              {pending ? "Saving" : "Save changes"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
