"use client";

import { type FormEvent, useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileSignature, FileUp, Library, ShieldCheck } from "lucide-react";

import { HrActionMessage } from "@/components/hr/hr-action-message";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  acknowledgeHrEmployeeDocumentAction,
  changeHrDocumentTemplateStatusAction,
  generateHrEmployeeDocumentAction,
  setDefaultHrDocumentTemplateAction,
} from "@/modules/hr/actions/documents";
import {
  hrDocumentTypes,
  humanizeHrDocumentType,
  type HrDocumentType,
} from "@/modules/hr/documents";
import type { HrActionState } from "@/modules/hr/schemas/hr";
import type {
  HrDocumentTemplateOption,
  HrEmployeeDocumentSummary,
} from "@/modules/hr/server/documents";
import type { HrWorkspaceData } from "@/modules/hr/server/hr";

const initialState: HrActionState = { status: "idle" };

function defaultTemplate(
  templates: readonly HrDocumentTemplateOption[],
  documentType: HrDocumentType,
): string {
  return (
    templates.find((template) => template.documentType === documentType && template.isDefault)
      ?.selection ??
    templates.find(
      (template) => template.documentType === documentType && template.status === "active",
    )?.selection ??
    `builtin:${documentType}`
  );
}

function GenerateDocumentForm({ data }: { data: HrWorkspaceData }) {
  const [state, action, pending] = useActionState(generateHrEmployeeDocumentAction, initialState);
  const [documentType, setDocumentType] = useState<HrDocumentType>("offer_letter");
  const [title, setTitle] = useState(() => humanizeHrDocumentType("offer_letter"));
  const [templateSelection, setTemplateSelection] = useState(() =>
    defaultTemplate(data.documents.templates, "offer_letter"),
  );
  const templates = data.documents.templates.filter(
    (template) => template.documentType === documentType && template.status === "active",
  );
  const selectedTemplate = templates.find((template) => template.selection === templateSelection);
  const customFieldPlaceholder = (selectedTemplate?.customFields ?? [])
    .map((key) => `${key} = Replace with reviewed wording`)
    .join("\n");

  function changeDocumentType(value: HrDocumentType) {
    setDocumentType(value);
    setTitle(humanizeHrDocumentType(value));
    setTemplateSelection(defaultTemplate(data.documents.templates, value));
  }

  return (
    <details className="hr-create-panel">
      <summary>
        <FileSignature size={16} aria-hidden="true" /> Generate private document
      </summary>
      <form action={action} className="hr-document-form">
        <label className="field">
          <span>Employee</span>
          <select name="membershipId" required defaultValue="">
            <option value="" disabled>
              Choose employee
            </option>
            {data.employees.map((employee) => (
              <option key={employee.membershipId} value={employee.membershipId}>
                {employee.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Document type</span>
          <select
            name="documentType"
            value={documentType}
            onChange={(event) => changeDocumentType(event.target.value as HrDocumentType)}
          >
            {hrDocumentTypes.map((type) => (
              <option key={type} value={type}>
                {humanizeHrDocumentType(type)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Template</span>
          <select
            name="templateSelection"
            value={templateSelection}
            onChange={(event) => setTemplateSelection(event.target.value)}
            required
          >
            {templates.map((template) => (
              <option key={template.selection} value={template.selection}>
                {template.name} · v{template.version}
                {template.isDefault ? " · default" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Title</span>
          <input
            name="title"
            required
            maxLength={180}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Internal reference</span>
          <input name="reference" required maxLength={80} placeholder="HR/OFFER/2026/001" />
        </label>
        <label className="field">
          <span>Effective date</span>
          <input name="effectiveDate" type="date" required />
        </label>
        <label className="field">
          <span>Expiry date</span>
          <input name="expiryDate" type="date" />
        </label>
        <label className="field">
          <span>Signatory name</span>
          <input name="signatoryName" required maxLength={180} />
        </label>
        <label className="field">
          <span>Signatory title</span>
          <input name="signatoryTitle" required maxLength={160} />
        </label>
        <label className="field hr-document-form__wide">
          <span>Template custom fields</span>
          <textarea
            name="customFields"
            maxLength={50_000}
            rows={9}
            placeholder={customFieldPlaceholder || "custom_key = Replace with reviewed wording"}
          />
          <small>
            One per line using <code>key = value</code>. Values are escaped before rendering.
            {selectedTemplate?.customFields.length
              ? ` Required by this template: ${selectedTemplate.customFields.join(", ")}.`
              : " This template has no custom placeholders."}
          </small>
        </label>
        <div className="hr-document-form__wide hr-document-counsel-note">
          Starter wording is deliberately marked as draft. Replace it with counsel-approved business
          templates before legal use.
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Generating" : "Generate private PDF"}
        </Button>
        <HrActionMessage state={state} />
      </form>
    </details>
  );
}

function TemplateUploadForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/hr/document-templates/upload", {
        method: "POST",
        body: new FormData(form),
      });
      const result = (await response.json()) as { message?: string };
      setMessage(result.message ?? "Template upload completed.");
      if (response.ok) {
        form.reset();
        router.refresh();
      }
    } catch {
      setMessage("Template could not be uploaded.");
    } finally {
      setPending(false);
    }
  }

  return (
    <details className="hr-create-panel">
      <summary>
        <FileUp size={16} aria-hidden="true" /> Upload HTML template
      </summary>
      <form className="hr-document-template-upload" onSubmit={upload}>
        <label className="field">
          <span>Document type</span>
          <select name="documentType" defaultValue="offer_letter">
            {hrDocumentTypes.map((type) => (
              <option key={type} value={type}>
                {humanizeHrDocumentType(type)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Template name</span>
          <input name="name" required maxLength={160} />
        </label>
        <label className="field hr-document-form__wide">
          <span>Description</span>
          <input name="description" maxLength={1000} />
        </label>
        <label className="field hr-document-form__wide">
          <span>Complete HTML template</span>
          <input name="file" type="file" accept="text/html,.html,.htm" required />
          <small>
            Maximum 512 KB. Scripts, forms, iframes, external URLs, active attributes, and CSS URL
            loading are rejected. Templates stay private in object storage and are never served as
            web pages.
          </small>
        </label>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Uploading" : "Upload immutable template version"}
        </Button>
        {message ? <small role="status">{message}</small> : null}
      </form>
    </details>
  );
}

function TemplateCard({ template }: { template: HrDocumentTemplateOption }) {
  const [defaultState, defaultAction, defaultPending] = useActionState(
    setDefaultHrDocumentTemplateAction,
    initialState,
  );
  const [statusState, statusAction, statusPending] = useActionState(
    changeHrDocumentTemplateStatusAction,
    initialState,
  );
  return (
    <article className="hr-document-template-card">
      <header>
        <div>
          <strong>{template.name}</strong>
          <span>
            {humanizeHrDocumentType(template.documentType)} · {template.source} · v
            {template.version}
          </span>
        </div>
        <StatusBadge
          tone={
            template.isDefault ? "success" : template.status === "active" ? "neutral" : "warning"
          }
        >
          {template.isDefault ? "default" : template.status}
        </StatusBadge>
      </header>
      <p>{template.description ?? "No description."}</p>
      <div className="hr-document-template-card__actions">
        {!template.isDefault && template.status === "active" ? (
          <form action={defaultAction}>
            <input type="hidden" name="documentType" value={template.documentType} />
            <input type="hidden" name="templateSelection" value={template.selection} />
            <Button type="submit" size="sm" variant="secondary" disabled={defaultPending}>
              {defaultPending ? "Selecting" : "Set default"}
            </Button>
          </form>
        ) : null}
        {template.source === "object_storage" ? (
          <form action={statusAction}>
            <input type="hidden" name="templateId" value={template.id ?? ""} />
            <input
              type="hidden"
              name="status"
              value={template.status === "active" ? "inactive" : "active"}
            />
            <Button type="submit" size="sm" variant="ghost" disabled={statusPending}>
              {statusPending
                ? "Updating"
                : template.status === "active"
                  ? "Deactivate"
                  : "Activate"}
            </Button>
          </form>
        ) : null}
      </div>
      <HrActionMessage state={defaultState} />
      <HrActionMessage state={statusState} />
    </article>
  );
}

function DocumentCard({ document }: { document: HrEmployeeDocumentSummary }) {
  const [state, action, pending] = useActionState(
    acknowledgeHrEmployeeDocumentAction,
    initialState,
  );
  const available = document.fileStatus === "available";
  return (
    <article className="hr-document-card">
      <header>
        <div>
          <strong>{document.title}</strong>
          <span>
            {document.employeeName} · {document.reference} · v{document.version}
          </span>
        </div>
        <StatusBadge
          tone={available ? "success" : document.fileStatus === "rejected" ? "error" : "warning"}
        >
          {document.fileStatus}
        </StatusBadge>
      </header>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{humanizeHrDocumentType(document.documentType)}</dd>
        </div>
        <div>
          <dt>Effective</dt>
          <dd>{document.effectiveDate}</dd>
        </div>
        <div>
          <dt>Template</dt>
          <dd>
            {document.templateName} · v{document.templateVersion}
          </dd>
        </div>
        <div>
          <dt>Acknowledgement</dt>
          <dd>{document.acknowledgedAt ? "Acknowledged" : "Pending"}</dd>
        </div>
      </dl>
      <div className="hr-document-card__actions">
        {available ? (
          <a
            className="button button--secondary button--sm"
            href={`/api/hr/documents/${document.id}`}
          >
            <Download size={15} aria-hidden="true" /> Download
          </a>
        ) : null}
        {document.isSelf && available && !document.acknowledgedAt ? (
          <form action={action}>
            <input type="hidden" name="documentId" value={document.id} />
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Acknowledging" : "Acknowledge"}
            </Button>
          </form>
        ) : null}
      </div>
      <HrActionMessage state={state} />
    </article>
  );
}

export function HrDocuments({ data }: { data: HrWorkspaceData }) {
  const customTemplates = useMemo(
    () => data.documents.templates.filter((template) => template.source === "object_storage"),
    [data.documents.templates],
  );
  if (
    !data.documents.capabilities.canViewDocuments &&
    !data.documents.capabilities.canViewTemplates
  ) {
    return null;
  }

  return (
    <section className="hr-section hr-documents">
      <header className="hr-section__header">
        <div>
          <h2>Private HR documents</h2>
          <p>
            Generate immutable employee PDFs from swappable templates. Built-in drafts work now;
            later template versions can be selected from the private template catalogue without
            changing document access or storage rules.
          </p>
        </div>
        <ShieldCheck aria-label="Private, scanner-gated document storage" />
      </header>

      {data.documents.capabilities.canManageDocuments ? <GenerateDocumentForm data={data} /> : null}

      {data.documents.capabilities.canManageTemplates ? (
        <div className="hr-document-template-management">
          <header>
            <Library size={18} aria-hidden="true" />
            <div>
              <h3>Template catalogue</h3>
              <p>
                Every upload creates a new immutable version. Defaults are selected per document
                type.
              </p>
            </div>
          </header>
          <TemplateUploadForm />
          <div className="hr-document-template-grid">
            {data.documents.templates.map((template) => (
              <TemplateCard key={template.selection} template={template} />
            ))}
          </div>
          {customTemplates.length === 0 ? (
            <p className="empty-state">No custom templates have been uploaded yet.</p>
          ) : null}
        </div>
      ) : null}

      {data.documents.capabilities.canViewDocuments ? (
        <div className="hr-document-grid">
          {data.documents.documents.map((document) => (
            <DocumentCard key={document.id} document={document} />
          ))}
        </div>
      ) : null}
      {data.documents.capabilities.canViewDocuments && data.documents.documents.length === 0 ? (
        <p className="empty-state">No private employee documents are visible in your scope.</p>
      ) : null}
    </section>
  );
}
