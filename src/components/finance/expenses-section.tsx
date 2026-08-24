"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useMemo, useRef, useState } from "react";
import {
  BadgeDollarSign,
  Download,
  History,
  Paperclip,
  Plus,
  ReceiptText,
  Send,
  Tags,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { getDateTimeFormatter } from "@/lib/intl-formatters";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  createExpenseAction,
  createExpenseCategoryAction,
  decideExpenseApprovalAction,
  setExpenseCategoryStatusAction,
  updateExpensePaymentStateAction,
} from "@/modules/finance/actions/expenses";
import { currencyMinorUnits, formatMinorMoney } from "@/modules/finance/calculations";
import {
  expensePaymentStatuses,
  expenseTypes,
  financeStatusLabel,
} from "@/modules/finance/finance";
import type { FinanceActionState } from "@/modules/finance/schemas/finance";
import type { FinanceExpense, FinanceWorkspaceData } from "@/modules/finance/server/finance";

const initialState: FinanceActionState = { status: "idle" };

type EditableAllocation = { key: string; projectId: string; amount: string };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function suggestedTaxInput(amount: string, currency: string, taxBps: number): string {
  const places = currencyMinorUnits(currency);
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount < 0) return (0).toFixed(places);
  return ((numericAmount * taxBps) / 10_000).toFixed(places);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toneForStatus(status: string): "success" | "warning" | "error" | "info" | "neutral" {
  if (["approved", "paid", "reimbursed"].includes(status)) return "success";
  if (["pending", "scheduled"].includes(status)) return "info";
  if (["unpaid", "not_required"].includes(status)) return "warning";
  if (["rejected"].includes(status)) return "error";
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

function CategoryManager({ data }: { data: FinanceWorkspaceData }) {
  const [createState, createAction, creating] = useActionState(
    createExpenseCategoryAction,
    initialState,
  );
  return (
    <details className="finance-create-panel">
      <summary>
        <Tags size={16} aria-hidden="true" /> Manage categories
      </summary>
      <div className="finance-category-manager">
        <form action={createAction} className="finance-form finance-form--catalog">
          <label className="field">
            <span>Name</span>
            <input name="name" maxLength={120} required />
          </label>
          <label className="field">
            <span>Code</span>
            <input name="code" maxLength={40} />
          </label>
          <label className="field">
            <span>Default tax %</span>
            <input name="defaultTaxPercent" inputMode="decimal" defaultValue="0" required />
          </label>
          <label className="check-row">
            <input type="checkbox" name="isActive" defaultChecked /> Active
          </label>
          <label className="field finance-form__wide">
            <span>Description</span>
            <input name="description" maxLength={1000} />
          </label>
          <div className="finance-form__actions">
            <Button type="submit" size="sm" disabled={creating}>
              <Plus size={15} aria-hidden="true" /> {creating ? "Creating" : "Create category"}
            </Button>
          </div>
          <ActionMessage state={createState} />
        </form>
        {data.expenseCategories.length ? (
          <div className="finance-category-list">
            {data.expenseCategories.map((category) => (
              <CategoryStatusControl key={category.id} category={category} />
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function CategoryStatusControl({
  category,
}: {
  category: FinanceWorkspaceData["expenseCategories"][number];
}) {
  const [state, action, pending] = useActionState(setExpenseCategoryStatusAction, initialState);
  return (
    <form action={action} className="finance-category-row">
      <input type="hidden" name="categoryId" value={category.id} />
      <input type="hidden" name="isActive" value={category.isActive ? "false" : "true"} />
      <span>
        <strong>{category.name}</strong>
        <small>
          {category.code ?? "No code"} · {(category.defaultTaxBps / 100).toFixed(2)}% tax
        </small>
      </span>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {category.isActive ? "Deactivate" : "Activate"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

function ExpenseCreateForm({ data }: { data: FinanceWorkspaceData }) {
  const [state, action, pending] = useActionState(createExpenseAction, initialState);
  const searchParams = useSearchParams();
  const [expenseType, setExpenseType] = useState<(typeof expenseTypes)[number]>("employee");
  const [currency, setCurrency] = useState(data.defaultCurrency);
  const [amount, setAmount] = useState("0.00");
  const [tax, setTax] = useState("0.00");
  const taxRateBpsRef = useRef(0);
  const [allocations, setAllocations] = useState<EditableAllocation[]>([]);
  const activeCategories = data.expenseCategories.filter((category) => category.isActive);
  const allocationJson = JSON.stringify(
    allocations
      .filter((allocation) => allocation.projectId && allocation.amount)
      .map(({ projectId, amount: allocationAmount }) => ({
        projectId,
        amount: allocationAmount,
      })),
  );

  function addAllocation() {
    setAllocations((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        projectId: data.projects[0]?.id ?? "",
        amount: expenseType === "project" ? String(Number(amount) + Number(tax)) : "0.00",
      },
    ]);
  }

  return (
    <details className="finance-create-panel" open={searchParams.get("create") === "expense"}>
      <summary>
        <Plus size={16} aria-hidden="true" /> Record expense
      </summary>
      <form action={action} className="finance-form finance-form--document">
        <label className="field">
          <span>Expense type</span>
          <select
            name="expenseType"
            value={expenseType}
            onChange={(event) => {
              const next = event.target.value as (typeof expenseTypes)[number];
              setExpenseType(next);
              if (next === "project" && allocations.length === 0) {
                setAllocations([
                  {
                    key: crypto.randomUUID(),
                    projectId: data.projects[0]?.id ?? "",
                    amount: String(Number(amount) + Number(tax)),
                  },
                ]);
              }
            }}
          >
            {expenseTypes.map((type) => (
              <option key={type} value={type}>
                {financeStatusLabel(type)} expense
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Category</span>
          <select
            name="categoryId"
            required
            onChange={(event) => {
              const category = activeCategories.find((item) => item.id === event.target.value);
              if (category) {
                taxRateBpsRef.current = category.defaultTaxBps;
                setTax(suggestedTaxInput(amount, currency, category.defaultTaxBps));
              }
            }}
          >
            <option value="">Choose a category</option>
            {activeCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Date</span>
          <input type="date" name="expenseDate" defaultValue={today()} required />
        </label>
        <label className="field">
          <span>Currency</span>
          <input
            name="currency"
            value={currency}
            onChange={(event) => {
              const nextCurrency = event.target.value.toUpperCase();
              setCurrency(nextCurrency);
              setTax(suggestedTaxInput(amount, nextCurrency, taxRateBpsRef.current));
            }}
            maxLength={3}
            required
          />
        </label>
        {expenseType === "employee" ? (
          <label className="field finance-form__wide">
            <span>Employee</span>
            <select name="employeeMembershipId" required>
              <option value="">Choose an employee</option>
              {data.expenseMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName} · {member.email}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {expenseType === "vendor" ? (
          <>
            <label className="field finance-form__wide">
              <span>Vendor</span>
              <input name="vendorName" maxLength={180} required />
            </label>
            <label className="field finance-form__wide">
              <span>Vendor reference</span>
              <input name="vendorReference" maxLength={160} />
            </label>
          </>
        ) : null}
        <label className="field">
          <span>Amount before tax</span>
          <input
            name="amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              const nextAmount = event.target.value;
              setAmount(nextAmount);
              setTax(suggestedTaxInput(nextAmount, currency, taxRateBpsRef.current));
            }}
            required
          />
        </label>
        <label className="field">
          <span>Tax amount</span>
          <input
            name="tax"
            inputMode="decimal"
            value={tax}
            onChange={(event) => setTax(event.target.value)}
            required
          />
        </label>
        <label className="check-row">
          <input type="checkbox" name="isBillable" /> Billable to client
        </label>
        <label className="check-row">
          <input type="checkbox" name="isReimbursable" /> Reimbursable
        </label>
        <input type="hidden" name="allocations" value={allocationJson} />
        <fieldset className="finance-lines finance-expense-allocations">
          <legend>Project allocation</legend>
          <div className="finance-expense-allocation-list">
            {allocations.map((allocation) => (
              <div className="finance-expense-allocation" key={allocation.key}>
                <label className="field">
                  <span>Project</span>
                  <select
                    value={allocation.projectId}
                    onChange={(event) =>
                      setAllocations((current) =>
                        current.map((item) =>
                          item.key === allocation.key
                            ? { ...item, projectId: event.target.value }
                            : item,
                        ),
                      )
                    }
                    required={expenseType === "project"}
                  >
                    <option value="">Choose a project</option>
                    {data.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.code} · {project.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Allocated amount</span>
                  <input
                    inputMode="decimal"
                    value={allocation.amount}
                    onChange={(event) =>
                      setAllocations((current) =>
                        current.map((item) =>
                          item.key === allocation.key
                            ? { ...item, amount: event.target.value }
                            : item,
                        ),
                      )
                    }
                    required={expenseType === "project"}
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Remove project allocation"
                  onClick={() =>
                    setAllocations((current) =>
                      current.filter((item) => item.key !== allocation.key),
                    )
                  }
                >
                  <Trash2 size={15} aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={addAllocation}>
            <Plus size={15} aria-hidden="true" /> Add project
          </Button>
        </fieldset>
        <label className="field finance-form__full">
          <span>Notes</span>
          <textarea name="notes" rows={3} maxLength={2000} />
        </label>
        <div className="finance-form__actions finance-form__full">
          <Button type="submit" disabled={pending || activeCategories.length === 0}>
            <ReceiptText size={16} aria-hidden="true" /> {pending ? "Recording" : "Record expense"}
          </Button>
          <span className="finance-muted-copy">
            Total:{" "}
            {formatMinorMoney(
              Math.round(
                (Number(amount || 0) + Number(tax || 0)) * 10 ** currencyMinorUnits(currency),
              ),
              currency,
              data.locale,
            )}
          </span>
        </div>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function ExpenseApprovalControls({
  expense,
  data,
}: {
  expense: FinanceExpense;
  data: FinanceWorkspaceData;
}) {
  const [state, action, pending] = useActionState(decideExpenseApprovalAction, initialState);
  const canSubmit =
    data.capabilities.canCreateExpenses &&
    ["not_required", "rejected"].includes(expense.approvalStatus) &&
    expense.paymentStatus === "unpaid";

  if (expense.approvalStatus === "pending") {
    return (
      <Link className="button button--secondary button--sm" href="/approvals">
        View approval
      </Link>
    );
  }
  if (!canSubmit) return null;

  return (
    <form action={action} className="finance-inline-form">
      <input type="hidden" name="expenseId" value={expense.id} />
      <Button
        type="submit"
        name="decision"
        value="submit"
        size="sm"
        variant="secondary"
        disabled={pending}
      >
        <Send size={15} aria-hidden="true" /> {pending ? "Submitting" : "Submit approval"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

function ExpensePaymentControl({ expense, canPay }: { expense: FinanceExpense; canPay: boolean }) {
  const [state, action, pending] = useActionState(updateExpensePaymentStateAction, initialState);
  if (!canPay || expense.approvalStatus !== "approved") return null;
  return (
    <form action={action} className="finance-inline-form">
      <input type="hidden" name="expenseId" value={expense.id} />
      <label className="field">
        <span>Payment state</span>
        <select name="paymentStatus" defaultValue={expense.paymentStatus}>
          {expensePaymentStatuses.map((status) => (
            <option
              key={status}
              value={status}
              disabled={status === "reimbursed" && !expense.isReimbursable}
            >
              {financeStatusLabel(status)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Reference</span>
        <input
          name="paymentReference"
          defaultValue={expense.paymentReference ?? ""}
          maxLength={160}
        />
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        <BadgeDollarSign size={15} aria-hidden="true" /> {pending ? "Updating" : "Update payment"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

function ExpenseReceiptControls({
  expense,
  canManage,
}: {
  expense: FinanceExpense;
  canManage: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<FinanceActionState>(initialState);
  const [pending, setPending] = useState(false);
  const isMutable =
    !["approved"].includes(expense.approvalStatus) &&
    ["unpaid", "scheduled"].includes(expense.paymentStatus);

  async function uploadReceipt() {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setMessage({ status: "error", message: "Choose a receipt to upload." });
      return;
    }
    setPending(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(`/api/finance/expenses/${expense.id}/receipt`, {
        method: "POST",
        body,
      });
      const result = (await response.json()) as { message?: string };
      setMessage({
        status: response.ok ? "success" : "error",
        message: result.message ?? (response.ok ? "Receipt uploaded." : "Upload failed."),
      });
      if (response.ok) {
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    } catch {
      setMessage({ status: "error", message: "The receipt could not be uploaded." });
    } finally {
      setPending(false);
    }
  }

  async function removeReceipt(receiptId: string) {
    setPending(true);
    try {
      const response = await fetch(`/api/finance/expense-receipts/${receiptId}`, {
        method: "DELETE",
      });
      const result = (await response.json()) as { message?: string };
      setMessage({
        status: response.ok ? "success" : "error",
        message: result.message ?? (response.ok ? "Receipt removed." : "Removal failed."),
      });
      if (response.ok) router.refresh();
    } catch {
      setMessage({ status: "error", message: "The receipt could not be removed." });
    } finally {
      setPending(false);
    }
  }

  if (!canManage && expense.receipts.length === 0) return null;
  return (
    <details className="finance-history-disclosure">
      <summary>
        <Paperclip size={15} aria-hidden="true" /> Receipts ({expense.receipts.length})
      </summary>
      <div className="finance-attachment-panel">
        {canManage && isMutable ? (
          <div className="finance-attachment-upload">
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.txt,.csv"
              aria-label="Receipt file"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={uploadReceipt}
            >
              <Paperclip size={15} aria-hidden="true" /> {pending ? "Uploading" : "Upload receipt"}
            </Button>
          </div>
        ) : null}
        {expense.receipts.length ? (
          <ul className="finance-attachment-list">
            {expense.receipts.map((receipt) => (
              <li key={receipt.id}>
                <div>
                  <strong>{receipt.fileName}</strong>
                  <span>
                    {formatFileSize(receipt.sizeBytes)} · {financeStatusLabel(receipt.status)}
                  </span>
                </div>
                <div className="finance-inline-actions">
                  {receipt.downloadHref ? (
                    <a className="button button--secondary button--sm" href={receipt.downloadHref}>
                      <Download size={15} aria-hidden="true" /> Download
                    </a>
                  ) : null}
                  {canManage && isMutable ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={pending}
                      onClick={() => removeReceipt(receipt.id)}
                    >
                      <Trash2 size={15} aria-hidden="true" /> Remove
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="finance-muted-copy">No receipts have been added.</p>
        )}
        <ActionMessage state={message} />
      </div>
    </details>
  );
}

export function ExpensesSection({ data }: { data: FinanceWorkspaceData }) {
  const visibleExpenses = useMemo(() => data.expenses, [data.expenses]);
  return (
    <section className="finance-section" aria-labelledby="expenses-title">
      <div className="finance-section__heading">
        <div>
          <h2 id="expenses-title">Expenses</h2>
          <p>
            Record employee, project, and vendor costs with tax, project allocation, private
            receipts, approvals, and settlement evidence.
          </p>
        </div>
        <div className="finance-heading-actions">
          {data.capabilities.canManageExpenseCategories ? <CategoryManager data={data} /> : null}
          {data.capabilities.canCreateExpenses ? <ExpenseCreateForm data={data} /> : null}
        </div>
      </div>
      {visibleExpenses.length === 0 ? (
        <div className="finance-empty">
          <ReceiptText size={24} aria-hidden="true" />
          <h3>No expenses found</h3>
          <p>Record the first cost or adjust the filters for this view.</p>
        </div>
      ) : (
        <div className="finance-record-list">
          {visibleExpenses.map((expense) => {
            const subject =
              expense.employeeName ?? expense.vendorName ?? `Recorded by ${expense.createdByName}`;
            return (
              <article className="finance-record" key={expense.id}>
                <div className="finance-record__primary">
                  <div>
                    <strong>{expense.categoryName}</strong>
                    <span>
                      {financeStatusLabel(expense.expenseType)} expense · {subject} ·{" "}
                      {expense.expenseDate}
                    </span>
                  </div>
                  <div className="finance-status-pair">
                    <StatusBadge tone={toneForStatus(expense.approvalStatus)}>
                      {financeStatusLabel(expense.approvalStatus)}
                    </StatusBadge>
                    <StatusBadge tone={toneForStatus(expense.paymentStatus)}>
                      {financeStatusLabel(expense.paymentStatus)}
                    </StatusBadge>
                  </div>
                </div>
                <dl className="finance-record__facts finance-record__facts--six">
                  <div>
                    <dt>Amount</dt>
                    <dd>{formatMinorMoney(expense.amountMinor, expense.currency, data.locale)}</dd>
                  </div>
                  <div>
                    <dt>Tax</dt>
                    <dd>{formatMinorMoney(expense.taxMinor, expense.currency, data.locale)}</dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd>{formatMinorMoney(expense.totalMinor, expense.currency, data.locale)}</dd>
                  </div>
                  <div>
                    <dt>Billable</dt>
                    <dd>{expense.isBillable ? "Yes" : "No"}</dd>
                  </div>
                  <div>
                    <dt>Reimbursable</dt>
                    <dd>{expense.isReimbursable ? "Yes" : "No"}</dd>
                  </div>
                  <div>
                    <dt>Payment ref.</dt>
                    <dd>{expense.paymentReference ?? "Not set"}</dd>
                  </div>
                </dl>
                {expense.allocations.length ? (
                  <p className="finance-evidence-note">
                    <strong>Project allocation:</strong>{" "}
                    {expense.allocations
                      .map(
                        (allocation) =>
                          `${allocation.projectCode} ${allocation.projectName} (${formatMinorMoney(
                            allocation.amountMinor,
                            expense.currency,
                            data.locale,
                          )})`,
                      )
                      .join(", ")}
                  </p>
                ) : null}
                {expense.vendorReference || expense.notes || expense.rejectionReason ? (
                  <p className="finance-evidence-note">
                    {expense.vendorReference ? (
                      <>
                        <strong>Vendor reference:</strong> {expense.vendorReference}.{" "}
                      </>
                    ) : null}
                    {expense.notes ? (
                      <>
                        <strong>Notes:</strong> {expense.notes}.{" "}
                      </>
                    ) : null}
                    {expense.rejectionReason ? (
                      <>
                        <strong>Rejection:</strong> {expense.rejectionReason}
                      </>
                    ) : null}
                  </p>
                ) : null}
                <div className="finance-record__actions finance-expense-actions">
                  <ExpenseApprovalControls expense={expense} data={data} />
                  <ExpensePaymentControl
                    expense={expense}
                    canPay={data.capabilities.canPayExpenses}
                  />
                </div>
                <ExpenseReceiptControls
                  expense={expense}
                  canManage={data.capabilities.canManageExpenseReceipts}
                />
                {expense.events.length ? (
                  <details className="finance-history-disclosure">
                    <summary>
                      <History size={15} aria-hidden="true" /> Expense history (
                      {expense.events.length})
                    </summary>
                    <ol className="finance-history-list">
                      {expense.events.map((event) => (
                        <li key={event.id}>
                          <strong>{financeStatusLabel(event.eventType)}</strong>
                          <span>{event.actorName ?? "System"}</span>
                          <time dateTime={event.createdAt}>
                            {getDateTimeFormatter(data.locale, {
                              dateStyle: "medium",
                              timeStyle: "short",
                              timeZone: "UTC",
                            }).format(new Date(event.createdAt))}
                          </time>
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
