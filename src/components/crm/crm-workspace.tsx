"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ContactRound,
  ExternalLink,
  FileText,
  Headphones,
  Mail,
  Paperclip,
  Phone,
  Plus,
  Receipt,
  Save,
  Scale,
  Sparkles,
  Trash2,
  TrendingUp,
  Upload,
  UserRound,
} from "lucide-react";

import { CrmFilterForm } from "@/components/crm/crm-filter-form";
import { CrmImportCenter, type CrmOAuthResult } from "@/components/crm/crm-import-center";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  completeActivityAction,
  convertLeadAction,
  createActivityAction,
  createCompanyAction,
  createContactAction,
  createLeadAction,
  createPipelineStageAction,
  deleteLeadAction,
  qualifyLeadAction,
  setCompanyPrimaryContactAction,
  setCrmForecastTargetAction,
  updateCompanyAction,
  updateContactAction,
  updateLeadAction,
  updateLeadStageAction,
  updatePipelineStageAction,
} from "@/modules/crm/actions/crm";
import { crmActivityTypes, crmLeadTypes, crmStageRequiredFields } from "@/modules/crm/crm";
import type { CrmActionState } from "@/modules/crm/schemas/crm";
import type {
  CrmCompany,
  CrmContact,
  CrmLead,
  CrmPipelineStage,
  CrmWorkspaceData,
} from "@/modules/crm/server/crm";
import { getDateTimeFormatter, getNumberFormatter } from "@/lib/intl-formatters";

const initialState: CrmActionState = { status: "idle" };

type WorkspaceTab = "pipeline" | "forecast" | "companies" | "contacts" | "activity" | "imports";

function ActionMessage({ state }: { state: CrmActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <div
      className={`crm-action-message${state.status === "success" ? " is-success" : ""}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.status === "success" ? <CheckCircle2 size={15} aria-hidden="true" /> : null}
      <div>
        <p>{state.message}</p>
        {state.duplicateWarnings?.length ? (
          <ul>
            {state.duplicateWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function OwnerSelect({
  data,
  name = "ownerMembershipId",
  defaultValue,
}: {
  data: CrmWorkspaceData;
  name?: string;
  defaultValue?: string | null;
}) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} aria-label="Owner">
      <option value="">Assign to me</option>
      {data.members.map((member) => (
        <option value={member.membershipId} key={member.membershipId}>
          {member.displayName} — {member.email}
        </option>
      ))}
    </select>
  );
}

const relationshipKinds = [
  { kind: "project", label: "Projects", icon: BriefcaseBusiness },
  { kind: "invoice", label: "Invoices", icon: Receipt },
  { kind: "contract", label: "Legal contracts", icon: Scale },
  { kind: "ticket", label: "Support tickets", icon: Headphones },
  { kind: "document", label: "Documents", icon: FileText },
] as const;

function CompanyRelationships({ company }: { company: CrmCompany }) {
  if (!company.relatedRecords.length) {
    return <p className="crm-relationship-empty">No related records are visible to your role.</p>;
  }

  return (
    <details className="crm-relationship-panel">
      <summary>
        Related records <span>{company.relatedRecords.length}</span>
      </summary>
      <div className="crm-relationship-groups">
        {relationshipKinds.map(({ kind, label, icon: Icon }) => {
          const records = company.relatedRecords.filter((record) => record.kind === kind);
          if (!records.length) return null;
          return (
            <section key={kind} aria-label={label}>
              <h4>
                <Icon size={14} aria-hidden="true" /> {label} <span>{records.length}</span>
              </h4>
              <ul>
                {records.slice(0, 8).map((record) => (
                  <li key={`${record.kind}-${record.id}`}>
                    <Link href={record.href}>
                      <span>
                        <strong>{record.label}</strong>
                        {record.metadata ? <small>{record.metadata}</small> : null}
                      </span>
                      {record.status ? (
                        <StatusBadge tone="neutral">{record.status}</StatusBadge>
                      ) : null}
                      <ExternalLink size={13} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </details>
  );
}

function PrimaryContactForm({ company, data }: { company: CrmCompany; data: CrmWorkspaceData }) {
  const [state, action, pending] = useActionState(setCompanyPrimaryContactAction, initialState);
  const options = data.companyContactOptions.filter((contact) => contact.companyId === company.id);

  return (
    <section className="crm-primary-contact" aria-label="Primary contact">
      <div>
        <span>Primary contact</span>
        <strong>{company.primaryContactName ?? "Not selected"}</strong>
        {company.primaryContactEmail ? <small>{company.primaryContactEmail}</small> : null}
      </div>
      {data.capabilities.canUpdateCompanies && data.capabilities.canViewContacts ? (
        <form action={action}>
          <input type="hidden" name="companyId" value={company.id} />
          <select
            name="primaryContactId"
            defaultValue={company.primaryContactId ?? ""}
            aria-label={`Primary contact for ${company.displayName ?? company.legalName}`}
          >
            <option value="">No primary contact</option>
            {options.map((contact) => (
              <option value={contact.id} key={contact.id}>
                {contact.name}
                {contact.email ? ` · ${contact.email}` : ""}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            <Save size={13} aria-hidden="true" /> {pending ? "Saving" : "Save contact"}
          </Button>
          <ActionMessage state={state} />
        </form>
      ) : null}
    </section>
  );
}

function LeadDocuments({ lead, data }: { lead: CrmLead; data: CrmWorkspaceData }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: new FormData(form),
      });
      const result = (await response.json()) as { message?: string };
      setMessage(result.message ?? (response.ok ? "Attachment uploaded." : "Upload failed."));
      if (response.ok) {
        form.reset();
        router.refresh();
      }
    } catch {
      setMessage("The attachment could not be uploaded.");
    } finally {
      setPending(false);
    }
  }

  if (!data.capabilities.canViewDocuments && !data.capabilities.canCreateDocuments) return null;

  return (
    <details className="crm-lead-documents">
      <summary>
        <Paperclip size={14} aria-hidden="true" /> Attachments <span>{lead.documents.length}</span>
      </summary>
      {lead.documents.length ? (
        <ul>
          {lead.documents.slice(0, 8).map((document) => (
            <li key={document.id}>
              <Link href={document.href}>
                <span>
                  <strong>{document.title}</strong>
                  <small>{document.classification}</small>
                </span>
                <StatusBadge tone={document.status === "active" ? "info" : "neutral"}>
                  {document.status}
                </StatusBadge>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>No visible attachments.</p>
      )}
      {data.capabilities.canCreateDocuments ? (
        <form onSubmit={upload} className="crm-lead-upload-form">
          <input type="hidden" name="description" value="" />
          <input type="hidden" name="ownerMembershipId" value={data.currentMembershipId} />
          <input type="hidden" name="classification" value="internal" />
          <input type="hidden" name="entityType" value="lead" />
          <input type="hidden" name="entityId" value={lead.id} />
          <input type="hidden" name="versionNote" value="CRM lead attachment" />
          <label className="field">
            <span>Title</span>
            <input name="title" required maxLength={180} />
          </label>
          <label className="field crm-lead-upload-form__file">
            <span>File</span>
            <input
              name="file"
              type="file"
              required
              accept="application/pdf,image/jpeg,image/png,text/plain,text/csv,.docx,.xlsx"
            />
          </label>
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            <Upload size={13} aria-hidden="true" /> {pending ? "Uploading" : "Upload privately"}
          </Button>
          {message ? <small role="status">{message}</small> : null}
        </form>
      ) : null}
    </details>
  );
}

function CompanyCard({ company, data }: { company: CrmCompany; data: CrmWorkspaceData }) {
  const [state, action, pending] = useActionState(updateCompanyAction, initialState);

  return (
    <article className="crm-record-card">
      <header>
        <span className="crm-record-card__icon">
          <Building2 size={17} aria-hidden="true" />
        </span>
        <div>
          <strong>{company.displayName ?? company.legalName}</strong>
          <small>{company.industry ?? "Industry not set"}</small>
        </div>
        <StatusBadge tone={company.clientStatus === "client" ? "success" : "info"}>
          {company.clientStatus}
        </StatusBadge>
      </header>
      <dl className="crm-record-meta">
        <div>
          <dt>Owner</dt>
          <dd>{company.ownerName ?? "Unassigned"}</dd>
        </div>
        <div>
          <dt>Contacts</dt>
          <dd>{company.contactCount}</dd>
        </div>
        <div>
          <dt>Terms</dt>
          <dd>{company.paymentTermsDays} days</dd>
        </div>
      </dl>
      {company.email || company.phone ? (
        <div className="crm-contact-lines">
          {company.email ? (
            <span>
              <Mail size={13} aria-hidden="true" /> {company.email}
            </span>
          ) : null}
          {company.phone ? (
            <span>
              <Phone size={13} aria-hidden="true" /> {company.phone}
            </span>
          ) : null}
        </div>
      ) : null}
      <PrimaryContactForm company={company} data={data} />
      <CompanyRelationships company={company} />
      {data.capabilities.canUpdateCompanies ? (
        <details className="crm-inline-editor">
          <summary>Edit company</summary>
          <form action={action} className="crm-compact-form">
            <input type="hidden" name="companyId" value={company.id} />
            <label className="field">
              <span>Legal name</span>
              <input name="legalName" defaultValue={company.legalName} required />
            </label>
            <label className="field">
              <span>Display name</span>
              <input name="displayName" defaultValue={company.displayName ?? ""} />
            </label>
            <label className="field">
              <span>Industry</span>
              <input name="industry" defaultValue={company.industry ?? ""} />
            </label>
            <label className="field">
              <span>Website</span>
              <input name="website" type="url" defaultValue={company.website ?? ""} />
            </label>
            <label className="field">
              <span>Email</span>
              <input name="email" type="email" defaultValue={company.email ?? ""} />
            </label>
            <label className="field">
              <span>Phone</span>
              <input name="phone" defaultValue={company.phone ?? ""} />
            </label>
            <label className="field">
              <span>Owner</span>
              <OwnerSelect data={data} defaultValue={company.ownerMembershipId} />
            </label>
            <label className="field">
              <span>Currency</span>
              <input name="currency" defaultValue={company.currency} maxLength={3} required />
            </label>
            <label className="field">
              <span>Payment terms</span>
              <input
                name="paymentTermsDays"
                type="number"
                min="0"
                max="365"
                defaultValue={company.paymentTermsDays}
              />
            </label>
            <input type="hidden" name="notes" value="" />
            <Button type="submit" size="sm" disabled={pending}>
              <Save size={14} aria-hidden="true" /> {pending ? "Saving" : "Save"}
            </Button>
            <ActionMessage state={state} />
          </form>
        </details>
      ) : null}
    </article>
  );
}

function ContactCard({ contact, data }: { contact: CrmContact; data: CrmWorkspaceData }) {
  const [state, action, pending] = useActionState(updateContactAction, initialState);

  return (
    <article className="crm-record-card">
      <header>
        <span className="crm-record-card__icon">
          <ContactRound size={17} aria-hidden="true" />
        </span>
        <div>
          <strong>
            {contact.firstName} {contact.lastName}
          </strong>
          <small>{contact.jobTitle ?? contact.companyName ?? "Independent contact"}</small>
        </div>
        {contact.isDecisionMaker ? <StatusBadge tone="warning">Decision maker</StatusBadge> : null}
      </header>
      <div className="crm-contact-lines">
        {contact.email ? (
          <span>
            <Mail size={13} aria-hidden="true" /> {contact.email}
          </span>
        ) : null}
        {contact.phone ? (
          <span>
            <Phone size={13} aria-hidden="true" /> {contact.phone}
          </span>
        ) : null}
      </div>
      <dl className="crm-record-meta">
        <div>
          <dt>Company</dt>
          <dd>{contact.companyName ?? "None"}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{contact.ownerName ?? "Unassigned"}</dd>
        </div>
        <div>
          <dt>Consent</dt>
          <dd>{contact.consentStatus}</dd>
        </div>
      </dl>
      {data.capabilities.canUpdateContacts ? (
        <details className="crm-inline-editor">
          <summary>Edit contact</summary>
          <form action={action} className="crm-compact-form">
            <input type="hidden" name="contactId" value={contact.id} />
            <label className="field">
              <span>Company</span>
              <select name="companyId" defaultValue={contact.companyId ?? ""}>
                <option value="">No company</option>
                {data.companies.map((company) => (
                  <option value={company.id} key={company.id}>
                    {company.displayName ?? company.legalName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>First name</span>
              <input name="firstName" defaultValue={contact.firstName} required />
            </label>
            <label className="field">
              <span>Last name</span>
              <input name="lastName" defaultValue={contact.lastName} required />
            </label>
            <label className="field">
              <span>Job title</span>
              <input name="jobTitle" defaultValue={contact.jobTitle ?? ""} />
            </label>
            <label className="field">
              <span>Email</span>
              <input name="email" type="email" defaultValue={contact.email ?? ""} />
            </label>
            <label className="field">
              <span>Phone</span>
              <input name="phone" defaultValue={contact.phone ?? ""} />
            </label>
            <label className="field">
              <span>Preferred communication</span>
              <select name="preferredCommunication" defaultValue={contact.preferredCommunication}>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="meeting">Meeting</option>
                <option value="none">None</option>
              </select>
            </label>
            <label className="field">
              <span>Consent</span>
              <select name="consentStatus" defaultValue={contact.consentStatus}>
                <option value="unknown">Unknown</option>
                <option value="granted">Granted</option>
                <option value="revoked">Revoked</option>
              </select>
            </label>
            <label className="field">
              <span>Owner</span>
              <OwnerSelect data={data} defaultValue={contact.ownerMembershipId} />
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                name="isBillingContact"
                defaultChecked={contact.isBillingContact}
              />
              Billing contact
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                name="isDecisionMaker"
                defaultChecked={contact.isDecisionMaker}
              />
              Decision maker
            </label>
            <input type="hidden" name="notes" value="" />
            <Button type="submit" size="sm" disabled={pending}>
              <Save size={14} aria-hidden="true" /> {pending ? "Saving" : "Save"}
            </Button>
            <ActionMessage state={state} />
          </form>
        </details>
      ) : null}
    </article>
  );
}

function LeadCard({ lead, data }: { lead: CrmLead; data: CrmWorkspaceData }) {
  const [stageState, stageAction, stagePending] = useActionState(
    updateLeadStageAction,
    initialState,
  );
  const [qualificationState, qualificationAction, qualificationPending] = useActionState(
    qualifyLeadAction,
    initialState,
  );
  const [convertState, convertAction, convertPending] = useActionState(
    convertLeadAction,
    initialState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(deleteLeadAction, initialState);
  const [activityState, activityAction, activityPending] = useActionState(
    createActivityAction,
    initialState,
  );
  const [updateState, updateAction, updatePending] = useActionState(updateLeadAction, initialState);

  const tone =
    lead.status === "converted"
      ? "success"
      : lead.status === "lost" || lead.status === "unqualified"
        ? "neutral"
        : lead.status === "qualified"
          ? "info"
          : "warning";

  const extraFieldEntries = flattenLeadExtraFields(lead.extraFields);

  return (
    <article className="crm-lead-card">
      <header>
        <div>
          <strong>{lead.name}</strong>
          <small>{lead.companyName ?? lead.email ?? "No company or email"}</small>
        </div>
        <StatusBadge tone={tone}>{lead.status}</StatusBadge>
      </header>

      <div className="crm-lead-card__value">
        <span>
          {lead.estimatedValue === null
            ? "Value not set"
            : getNumberFormatter("en", {
                style: "currency",
                currency: lead.currency,
                maximumFractionDigits: 0,
              }).format(lead.estimatedValue)}
        </span>
        <small>
          {lead.probability}% probability · expected{" "}
          {getNumberFormatter("en", {
            style: "currency",
            currency: lead.currency,
            maximumFractionDigits: 0,
          }).format(lead.expectedRevenue)}
        </small>
      </div>

      <div className="crm-lead-card__details">
        <span>
          <UserRound size={13} aria-hidden="true" /> {lead.ownerName ?? "Unassigned"}
        </span>
        <span>
          <Sparkles size={13} aria-hidden="true" /> {lead.qualificationScore}/100 ·{" "}
          {lead.qualificationLabel}
        </span>
      </div>
      <LeadDocuments lead={lead} data={data} />
      {extraFieldEntries.length ? (
        <details className="crm-lead-extra-fields">
          <summary>
            Extra fields <span>{extraFieldEntries.length}</span>
          </summary>
          <dl>
            {extraFieldEntries.map((entry) => (
              <div key={entry.path}>
                <dt>{entry.path}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      {data.capabilities.canUpdateLeads && lead.status !== "converted" ? (
        <form action={stageAction} className="crm-stage-form">
          <input type="hidden" name="leadId" value={lead.id} />
          <select name="stageId" defaultValue={lead.stageId} aria-label={`Stage for ${lead.name}`}>
            {data.stages
              .filter((stage) => stage.isActive)
              .map((stage) => (
                <option value={stage.id} key={stage.id}>
                  {stage.name} · {stage.probability}%
                </option>
              ))}
          </select>
          <input
            name="lostReason"
            placeholder="Lost reason (required for Lost stage)"
            defaultValue={lead.lostReason ?? ""}
            aria-label={`Lost reason for ${lead.name}`}
          />
          <Button type="submit" size="sm" variant="secondary" disabled={stagePending}>
            {stagePending ? "Moving" : "Move"}
          </Button>
          <ActionMessage state={stageState} />
        </form>
      ) : null}

      {data.capabilities.canUpdateLeads && lead.status !== "converted" ? (
        <div className="crm-lead-card__actions">
          <form action={qualificationAction}>
            <input type="hidden" name="leadId" value={lead.id} />
            <input type="hidden" name="status" value="qualified" />
            <input type="hidden" name="reason" value="Qualified from CRM pipeline" />
            <Button type="submit" size="sm" variant="ghost" disabled={qualificationPending}>
              Qualify
            </Button>
          </form>
          <form action={qualificationAction}>
            <input type="hidden" name="leadId" value={lead.id} />
            <input type="hidden" name="status" value="unqualified" />
            <input type="hidden" name="reason" value="Unqualified from CRM pipeline" />
            <Button type="submit" size="sm" variant="ghost" disabled={qualificationPending}>
              Disqualify
            </Button>
          </form>
          {lead.status === "qualified" && data.capabilities.canCreateCompanies ? (
            <form action={convertAction}>
              <input type="hidden" name="leadId" value={lead.id} />
              <input
                type="hidden"
                name="createContact"
                value={String(data.capabilities.canCreateContacts)}
              />
              <input type="hidden" name="createBillingProfile" value="true" />
              {data.capabilities.canCreateContracts ? (
                <label className="field">
                  <span>Contract request</span>
                  <input type="checkbox" name="createContractRequest" value="true" />
                </label>
              ) : null}
              <Button type="submit" size="sm" disabled={convertPending}>
                <ChevronRight size={14} aria-hidden="true" />
                {convertPending ? "Converting" : "Convert"}
              </Button>
            </form>
          ) : null}
          {data.capabilities.canDeleteLeads ? (
            <form
              action={deleteAction}
              onSubmit={(event) => {
                if (!window.confirm(`Delete ${lead.name}?`)) event.preventDefault();
              }}
            >
              <input type="hidden" name="leadId" value={lead.id} />
              <Button type="submit" size="sm" variant="danger" disabled={deletePending}>
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
      <ActionMessage state={qualificationState} />
      <ActionMessage state={convertState} />
      <ActionMessage state={deleteState} />

      {data.capabilities.canUpdateLeads && lead.status !== "converted" ? (
        <details className="crm-inline-editor">
          <summary>Edit opportunity and next action</summary>
          <form action={updateAction} className="crm-create-form crm-create-form--lead">
            <input type="hidden" name="leadId" value={lead.id} />
            <label className="field">
              <span>Name</span>
              <input name="name" defaultValue={lead.name} required />
            </label>
            <label className="field">
              <span>Type</span>
              <select name="leadType" defaultValue={lead.leadType}>
                {crmLeadTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Status</span>
              <select name="status" defaultValue={lead.status}>
                <option value="new">new</option>
                <option value="qualified">qualified</option>
                <option value="unqualified">unqualified</option>
                <option value="lost">lost</option>
              </select>
            </label>
            <label className="field">
              <span>Stage</span>
              <select name="stageId" defaultValue={lead.stageId}>
                {data.stages
                  .filter((stage) => stage.isActive)
                  .map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Owner</span>
              <OwnerSelect data={data} defaultValue={lead.ownerMembershipId} />
            </label>
            <label className="field">
              <span>Company</span>
              <input name="companyName" defaultValue={lead.companyName ?? ""} />
            </label>
            <label className="field">
              <span>Email</span>
              <input name="email" type="email" defaultValue={lead.email ?? ""} />
            </label>
            <label className="field">
              <span>Phone</span>
              <input name="phone" defaultValue={lead.phone ?? ""} />
            </label>
            <label className="field">
              <span>Source</span>
              <input name="source" defaultValue={lead.source ?? ""} />
            </label>
            <label className="field">
              <span>Estimated value</span>
              <input
                name="estimatedValue"
                type="number"
                min="0"
                step="0.01"
                defaultValue={lead.estimatedValue ?? ""}
              />
            </label>
            <label className="field">
              <span>Currency</span>
              <input name="currency" maxLength={3} defaultValue={lead.currency} required />
            </label>
            <label className="field">
              <span>Probability</span>
              <input
                name="probability"
                type="number"
                min="0"
                max="100"
                defaultValue={lead.probability}
              />
            </label>
            <label className="field">
              <span>Expected close</span>
              <input
                name="expectedCloseDate"
                type="date"
                defaultValue={lead.expectedCloseDate ?? ""}
              />
            </label>
            <label className="field">
              <span>Follow-up</span>
              <input
                name="followUpAt"
                type="datetime-local"
                defaultValue={lead.followUpAt?.slice(0, 16) ?? ""}
              />
            </label>
            <label className="field">
              <span>Lost reason</span>
              <input name="lostReason" defaultValue={lead.lostReason ?? ""} />
            </label>
            <label className="field crm-create-form__wide">
              <span>Notes</span>
              <input name="notes" defaultValue={lead.notes ?? ""} />
            </label>
            <Button type="submit" size="sm" disabled={updatePending}>
              <Save size={14} aria-hidden="true" /> {updatePending ? "Saving" : "Save opportunity"}
            </Button>
            <ActionMessage state={updateState} />
          </form>
        </details>
      ) : null}

      {data.capabilities.canCreateActivities ? (
        <details className="crm-inline-editor">
          <summary>Add activity</summary>
          <form action={activityAction} className="crm-activity-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label className="field">
              <span>Type</span>
              <select name="activityType" defaultValue="note">
                {crmActivityTypes.map((type) => (
                  <option value={type} key={type}>
                    {type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Subject</span>
              <input name="subject" placeholder="Client follow-up" required />
            </label>
            <label className="field crm-activity-form__details">
              <span>Details</span>
              <input name="details" placeholder="What happened or what is next?" />
            </label>
            <label className="field">
              <span>Due at</span>
              <input name="dueAt" type="datetime-local" />
            </label>
            <Button type="submit" size="sm" disabled={activityPending}>
              <Plus size={14} aria-hidden="true" /> {activityPending ? "Adding" : "Add"}
            </Button>
            <ActionMessage state={activityState} />
          </form>
        </details>
      ) : null}
    </article>
  );
}

interface LeadExtraFieldEntry {
  path: string;
  value: string;
}

function displayExtraFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function flattenLeadExtraFields(
  value: unknown,
  path: string[] = [],
  entries: LeadExtraFieldEntry[] = [],
): LeadExtraFieldEntry[] {
  if (entries.length >= 200) return entries;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      flattenLeadExtraFields(nestedValue, [...path, key], entries);
      if (entries.length >= 200) break;
    }
    return entries;
  }
  if (!path.length) return entries;
  entries.push({ path: path.join(" › "), value: displayExtraFieldValue(value) });
  return entries;
}

function CreateLeadForm({ data }: { data: CrmWorkspaceData }) {
  const [state, action, pending] = useActionState(createLeadAction, initialState);
  const searchParams = useSearchParams();
  const firstStage = data.stages.find((stage) => stage.isActive)?.id ?? "";

  return (
    <details
      className="crm-create-panel"
      open={data.leads.length === 0 || searchParams.get("create") === "lead"}
    >
      <summary>
        <Plus size={16} aria-hidden="true" /> Create lead
      </summary>
      <form action={action} className="crm-create-form crm-create-form--lead">
        <label className="field">
          <span>Lead name</span>
          <input name="name" placeholder="Acme campaign opportunity" required />
        </label>
        <label className="field">
          <span>Type</span>
          <select name="leadType" defaultValue="company">
            {crmLeadTypes.map((type) => (
              <option value={type} key={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Pipeline stage</span>
          <select name="stageId" defaultValue={firstStage} required>
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
          <OwnerSelect data={data} />
        </label>
        <label className="field">
          <span>Company</span>
          <input name="companyName" placeholder="Acme Ltd" />
        </label>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" placeholder="buyer@example.com" />
        </label>
        <label className="field">
          <span>Phone</span>
          <input name="phone" placeholder="+1 555 0100" />
        </label>
        <label className="field">
          <span>Source</span>
          <input name="source" placeholder="Referral" />
        </label>
        <label className="field">
          <span>Estimated value</span>
          <input name="estimatedValue" type="number" min="0" step="0.01" />
        </label>
        <label className="field">
          <span>Currency</span>
          <input name="currency" defaultValue="USD" maxLength={3} required />
        </label>
        <label className="field">
          <span>Probability</span>
          <input name="probability" type="number" min="0" max="100" defaultValue="0" />
        </label>
        <label className="field">
          <span>Expected close</span>
          <input name="expectedCloseDate" type="date" />
        </label>
        <label className="field">
          <span>Follow-up</span>
          <input name="followUpAt" type="datetime-local" />
        </label>
        <label className="field crm-create-form__wide">
          <span>Notes</span>
          <input name="notes" placeholder="Qualification context and next step" />
        </label>
        <Button type="submit" disabled={pending}>
          <Plus size={15} aria-hidden="true" /> {pending ? "Creating" : "Create lead"}
        </Button>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function CreateCompanyForm({ data }: { data: CrmWorkspaceData }) {
  const [state, action, pending] = useActionState(createCompanyAction, initialState);
  const searchParams = useSearchParams();
  return (
    <details className="crm-create-panel" open={searchParams.get("create") === "company"}>
      <summary>
        <Plus size={16} aria-hidden="true" /> Create company
      </summary>
      <form action={action} className="crm-create-form">
        <label className="field">
          <span>Legal name</span>
          <input name="legalName" required />
        </label>
        <label className="field">
          <span>Display name</span>
          <input name="displayName" />
        </label>
        <label className="field">
          <span>Industry</span>
          <input name="industry" />
        </label>
        <label className="field">
          <span>Website</span>
          <input name="website" type="url" />
        </label>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" />
        </label>
        <label className="field">
          <span>Phone</span>
          <input name="phone" />
        </label>
        <label className="field">
          <span>Owner</span>
          <OwnerSelect data={data} />
        </label>
        <label className="field">
          <span>Currency</span>
          <input name="currency" defaultValue="USD" maxLength={3} required />
        </label>
        <label className="field">
          <span>Payment terms</span>
          <input name="paymentTermsDays" type="number" defaultValue="30" min="0" max="365" />
        </label>
        <label className="field crm-create-form__wide">
          <span>Notes</span>
          <input name="notes" />
        </label>
        <Button type="submit" disabled={pending}>
          <Plus size={15} aria-hidden="true" /> {pending ? "Creating" : "Create company"}
        </Button>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function CreateContactForm({ data }: { data: CrmWorkspaceData }) {
  const [state, action, pending] = useActionState(createContactAction, initialState);
  return (
    <details className="crm-create-panel">
      <summary>
        <Plus size={16} aria-hidden="true" /> Create contact
      </summary>
      <form action={action} className="crm-create-form">
        <label className="field">
          <span>Company</span>
          <select name="companyId" defaultValue="">
            <option value="">No company</option>
            {data.companies.map((company) => (
              <option value={company.id} key={company.id}>
                {company.displayName ?? company.legalName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>First name</span>
          <input name="firstName" required />
        </label>
        <label className="field">
          <span>Last name</span>
          <input name="lastName" required />
        </label>
        <label className="field">
          <span>Job title</span>
          <input name="jobTitle" />
        </label>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" />
        </label>
        <label className="field">
          <span>Phone</span>
          <input name="phone" />
        </label>
        <label className="field">
          <span>Owner</span>
          <OwnerSelect data={data} />
        </label>
        <label className="field">
          <span>Communication</span>
          <select name="preferredCommunication" defaultValue="email">
            <option value="email">Email</option>
            <option value="phone">Phone</option>
            <option value="meeting">Meeting</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="field">
          <span>Consent</span>
          <select name="consentStatus" defaultValue="unknown">
            <option value="unknown">Unknown</option>
            <option value="granted">Granted</option>
            <option value="revoked">Revoked</option>
          </select>
        </label>
        <label className="checkbox-field">
          <input type="checkbox" name="isBillingContact" /> Billing contact
        </label>
        <label className="checkbox-field">
          <input type="checkbox" name="isDecisionMaker" /> Decision maker
        </label>
        <label className="field crm-create-form__wide">
          <span>Notes</span>
          <input name="notes" />
        </label>
        <Button type="submit" disabled={pending}>
          <Plus size={15} aria-hidden="true" /> {pending ? "Creating" : "Create contact"}
        </Button>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function StageRequiredFieldChecklist({ stage }: { stage?: CrmPipelineStage }) {
  const selected = new Set(stage?.requiredFields ?? []);
  return (
    <fieldset className="crm-stage-required-fields">
      <legend>Required before entering this stage</legend>
      {crmStageRequiredFields.map((field) => (
        <label key={field}>
          <input
            type="checkbox"
            name="requiredFields"
            value={field}
            defaultChecked={selected.has(field)}
          />
          <span>{field.replaceAll("_", " ")}</span>
        </label>
      ))}
    </fieldset>
  );
}

function PipelineStageEditForm({ stage }: { stage: CrmPipelineStage }) {
  const [state, action, pending] = useActionState(updatePipelineStageAction, initialState);
  return (
    <details className="crm-inline-editor">
      <summary>{stage.name} settings</summary>
      <form action={action} className="crm-stage-create-form">
        <input type="hidden" name="stageId" value={stage.id} />
        <label className="field">
          <span>Name</span>
          <input name="name" defaultValue={stage.name} required />
        </label>
        <label className="field">
          <span>Probability</span>
          <input
            name="probability"
            type="number"
            min="0"
            max="100"
            defaultValue={stage.probability}
            required
          />
        </label>
        <label className="field">
          <span>State</span>
          <select name="state" defaultValue={stage.state}>
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
        </label>
        <label className="field">
          <span>Active</span>
          <input type="checkbox" name="isActive" value="true" defaultChecked={stage.isActive} />
        </label>
        <StageRequiredFieldChecklist stage={stage} />
        <Button type="submit" disabled={pending}>
          <Save size={15} aria-hidden="true" /> {pending ? "Saving" : "Save stage"}
        </Button>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function PipelineStageForm({ data }: { data: CrmWorkspaceData }) {
  const [state, action, pending] = useActionState(createPipelineStageAction, initialState);
  return (
    <details className="crm-create-panel crm-create-panel--stage">
      <summary>
        <Plus size={16} aria-hidden="true" /> Pipeline stage rules
      </summary>
      <form action={action} className="crm-stage-create-form">
        <label className="field">
          <span>Name</span>
          <input name="name" required />
        </label>
        <label className="field">
          <span>Probability</span>
          <input name="probability" type="number" min="0" max="100" defaultValue="25" required />
        </label>
        <label className="field">
          <span>State</span>
          <select name="state" defaultValue="open">
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
        </label>
        <StageRequiredFieldChecklist />
        <Button type="submit" disabled={pending}>
          <Plus size={15} aria-hidden="true" /> {pending ? "Adding" : "Add stage"}
        </Button>
        <ActionMessage state={state} />
      </form>
      <div className="crm-stage-manager">
        {data.stages.map((stage) => (
          <PipelineStageEditForm key={stage.id} stage={stage} />
        ))}
      </div>
    </details>
  );
}

function ActivityCompleteButton({ activityId }: { activityId: string }) {
  const [state, action, pending] = useActionState(completeActivityAction, initialState);
  return (
    <form action={action}>
      <input type="hidden" name="activityId" value={activityId} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        <CheckCircle2 size={14} aria-hidden="true" /> {pending ? "Completing" : "Complete"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

function ForecastPanel({ data }: { data: CrmWorkspaceData }) {
  const [state, action, pending] = useActionState(setCrmForecastTargetAction, initialState);
  const currentMonth = new Date().toISOString().slice(0, 7);
  return (
    <section className="crm-view crm-forecast" aria-label="Sales forecast report">
      <header className="crm-forecast__header">
        <div>
          <h2>Sales forecast</h2>
          <p>Weighted and unweighted pipeline stay separated by currency.</p>
        </div>
        {data.capabilities.canManagePipeline ? (
          <form action={action} className="crm-stage-create-form">
            <label className="field">
              <span>Month</span>
              <input name="month" type="month" defaultValue={currentMonth} required />
            </label>
            <label className="field">
              <span>Currency</span>
              <input
                name="currency"
                defaultValue={data.forecast.currencies[0]?.currency ?? "USD"}
                maxLength={3}
                required
              />
            </label>
            <label className="field">
              <span>Target</span>
              <input name="targetValue" type="number" min="0" step="0.01" required />
            </label>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving" : "Set target"}
            </Button>
            <ActionMessage state={state} />
          </form>
        ) : null}
      </header>

      <div className="crm-summary">
        {data.forecast.currencies.flatMap((summary) => {
          const money = getNumberFormatter("en", {
            style: "currency",
            currency: summary.currency,
            maximumFractionDigits: 0,
          });
          return [
            <div key={`${summary.currency}-weighted`}>
              <CircleDollarSign size={18} aria-hidden="true" />
              <span>{summary.currency} weighted</span>
              <strong>{money.format(summary.weightedPipeline)}</strong>
            </div>,
            <div key={`${summary.currency}-unweighted`}>
              <TrendingUp size={18} aria-hidden="true" />
              <span>{summary.currency} unweighted</span>
              <strong>{money.format(summary.unweightedPipeline)}</strong>
            </div>,
            <div key={`${summary.currency}-month`}>
              <Sparkles size={18} aria-hidden="true" />
              <span>This month</span>
              <strong>{money.format(summary.forecastThisMonth)}</strong>
            </div>,
            <div key={`${summary.currency}-coverage`}>
              <TrendingUp size={18} aria-hidden="true" />
              <span>Pipeline coverage</span>
              <strong>
                {summary.pipelineCoverageRatio == null
                  ? "Set target"
                  : `${summary.pipelineCoverageRatio.toFixed(1)}×`}
              </strong>
            </div>,
          ];
        })}
      </div>

      {data.forecast.currencies.map((summary) => {
        const money = getNumberFormatter("en", {
          style: "currency",
          currency: summary.currency,
          maximumFractionDigits: 0,
        });
        return (
          <section className="crm-create-panel" key={summary.currency}>
            <h3>{summary.currency} forecast windows</h3>
            <div className="crm-summary">
              <div>
                <span>Next 30 days</span>
                <strong>{money.format(summary.forecastNext30Days)}</strong>
              </div>
              <div>
                <span>Next 60 days</span>
                <strong>{money.format(summary.forecastNext60Days)}</strong>
              </div>
              <div>
                <span>Next 90 days</span>
                <strong>{money.format(summary.forecastNext90Days)}</strong>
              </div>
              <div>
                <span>Monthly target</span>
                <strong>
                  {summary.monthlyTarget == null ? "Not set" : money.format(summary.monthlyTarget)}
                </strong>
              </div>
            </div>
          </section>
        );
      })}

      <div className="crm-record-grid">
        <section className="crm-create-panel">
          <h3>Stage conversion · last 180 days</h3>
          <div className="report-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Entered</th>
                  <th>Advanced</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.forecast.stageConversions.map((metric) => (
                  <tr key={metric.stageId}>
                    <td>{metric.stageName}</td>
                    <td>{metric.entered}</td>
                    <td>{metric.advanced}</td>
                    <td>
                      {metric.conversionRate == null
                        ? "—"
                        : `${(metric.conversionRate * 100).toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Average sales cycle:{" "}
            {data.forecast.averageSalesCycleDays == null
              ? "Not enough converted opportunities"
              : `${data.forecast.averageSalesCycleDays.toFixed(1)} days`}
            .
          </p>
        </section>

        <section className="crm-create-panel">
          <h3>Lost-reason analysis · last 365 days</h3>
          {data.forecast.lostReasons.length ? (
            <ul>
              {data.forecast.lostReasons.map((reason) => (
                <li key={reason.reason}>
                  <strong>{reason.reason}</strong> · {reason.opportunities} opportunity
                  {reason.opportunities === 1 ? "" : "s"} ·{" "}
                  {getNumberFormatter("en", { notation: "compact" }).format(reason.estimatedValue)}
                </li>
              ))}
            </ul>
          ) : (
            <p>No lost opportunities in the period.</p>
          )}
        </section>
      </div>

      <section className="crm-create-panel">
        <h3>Top opportunities at risk</h3>
        {data.forecast.topRisks.length ? (
          <div className="report-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Opportunity</th>
                  <th>Owner</th>
                  <th>Expected revenue</th>
                  <th>Close</th>
                  <th>Stale</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {data.forecast.topRisks.map((risk) => (
                  <tr key={risk.leadId}>
                    <td>
                      {risk.name}
                      <small>{risk.reasons.join(" · ")}</small>
                    </td>
                    <td>{risk.ownerName ?? "Unassigned"}</td>
                    <td>
                      {getNumberFormatter("en", {
                        style: "currency",
                        currency: risk.currency,
                        maximumFractionDigits: 0,
                      }).format(risk.expectedRevenue)}
                    </td>
                    <td>{risk.expectedCloseDate ?? "—"}</td>
                    <td>{risk.daysStale}d</td>
                    <td>{risk.riskScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No open opportunity exceptions are currently flagged.</p>
        )}
        <p>
          {data.forecast.staleOpportunities.length} stale · {data.forecast.overdueFollowUps.length}{" "}
          follow-up overdue.
        </p>
      </section>
    </section>
  );
}

export function CrmWorkspace({
  data,
  initialTab = "pipeline",
  oauthResult = null,
}: {
  data: CrmWorkspaceData;
  initialTab?: WorkspaceTab;
  oauthResult?: CrmOAuthResult | null;
}) {
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabs: ReadonlyArray<readonly [WorkspaceTab, string, number]> = [
    ["pipeline", "Pipeline", data.summary.openLeads],
    ["forecast", "Forecast", data.forecast.topRisks.length],
    ["companies", "Companies", data.summary.companies],
    ["contacts", "Contacts", data.summary.contacts],
    ["activity", "Activity", data.activities.length],
    ["imports", "Imports", data.imports.runs.length],
  ];

  function selectTab(nextTab: WorkspaceTab) {
    setTab(nextTab);
    const params = new URLSearchParams(searchParams.toString());
    if (nextTab === "pipeline") params.delete("tab");
    else params.set("tab", nextTab);
    const query = params.toString();
    router.replace(query ? `/crm?${query}` : "/crm", { scroll: false });
  }

  function moveTab(event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex][0];
    selectTab(nextTab);
    document.getElementById(`crm-tab-${nextTab}`)?.focus();
  }
  const leadsByStage = useMemo(
    () =>
      new Map(
        data.stages.map((stage) => [
          stage.id,
          data.leads.filter((lead) => lead.stageId === stage.id),
        ]),
      ),
    [data.leads, data.stages],
  );

  return (
    <div className="crm-workspace">
      <section className="crm-summary" aria-label="CRM summary">
        <div>
          <TrendingUp size={19} aria-hidden="true" />
          <span>Open leads</span>
          <strong>{data.summary.openLeads}</strong>
        </div>
        <div>
          <Sparkles size={19} aria-hidden="true" />
          <span>Qualified</span>
          <strong>{data.summary.qualifiedLeads}</strong>
        </div>
        <div>
          <CircleDollarSign size={19} aria-hidden="true" />
          <span>Weighted pipeline</span>
          <strong>
            {getNumberFormatter("en", {
              notation: "compact",
              maximumFractionDigits: 1,
            }).format(data.summary.pipelineValue)}
          </strong>
        </div>
        <div>
          <Building2 size={19} aria-hidden="true" />
          <span>Companies</span>
          <strong>{data.summary.companies}</strong>
        </div>
        <div>
          <ContactRound size={19} aria-hidden="true" />
          <span>Contacts</span>
          <strong>{data.summary.contacts}</strong>
        </div>
      </section>

      <section className="crm-filter-panel">
        <CrmFilterForm data={data} />
      </section>

      <nav className="crm-tabs" aria-label="CRM views" role="tablist">
        {tabs.map(([value, label, count], index) => (
          <button
            id={`crm-tab-${value}`}
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls={`crm-panel-${value}`}
            tabIndex={tab === value ? 0 : -1}
            className={tab === value ? "is-active" : ""}
            onClick={() => selectTab(value)}
            onKeyDown={(event) => moveTab(event, index)}
            key={value}
          >
            {label} <span>{count}</span>
          </button>
        ))}
      </nav>

      {tab === "pipeline" ? (
        <section
          className="crm-view"
          id="crm-panel-pipeline"
          role="tabpanel"
          aria-labelledby="crm-tab-pipeline"
        >
          <div className="crm-view__actions">
            {data.capabilities.canCreateLeads ? <CreateLeadForm data={data} /> : null}
            {data.capabilities.canManagePipeline ? <PipelineStageForm data={data} /> : null}
          </div>
          {data.capabilities.canViewLeads ? (
            <div className="crm-pipeline-board">
              {data.stages
                .filter((stage) => stage.isActive)
                .map((stage) => {
                  const leads = leadsByStage.get(stage.id) ?? [];
                  const stageValue = leads.reduce(
                    (sum, lead) => sum + (lead.estimatedValue ?? 0),
                    0,
                  );
                  return (
                    <section className="crm-pipeline-column" key={stage.id}>
                      <header>
                        <div>
                          <strong>{stage.name}</strong>
                          <small>
                            {leads.length} lead{leads.length === 1 ? "" : "s"} · {stage.probability}
                            %
                          </small>
                        </div>
                        <span>
                          {getNumberFormatter("en", { notation: "compact" }).format(stageValue)}
                        </span>
                      </header>
                      <div className="crm-pipeline-column__cards">
                        {leads.length ? (
                          leads.map((lead) => <LeadCard lead={lead} data={data} key={lead.id} />)
                        ) : (
                          <p className="crm-empty-column">No leads in this stage.</p>
                        )}
                      </div>
                    </section>
                  );
                })}
            </div>
          ) : (
            <p className="structure-read-only-note">
              You can open CRM, but lead records are not granted to your role.
            </p>
          )}
        </section>
      ) : null}

      {tab === "forecast" ? (
        <section id="crm-panel-forecast" role="tabpanel" aria-labelledby="crm-tab-forecast">
          <ForecastPanel data={data} />
        </section>
      ) : null}

      {tab === "companies" ? (
        <section
          className="crm-view"
          id="crm-panel-companies"
          role="tabpanel"
          aria-labelledby="crm-tab-companies"
        >
          {data.capabilities.canCreateCompanies ? <CreateCompanyForm data={data} /> : null}
          <div className="crm-record-grid">
            {data.companies.length ? (
              data.companies.map((company) => (
                <CompanyCard company={company} data={data} key={company.id} />
              ))
            ) : (
              <p className="empty-state-copy">No companies match the current search and scope.</p>
            )}
          </div>
        </section>
      ) : null}

      {tab === "contacts" ? (
        <section
          className="crm-view"
          id="crm-panel-contacts"
          role="tabpanel"
          aria-labelledby="crm-tab-contacts"
        >
          {data.capabilities.canCreateContacts ? <CreateContactForm data={data} /> : null}
          <div className="crm-record-grid">
            {data.contacts.length ? (
              data.contacts.map((contact) => (
                <ContactCard contact={contact} data={data} key={contact.id} />
              ))
            ) : (
              <p className="empty-state-copy">No contacts match the current search and scope.</p>
            )}
          </div>
        </section>
      ) : null}

      {tab === "imports" ? (
        <section id="crm-panel-imports" role="tabpanel" aria-labelledby="crm-tab-imports">
          <CrmImportCenter data={data} oauthResult={oauthResult} />
        </section>
      ) : null}

      {tab === "activity" ? (
        <section
          className="crm-activity-timeline"
          id="crm-panel-activity"
          role="tabpanel"
          aria-labelledby="crm-tab-activity"
        >
          {data.activities.length ? (
            data.activities.map((activity) => (
              <article key={activity.id}>
                <span className="crm-activity-timeline__icon">
                  <Activity size={15} aria-hidden="true" />
                </span>
                <div>
                  <header>
                    <strong>{activity.subject}</strong>
                    <StatusBadge tone="neutral">
                      {activity.activityType.replaceAll("_", " ")}
                    </StatusBadge>
                  </header>
                  <p>
                    {activity.entityName} · {activity.actorName}
                  </p>
                  {activity.details ? <small>{activity.details}</small> : null}
                  {activity.dueAt ? (
                    <small>
                      Due{" "}
                      {getDateTimeFormatter("en", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(activity.dueAt))}
                    </small>
                  ) : null}
                  {!activity.completedAt && data.capabilities.canUpdateActivities ? (
                    <ActivityCompleteButton activityId={activity.id} />
                  ) : activity.completedAt ? (
                    <StatusBadge tone="success">completed</StatusBadge>
                  ) : null}
                </div>
                <time dateTime={activity.occurredAt}>
                  {getDateTimeFormatter("en", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(activity.occurredAt))}
                </time>
              </article>
            ))
          ) : (
            <p className="empty-state-copy">No CRM activity is visible in your current scope.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
