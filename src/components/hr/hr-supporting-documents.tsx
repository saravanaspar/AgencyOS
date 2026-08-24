"use client";

import { useActionState, useMemo, useState, type FormEvent } from "react";
import { Download, FileCheck2, FileUp, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";

import { HrActionMessage } from "@/components/hr/hr-action-message";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  reviewHrSupportingDocumentAction,
  setHrSupportingDocumentVisibilityAction,
} from "@/modules/hr/actions/supporting-documents";
import type { HrActionState } from "@/modules/hr/schemas/hr";
import {
  getHrSupportingDocumentCategoryDefinition,
  hrSupportingDocumentCategoryDefinitions,
  humanizeHrSupportingDocumentCategory,
  maskHrSupportingDocumentIdentifier,
} from "@/modules/hr/supporting-documents";
import type { HrSupportingDocumentSummary } from "@/modules/hr/server/supporting-documents";
import type { HrWorkspaceData } from "@/modules/hr/server/hr";

const initialState: HrActionState = { status: "idle" };

function SupportingDocumentUpload({ data }: { data: HrWorkspaceData }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const canManage = data.supportingDocuments.capabilities.canManage;
  const self = data.employees.find((employee) => employee.isSelf) ?? null;
  const allowedCategories = canManage
    ? hrSupportingDocumentCategoryDefinitions
    : hrSupportingDocumentCategoryDefinitions.filter((item) => item.selfUploadAllowed);
  const [category, setCategory] = useState(allowedCategories[0]?.category ?? "identification");
  const definition = getHrSupportingDocumentCategoryDefinition(category);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/hr/supporting-documents/upload", {
        method: "POST",
        body: new FormData(form),
      });
      const result = (await response.json()) as { message?: string };
      setMessage(result.message ?? "Supporting-document upload completed.");
      if (response.ok) {
        form.reset();
        setCategory(allowedCategories[0]?.category ?? "identification");
        router.refresh();
      }
    } catch {
      setMessage("Supporting document could not be uploaded.");
    } finally {
      setPending(false);
    }
  }

  if (!canManage && !data.supportingDocuments.capabilities.canUploadOwn) return null;
  if (!canManage && !self) return null;

  return (
    <details className="hr-create-panel">
      <summary>
        <FileUp size={16} aria-hidden="true" /> Upload supporting document
      </summary>
      <form className="hr-supporting-document-form" onSubmit={upload}>
        {canManage ? (
          <label className="field">
            <span>Employee</span>
            <select name="membershipId" required defaultValue="">
              <option value="" disabled>
                Select employee
              </option>
              {data.employees.map((employee) => (
                <option key={employee.membershipId} value={employee.membershipId}>
                  {employee.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input type="hidden" name="membershipId" value={self?.membershipId ?? ""} />
        )}
        <label className="field">
          <span>Category</span>
          <select
            name="category"
            value={category}
            onChange={(event) => setCategory(event.target.value as typeof category)}
          >
            {allowedCategories.map((item) => (
              <option key={item.category} value={item.category}>
                {item.label}
              </option>
            ))}
          </select>
          <small>{definition.description}</small>
        </label>
        <label className="field">
          <span>Title</span>
          <input name="title" required minLength={2} maxLength={180} />
        </label>
        <label className="field">
          <span>Issuer</span>
          <input name="issuer" maxLength={180} />
        </label>
        {definition.identifierSuffixAllowed ? (
          <label className="field">
            <span>Identifier final four</span>
            <input
              name="identifierSuffix"
              maxLength={4}
              pattern="[A-Za-z0-9]{1,4}"
              autoComplete="off"
            />
            <small>Do not enter the complete government, passport, or licence number.</small>
          </label>
        ) : null}
        <label className="field">
          <span>Issue date</span>
          <input name="issuedDate" type="date" />
        </label>
        <label className="field">
          <span>Expiry date</span>
          <input name="expiryDate" type="date" />
        </label>
        {canManage ? (
          <label className="field hr-supporting-document-form__visibility">
            <span>Employee access</span>
            <select
              name="employeeVisible"
              defaultValue={definition.defaultEmployeeVisible ? "true" : "false"}
              key={category}
            >
              <option value="true">Employee can view</option>
              <option value="false">HR only</option>
            </select>
          </label>
        ) : (
          <input type="hidden" name="employeeVisible" value="true" />
        )}
        <label className="field hr-supporting-document-form__file">
          <span>File</span>
          <input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required />
          <small>
            PDF, JPEG, or PNG up to 10 MB. Uploads are quarantined and scanned before download.
          </small>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Uploading" : "Upload privately"}
        </Button>
        {message ? <small role="status">{message}</small> : null}
      </form>
    </details>
  );
}

function SupportingDocumentCard({
  document,
  canManage,
}: {
  document: HrSupportingDocumentSummary;
  canManage: boolean;
}) {
  const [reviewState, reviewAction, reviewPending] = useActionState(
    reviewHrSupportingDocumentAction,
    initialState,
  );
  const [visibilityState, visibilityAction, visibilityPending] = useActionState(
    setHrSupportingDocumentVisibilityAction,
    initialState,
  );
  const available = document.fileStatus === "available";
  const reviewTone =
    document.reviewStatus === "verified"
      ? "success"
      : document.reviewStatus === "rejected"
        ? "error"
        : "warning";

  return (
    <article className="hr-supporting-document-card">
      <header>
        <div>
          <strong>{document.title}</strong>
          <span>
            {document.employeeName} · {document.reference} · v{document.version}
          </span>
        </div>
        <StatusBadge tone={reviewTone}>{document.reviewStatus}</StatusBadge>
      </header>
      <dl>
        <div>
          <dt>Category</dt>
          <dd>{humanizeHrSupportingDocumentCategory(document.category)}</dd>
        </div>
        <div>
          <dt>Identifier</dt>
          <dd>{maskHrSupportingDocumentIdentifier(document.identifierSuffix)}</dd>
        </div>
        <div>
          <dt>Issuer</dt>
          <dd>{document.issuer ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Expiry</dt>
          <dd>{document.expiryDate ?? "No expiry"}</dd>
        </div>
        <div>
          <dt>Access</dt>
          <dd>{document.employeeVisible ? "Employee and HR" : "HR only"}</dd>
        </div>
        <div>
          <dt>File</dt>
          <dd>{document.fileStatus}</dd>
        </div>
      </dl>
      {document.isExpired ? <p className="hr-supporting-document-card__alert">Expired</p> : null}
      <div className="hr-supporting-document-card__actions">
        {available ? (
          <a
            className="button button--secondary button--sm"
            href={`/api/hr/supporting-documents/${document.id}`}
          >
            <Download size={15} aria-hidden="true" /> Download
          </a>
        ) : null}
        {canManage && document.reviewStatus !== "verified" ? (
          <form action={reviewAction}>
            <input type="hidden" name="documentId" value={document.id} />
            <input type="hidden" name="reviewStatus" value="verified" />
            <Button type="submit" size="sm" disabled={reviewPending}>
              Verify
            </Button>
          </form>
        ) : null}
        {canManage && document.reviewStatus !== "rejected" ? (
          <form action={reviewAction}>
            <input type="hidden" name="documentId" value={document.id} />
            <input type="hidden" name="reviewStatus" value="rejected" />
            <Button type="submit" size="sm" variant="ghost" disabled={reviewPending}>
              Reject
            </Button>
          </form>
        ) : null}
        {canManage ? (
          <form action={visibilityAction}>
            <input type="hidden" name="documentId" value={document.id} />
            <input
              type="hidden"
              name="employeeVisible"
              value={document.employeeVisible ? "false" : "true"}
            />
            <Button type="submit" size="sm" variant="secondary" disabled={visibilityPending}>
              {document.employeeVisible ? "Make HR only" : "Share with employee"}
            </Button>
          </form>
        ) : null}
      </div>
      <HrActionMessage state={reviewState} />
      <HrActionMessage state={visibilityState} />
    </article>
  );
}

export function HrSupportingDocuments({ data }: { data: HrWorkspaceData }) {
  const [category, setCategory] = useState("all");
  const visibleDocuments = useMemo(
    () =>
      category === "all"
        ? data.supportingDocuments.documents
        : data.supportingDocuments.documents.filter((document) => document.category === category),
    [category, data.supportingDocuments.documents],
  );
  if (!data.supportingDocuments.capabilities.canView) return null;

  return (
    <section className="hr-section hr-supporting-documents">
      <header className="hr-section__header">
        <div>
          <h2>Supporting documents</h2>
          <p>
            Store identity, education, certificate, work-authorization, background-check, and exit
            evidence through the existing private-file scanner. Full identifier numbers are never
            stored as searchable metadata.
          </p>
        </div>
        <ShieldCheck aria-label="Restricted, scanner-gated supporting documents" />
      </header>
      <SupportingDocumentUpload data={data} />
      <div className="hr-supporting-documents__toolbar">
        <FileCheck2 size={17} aria-hidden="true" />
        <label className="field">
          <span>Filter category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {hrSupportingDocumentCategoryDefinitions.map((item) => (
              <option key={item.category} value={item.category}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="hr-supporting-document-grid">
        {visibleDocuments.map((document) => (
          <SupportingDocumentCard
            key={document.id}
            document={document}
            canManage={data.supportingDocuments.capabilities.canManage}
          />
        ))}
      </div>
      {visibleDocuments.length === 0 ? (
        <p className="empty-state">No supporting documents are visible in this category.</p>
      ) : null}
    </section>
  );
}
