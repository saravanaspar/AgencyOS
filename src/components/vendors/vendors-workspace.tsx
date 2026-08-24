"use client";

import Link from "next/link";
import { useActionState } from "react";

import { VendorActionMessage } from "@/components/vendors/vendors-action-message";
import { toDateTimeLocalValue } from "@/lib/date-time-local";
import { getDateTimeFormatter, getNumberFormatter } from "@/lib/intl-formatters";
import {
  addVendorContactAction,
  addVendorNoteAction,
  addVendorQuotationAction,
  attachPurchaseOrderDocumentAction,
  attachVendorDocumentAction,
  createPurchaseRequestAction,
  createVendorCategoryAction,
  issuePurchaseOrderAction,
  linkVendorContractAction,
  recordGoodsReceiptAction,
  recordVendorBillAction,
  saveVendorAction,
  selectVendorQuotationAction,
  submitPurchaseRequestAction,
  submitVendorBillApprovalAction,
  updateVendorBillPaymentAction,
} from "@/modules/vendors/actions/vendors";
import type { VendorActionState } from "@/modules/vendors/schemas/vendors";
import type {
  PurchaseOrderSummary,
  PurchaseRequestSummary,
  VendorSummary,
  VendorWorkspaceData,
} from "@/modules/vendors/server/vendors";
import {
  purchaseRequestStatusLabels,
  receiptConditionLabels,
  receiptConditions,
  receiptStatusLabels,
  receiptStatuses,
  vendorBillStatusLabels,
  vendorBillStatuses,
  vendorContractRelationshipLabels,
  vendorContractRelationshipTypes,
  vendorNoteTypeLabels,
  vendorNoteTypes,
  vendorRiskLabels,
  vendorRiskClassifications,
  vendorStatusLabels,
  vendorStatuses,
} from "@/modules/vendors/vendors";

const initialState: VendorActionState = { status: "idle", message: "" };
const dateFormatter = getDateTimeFormatter("en", { dateStyle: "medium", timeZone: "UTC" });
const dateTimeFormatter = getDateTimeFormatter("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const numberFormatter = getNumberFormatter("en", { maximumFractionDigits: 2 });
const paymentStatuses = vendorBillStatuses.filter((status) =>
  ["disputed", "partially_paid", "paid", "void"].includes(status),
);

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`)) : "—";
}
function formatDateTime(value: string | null): string {
  return value ? dateTimeFormatter.format(new Date(value)) : "—";
}
function money(value: number, currency: string): string {
  return `${currency} ${numberFormatter.format(value / 100)}`;
}
function dateOnly(value: string | null): string {
  return value?.slice(0, 10) ?? "";
}
function CategoryForm() {
  const [state, action, pending] = useActionState(createVendorCategoryAction, initialState);
  return (
    <form action={action} className="vendor-form vendor-form--compact">
      <label>
        Category name
        <input name="name" required minLength={2} maxLength={80} />
      </label>
      <label className="vendor-form__wide">
        Description
        <textarea name="description" rows={2} maxLength={500} />
      </label>
      <div className="vendor-form__wide vendor-form__actions">
        <button type="submit" className="button button--secondary" disabled={pending}>
          Add category
        </button>
        <VendorActionMessage state={state} />
      </div>
    </form>
  );
}

function VendorFields({ data, vendor }: { data: VendorWorkspaceData; vendor?: VendorSummary }) {
  const activeCategories = data.categories.filter((category) => category.status === "active");
  return (
    <>
      {vendor ? <input type="hidden" name="vendorId" value={vendor.id} /> : null}
      <label>
        Legal name
        <input
          name="legalName"
          required
          minLength={2}
          maxLength={180}
          defaultValue={vendor?.legalName}
        />
      </label>
      <label>
        Display name
        <input
          name="displayName"
          required
          minLength={2}
          maxLength={160}
          defaultValue={vendor?.displayName}
        />
      </label>
      <label>
        Primary category
        <select name="primaryCategoryId" defaultValue={vendor?.primaryCategoryId ?? ""}>
          <option value="">None</option>
          {activeCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Additional categories
        <select
          name="categoryIds"
          multiple
          defaultValue={vendor?.categories.map((category) => category.id) ?? []}
        >
          {activeCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select name="status" defaultValue={vendor?.status ?? "prospect"}>
          {vendorStatuses.map((status) => (
            <option key={status} value={status}>
              {vendorStatusLabels[status]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Risk
        <select name="riskClassification" defaultValue={vendor?.riskClassification ?? "low"}>
          {vendorRiskClassifications.map((risk) => (
            <option key={risk} value={risk}>
              {vendorRiskLabels[risk]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Owner
        <select name="ownerMembershipId" defaultValue={vendor?.ownerMembershipId ?? ""}>
          <option value="">Unassigned</option>
          {data.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Website
        <input name="website" type="url" maxLength={500} defaultValue={vendor?.website ?? ""} />
      </label>
      <label>
        Email
        <input name="email" type="email" maxLength={320} defaultValue={vendor?.email ?? ""} />
      </label>
      <label>
        Phone
        <input name="phone" maxLength={80} defaultValue={vendor?.phone ?? ""} />
      </label>
      <label>
        Country code
        <input name="countryCode" maxLength={2} defaultValue={vendor?.countryCode ?? ""} />
      </label>
      <label>
        Currency
        <input
          name="defaultCurrency"
          required
          maxLength={3}
          defaultValue={vendor?.defaultCurrency ?? "USD"}
        />
      </label>
      <label>
        Payment terms (days)
        <input
          name="paymentTermsDays"
          type="number"
          min={0}
          max={365}
          defaultValue={vendor?.paymentTermsDays ?? 30}
        />
      </label>
      <label>
        Onboarding date
        <input
          name="onboardingDate"
          type="date"
          defaultValue={dateOnly(vendor?.onboardingDate ?? null)}
        />
      </label>
      <label>
        Next review
        <input
          name="nextReviewDate"
          type="date"
          defaultValue={dateOnly(vendor?.nextReviewDate ?? null)}
        />
      </label>
      <label className="vendor-form__wide">
        Address
        <textarea name="address" rows={2} maxLength={1000} defaultValue={vendor?.address ?? ""} />
      </label>
      {!vendor || vendor.canViewSensitive ? (
        <>
          <label>
            Tax country
            <input
              name="taxCountryCode"
              maxLength={2}
              defaultValue={vendor?.financial?.taxCountryCode ?? ""}
            />
          </label>
          <label>
            Tax identifier
            <input
              name="taxIdentifier"
              maxLength={120}
              defaultValue={vendor?.financial?.taxIdentifier ?? ""}
            />
          </label>
          <label>
            Tax registered name
            <input
              name="taxRegistrationName"
              maxLength={180}
              defaultValue={vendor?.financial?.taxRegistrationName ?? ""}
            />
          </label>
          <label>
            Bank name
            <input
              name="bankName"
              maxLength={160}
              defaultValue={vendor?.financial?.bankName ?? ""}
            />
          </label>
          <label>
            Bank account name
            <input
              name="bankAccountName"
              maxLength={160}
              defaultValue={vendor?.financial?.bankAccountName ?? ""}
            />
          </label>
          <label>
            Account last four
            <input
              name="bankAccountLastFour"
              maxLength={8}
              defaultValue={vendor?.financial?.bankAccountLastFour ?? ""}
            />
          </label>
          <label>
            Routing reference
            <input
              name="bankRoutingReference"
              maxLength={120}
              defaultValue={vendor?.financial?.bankRoutingReference ?? ""}
            />
          </label>
          <label className="vendor-form__wide">
            Payment instructions
            <textarea
              name="paymentInstructions"
              rows={2}
              maxLength={2000}
              defaultValue={vendor?.financial?.paymentInstructions ?? ""}
            />
          </label>
        </>
      ) : null}
    </>
  );
}

function VendorForm({ data, vendor }: { data: VendorWorkspaceData; vendor?: VendorSummary }) {
  const [state, action, pending] = useActionState(saveVendorAction, initialState);
  return (
    <form action={action} className="vendor-form">
      <VendorFields data={data} vendor={vendor} />
      <div className="vendor-form__wide vendor-form__actions">
        <button type="submit" className="button" disabled={pending}>
          {vendor ? "Save vendor" : "Create vendor"}
        </button>
        <VendorActionMessage state={state} />
      </div>
    </form>
  );
}

function VendorOperations({ data, vendor }: { data: VendorWorkspaceData; vendor: VendorSummary }) {
  const [contactState, contactAction, contactPending] = useActionState(
    addVendorContactAction,
    initialState,
  );
  const [noteState, noteAction, notePending] = useActionState(addVendorNoteAction, initialState);
  const [contractState, contractAction, contractPending] = useActionState(
    linkVendorContractAction,
    initialState,
  );
  const [documentState, documentAction, documentPending] = useActionState(
    attachVendorDocumentAction,
    initialState,
  );
  return (
    <div className="vendor-operations">
      {vendor.canUpdate ? (
        <details>
          <summary>Edit profile</summary>
          <VendorForm data={data} vendor={vendor} />
        </details>
      ) : null}
      {vendor.canUpdate ? (
        <form action={contactAction} className="vendor-form vendor-form--compact">
          <input type="hidden" name="vendorId" value={vendor.id} />
          <label>
            Contact name
            <input name="name" required />
          </label>
          <label>
            Role
            <input name="roleTitle" />
          </label>
          <label>
            Email
            <input name="email" type="email" />
          </label>
          <label>
            Phone
            <input name="phone" />
          </label>
          <label>
            <input name="isPrimary" type="checkbox" /> Primary contact
          </label>
          <div className="vendor-form__wide vendor-form__actions">
            <button type="submit" className="button button--secondary" disabled={contactPending}>
              Add contact
            </button>
            <VendorActionMessage state={contactState} />
          </div>
        </form>
      ) : null}
      {vendor.canNote ? (
        <form action={noteAction} className="vendor-form vendor-form--compact">
          <input type="hidden" name="vendorId" value={vendor.id} />
          <label>
            Note type
            <select name="noteType">
              {vendorNoteTypes.map((type) => (
                <option key={type} value={type}>
                  {vendorNoteTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rating
            <input name="rating" type="number" min={1} max={5} />
          </label>
          <label className="vendor-form__wide">
            Performance, risk, or compliance note
            <textarea name="content" required minLength={3} rows={3} />
          </label>
          <div className="vendor-form__wide vendor-form__actions">
            <button type="submit" className="button button--secondary" disabled={notePending}>
              Add immutable note
            </button>
            <VendorActionMessage state={noteState} />
          </div>
        </form>
      ) : null}
      {vendor.canLinkContract ? (
        <form action={contractAction} className="vendor-inline-form">
          <input type="hidden" name="vendorId" value={vendor.id} />
          <select name="contractId" aria-label="Legal contract" required defaultValue="">
            <option value="" disabled>
              Choose legal contract
            </option>
            {data.contracts.map((contract) => (
              <option key={contract.id} value={contract.id}>
                {contract.title}
              </option>
            ))}
          </select>
          <select name="relationshipType" aria-label="Contract relationship type">
            {vendorContractRelationshipTypes.map((type) => (
              <option key={type} value={type}>
                {vendorContractRelationshipLabels[type]}
              </option>
            ))}
          </select>
          <button type="submit" className="button button--secondary" disabled={contractPending}>
            Link contract
          </button>
          <VendorActionMessage state={contractState} />
        </form>
      ) : null}
      {vendor.canLinkDocument ? (
        <form action={documentAction} className="vendor-inline-form">
          <input type="hidden" name="vendorId" value={vendor.id} />
          <select name="documentId" aria-label="Document" required defaultValue="">
            <option value="" disabled>
              Choose document
            </option>
            {data.documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.title}
              </option>
            ))}
          </select>
          <button type="submit" className="button button--secondary" disabled={documentPending}>
            Link document
          </button>
          <VendorActionMessage state={documentState} />
        </form>
      ) : null}
    </div>
  );
}

function PurchaseRequestForm({ data }: { data: VendorWorkspaceData }) {
  const [state, action, pending] = useActionState(createPurchaseRequestAction, initialState);
  return (
    <form action={action} className="vendor-form">
      <label>
        Request title
        <input name="title" required minLength={3} />
      </label>
      <label>
        Department
        <select name="departmentId" defaultValue="">
          <option value="">None</option>
          {data.departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Project
        <select name="projectId" defaultValue="">
          <option value="">None</option>
          {data.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Budget (minor units)
        <input name="budgetMinor" type="number" min={0} defaultValue={0} required />
      </label>
      <label>
        Currency
        <input name="currency" defaultValue="USD" maxLength={3} required />
      </label>
      <label>
        Required by
        <input name="requiredByDate" type="date" />
      </label>
      <label className="vendor-form__wide">
        Business justification
        <textarea name="businessJustification" rows={3} minLength={10} required />
      </label>
      <label className="vendor-form__wide">
        Items{" "}
        <span className="field-hint">
          One per line: description | quantity | unit | estimated unit price minor | optional
          specifications
        </span>
        <textarea
          name="items"
          rows={5}
          required
          placeholder="Laptop | 2 | each | 125000 | 16GB RAM"
        />
      </label>
      <div className="vendor-form__wide vendor-form__actions">
        <button type="submit" className="button" disabled={pending}>
          Create draft request
        </button>
        <VendorActionMessage state={state} />
      </div>
    </form>
  );
}

function RequestActions({
  data,
  request,
}: {
  data: VendorWorkspaceData;
  request: PurchaseRequestSummary;
}) {
  const [submitState, submitAction, submitPending] = useActionState(
    submitPurchaseRequestAction,
    initialState,
  );
  const [quoteState, quoteAction, quotePending] = useActionState(
    addVendorQuotationAction,
    initialState,
  );
  const [selectState, selectAction, selectPending] = useActionState(
    selectVendorQuotationAction,
    initialState,
  );
  const [orderState, orderAction, orderPending] = useActionState(
    issuePurchaseOrderAction,
    initialState,
  );
  const activeVendors = data.vendors.filter((vendor) => vendor.status === "active");
  const submittedQuotations = request.quotations.filter(
    (quotation) => quotation.status === "submitted",
  );
  return (
    <div className="vendor-operations">
      {request.canSubmit && ["draft", "revision_requested"].includes(request.status) ? (
        <form action={submitAction} className="vendor-inline-form">
          <input type="hidden" name="purchaseRequestId" value={request.id} />
          <button type="submit" className="button" disabled={submitPending}>
            Submit for approval
          </button>
          <VendorActionMessage state={submitState} />
        </form>
      ) : null}
      {request.canManageQuotations && ["approved", "sourcing"].includes(request.status) ? (
        <form action={quoteAction} className="vendor-form vendor-form--compact">
          <input type="hidden" name="purchaseRequestId" value={request.id} />
          <label>
            Vendor
            <select name="vendorId" required defaultValue="">
              <option value="" disabled>
                Select vendor
              </option>
              {activeVendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quote reference
            <input name="quotationReference" required />
          </label>
          <label>
            Quoted on
            <input name="quotedOn" type="date" required />
          </label>
          <label>
            Valid until
            <input name="validUntil" type="date" />
          </label>
          <label>
            Subtotal minor
            <input name="subtotalMinor" type="number" min={0} required />
          </label>
          <label>
            Tax minor
            <input name="taxMinor" type="number" min={0} defaultValue={0} required />
          </label>
          <label>
            Shipping minor
            <input name="shippingMinor" type="number" min={0} defaultValue={0} required />
          </label>
          <label>
            Currency
            <input name="currency" maxLength={3} defaultValue={request.currency} required />
          </label>
          <label>
            Lead time days
            <input name="leadTimeDays" type="number" min={0} />
          </label>
          <label>
            Source document
            <select name="sourceDocumentId" defaultValue="">
              <option value="">None</option>
              {data.documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
            </select>
          </label>
          <label className="vendor-form__wide">
            Payment terms
            <textarea name="paymentTerms" rows={2} />
          </label>
          <label className="vendor-form__wide">
            Notes
            <textarea name="notes" rows={2} />
          </label>
          <div className="vendor-form__wide vendor-form__actions">
            <button type="submit" className="button button--secondary" disabled={quotePending}>
              Record quotation
            </button>
            <VendorActionMessage state={quoteState} />
          </div>
        </form>
      ) : null}
      {request.canManageQuotations && submittedQuotations.length > 0 ? (
        <form action={selectAction} className="vendor-inline-form">
          <input type="hidden" name="purchaseRequestId" value={request.id} />
          <select name="quotationId" aria-label="Winning quotation" required defaultValue="">
            <option value="" disabled>
              Select winning quotation
            </option>
            {submittedQuotations.map((quote) => (
              <option key={quote.id} value={quote.id}>
                {quote.vendorName} — {money(quote.totalMinor, quote.currency)}
              </option>
            ))}
          </select>
          <button type="submit" className="button button--secondary" disabled={selectPending}>
            Select vendor
          </button>
          <VendorActionMessage state={selectState} />
        </form>
      ) : null}
      {request.canManage &&
      request.selectedQuotationId &&
      ["approved", "sourcing"].includes(request.status) ? (
        <form action={orderAction} className="vendor-form vendor-form--compact">
          <input type="hidden" name="purchaseRequestId" value={request.id} />
          <label>
            Issue date
            <input name="issueDate" type="date" required />
          </label>
          <label>
            Expected delivery
            <input name="expectedDeliveryDate" type="date" />
          </label>
          <label>
            Contract
            <select name="contractId" defaultValue="">
              <option value="">No linked contract</option>
              {data.contracts.map((contract) => (
                <option key={contract.id} value={contract.id}>
                  {contract.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment terms
            <input name="paymentTerms" />
          </label>
          <label className="vendor-form__wide">
            Delivery address
            <textarea name="deliveryAddress" rows={2} />
          </label>
          <div className="vendor-form__wide vendor-form__actions">
            <button type="submit" className="button" disabled={orderPending}>
              Issue purchase order
            </button>
            <VendorActionMessage state={orderState} />
          </div>
        </form>
      ) : null}
    </div>
  );
}

function PurchaseOrderActions({
  data,
  order,
}: {
  data: VendorWorkspaceData;
  order: PurchaseOrderSummary;
}) {
  const [receiptState, receiptAction, receiptPending] = useActionState(
    recordGoodsReceiptAction,
    initialState,
  );
  const [billState, billAction, billPending] = useActionState(recordVendorBillAction, initialState);
  const [documentState, documentAction, documentPending] = useActionState(
    attachPurchaseOrderDocumentAction,
    initialState,
  );
  return (
    <div className="vendor-operations">
      {order.canRecordReceipt && order.items.some((item) => item.quantityOutstanding > 0) ? (
        <form action={receiptAction} className="vendor-form">
          <input type="hidden" name="purchaseOrderId" value={order.id} />
          <label>
            Received at
            <input
              name="receivedAt"
              type="datetime-local"
              defaultValue={toDateTimeLocalValue()}
              required
            />
          </label>
          <label>
            Delivery reference
            <input name="deliveryReference" />
          </label>
          <label>
            Receipt status
            <select name="status">
              {receiptStatuses.map((status) => (
                <option key={status} value={status}>
                  {receiptStatusLabels[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="vendor-form__wide">
            Receipt notes
            <textarea name="notes" rows={2} />
          </label>
          <div className="vendor-form__wide vendor-receipt-items">
            {order.items.map((item) => (
              <fieldset key={item.id}>
                <legend>
                  {item.description} — {item.quantityOutstanding} {item.unit} outstanding
                </legend>
                <input type="hidden" name="receiptItemIds" value={item.id} />
                <label>
                  Quantity received
                  <input
                    name={`quantityReceived:${item.id}`}
                    type="number"
                    min="0.0001"
                    step="any"
                    max={item.quantityOutstanding}
                    required
                  />
                </label>
                <label>
                  Condition
                  <select name={`condition:${item.id}`}>
                    {receiptConditions.map((condition) => (
                      <option key={condition} value={condition}>
                        {receiptConditionLabels[condition]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Notes
                  <input name={`notes:${item.id}`} />
                </label>
              </fieldset>
            ))}
          </div>
          <div className="vendor-form__wide vendor-form__actions">
            <button type="submit" className="button" disabled={receiptPending}>
              Record receipt
            </button>
            <VendorActionMessage state={receiptState} />
          </div>
        </form>
      ) : null}
      {order.canManageBill ? (
        <form action={billAction} className="vendor-form vendor-form--compact">
          <input type="hidden" name="purchaseOrderId" value={order.id} />
          <label>
            Bill reference
            <input name="billReference" required />
          </label>
          <label>
            Invoice date
            <input name="invoiceDate" type="date" required />
          </label>
          <label>
            Due date
            <input name="dueDate" type="date" />
          </label>
          <label>
            Subtotal minor
            <input name="subtotalMinor" type="number" min={0} required />
          </label>
          <label>
            Tax minor
            <input name="taxMinor" type="number" min={0} defaultValue={0} required />
          </label>
          <label>
            Currency
            <input name="currency" maxLength={3} defaultValue={order.currency} required />
          </label>
          <label>
            Source document
            <select name="sourceDocumentId" defaultValue="">
              <option value="">None</option>
              {data.documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
            </select>
          </label>
          <div className="vendor-form__wide vendor-form__actions">
            <button type="submit" className="button button--secondary" disabled={billPending}>
              Record bill
            </button>
            <VendorActionMessage state={billState} />
          </div>
        </form>
      ) : null}
      {order.canLinkDocument ? (
        <form action={documentAction} className="vendor-inline-form">
          <input type="hidden" name="purchaseOrderId" value={order.id} />
          <select name="documentId" aria-label="Document" required defaultValue="">
            <option value="" disabled>
              Choose PO document
            </option>
            {data.documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.title}
              </option>
            ))}
          </select>
          <button type="submit" className="button button--secondary" disabled={documentPending}>
            Link document
          </button>
          <VendorActionMessage state={documentState} />
        </form>
      ) : null}
    </div>
  );
}

function BillApprovalForm({ bill }: { bill: PurchaseOrderSummary["bills"][number] }) {
  const [state, action, pending] = useActionState(submitVendorBillApprovalAction, initialState);
  if (!bill.canSubmitApproval) return null;
  return (
    <form action={action} className="vendor-inline-form">
      <input type="hidden" name="billId" value={bill.id} />
      <button type="submit" className="button" disabled={pending}>
        Submit for approval
      </button>
      <VendorActionMessage state={state} />
    </form>
  );
}

function BillPaymentForm({ bill }: { bill: PurchaseOrderSummary["bills"][number] }) {
  const [state, action, pending] = useActionState(updateVendorBillPaymentAction, initialState);
  if (!bill.canManagePayment || !["approved", "partially_paid", "disputed"].includes(bill.status)) {
    return null;
  }
  const defaultStatus = bill.status === "approved" ? "partially_paid" : bill.status;
  return (
    <form action={action} className="vendor-inline-form">
      <input type="hidden" name="billId" value={bill.id} />
      <select name="status" aria-label="Bill payment status" defaultValue={defaultStatus}>
        {paymentStatuses.map((status) => (
          <option key={status} value={status}>
            {vendorBillStatusLabels[status]}
          </option>
        ))}
      </select>
      <input
        name="paymentReference"
        aria-label="Payment reference"
        placeholder="Payment reference"
        defaultValue={bill.paymentReference ?? ""}
      />
      <button type="submit" className="button button--secondary" disabled={pending}>
        Update payment
      </button>
      <VendorActionMessage state={state} />
    </form>
  );
}

function VendorSummary({ data }: { data: VendorWorkspaceData }) {
  return (
    <section className="vendor-summary-grid" aria-label="Vendor and procurement summary">
      <article>
        <span>Active vendors</span>
        <strong>{data.summary.activeVendors}</strong>
      </article>
      <article>
        <span>High-risk vendors</span>
        <strong>{data.summary.highRiskVendors}</strong>
      </article>
      <article>
        <span>Pending requests</span>
        <strong>{data.summary.pendingRequests}</strong>
      </article>
      <article>
        <span>Sourcing</span>
        <strong>{data.summary.sourcingRequests}</strong>
      </article>
      <article>
        <span>Open POs</span>
        <strong>{data.summary.openPurchaseOrders}</strong>
      </article>
      <article>
        <span>Bills due</span>
        <strong>{data.summary.billsDue}</strong>
      </article>
    </section>
  );
}

function VendorCreatePanel({ data }: { data: VendorWorkspaceData }) {
  const visible =
    data.capabilities.canCreateVendor ||
    data.capabilities.canManageCategories ||
    data.capabilities.canCreateRequest;
  if (!visible) return null;
  return (
    <section className="vendor-create-panel">
      <h2>Create and configure</h2>
      {data.capabilities.canManageCategories ? (
        <details>
          <summary>Add vendor category</summary>
          <CategoryForm />
        </details>
      ) : null}
      {data.capabilities.canCreateVendor ? (
        <details>
          <summary>Register vendor</summary>
          <VendorForm data={data} />
        </details>
      ) : null}
      {data.capabilities.canCreateRequest ? (
        <details>
          <summary>Create purchase request</summary>
          <PurchaseRequestForm data={data} />
        </details>
      ) : null}
    </section>
  );
}

function VendorRegister({ data }: { data: VendorWorkspaceData }) {
  return (
    <section>
      <div className="vendor-section-heading">
        <div>
          <p className="eyebrow">Supplier governance</p>
          <h2>Vendor register</h2>
        </div>
        <span>{data.vendors.length} visible</span>
      </div>
      <div className="vendor-card-grid">
        {data.vendors.map((vendor) => (
          <article className="vendor-card" key={vendor.id}>
            <header>
              <div>
                <p className="vendor-key">{vendor.vendorKey}</p>
                <h3>{vendor.displayName}</h3>
                <p>{vendor.legalName}</p>
              </div>
              <div className="vendor-badges">
                <span>{vendor.statusLabel}</span>
                <span>{vendor.riskLabel}</span>
              </div>
            </header>
            <dl className="vendor-facts">
              <div>
                <dt>Category</dt>
                <dd>{vendor.primaryCategoryName ?? "—"}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{vendor.ownerName ?? "—"}</dd>
              </div>
              <div>
                <dt>Payment terms</dt>
                <dd>{vendor.paymentTermsDays} days</dd>
              </div>
              <div>
                <dt>Next review</dt>
                <dd>{formatDate(vendor.nextReviewDate)}</dd>
              </div>
            </dl>
            {vendor.contacts.length ? (
              <div>
                <h4>Contacts</h4>
                <ul>
                  {vendor.contacts.map((contact) => (
                    <li key={contact.id}>
                      {contact.name}
                      {contact.roleTitle ? ` — ${contact.roleTitle}` : ""}
                      {contact.isPrimary ? " · Primary" : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {vendor.contracts.length ? (
              <div>
                <h4>Contracts</h4>
                <ul>
                  {vendor.contracts.map((contract) => (
                    <li key={contract.id}>
                      {contract.title} · {contract.relationshipLabel}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {vendor.documents.length ? (
              <div>
                <h4>Documents</h4>
                <ul>
                  {vendor.documents.map((document) => (
                    <li key={document.id}>
                      {document.canOpen && document.currentVersionId ? (
                        <Link
                          href={`/api/documents/${document.id}/versions/${document.currentVersionId}`}
                        >
                          {document.title}
                        </Link>
                      ) : (
                        document.title
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {vendor.notes.length ? (
              <details>
                <summary>Performance, risk, and compliance history</summary>
                <ul className="vendor-timeline">
                  {vendor.notes.map((note) => (
                    <li key={note.id}>
                      <strong>
                        {note.noteTypeLabel}
                        {note.rating ? ` · ${note.rating}/5` : ""}
                      </strong>
                      <p>{note.content}</p>
                      <small>
                        {note.createdByName} · {formatDateTime(note.createdAt)}
                      </small>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <VendorOperations data={data} vendor={vendor} />
          </article>
        ))}
      </div>
      {data.vendors.length === 0 ? (
        <p className="empty-state">No vendors match the current filters.</p>
      ) : null}
    </section>
  );
}

function PurchaseRequestRegister({ data }: { data: VendorWorkspaceData }) {
  return (
    <section>
      <div className="vendor-section-heading">
        <div>
          <p className="eyebrow">Approval and sourcing</p>
          <h2>Purchase requests</h2>
        </div>
        <span>{data.purchaseRequests.length} visible</span>
      </div>
      <div className="vendor-stack">
        {data.purchaseRequests.map((request) => (
          <article className="vendor-card" key={request.id}>
            <header>
              <div>
                <p className="vendor-key">{request.requestKey}</p>
                <h3>{request.title}</h3>
                <p>
                  {request.requesterName} · {request.departmentName ?? "No department"}
                </p>
              </div>
              <span className="vendor-status">{purchaseRequestStatusLabels[request.status]}</span>
            </header>
            <p>{request.businessJustification}</p>
            <dl className="vendor-facts">
              <div>
                <dt>Budget</dt>
                <dd>{money(request.budgetMinor, request.currency)}</dd>
              </div>
              <div>
                <dt>Required by</dt>
                <dd>{formatDate(request.requiredByDate)}</dd>
              </div>
              <div>
                <dt>Project</dt>
                <dd>{request.projectName ?? "—"}</dd>
              </div>
              <div>
                <dt>Selected vendor</dt>
                <dd>{request.selectedVendorName ?? "—"}</dd>
              </div>
            </dl>
            <div className="vendor-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Quantity</th>
                    <th>Estimate</th>
                  </tr>
                </thead>
                <tbody>
                  {request.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.description}</td>
                      <td>
                        {item.quantity} {item.unit}
                      </td>
                      <td>{money(item.estimatedLineTotalMinor, request.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {request.quotations.length ? (
              <div>
                <h4>Quotations</h4>
                <ul>
                  {request.quotations.map((quote) => (
                    <li key={quote.id}>
                      {quote.vendorName} · {money(quote.totalMinor, quote.currency)} ·{" "}
                      {quote.statusLabel}
                      {quote.leadTimeDays !== null ? ` · ${quote.leadTimeDays} days` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <RequestActions data={data} request={request} />
          </article>
        ))}
      </div>
      {data.purchaseRequests.length === 0 ? (
        <p className="empty-state">No purchase requests match the current filters.</p>
      ) : null}
    </section>
  );
}

function PurchaseOrderRegister({ data }: { data: VendorWorkspaceData }) {
  return (
    <section>
      <div className="vendor-section-heading">
        <div>
          <p className="eyebrow">Order-to-pay</p>
          <h2>Purchase orders</h2>
        </div>
        <span>{data.purchaseOrders.length} visible</span>
      </div>
      <div className="vendor-stack">
        {data.purchaseOrders.map((order) => (
          <article className="vendor-card" key={order.id}>
            <header>
              <div>
                <p className="vendor-key">{order.purchaseOrderKey}</p>
                <h3>{order.vendorName}</h3>
                <p>
                  {order.purchaseRequestKey} — {order.requestTitle}
                </p>
              </div>
              <span className="vendor-status">{order.statusLabel}</span>
            </header>
            <dl className="vendor-facts">
              <div>
                <dt>Total</dt>
                <dd>{money(order.totalMinor, order.currency)}</dd>
              </div>
              <div>
                <dt>Issued</dt>
                <dd>{formatDate(order.issueDate)}</dd>
              </div>
              <div>
                <dt>Expected</dt>
                <dd>{formatDate(order.expectedDeliveryDate)}</dd>
              </div>
              <div>
                <dt>Contract</dt>
                <dd>{order.contractTitle ?? "—"}</dd>
              </div>
            </dl>
            <div className="vendor-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Ordered</th>
                    <th>Received</th>
                    <th>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.description}</td>
                      <td>
                        {item.quantity} {item.unit}
                      </td>
                      <td>{item.quantityReceived}</td>
                      <td>{item.quantityOutstanding}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {order.receipts.length ? (
              <div>
                <h4>Goods receipts</h4>
                <ul>
                  {order.receipts.map((receipt) => (
                    <li key={receipt.id}>
                      {receipt.receiptKey} · {receipt.statusLabel} ·{" "}
                      {formatDateTime(receipt.receivedAt)} · {receipt.receivedByName}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {order.bills.length ? (
              <div>
                <h4>Vendor bills</h4>
                {order.bills.map((bill) => (
                  <div className="vendor-bill" key={bill.id}>
                    <p>
                      <strong>{bill.billReference}</strong> ·{" "}
                      {money(bill.totalMinor, bill.currency)} · {bill.matchStatusLabel} ·{" "}
                      {bill.statusLabel}
                    </p>
                    {bill.approvalRequestId ? (
                      <p className="vendor-muted">Approval request linked.</p>
                    ) : null}
                    <BillApprovalForm bill={bill} />
                    <BillPaymentForm bill={bill} />
                  </div>
                ))}
              </div>
            ) : null}
            {order.documents.length ? (
              <div>
                <h4>Documents</h4>
                <ul>
                  {order.documents.map((document) => (
                    <li key={document.id}>
                      {document.canOpen && document.currentVersionId ? (
                        <Link
                          href={`/api/documents/${document.id}/versions/${document.currentVersionId}`}
                        >
                          {document.title}
                        </Link>
                      ) : (
                        document.title
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <PurchaseOrderActions data={data} order={order} />
          </article>
        ))}
      </div>
      {data.purchaseOrders.length === 0 ? (
        <p className="empty-state">No purchase orders match the current filters.</p>
      ) : null}
    </section>
  );
}

export function VendorsWorkspace({ data }: { data: VendorWorkspaceData }) {
  return (
    <div className="vendor-workspace">
      <VendorSummary data={data} />
      <VendorCreatePanel data={data} />
      <VendorRegister data={data} />
      <PurchaseRequestRegister data={data} />
      <PurchaseOrderRegister data={data} />
    </div>
  );
}
