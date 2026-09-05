"use client";

import { useActionState } from "react";

import { formatMinorMoney } from "@/modules/finance/calculations";
import {
  resolveCollectionCaseAction,
  saveCollectionPolicyAction,
  updateCollectionCaseAction,
} from "@/modules/finance/actions/collections";
import type { FinanceWorkspaceData } from "@/modules/finance/server/finance";
import type { FinanceActionState } from "@/modules/finance/schemas/finance";

const initialState: FinanceActionState = { status: "idle", message: "" };
function Message({ state }: { state: FinanceActionState }) {
  return state.status === "idle" ? null : <p role="status">{state.message}</p>;
}
function localDateTime(value: string | null): string {
  return value ? value.slice(0, 16) : "";
}

export function CollectionsSection({ data }: { data: FinanceWorkspaceData }) {
  const collections = data.collections;
  const [policyState, policyAction, policyPending] = useActionState(
    saveCollectionPolicyAction,
    initialState,
  );
  const [caseState, caseAction, casePending] = useActionState(
    updateCollectionCaseAction,
    initialState,
  );
  if (!collections) return null;
  return (
    <section className="finance-client-statement" aria-labelledby="collections-title">
      <header>
        <div>
          <h3 id="collections-title">Automated collections</h3>
          <p>
            Stage-driven collection reminders with dispute suppression, promise-to-pay tracking,
            owner follow-up, founder escalation, and append-only delivery evidence.
          </p>
        </div>
      </header>
      {data.capabilities.canManageCollections ? (
        <form action={policyAction} className="finance-form-grid">
          <label>
            Pre-due reminder days
            <input
              name="preDueDays"
              type="number"
              min={0}
              max={30}
              defaultValue={collections.policy.preDueDays}
            />
          </label>
          <label>
            Overdue stages
            <input
              name="overdueStageDays"
              defaultValue={collections.policy.overdueStageDays.join(",")}
              placeholder="0,7,14,30"
            />
          </label>
          <label>
            Founder escalation days
            <input
              name="founderEscalationDays"
              type="number"
              min={1}
              max={365}
              defaultValue={collections.policy.founderEscalationDays}
            />
          </label>
          <label>
            <input
              type="checkbox"
              name="reminderChannels"
              value="email"
              defaultChecked={collections.policy.reminderChannels.includes("email")}
            />{" "}
            Email
          </label>
          <label>
            <input
              type="checkbox"
              name="reminderChannels"
              value="in_app"
              defaultChecked={collections.policy.reminderChannels.includes("in_app")}
            />{" "}
            In-app owner notification
          </label>
          <label>
            Reminder subject
            <input
              name="reminderSubjectTemplate"
              maxLength={200}
              defaultValue={collections.policy.reminderSubjectTemplate}
            />
          </label>
          <label>
            Reminder body
            <textarea
              name="reminderBodyTemplate"
              maxLength={4000}
              defaultValue={collections.policy.reminderBodyTemplate}
            />
            <small>
              Placeholders: {"{{invoice}}"}, {"{{company}}"}, {"{{stage}}"}, {"{{due_date}}"}
            </small>
          </label>
          <button className="button button--secondary" type="submit" disabled={policyPending}>
            Save collection policy
          </button>
          <Message state={policyState} />
        </form>
      ) : null}
      {collections.cases.length ? (
        <div className="finance-report-table-scroll">
          <table className="finance-report-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Stage</th>
                <th>Balance</th>
                <th>Collection state</th>
              </tr>
            </thead>
            <tbody>
              {collections.cases.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.companyName}</strong>
                    <small>
                      {item.invoiceNumber} · due {item.dueDate ?? "not set"}
                    </small>
                  </td>
                  <td>
                    {item.stage.replaceAll("_", " ")}
                    <small>
                      {item.retryPending
                        ? ` · retry pending${item.lastDeliveryError ? ` (${item.lastDeliveryError})` : ""}`
                        : item.lastDeliveryStatus
                          ? ` · ${item.lastDeliveryStatus}`
                          : ""}
                    </small>
                  </td>
                  <td>{formatMinorMoney(item.amountMinor, item.currency, data.locale)}</td>
                  <td>
                    {data.capabilities.canManageCollections ? (
                      <div className="finance-inline-form">
                        <form action={caseAction}>
                          <input type="hidden" name="caseId" value={item.id} />
                          <label>
                            Promise
                            <input
                              type="date"
                              name="promiseToPayOn"
                              defaultValue={item.promiseToPayOn ?? ""}
                            />
                          </label>
                          <label>
                            Next action
                            <input
                              type="datetime-local"
                              name="nextActionAt"
                              defaultValue={localDateTime(item.nextActionAt)}
                            />
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              name="disputeSuppressed"
                              defaultChecked={item.disputeSuppressed}
                            />{" "}
                            Dispute/suppress
                          </label>
                          <input name="note" maxLength={2000} placeholder="Collection note" />
                          <button className="text-link" type="submit" disabled={casePending}>
                            Update
                          </button>
                        </form>
                        <form action={resolveCollectionCaseAction}>
                          <input type="hidden" name="caseId" value={item.id} />
                          <button type="submit" className="text-link">
                            Resolve
                          </button>
                        </form>
                      </div>
                    ) : (
                      item.status
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Message state={caseState} />
        </div>
      ) : (
        <p className="empty-state">
          No active collection cases. The collections worker creates cases from due receivables.
        </p>
      )}
    </section>
  );
}
