"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Banknote,
  BookOpenCheck,
  Download,
  Eye,
  FileBarChart2,
  FileCheck2,
  FileText,
  History,
  Mail,
  Paperclip,
  PackagePlus,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Undo2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { getDateTimeFormatter } from "@/lib/intl-formatters";
import { ExpensesSection } from "@/components/finance/expenses-section";
import { FinanceReportsSection } from "@/components/finance/finance-reports-section";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  createCatalogItemAction,
  createCreditNoteAction,
  createEstimateAction,
  createInvoiceAction,
  createRevisedInvoiceAction,
  createPaymentAction,
  decideFinanceApprovalAction,
  generateFinanceDocumentSnapshotAction,
  issueCreditNoteAction,
  issueInvoiceAction,
  reconcilePaymentAction,
  recordPaymentRefundAction,
  recordEstimateClientDecisionAction,
  sendFinanceDocumentAction,
  setCatalogItemStatusAction,
  updateInvoiceStatusAction,
  convertEstimateToInvoiceAction,
  voidCreditNoteAction,
  voidInvoiceAction,
} from "@/modules/finance/actions/finance";
import {
  currencyMinorUnits,
  formatMinorMoney,
  summarizeFinanceTaxes,
} from "@/modules/finance/calculations";
import {
  approvalStatuses,
  creditNoteStatuses,
  estimateStatuses,
  expensePaymentStatuses,
  expenseTypes,
  financeStatusLabel,
  invoiceStatuses,
  paymentMethods,
} from "@/modules/finance/finance";
import type { FinanceActionState } from "@/modules/finance/schemas/finance";
import type {
  FinanceCatalogItem,
  FinanceCreditNote,
  FinanceDeliverySummary,
  FinanceDocumentLine,
  FinanceDocumentSnapshotSummary,
  FinanceEstimate,
  FinanceInvoice,
  FinancePayment,
  FinanceWorkspaceData,
} from "@/modules/finance/server/finance";

const initialState: FinanceActionState = { status: "idle" };

type FinanceTab = FinanceWorkspaceData["filters"]["tab"];

type EditableLine = {
  key: string;
  catalogItemId: string;
  description: string;
  quantity: string;
  unitRate: string;
  discountPercent: string;
  taxPercent: string;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function minorToInput(amount: number, currency: string): string {
  const places = currencyMinorUnits(currency);
  return (amount / 10 ** places).toFixed(places);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function percentFromBps(bps: number): string {
  return (bps / 100).toFixed(2).replace(/\.00$/, "");
}

function newLine(key: string): EditableLine {
  return {
    key,
    catalogItemId: "",
    description: "",
    quantity: "1",
    unitRate: "0.00",
    discountPercent: "0",
    taxPercent: "0",
  };
}

function toneForStatus(status: string): "success" | "warning" | "error" | "info" | "neutral" {
  if (["approved", "accepted", "paid", "reconciled"].includes(status)) return "success";
  if (["pending_approval", "sent", "viewed", "partially_paid", "matched"].includes(status))
    return "info";
  if (["overdue", "disputed", "exception"].includes(status)) return "warning";
  if (["rejected", "void", "cancelled", "credited"].includes(status)) return "error";
  return "neutral";
}

function ActionMessage({ state }: { state: FinanceActionState }) {
  if (state.status === "idle") return null;
  return (
    <p className={`finance-action-message finance-action-message--${state.status}`} role="status">
      {state.message}
    </p>
  );
}

function Summary({ data }: { data: FinanceWorkspaceData }) {
  const summary = data.summary;
  if (data.filters.tab === "reports" && data.capabilities.canViewReports) {
    const netRevenueMinor = data.revenueByMonth.reduce((sum, row) => sum + row.revenueMinor, 0);
    const expenseMinor = data.expenseByCategory.reduce((sum, row) => sum + row.totalMinor, 0);
    return (
      <section className="finance-summary" aria-label="Financial report overview">
        <div>
          <Banknote size={18} aria-hidden="true" />
          <span>Net revenue</span>
          <strong>{formatMinorMoney(netRevenueMinor, data.defaultCurrency, data.locale)}</strong>
        </div>
        <div>
          <ReceiptText size={18} aria-hidden="true" />
          <span>Approved expenses</span>
          <strong>{formatMinorMoney(expenseMinor, data.defaultCurrency, data.locale)}</strong>
        </div>
        <div>
          <FileBarChart2 size={18} aria-hidden="true" />
          <span>Gross profit</span>
          <strong>
            {formatMinorMoney(netRevenueMinor - expenseMinor, data.defaultCurrency, data.locale)}
          </strong>
        </div>
        <div>
          <BadgeCheck size={18} aria-hidden="true" />
          <span>Estimate conversion</span>
          <strong>{(data.estimateConversion.rateBps / 100).toFixed(1)}%</strong>
        </div>
      </section>
    );
  }
  if (data.filters.tab === "expenses") {
    return (
      <section className="finance-summary" aria-label="Expense overview">
        <div>
          <ReceiptText size={18} aria-hidden="true" />
          <span>Expenses this month</span>
          <strong>
            {formatMinorMoney(
              data.expenseSummary.totalThisMonthMinor,
              data.defaultCurrency,
              data.locale,
            )}
          </strong>
        </div>
        <div>
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Pending approval</span>
          <strong>
            {formatMinorMoney(
              data.expenseSummary.pendingApprovalMinor,
              data.defaultCurrency,
              data.locale,
            )}
          </strong>
        </div>
        <div>
          <Undo2 size={18} aria-hidden="true" />
          <span>Reimbursable</span>
          <strong>
            {formatMinorMoney(
              data.expenseSummary.reimbursableMinor,
              data.defaultCurrency,
              data.locale,
            )}
          </strong>
        </div>
        <div>
          <Banknote size={18} aria-hidden="true" />
          <span>Unpaid</span>
          <strong>
            {formatMinorMoney(data.expenseSummary.unpaidMinor, data.defaultCurrency, data.locale)}
          </strong>
        </div>
      </section>
    );
  }
  return (
    <section className="finance-summary" aria-label="Finance overview">
      <div>
        <FileText size={18} aria-hidden="true" />
        <span>Open estimate value</span>
        <strong>
          {formatMinorMoney(summary.draftEstimateValueMinor, summary.currency, data.locale)}
        </strong>
      </div>
      <div>
        <ReceiptText size={18} aria-hidden="true" />
        <span>Outstanding</span>
        <strong>{formatMinorMoney(summary.outstandingMinor, summary.currency, data.locale)}</strong>
      </div>
      <div>
        <FileCheck2 size={18} aria-hidden="true" />
        <span>Overdue</span>
        <strong>{formatMinorMoney(summary.overdueMinor, summary.currency, data.locale)}</strong>
      </div>
      <div>
        <Banknote size={18} aria-hidden="true" />
        <span>Paid this month</span>
        <strong>
          {formatMinorMoney(summary.paidThisMonthMinor, summary.currency, data.locale)}
        </strong>
      </div>
    </section>
  );
}

function FinanceNavigation({ data }: { data: FinanceWorkspaceData }) {
  const active = data.filters.tab;
  const tabs: Array<{ key: FinanceTab; label: string; visible: boolean }> = [
    { key: "invoices", label: "Invoices", visible: data.capabilities.canViewInvoices },
    { key: "estimates", label: "Estimates", visible: data.capabilities.canViewEstimates },
    {
      key: "credit_notes",
      label: "Credit notes",
      visible: data.capabilities.canViewCreditNotes,
    },
    { key: "catalog", label: "Catalogue", visible: data.capabilities.canViewCatalog },
    { key: "payments", label: "Payments", visible: data.capabilities.canViewPayments },
    { key: "expenses", label: "Expenses", visible: data.capabilities.canViewExpenses },
    { key: "reports", label: "Reports", visible: data.capabilities.canViewReports },
  ];
  return (
    <nav className="finance-tabs" aria-label="Finance sections">
      {tabs
        .filter((tab) => tab.visible)
        .map((tab) => (
          <Link
            key={tab.key}
            href={`/finance?tab=${tab.key}`}
            className={active === tab.key ? "finance-tab finance-tab--active" : "finance-tab"}
            aria-current={active === tab.key ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
    </nav>
  );
}

function FinanceFilters({ data }: { data: FinanceWorkspaceData }) {
  if (data.filters.tab === "reports") {
    return (
      <form className="finance-filter-form finance-filter-form--reports" method="get">
        <input type="hidden" name="tab" value="reports" />
        <label className="field">
          <span>From</span>
          <input type="date" name="from" defaultValue={data.reportPeriod.from} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" name="to" defaultValue={data.reportPeriod.to} />
        </label>
        <label className="field">
          <span>Client statement</span>
          <select name="company" defaultValue={data.filters.company ?? ""}>
            <option value="">Choose a client</option>
            {data.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary">
          Update reports
        </Button>
      </form>
    );
  }

  const statuses =
    data.filters.tab === "estimates"
      ? estimateStatuses
      : data.filters.tab === "credit_notes"
        ? creditNoteStatuses
        : data.filters.tab === "expenses"
          ? [...expenseTypes, ...approvalStatuses, ...expensePaymentStatuses]
          : invoiceStatuses;
  return (
    <form className="finance-filter-form" method="get">
      <input type="hidden" name="tab" value={data.filters.tab} />
      <label className="finance-search-field">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">Search finance records</span>
        <input
          type="search"
          name="q"
          defaultValue={data.filters.q}
          placeholder="Search number, client, item, or reference"
        />
      </label>
      {data.filters.tab !== "expenses" ? (
        <label className="field">
          <span>Client</span>
          <select name="company" defaultValue={data.filters.company ?? ""}>
            <option value="">All clients</option>
            {data.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {data.filters.scope ? <input type="hidden" name="scope" value={data.filters.scope} /> : null}
      {data.filters.currency ? (
        <label className="field">
          <span>Currency</span>
          <input name="currency" defaultValue={data.filters.currency} maxLength={3} />
        </label>
      ) : null}
      {data.filters.from || data.filters.to ? (
        <>
          <label className="field">
            <span>From</span>
            <input type="date" name="from" defaultValue={data.filters.from ?? ""} />
          </label>
          <label className="field">
            <span>To</span>
            <input type="date" name="to" defaultValue={data.filters.to ?? ""} />
          </label>
        </>
      ) : null}
      <label className="field">
        <span>Status</span>
        <select name="status" defaultValue={data.filters.status ?? ""}>
          <option value="">All statuses</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {financeStatusLabel(status)}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="secondary">
        Apply filters
      </Button>
    </form>
  );
}

function LineItemsEditor({
  items,
  currency,
  initialLines = [],
}: {
  items: FinanceCatalogItem[];
  currency: string;
  initialLines?: readonly FinanceDocumentLine[];
}) {
  const initialEditableLines = initialLines.length
    ? initialLines.map((line, index) => ({
        key: `line-${index + 1}`,
        catalogItemId: line.catalogItemId ?? "",
        description: line.description,
        quantity: String(line.quantityMilli / 1_000),
        unitRate: minorToInput(line.unitRateMinor, currency),
        discountPercent: percentFromBps(line.discountBps),
        taxPercent: percentFromBps(line.taxBps),
      }))
    : [newLine("line-1")];
  const nextLineId = useRef(initialEditableLines.length);
  const [lines, setLines] = useState<EditableLine[]>(initialEditableLines);

  function updateLine(key: string, patch: Partial<EditableLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function chooseItem(key: string, itemId: string) {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) {
      updateLine(key, { catalogItemId: "" });
      return;
    }
    updateLine(key, {
      catalogItemId: item.id,
      description: item.defaultInvoiceDescription ?? item.description ?? item.name,
      unitRate: minorToInput(item.standardRateMinor, item.currency),
      taxPercent: percentFromBps(item.taxRateBps),
    });
  }

  const serialized = JSON.stringify(
    lines.map(
      ({ catalogItemId, description, quantity, unitRate, discountPercent, taxPercent }) => ({
        catalogItemId: catalogItemId || null,
        description,
        quantity,
        unitRate,
        discountPercent,
        taxPercent,
      }),
    ),
  );

  return (
    <fieldset className="finance-lines">
      <legend>Line items</legend>
      <input type="hidden" name="lines" value={serialized} />
      <div className="finance-lines__header" aria-hidden="true">
        <span>Item and description</span>
        <span>Quantity</span>
        <span>Rate ({currency})</span>
        <span>Discount %</span>
        <span>Tax %</span>
        <span />
      </div>
      {lines.map((line, index) => (
        <div className="finance-line" key={line.key}>
          <div className="finance-line__description">
            <label className="field">
              <span>Catalogue item {index + 1}</span>
              <select
                value={line.catalogItemId}
                onChange={(event) => chooseItem(line.key, event.target.value)}
              >
                <option value="">Custom line</option>
                {items
                  .filter((item) => item.isActive && item.currency === currency)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.sku ? ` · ${item.sku}` : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Description</span>
              <input
                value={line.description}
                onChange={(event) => updateLine(line.key, { description: event.target.value })}
                required
                maxLength={500}
              />
            </label>
          </div>
          <label className="field">
            <span>Quantity</span>
            <input
              inputMode="decimal"
              value={line.quantity}
              onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
              required
            />
          </label>
          <label className="field">
            <span>Rate</span>
            <input
              inputMode="decimal"
              value={line.unitRate}
              onChange={(event) => updateLine(line.key, { unitRate: event.target.value })}
              required
            />
          </label>
          <label className="field">
            <span>Discount %</span>
            <input
              inputMode="decimal"
              value={line.discountPercent}
              onChange={(event) => updateLine(line.key, { discountPercent: event.target.value })}
              required
            />
          </label>
          <label className="field">
            <span>Tax %</span>
            <input
              inputMode="decimal"
              value={line.taxPercent}
              onChange={(event) => updateLine(line.key, { taxPercent: event.target.value })}
              required
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove line ${index + 1}`}
            disabled={lines.length === 1}
            onClick={() =>
              setLines((current) => current.filter((candidate) => candidate.key !== line.key))
            }
          >
            <Trash2 size={15} aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          nextLineId.current += 1;
          setLines((current) => [...current, newLine(`line-${nextLineId.current}`)]);
        }}
      >
        <Plus size={15} aria-hidden="true" /> Add line
      </Button>
    </fieldset>
  );
}

function ClientDocumentFields({
  data,
  currency,
  onCurrencyChange,
}: {
  data: FinanceWorkspaceData;
  currency: string;
  onCurrencyChange: (currency: string) => void;
}) {
  const [companyId, setCompanyId] = useState("");
  return (
    <>
      <label className="field">
        <span>Client</span>
        <select
          name="companyId"
          value={companyId}
          onChange={(event) => {
            const nextCompanyId = event.target.value;
            setCompanyId(nextCompanyId);
            const nextCompany = data.companies.find((company) => company.id === nextCompanyId);
            if (nextCompany) onCurrencyChange(nextCompany.currency);
          }}
          required
        >
          <option value="">Choose a client</option>
          {data.companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Billing contact</span>
        <select name="contactId" defaultValue="">
          <option value="">No contact selected</option>
          {data.contacts
            .filter((contact) => !companyId || contact.companyId === companyId)
            .map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
                {contact.isBillingContact ? " · Billing" : ""}
              </option>
            ))}
        </select>
      </label>
      <label className="field">
        <span>Project</span>
        <select name="projectId" defaultValue="">
          <option value="">No project selected</option>
          {data.projects
            .filter(
              (project) =>
                !companyId || project.companyId === null || project.companyId === companyId,
            )
            .map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.name}
              </option>
            ))}
        </select>
      </label>
      <label className="field">
        <span>Currency</span>
        <input
          name="currency"
          value={currency}
          onChange={(event) => onCurrencyChange(event.target.value.toUpperCase())}
          pattern="[A-Za-z]{3}"
          maxLength={3}
          required
        />
      </label>
    </>
  );
}

function CatalogStatusControl({ item }: { item: FinanceCatalogItem }) {
  const [state, action, pending] = useActionState(setCatalogItemStatusAction, initialState);
  return (
    <form action={action} className="finance-status-control">
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="isActive" value={item.isActive ? "false" : "true"} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {item.isActive ? (
          <ToggleLeft size={15} aria-hidden="true" />
        ) : (
          <ToggleRight size={15} aria-hidden="true" />
        )}
        {pending ? "Saving" : item.isActive ? "Deactivate" : "Activate"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

function DocumentControls({
  entityType,
  entityId,
  documentNumber,
  snapshots,
  deliveries,
  recipientEmail,
  requestToken,
  canGenerate,
  canSend,
}: {
  entityType: "estimate" | "invoice" | "credit_note" | "payment_receipt";
  entityId: string;
  documentNumber: string;
  snapshots: FinanceDocumentSnapshotSummary[];
  deliveries: FinanceDeliverySummary[];
  recipientEmail: string | null;
  requestToken: string;
  canGenerate: boolean;
  canSend: boolean;
}) {
  const [generateState, generateAction, generating] = useActionState(
    generateFinanceDocumentSnapshotAction,
    initialState,
  );
  const [sendState, sendAction, sending] = useActionState(sendFinanceDocumentAction, initialState);
  const latestSnapshot = snapshots[0];
  const latestDelivery = deliveries[0];

  if (!canGenerate && !canSend && !latestSnapshot && !latestDelivery) return null;

  return (
    <div className="finance-document-controls">
      <div className="finance-document-controls__toolbar">
        {latestSnapshot ? (
          <a
            className="button button--secondary button--sm"
            href={`/api/finance/documents/${latestSnapshot.id}`}
          >
            <Download size={15} aria-hidden="true" /> Download PDF
          </a>
        ) : canGenerate ? (
          <form action={generateAction}>
            <input type="hidden" name="entityType" value={entityType} />
            <input type="hidden" name="entityId" value={entityId} />
            <Button type="submit" size="sm" variant="secondary" disabled={generating}>
              <FileCheck2 size={15} aria-hidden="true" />
              {generating ? "Generating" : "Generate PDF"}
            </Button>
          </form>
        ) : null}
        {canSend ? (
          <details className="finance-email-disclosure">
            <summary>
              <Mail size={15} aria-hidden="true" /> Email document
            </summary>
            <form action={sendAction} className="finance-email-form">
              <input type="hidden" name="entityType" value={entityType} />
              <input type="hidden" name="entityId" value={entityId} />
              <input type="hidden" name="requestToken" value={requestToken} />
              <label className="field">
                <span>Recipient</span>
                <input
                  type="email"
                  name="recipientEmail"
                  defaultValue={recipientEmail ?? ""}
                  maxLength={320}
                  required
                />
              </label>
              <label className="field">
                <span>Subject</span>
                <input
                  name="subject"
                  defaultValue={`${financeStatusLabel(entityType)} ${documentNumber}`}
                  maxLength={240}
                  required
                />
              </label>
              <Button type="submit" size="sm" disabled={sending}>
                {sending ? "Sending" : "Send email"}
              </Button>
              <ActionMessage state={sendState} />
            </form>
          </details>
        ) : null}
      </div>
      <ActionMessage state={generateState} />
      {latestSnapshot || latestDelivery ? (
        <div className="finance-document-history">
          {latestSnapshot ? (
            <span>
              PDF v{latestSnapshot.versionNumber}, {latestSnapshot.downloadCount} download
              {latestSnapshot.downloadCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {latestDelivery ? (
            <span>
              Latest email: {financeStatusLabel(latestDelivery.status)} to{" "}
              {latestDelivery.recipientEmail}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EstimateClientDecisionForm({ estimate }: { estimate: FinanceEstimate }) {
  const [state, action, pending] = useActionState(recordEstimateClientDecisionAction, initialState);
  return (
    <details className="finance-inline-disclosure">
      <summary>Record client decision</summary>
      <form action={action} className="finance-inline-form finance-inline-form--stacked">
        <input type="hidden" name="estimateId" value={estimate.id} />
        <label className="field">
          <span>Decision</span>
          <select name="decision" defaultValue="accepted">
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label className="field finance-form__wide">
          <span>Evidence note</span>
          <input
            name="note"
            minLength={3}
            maxLength={2000}
            placeholder="Email, meeting, or signed approval reference"
            required
          />
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Recording" : "Save decision"}
        </Button>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function EstimateConversionForm({ estimate }: { estimate: FinanceEstimate }) {
  const [state, action, pending] = useActionState(convertEstimateToInvoiceAction, initialState);
  const issueDate = today();
  return (
    <details className="finance-inline-disclosure">
      <summary>Convert to invoice</summary>
      <form action={action} className="finance-inline-form finance-inline-form--stacked">
        <input type="hidden" name="estimateId" value={estimate.id} />
        <label className="field">
          <span>Issue date</span>
          <input type="date" name="issueDate" defaultValue={issueDate} required />
        </label>
        <label className="field">
          <span>Due date</span>
          <input type="date" name="dueDate" defaultValue={plusDays(issueDate, 30)} required />
        </label>
        <label className="field">
          <span>Purchase order reference</span>
          <input name="purchaseOrderReference" maxLength={120} />
        </label>
        <label className="field finance-form__wide">
          <span>Bank and payment details</span>
          <input name="bankDetails" maxLength={2000} />
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Converting" : "Create invoice draft"}
        </Button>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function EstimateVersionHistory({
  estimate,
  locale,
}: {
  estimate: FinanceEstimate;
  locale: string;
}) {
  if (estimate.versions.length === 0) return null;
  return (
    <details className="finance-history-disclosure">
      <summary>
        <History size={15} aria-hidden="true" /> Version history ({estimate.versions.length})
      </summary>
      <ol className="finance-history-list">
        {estimate.versions.map((version) => (
          <li key={version.id}>
            <strong>Version {version.versionNumber}</strong>
            <span>{version.reason ?? "Document updated"}</span>
            <time dateTime={version.createdAt}>
              {getDateTimeFormatter(locale, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "UTC",
              }).format(new Date(version.createdAt))}
            </time>
          </li>
        ))}
      </ol>
    </details>
  );
}

function CatalogSection({ data }: { data: FinanceWorkspaceData }) {
  const [state, action, pending] = useActionState(createCatalogItemAction, initialState);
  return (
    <section className="finance-section" aria-labelledby="catalog-title">
      <div className="finance-section__heading">
        <div>
          <h2 id="catalog-title">Products and services</h2>
          <p>
            Rates and tax defaults are copied into document lines. Historical invoices never read
            live catalogue values.
          </p>
        </div>
      </div>
      {data.capabilities.canManageCatalog ? (
        <details className="finance-create-panel">
          <summary>
            <PackagePlus size={16} aria-hidden="true" /> Add catalogue item
          </summary>
          <form action={action} className="finance-form finance-form--catalog">
            <label className="field">
              <span>Type</span>
              <select name="itemType" defaultValue="service">
                <option value="service">Service</option>
                <option value="product">Product</option>
              </select>
            </label>
            <label className="field finance-form__wide">
              <span>Name</span>
              <input name="name" required maxLength={180} />
            </label>
            <label className="field">
              <span>SKU or code</span>
              <input name="sku" maxLength={80} />
            </label>
            <label className="field">
              <span>Unit</span>
              <input name="unit" defaultValue="each" required maxLength={40} />
            </label>
            <label className="field">
              <span>Standard rate</span>
              <input name="standardRate" inputMode="decimal" defaultValue="0.00" required />
            </label>
            <label className="field">
              <span>Currency</span>
              <input
                name="currency"
                defaultValue={data.defaultCurrency}
                pattern="[A-Za-z]{3}"
                maxLength={3}
                required
              />
            </label>
            <label className="field">
              <span>Tax category</span>
              <input name="taxCategory" defaultValue="standard" required maxLength={80} />
            </label>
            <label className="field">
              <span>Tax rate %</span>
              <input name="taxPercent" inputMode="decimal" defaultValue="0" required />
            </label>
            <label className="field finance-form__full">
              <span>Description</span>
              <textarea name="description" rows={2} maxLength={2000} />
            </label>
            <label className="field finance-form__full">
              <span>Default invoice description</span>
              <textarea name="defaultInvoiceDescription" rows={2} maxLength={500} />
            </label>
            <input type="hidden" name="isActive" value="true" />
            <div className="finance-form__actions finance-form__full">
              <Button type="submit" disabled={pending}>
                <Plus size={15} aria-hidden="true" /> {pending ? "Creating" : "Create item"}
              </Button>
            </div>
            <ActionMessage state={state} />
          </form>
        </details>
      ) : null}
      {data.catalogItems.length === 0 ? (
        <div className="finance-empty">
          <BookOpenCheck size={24} aria-hidden="true" />
          <h3>No catalogue items</h3>
          <p>Add the services and products that appear most often on estimates and invoices.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table finance-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Code</th>
                <th>Unit</th>
                <th>Rate</th>
                <th>Tax</th>
                <th>Status</th>
                {data.capabilities.canManageCatalog ? <th>Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {data.catalogItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    <span>{item.itemType}</span>
                  </td>
                  <td>{item.sku ?? "—"}</td>
                  <td>{item.unit}</td>
                  <td>{formatMinorMoney(item.standardRateMinor, item.currency, data.locale)}</td>
                  <td>{percentFromBps(item.taxRateBps)}%</td>
                  <td>
                    <StatusBadge tone={item.isActive ? "success" : "neutral"}>
                      {item.isActive ? "Active" : "Inactive"}
                    </StatusBadge>
                  </td>
                  {data.capabilities.canManageCatalog ? (
                    <td>
                      <CatalogStatusControl item={item} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EstimateCreateForm({ data }: { data: FinanceWorkspaceData }) {
  const [state, action, pending] = useActionState(createEstimateAction, initialState);
  const issueDate = today();
  const [currency, setCurrency] = useState(data.defaultCurrency);
  return (
    <details className="finance-create-panel">
      <summary>
        <Plus size={16} aria-hidden="true" /> Create estimate
      </summary>
      <form action={action} className="finance-form finance-form--document">
        <ClientDocumentFields data={data} currency={currency} onCurrencyChange={setCurrency} />
        <label className="field">
          <span>Issue date</span>
          <input type="date" name="issueDate" defaultValue={issueDate} required />
        </label>
        <label className="field">
          <span>Expiry date</span>
          <input type="date" name="expiryDate" defaultValue={plusDays(issueDate, 30)} />
        </label>
        <LineItemsEditor items={data.catalogItems} currency={currency} />
        <label className="field finance-form__full">
          <span>Client notes</span>
          <textarea name="notes" rows={2} maxLength={4000} />
        </label>
        <label className="field finance-form__full">
          <span>Terms</span>
          <textarea name="terms" rows={2} maxLength={4000} />
        </label>
        <label className="field finance-form__full">
          <span>Internal notes</span>
          <textarea name="internalNotes" rows={2} maxLength={4000} />
        </label>
        <div className="finance-security-note finance-form__full">
          <ShieldCheck size={17} aria-hidden="true" />
          <p>
            Estimate numbers are allocated in the database. Exact matching drafts are reused instead
            of duplicated.
          </p>
        </div>
        <div className="finance-form__actions finance-form__full">
          <Button type="submit" disabled={pending}>
            {pending ? "Creating" : "Create estimate"}
          </Button>
        </div>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function ApprovalControls({
  entityId,
  entityType,
  status,
  canUpdate,
}: {
  entityId: string;
  entityType: "estimate" | "invoice" | "credit_note";
  status: string;
  canUpdate: boolean;
}) {
  const [state, action, pending] = useActionState(decideFinanceApprovalAction, initialState);
  if (status === "pending_approval") {
    return (
      <Link className="button button--secondary button--sm" href="/approvals">
        View approval
      </Link>
    );
  }
  if (status !== "draft" || !canUpdate) return null;
  return (
    <form action={action} className="finance-inline-actions">
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="entityType" value={entityType} />
      <Button type="submit" name="decision" value="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Submitting" : "Submit approval"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

function EstimatesSection({ data }: { data: FinanceWorkspaceData }) {
  return (
    <section className="finance-section" aria-labelledby="estimates-title">
      <div className="finance-section__heading">
        <div>
          <h2 id="estimates-title">Estimates</h2>
          <p>
            Approval, client decisions, version history, PDF snapshots, and invoice conversion stay
            attached to one estimate record.
          </p>
        </div>
        {data.capabilities.canCreateEstimates ? <EstimateCreateForm data={data} /> : null}
      </div>
      {data.estimates.length === 0 ? (
        <div className="finance-empty">
          <FileText size={24} aria-hidden="true" />
          <h3>No estimates found</h3>
          <p>Create a priced estimate for a client and project.</p>
        </div>
      ) : (
        <div className="finance-record-list">
          {data.estimates.map((estimate) => {
            const contact = data.contacts.find((candidate) => candidate.id === estimate.contactId);
            const documentReady = ["approved", "sent", "accepted", "converted"].includes(
              estimate.status,
            );
            return (
              <article className="finance-record" key={estimate.id}>
                <div className="finance-record__primary">
                  <div>
                    <strong>{estimate.estimateNumber}</strong>
                    <span>
                      {estimate.companyName}
                      {estimate.projectName ? ` · ${estimate.projectName}` : ""}
                    </span>
                  </div>
                  <StatusBadge tone={toneForStatus(estimate.status)}>
                    {financeStatusLabel(estimate.status)}
                  </StatusBadge>
                </div>
                <dl className="finance-record__facts">
                  <div>
                    <dt>Issue</dt>
                    <dd>{estimate.issueDate}</dd>
                  </div>
                  <div>
                    <dt>Expires</dt>
                    <dd>{estimate.expiryDate ?? "Not set"}</dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd>{estimate.versionNumber}</dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd>{formatMinorMoney(estimate.totalMinor, estimate.currency, data.locale)}</dd>
                  </div>
                </dl>
                {estimate.clientDecisionNote ? (
                  <p className="finance-evidence-note">
                    <strong>Client decision evidence:</strong> {estimate.clientDecisionNote}
                  </p>
                ) : null}
                <div className="finance-record__actions">
                  <ApprovalControls
                    entityId={estimate.id}
                    entityType="estimate"
                    status={estimate.status}
                    canUpdate={data.capabilities.canUpdateEstimates}
                  />
                  {data.capabilities.canRecordEstimateAcceptance &&
                  ["approved", "sent"].includes(estimate.status) ? (
                    <EstimateClientDecisionForm estimate={estimate} />
                  ) : null}
                  {data.capabilities.canConvertEstimates &&
                  data.capabilities.canCreateInvoices &&
                  estimate.status === "accepted" &&
                  !estimate.convertedInvoiceId ? (
                    <EstimateConversionForm estimate={estimate} />
                  ) : null}
                </div>
                {documentReady ? (
                  <DocumentControls
                    entityType="estimate"
                    entityId={estimate.id}
                    documentNumber={estimate.estimateNumber}
                    snapshots={estimate.snapshots}
                    deliveries={estimate.deliveries}
                    recipientEmail={contact?.email ?? null}
                    requestToken={estimate.deliveryRequestToken}
                    canGenerate={data.capabilities.canDownloadDocuments}
                    canSend={data.capabilities.canSendDocuments}
                  />
                ) : null}
                <EstimateVersionHistory estimate={estimate} locale={data.locale} />
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function InvoiceCreateForm({ data }: { data: FinanceWorkspaceData }) {
  const [state, action, pending] = useActionState(createInvoiceAction, initialState);
  const issueDate = today();
  const [currency, setCurrency] = useState(data.defaultCurrency);
  return (
    <details className="finance-create-panel">
      <summary>
        <Plus size={16} aria-hidden="true" /> Create invoice draft
      </summary>
      <form action={action} className="finance-form finance-form--document">
        <ClientDocumentFields data={data} currency={currency} onCurrencyChange={setCurrency} />
        <label className="field">
          <span>Purchase order reference</span>
          <input name="purchaseOrderReference" maxLength={120} />
        </label>
        <label className="field">
          <span>Planned issue date</span>
          <input type="date" name="issueDate" defaultValue={issueDate} />
        </label>
        <label className="field">
          <span>Planned due date</span>
          <input type="date" name="dueDate" defaultValue={plusDays(issueDate, 30)} />
        </label>
        <label className="field">
          <span>Service period start</span>
          <input type="date" name="servicePeriodStart" />
        </label>
        <label className="field">
          <span>Service period end</span>
          <input type="date" name="servicePeriodEnd" />
        </label>
        <label className="field">
          <span>Exchange rate</span>
          <input
            name="exchangeRate"
            inputMode="decimal"
            placeholder={currency === data.defaultCurrency ? "Not required" : "Example: 1.08750000"}
          />
          <small>
            Record the rate used when the invoice currency differs from the organization currency.
          </small>
        </label>
        <LineItemsEditor items={data.catalogItems} currency={currency} />
        <label className="field finance-form__full">
          <span>Notes</span>
          <textarea name="notes" rows={2} maxLength={4000} />
        </label>
        <label className="field finance-form__full">
          <span>Terms</span>
          <textarea name="terms" rows={2} maxLength={4000} />
        </label>
        <label className="field finance-form__full">
          <span>Bank and payment details</span>
          <textarea name="bankDetails" rows={2} maxLength={2000} />
        </label>
        <label className="field finance-form__full">
          <span>Internal notes</span>
          <textarea name="internalNotes" rows={2} maxLength={4000} />
        </label>
        <div className="finance-security-note finance-form__full">
          <ShieldCheck size={17} aria-hidden="true" />
          <p>
            Issuing allocates the final invoice number and freezes client, seller, tax, line, and
            total snapshots.
          </p>
        </div>
        <div className="finance-form__actions finance-form__full">
          <Button type="submit" disabled={pending}>
            {pending ? "Creating" : "Create invoice draft"}
          </Button>
        </div>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function IssueInvoiceForm({ invoice }: { invoice: FinanceInvoice }) {
  const [state, action, pending] = useActionState(issueInvoiceAction, initialState);
  const issueDate = invoice.issueDate ?? today();
  return (
    <form action={action} className="finance-inline-form">
      <input type="hidden" name="invoiceId" value={invoice.id} />
      <label className="field">
        <span>Issue date</span>
        <input type="date" name="issueDate" defaultValue={issueDate} required />
      </label>
      <label className="field">
        <span>Due date</span>
        <input
          type="date"
          name="dueDate"
          defaultValue={invoice.dueDate ?? plusDays(issueDate, 30)}
          required
        />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        <BadgeCheck size={15} aria-hidden="true" /> {pending ? "Issuing" : "Issue invoice"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

function VoidInvoiceForm({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState(voidInvoiceAction, initialState);
  return (
    <details className="finance-danger-disclosure">
      <summary>Void invoice</summary>
      <form action={action} className="finance-inline-form">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <label className="field">
          <span>Reason</span>
          <input name="reason" minLength={5} maxLength={1000} required />
        </label>
        <Button type="submit" variant="danger" size="sm" disabled={pending}>
          Void invoice
        </Button>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function InvoiceStatusControls({ invoice }: { invoice: FinanceInvoice }) {
  const [state, action, pending] = useActionState(updateInvoiceStatusAction, initialState);
  if (!invoice.issuedAt || ["void", "credited"].includes(invoice.status)) return null;
  return (
    <div className="finance-status-evidence">
      {!invoice.disputedAt ? (
        <form action={action} className="finance-inline-actions">
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <input type="hidden" name="action" value="viewed" />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={pending || invoice.status === "viewed"}
          >
            <Eye size={15} aria-hidden="true" /> Mark viewed
          </Button>
        </form>
      ) : null}
      {invoice.status !== "disputed" ? (
        <details className="finance-inline-disclosure">
          <summary>Record dispute</summary>
          <form action={action} className="finance-inline-form finance-inline-form--stacked">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <input type="hidden" name="action" value="disputed" />
            <label className="field finance-form__wide">
              <span>Dispute evidence</span>
              <textarea name="reason" rows={2} minLength={5} maxLength={2000} required />
            </label>
            <Button type="submit" size="sm" variant="secondary" disabled={pending}>
              Record dispute
            </Button>
          </form>
        </details>
      ) : (
        <details className="finance-inline-disclosure">
          <summary>Resolve dispute</summary>
          <form action={action} className="finance-inline-form finance-inline-form--stacked">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <input type="hidden" name="action" value="resolve_dispute" />
            <label className="field finance-form__wide">
              <span>Resolution evidence</span>
              <textarea name="reason" rows={2} minLength={5} maxLength={2000} required />
            </label>
            <Button type="submit" size="sm" disabled={pending}>
              Resolve dispute
            </Button>
          </form>
        </details>
      )}
      <ActionMessage state={state} />
    </div>
  );
}

function InvoiceAttachmentControls({
  invoice,
  canManage,
}: {
  invoice: FinanceInvoice;
  canManage: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<FinanceActionState>(initialState);
  const [pending, setPending] = useState(false);

  async function uploadAttachment() {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setMessage({ status: "error", message: "Choose a file to upload." });
      return;
    }
    setPending(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(`/api/finance/invoices/${invoice.id}/attachments`, {
        method: "POST",
        body,
      });
      const result = (await response.json()) as { message?: string };
      setMessage({
        status: response.ok ? "success" : "error",
        message: result.message ?? (response.ok ? "Attachment uploaded." : "Upload failed."),
      });
      if (response.ok) {
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    } catch {
      setMessage({ status: "error", message: "The attachment could not be uploaded." });
    } finally {
      setPending(false);
    }
  }

  async function removeAttachment(attachmentId: string) {
    setPending(true);
    try {
      const response = await fetch(`/api/finance/attachments/${attachmentId}`, {
        method: "DELETE",
      });
      const result = (await response.json()) as { message?: string };
      setMessage({
        status: response.ok ? "success" : "error",
        message: result.message ?? (response.ok ? "Attachment removed." : "Removal failed."),
      });
      if (response.ok) router.refresh();
    } catch {
      setMessage({ status: "error", message: "The attachment could not be removed." });
    } finally {
      setPending(false);
    }
  }

  if (!canManage && invoice.attachments.length === 0) return null;
  return (
    <details className="finance-history-disclosure">
      <summary>
        <Paperclip size={15} aria-hidden="true" /> Attachments ({invoice.attachments.length})
      </summary>
      <div className="finance-attachment-panel">
        {canManage && !invoice.issuedAt ? (
          <div className="finance-attachment-upload">
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.txt,.csv"
              aria-label="Invoice attachment file"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={uploadAttachment}
            >
              <Paperclip size={15} aria-hidden="true" />{" "}
              {pending ? "Uploading" : "Upload attachment"}
            </Button>
          </div>
        ) : null}
        {invoice.attachments.length ? (
          <ul className="finance-attachment-list">
            {invoice.attachments.map((attachment) => (
              <li key={attachment.id}>
                <div>
                  <strong>{attachment.fileName}</strong>
                  <span>
                    {formatFileSize(attachment.sizeBytes)} · {financeStatusLabel(attachment.status)}
                  </span>
                </div>
                <div className="finance-inline-actions">
                  {attachment.downloadHref ? (
                    <a
                      className="button button--secondary button--sm"
                      href={attachment.downloadHref}
                    >
                      <Download size={15} aria-hidden="true" /> Download
                    </a>
                  ) : null}
                  {canManage && !invoice.issuedAt ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={pending}
                      onClick={() => removeAttachment(attachment.id)}
                    >
                      <Trash2 size={15} aria-hidden="true" /> Remove
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="finance-muted-copy">No attachments have been added.</p>
        )}
        <ActionMessage state={message} />
      </div>
    </details>
  );
}

function RevisedInvoiceForm({ invoice }: { invoice: FinanceInvoice }) {
  const [state, action, pending] = useActionState(createRevisedInvoiceAction, initialState);
  const issueDate = today();
  return (
    <details className="finance-inline-disclosure">
      <summary>Create revised invoice</summary>
      <form action={action} className="finance-inline-form">
        <input type="hidden" name="invoiceId" value={invoice.id} />
        <label className="field finance-form__wide">
          <span>Correction reason</span>
          <input name="reason" minLength={5} maxLength={1000} required />
        </label>
        <label className="field">
          <span>Issue date</span>
          <input type="date" name="issueDate" defaultValue={issueDate} required />
        </label>
        <label className="field">
          <span>Due date</span>
          <input type="date" name="dueDate" defaultValue={plusDays(issueDate, 30)} required />
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Creating" : "Create revision"}
        </Button>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function CreditNoteCreateForm({
  invoice,
  data,
}: {
  invoice: FinanceInvoice;
  data: FinanceWorkspaceData;
}) {
  const [state, action, pending] = useActionState(createCreditNoteAction, initialState);
  return (
    <details className="finance-inline-disclosure">
      <summary>Create credit note</summary>
      <form action={action} className="finance-form">
        <input type="hidden" name="originalInvoiceId" value={invoice.id} />
        <label className="field finance-form__full">
          <span>Credit reason</span>
          <textarea name="reason" rows={2} minLength={5} maxLength={2000} required />
        </label>
        <label className="field finance-form__full">
          <span>Internal notes</span>
          <textarea name="internalNotes" rows={2} maxLength={4000} />
        </label>
        <div className="finance-form__full">
          <LineItemsEditor
            items={data.catalogItems}
            currency={invoice.currency}
            initialLines={invoice.lines}
          />
        </div>
        <div className="finance-form__actions finance-form__full">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Creating" : "Create credit note"}
          </Button>
        </div>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function IssueCreditNoteForm({ creditNote }: { creditNote: FinanceCreditNote }) {
  const [state, action, pending] = useActionState(issueCreditNoteAction, initialState);
  return (
    <form action={action} className="finance-inline-form">
      <input type="hidden" name="creditNoteId" value={creditNote.id} />
      <label className="field">
        <span>Issue date</span>
        <input
          type="date"
          name="issueDate"
          defaultValue={creditNote.issueDate ?? today()}
          required
        />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        <BadgeCheck size={15} aria-hidden="true" /> {pending ? "Issuing" : "Issue credit note"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

function VoidCreditNoteForm({ creditNoteId }: { creditNoteId: string }) {
  const [state, action, pending] = useActionState(voidCreditNoteAction, initialState);
  return (
    <details className="finance-danger-disclosure">
      <summary>Void credit note</summary>
      <form action={action} className="finance-inline-form">
        <input type="hidden" name="creditNoteId" value={creditNoteId} />
        <label className="field">
          <span>Reason</span>
          <input name="reason" minLength={5} maxLength={1000} required />
        </label>
        <Button type="submit" variant="danger" size="sm" disabled={pending}>
          Void credit note
        </Button>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function InvoiceFinancialHistory({ invoice, locale }: { invoice: FinanceInvoice; locale: string }) {
  const taxSummary = summarizeFinanceTaxes(invoice.lines);
  if (
    taxSummary.length === 0 &&
    invoice.paymentHistory.length === 0 &&
    invoice.revisions.length === 0 &&
    invoice.creditNotes.length === 0
  )
    return null;
  return (
    <div className="finance-financial-history">
      {taxSummary.length > 0 ? (
        <div className="finance-tax-summary">
          <h4>Tax summary</h4>
          <dl>
            {taxSummary.map((tax) => (
              <div key={tax.taxBps}>
                <dt>{percentFromBps(tax.taxBps)}% tax</dt>
                <dd>
                  {formatMinorMoney(tax.taxMinor, invoice.currency, locale)} on{" "}
                  {formatMinorMoney(tax.taxableMinor, invoice.currency, locale)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {invoice.revisions.length > 0 || invoice.creditNotes.length > 0 ? (
        <details className="finance-history-disclosure">
          <summary>
            <History size={15} aria-hidden="true" /> Corrections (
            {invoice.revisions.length + invoice.creditNotes.length})
          </summary>
          <ol className="finance-history-list">
            {invoice.revisions.map((revision) => (
              <li key={revision.id}>
                <strong>{revision.displayNumber}</strong>
                <span>{revision.correctionReason ?? "Revised invoice"}</span>
                <StatusBadge tone={toneForStatus(revision.status)}>
                  {financeStatusLabel(revision.status)}
                </StatusBadge>
              </li>
            ))}
            {invoice.creditNotes.map((creditNote) => (
              <li key={creditNote.id}>
                <strong>{creditNote.displayNumber}</strong>
                <span>{formatMinorMoney(creditNote.totalMinor, invoice.currency, locale)}</span>
                <StatusBadge tone={toneForStatus(creditNote.status)}>
                  {financeStatusLabel(creditNote.status)}
                </StatusBadge>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {invoice.paymentHistory.length > 0 ? (
        <details className="finance-history-disclosure">
          <summary>
            <History size={15} aria-hidden="true" /> Payment history (
            {invoice.paymentHistory.length})
          </summary>
          <ol className="finance-history-list">
            {invoice.paymentHistory.map((payment) => (
              <li key={payment.allocationId}>
                <strong>{formatMinorMoney(payment.amountMinor, payment.currency, locale)}</strong>
                <span>
                  {payment.paymentDate} · {financeStatusLabel(payment.paymentMethod)}
                  {payment.transactionReference ? ` · ${payment.transactionReference}` : ""}
                </span>
                <StatusBadge tone={toneForStatus(payment.reconciliationStatus)}>
                  {financeStatusLabel(payment.reconciliationStatus)}
                </StatusBadge>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

function InvoicesSection({ data }: { data: FinanceWorkspaceData }) {
  return (
    <section className="finance-section" aria-labelledby="invoices-title">
      <div className="finance-section__heading">
        <div>
          <h2 id="invoices-title">Invoices</h2>
          <p>
            Issued invoices keep the original client, seller, tax, payment, and PDF snapshots while
            payment allocations remain visible as history.
          </p>
        </div>
        {data.capabilities.canCreateInvoices ? <InvoiceCreateForm data={data} /> : null}
      </div>
      {data.invoices.length === 0 ? (
        <div className="finance-empty">
          <ReceiptText size={24} aria-hidden="true" />
          <h3>No invoices found</h3>
          <p>Create a draft, complete approval, then issue it with final dates.</p>
        </div>
      ) : (
        <div className="finance-record-list">
          {data.invoices.map((invoice) => {
            const contact = data.contacts.find((candidate) => candidate.id === invoice.contactId);
            return (
              <article className="finance-record" key={invoice.id}>
                <div className="finance-record__primary">
                  <div>
                    <strong>{invoice.displayNumber}</strong>
                    <span>
                      {invoice.companyName}
                      {invoice.projectName ? ` · ${invoice.projectName}` : ""}
                    </span>
                  </div>
                  <StatusBadge tone={toneForStatus(invoice.status)}>
                    {financeStatusLabel(invoice.status)}
                  </StatusBadge>
                </div>
                <dl className="finance-record__facts finance-record__facts--six">
                  <div>
                    <dt>Issue</dt>
                    <dd>{invoice.issueDate ?? "Draft"}</dd>
                  </div>
                  <div>
                    <dt>Due</dt>
                    <dd>{invoice.dueDate ?? "Not set"}</dd>
                  </div>
                  <div>
                    <dt>Subtotal</dt>
                    <dd>
                      {formatMinorMoney(invoice.subtotalMinor, invoice.currency, data.locale)}
                    </dd>
                  </div>
                  <div>
                    <dt>Tax</dt>
                    <dd>{formatMinorMoney(invoice.taxMinor, invoice.currency, data.locale)}</dd>
                  </div>
                  <div>
                    <dt>Paid</dt>
                    <dd>
                      {formatMinorMoney(invoice.amountPaidMinor, invoice.currency, data.locale)}
                    </dd>
                  </div>
                  <div>
                    <dt>Credited</dt>
                    <dd>
                      {formatMinorMoney(invoice.creditedMinor, invoice.currency, data.locale)}
                    </dd>
                  </div>
                  <div>
                    <dt>Balance</dt>
                    <dd>{formatMinorMoney(invoice.balanceMinor, invoice.currency, data.locale)}</dd>
                  </div>
                  {invoice.creditDueMinor > 0 ? (
                    <div>
                      <dt>Credit due</dt>
                      <dd>
                        {formatMinorMoney(invoice.creditDueMinor, invoice.currency, data.locale)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {invoice.correctionOfInvoiceId ? (
                  <p className="finance-evidence-note">
                    <strong>
                      Correction of {invoice.correctionOfInvoiceNumber ?? "original invoice"}:
                    </strong>{" "}
                    {invoice.correctionReason ?? "Reason not recorded"}
                  </p>
                ) : null}
                <div className="finance-record__actions">
                  <ApprovalControls
                    entityId={invoice.id}
                    entityType="invoice"
                    status={invoice.status}
                    canUpdate={data.capabilities.canUpdateInvoices}
                  />
                  {data.capabilities.canIssueInvoices &&
                  invoice.status === "approved" &&
                  invoice.approvalStatus === "approved" ? (
                    <IssueInvoiceForm invoice={invoice} />
                  ) : null}
                  {data.capabilities.canCorrectInvoices &&
                  invoice.issuedAt &&
                  !["void", "credited"].includes(invoice.status) ? (
                    <RevisedInvoiceForm invoice={invoice} />
                  ) : null}
                  {data.capabilities.canCreateCreditNotes &&
                  invoice.issuedAt &&
                  invoice.totalMinor > invoice.creditedMinor &&
                  !["void", "credited"].includes(invoice.status) ? (
                    <CreditNoteCreateForm invoice={invoice} data={data} />
                  ) : null}
                  {data.capabilities.canManageInvoiceStatus ? (
                    <InvoiceStatusControls invoice={invoice} />
                  ) : null}
                  {data.capabilities.canVoidInvoices &&
                  invoice.issuedAt &&
                  invoice.amountPaidMinor === 0 &&
                  invoice.creditedMinor === 0 &&
                  !["void", "credited", "paid"].includes(invoice.status) ? (
                    <VoidInvoiceForm invoiceId={invoice.id} />
                  ) : null}
                </div>
                {invoice.disputeReason ? (
                  <p className="finance-evidence-note">
                    <strong>
                      {invoice.status === "disputed" ? "Active dispute" : "Resolved dispute"}:
                    </strong>{" "}
                    {invoice.disputeReason}
                    {invoice.disputeResolutionNote
                      ? ` Resolution: ${invoice.disputeResolutionNote}`
                      : ""}
                  </p>
                ) : null}
                {invoice.exchangeRate ? (
                  <p className="finance-evidence-note">
                    <strong>Exchange rate snapshot:</strong> {invoice.exchangeRate}
                  </p>
                ) : null}
                <InvoiceAttachmentControls
                  invoice={invoice}
                  canManage={data.capabilities.canManageInvoiceAttachments}
                />
                {invoice.issuedAt ? (
                  <DocumentControls
                    entityType="invoice"
                    entityId={invoice.id}
                    documentNumber={invoice.displayNumber}
                    snapshots={invoice.snapshots}
                    deliveries={invoice.deliveries}
                    recipientEmail={contact?.email ?? null}
                    requestToken={invoice.deliveryRequestToken}
                    canGenerate={data.capabilities.canDownloadDocuments}
                    canSend={
                      data.capabilities.canSendDocuments &&
                      !["void", "credited"].includes(invoice.status)
                    }
                  />
                ) : null}
                <InvoiceFinancialHistory invoice={invoice} locale={data.locale} />
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CreditNotesSection({ data }: { data: FinanceWorkspaceData }) {
  return (
    <section className="finance-section" aria-labelledby="credit-notes-title">
      <div className="finance-section__heading">
        <div>
          <h2 id="credit-notes-title">Credit notes</h2>
          <p>
            Every credit note references its original invoice, preserves an immutable issued
            snapshot, and recalculates the invoice balance when issued or voided.
          </p>
        </div>
      </div>
      {data.creditNotes.length === 0 ? (
        <div className="finance-empty">
          <ReceiptText size={24} aria-hidden="true" />
          <h3>No credit notes found</h3>
          <p>Create a credit note from an issued invoice that needs a correction.</p>
        </div>
      ) : (
        <div className="finance-record-list">
          {data.creditNotes.map((creditNote) => {
            const invoice = data.invoices.find(
              (candidate) => candidate.id === creditNote.originalInvoiceId,
            );
            const contact = invoice
              ? data.contacts.find((candidate) => candidate.id === invoice.contactId)
              : null;
            return (
              <article className="finance-record" key={creditNote.id}>
                <div className="finance-record__primary">
                  <div>
                    <strong>{creditNote.displayNumber}</strong>
                    <span>
                      {creditNote.companyName} · Original invoice {creditNote.originalInvoiceNumber}
                      {creditNote.projectName ? ` · ${creditNote.projectName}` : ""}
                    </span>
                  </div>
                  <StatusBadge tone={toneForStatus(creditNote.status)}>
                    {financeStatusLabel(creditNote.status)}
                  </StatusBadge>
                </div>
                <dl className="finance-record__facts">
                  <div>
                    <dt>Issue</dt>
                    <dd>{creditNote.issueDate ?? "Draft"}</dd>
                  </div>
                  <div>
                    <dt>Subtotal</dt>
                    <dd>
                      {formatMinorMoney(creditNote.subtotalMinor, creditNote.currency, data.locale)}
                    </dd>
                  </div>
                  <div>
                    <dt>Tax</dt>
                    <dd>
                      {formatMinorMoney(creditNote.taxMinor, creditNote.currency, data.locale)}
                    </dd>
                  </div>
                  <div>
                    <dt>Total credit</dt>
                    <dd>
                      {formatMinorMoney(creditNote.totalMinor, creditNote.currency, data.locale)}
                    </dd>
                  </div>
                </dl>
                <p className="finance-evidence-note">
                  <strong>Reason:</strong> {creditNote.reason}
                </p>
                <div className="finance-record__actions">
                  <ApprovalControls
                    entityId={creditNote.id}
                    entityType="credit_note"
                    status={creditNote.status}
                    canUpdate={data.capabilities.canCreateCreditNotes}
                  />
                  {data.capabilities.canIssueCreditNotes &&
                  creditNote.status === "approved" &&
                  creditNote.approvalStatus === "approved" ? (
                    <IssueCreditNoteForm creditNote={creditNote} />
                  ) : null}
                  {data.capabilities.canVoidCreditNotes &&
                  ["issued", "sent"].includes(creditNote.status) ? (
                    <VoidCreditNoteForm creditNoteId={creditNote.id} />
                  ) : null}
                </div>
                {creditNote.issuedAt ? (
                  <DocumentControls
                    entityType="credit_note"
                    entityId={creditNote.id}
                    documentNumber={creditNote.displayNumber}
                    snapshots={creditNote.snapshots}
                    deliveries={creditNote.deliveries}
                    recipientEmail={contact?.email ?? null}
                    requestToken={creditNote.deliveryRequestToken}
                    canGenerate={data.capabilities.canDownloadDocuments}
                    canSend={data.capabilities.canSendDocuments && creditNote.status !== "void"}
                  />
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PaymentCreateForm({ data }: { data: FinanceWorkspaceData }) {
  const openInvoices = data.invoices.filter(
    (invoice) =>
      invoice.issuedAt &&
      invoice.balanceMinor > 0 &&
      !["void", "credited"].includes(invoice.status),
  );
  const [invoiceId, setInvoiceId] = useState(openInvoices[0]?.id ?? "");
  const selectedInvoice = openInvoices.find((invoice) => invoice.id === invoiceId);
  const [amount, setAmount] = useState(
    selectedInvoice ? minorToInput(selectedInvoice.balanceMinor, selectedInvoice.currency) : "0.00",
  );
  const [state, action, pending] = useActionState(createPaymentAction, initialState);
  const allocationJson = JSON.stringify(invoiceId ? [{ invoiceId, amount }] : []);
  return (
    <details className="finance-create-panel">
      <summary>
        <Plus size={16} aria-hidden="true" /> Record payment
      </summary>
      <form action={action} className="finance-form">
        <label className="field finance-form__wide">
          <span>Invoice</span>
          <select
            value={invoiceId}
            onChange={(event) => {
              const next = openInvoices.find((invoice) => invoice.id === event.target.value);
              setInvoiceId(event.target.value);
              if (next) setAmount(minorToInput(next.balanceMinor, next.currency));
            }}
            required
          >
            <option value="">Choose an invoice</option>
            {openInvoices.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.displayNumber} · {invoice.companyName} ·{" "}
                {formatMinorMoney(invoice.balanceMinor, invoice.currency, data.locale)}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="companyId" value={selectedInvoice?.companyId ?? ""} />
        <input
          type="hidden"
          name="currency"
          value={selectedInvoice?.currency ?? data.defaultCurrency}
        />
        <input type="hidden" name="allocations" value={allocationJson} />
        <label className="field">
          <span>Payment date</span>
          <input type="date" name="paymentDate" defaultValue={today()} required />
        </label>
        <label className="field">
          <span>Amount</span>
          <input
            name="amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Method</span>
          <select name="paymentMethod" defaultValue="bank_transfer">
            {paymentMethods.map((method) => (
              <option key={method} value={method}>
                {financeStatusLabel(method)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Transaction reference</span>
          <input name="transactionReference" maxLength={160} />
        </label>
        <label className="field">
          <span>Bank account</span>
          <input name="bankAccount" maxLength={160} />
        </label>
        <label className="field finance-form__full">
          <span>Notes</span>
          <textarea name="notes" rows={2} maxLength={2000} />
        </label>
        <div className="finance-form__actions finance-form__full">
          <Button type="submit" disabled={pending || !selectedInvoice}>
            {pending ? "Recording" : "Record payment"}
          </Button>
        </div>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function PaymentReconcileForm({ paymentId, current }: { paymentId: string; current: string }) {
  const [state, action, pending] = useActionState(reconcilePaymentAction, initialState);
  return (
    <form action={action} className="finance-inline-actions">
      <input type="hidden" name="paymentId" value={paymentId} />
      <label className="field">
        <span className="sr-only">Reconciliation status</span>
        <select name="reconciliationStatus" defaultValue={current}>
          <option value="unreconciled">Unreconciled</option>
          <option value="matched">Matched</option>
          <option value="reconciled">Reconciled</option>
          <option value="exception">Exception</option>
        </select>
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        Save state
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

function PaymentRefundForm({ payment }: { payment: FinancePayment }) {
  const [state, action, pending] = useActionState(recordPaymentRefundAction, initialState);
  const remaining = payment.amountMinor - payment.refundedMinor;
  if (remaining <= 0) return null;
  return (
    <details className="finance-inline-disclosure">
      <summary>Record refund</summary>
      <form action={action} className="finance-inline-form finance-inline-form--stacked">
        <input type="hidden" name="paymentId" value={payment.id} />
        <label className="field">
          <span>Refund date</span>
          <input type="date" name="refundDate" defaultValue={today()} required />
        </label>
        <label className="field">
          <span>Amount</span>
          <input
            name="amount"
            inputMode="decimal"
            defaultValue={minorToInput(remaining, payment.currency)}
            required
          />
        </label>
        <label className="field">
          <span>Method</span>
          <select name="refundMethod" defaultValue={payment.paymentMethod}>
            {paymentMethods.map((method) => (
              <option key={method} value={method}>
                {financeStatusLabel(method)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Reference</span>
          <input name="transactionReference" maxLength={160} />
        </label>
        <label className="field finance-form__wide">
          <span>Reason</span>
          <textarea name="reason" rows={2} minLength={5} maxLength={2000} required />
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          <Undo2 size={15} aria-hidden="true" /> {pending ? "Recording" : "Record refund"}
        </Button>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function PaymentReceiptControls({
  payment,
  data,
}: {
  payment: FinancePayment;
  data: FinanceWorkspaceData;
}) {
  return (
    <DocumentControls
      entityType="payment_receipt"
      entityId={payment.id}
      documentNumber={payment.transactionReference ?? `PAY-${payment.id.slice(0, 8).toUpperCase()}`}
      snapshots={payment.snapshots}
      deliveries={[]}
      recipientEmail={null}
      requestToken={payment.receiptRequestToken}
      canGenerate={data.capabilities.canDownloadDocuments}
      canSend={false}
    />
  );
}

function PaymentsSection({ data }: { data: FinanceWorkspaceData }) {
  return (
    <section className="finance-section" aria-labelledby="payments-title">
      <div className="finance-section__heading">
        <div>
          <h2 id="payments-title">Payments</h2>
          <p>
            Receipts, allocations, reconciliation, and immutable refund evidence stay attached to
            each payment.
          </p>
        </div>
        {data.capabilities.canCreatePayments ? <PaymentCreateForm data={data} /> : null}
      </div>
      {data.payments.length === 0 ? (
        <div className="finance-empty">
          <Banknote size={24} aria-hidden="true" />
          <h3>No payments found</h3>
          <p>Record a client payment after an invoice has been issued.</p>
        </div>
      ) : (
        <div className="finance-record-list">
          {data.payments.map((payment) => (
            <article className="finance-record" key={payment.id}>
              <div className="finance-record__primary">
                <div>
                  <strong>
                    {payment.transactionReference ?? `PAY-${payment.id.slice(0, 8).toUpperCase()}`}
                  </strong>
                  <span>
                    {payment.companyName} · {payment.paymentDate}
                  </span>
                </div>
                <StatusBadge
                  tone={toneForStatus(
                    payment.refundState === "none"
                      ? payment.reconciliationStatus
                      : payment.refundState,
                  )}
                >
                  {payment.refundState === "none"
                    ? financeStatusLabel(payment.reconciliationStatus)
                    : `${financeStatusLabel(payment.refundState)} refund`}
                </StatusBadge>
              </div>
              <dl className="finance-record__facts">
                <div>
                  <dt>Amount</dt>
                  <dd>{formatMinorMoney(payment.amountMinor, payment.currency, data.locale)}</dd>
                </div>
                <div>
                  <dt>Allocated</dt>
                  <dd>{formatMinorMoney(payment.allocatedMinor, payment.currency, data.locale)}</dd>
                </div>
                <div>
                  <dt>Refunded</dt>
                  <dd>{formatMinorMoney(payment.refundedMinor, payment.currency, data.locale)}</dd>
                </div>
                <div>
                  <dt>Method</dt>
                  <dd>{financeStatusLabel(payment.paymentMethod)}</dd>
                </div>
              </dl>
              <p className="finance-evidence-note">
                <strong>Allocated invoices:</strong>{" "}
                {payment.allocations
                  .map(
                    (allocation) =>
                      `${allocation.invoiceNumber} (${formatMinorMoney(allocation.amountMinor, payment.currency, data.locale)})`,
                  )
                  .join(", ")}
              </p>
              <div className="finance-record__actions">
                {data.capabilities.canReconcilePayments ? (
                  <PaymentReconcileForm
                    paymentId={payment.id}
                    current={payment.reconciliationStatus}
                  />
                ) : null}
                {data.capabilities.canRefundPayments ? (
                  <PaymentRefundForm payment={payment} />
                ) : null}
              </div>
              {payment.refunds.length ? (
                <details className="finance-history-disclosure">
                  <summary>
                    <History size={15} aria-hidden="true" /> Refund history (
                    {payment.refunds.length})
                  </summary>
                  <ol className="finance-history-list">
                    {payment.refunds.map((refund) => (
                      <li key={refund.id}>
                        <strong>
                          {formatMinorMoney(refund.amountMinor, payment.currency, data.locale)}
                        </strong>
                        <span>
                          {refund.refundDate} · {financeStatusLabel(refund.refundMethod)} ·{" "}
                          {refund.reason}
                        </span>
                        <span>{refund.transactionReference ?? "No reference"}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
              <PaymentReceiptControls payment={payment} data={data} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function FinanceWorkspace({ data }: { data: FinanceWorkspaceData }) {
  const section = useMemo(() => {
    if (data.filters.tab === "catalog") return <CatalogSection data={data} />;
    if (data.filters.tab === "estimates") return <EstimatesSection data={data} />;
    if (data.filters.tab === "credit_notes") return <CreditNotesSection data={data} />;
    if (data.filters.tab === "payments") return <PaymentsSection data={data} />;
    if (data.filters.tab === "expenses") return <ExpensesSection data={data} />;
    if (data.filters.tab === "reports") return <FinanceReportsSection data={data} />;
    return <InvoicesSection data={data} />;
  }, [data]);

  return (
    <div className="finance-workspace">
      <Summary data={data} />
      <FinanceNavigation data={data} />
      <FinanceFilters data={data} />
      {section}
    </div>
  );
}
