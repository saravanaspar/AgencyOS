"use client";

import Link from "next/link";
import { useActionState } from "react";

import { AssetActionMessage } from "@/components/assets/assets-action-message";
import { toDateTimeLocalValue } from "@/lib/date-time-local";
import { getDateTimeFormatter, getNumberFormatter } from "@/lib/intl-formatters";
import {
  acknowledgeAssetAction,
  assignAssetAction,
  attachAssetDocumentAction,
  completeAssetMaintenanceAction,
  createAssetAction,
  createAssetCategoryAction,
  createAssetMaintenanceAction,
  createAssetRequestAction,
  submitAssetRequestAction,
  cancelAssetRequestAction,
  fulfillAssetRequestAction,
  createAssetReturnRequestAction,
  updateAssetReturnRequestAction,
  disposeAssetAction,
  recordAssetConditionAction,
  returnAssetAction,
  updateAssetAction,
} from "@/modules/assets/actions/assets";
import type { AssetActionState } from "@/modules/assets/schemas/assets";
import type { AssetSummary, AssetWorkspaceData } from "@/modules/assets/server/assets";
import {
  assetCategoryKindLabels,
  assetCategoryKinds,
  assetConditionLabels,
  assetConditions,
  assetDepreciationMethodLabels,
  assetDepreciationMethods,
  assetMaintenanceTypeLabels,
  assetMaintenanceTypes,
  assetOwnershipTypeLabels,
  assetOwnershipTypes,
  assetStatusLabels,
  assetRequestTypes,
  assetRequestTypeLabels,
} from "@/modules/assets/assets";

const initialState: AssetActionState = { status: "idle", message: "" };
const editableAssetStatuses = [
  "ordered",
  "received",
  "available",
  "under_repair",
  "lost",
  "stolen",
  "retired",
] as const;
const dateFormatter = getDateTimeFormatter("en", { dateStyle: "medium", timeZone: "UTC" });
const dateTimeFormatter = getDateTimeFormatter("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const integerFormatter = getNumberFormatter("en", { maximumFractionDigits: 0 });

function dateOnly(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`)) : "—";
}

function formatDateTime(value: string | null): string {
  return value ? dateTimeFormatter.format(new Date(value)) : "—";
}

function formatMoneyMinor(value: number | null, currency: string): string {
  if (value === null) return "—";
  return `${currency} ${integerFormatter.format(value / 100)}`;
}

function AssetCategoryForm() {
  const [state, action, pending] = useActionState(createAssetCategoryAction, initialState);
  return (
    <form action={action} className="asset-form asset-form--category">
      <label>
        Category name
        <input name="name" required minLength={2} maxLength={80} />
      </label>
      <label>
        Type
        <select name="kind" defaultValue="other">
          {assetCategoryKinds.map((kind) => (
            <option key={kind} value={kind}>
              {assetCategoryKindLabels[kind]}
            </option>
          ))}
        </select>
      </label>
      <label className="asset-form__wide">
        Description
        <textarea name="description" minLength={2} maxLength={500} rows={2} />
      </label>
      <div className="asset-form__wide asset-form__actions">
        <button className="button button--secondary" type="submit" disabled={pending}>
          Add category
        </button>
        <AssetActionMessage state={state} />
      </div>
    </form>
  );
}

function MetadataFields({
  data,
  asset,
  includeStatus = true,
}: {
  data: AssetWorkspaceData;
  asset?: AssetSummary;
  includeStatus?: boolean;
}) {
  return (
    <>
      <label>
        Asset tag
        <input
          name="assetTag"
          required
          minLength={2}
          maxLength={80}
          defaultValue={asset?.assetTag}
        />
      </label>
      <label>
        Serial number
        <input name="serialNumber" maxLength={160} defaultValue={asset?.serialNumber ?? ""} />
      </label>
      <label>
        Category
        <select name="categoryId" required defaultValue={asset?.categoryId ?? ""}>
          <option value="" disabled>
            Select category
          </option>
          {data.categories.map((category) =>
            category.status === "active" || category.id === asset?.categoryId ? (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ) : null,
          )}
        </select>
      </label>
      <label>
        Name
        <input name="name" required minLength={2} maxLength={180} defaultValue={asset?.name} />
      </label>
      <label>
        Manufacturer
        <input name="manufacturer" maxLength={120} defaultValue={asset?.manufacturer ?? ""} />
      </label>
      <label>
        Model
        <input name="model" maxLength={120} defaultValue={asset?.model ?? ""} />
      </label>
      <label>
        Ownership
        <select name="ownershipType" defaultValue={asset?.ownershipType ?? "owned"}>
          {assetOwnershipTypes.map((type) => (
            <option key={type} value={type}>
              {assetOwnershipTypeLabels[type]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Responsible owner
        <select name="ownerMembershipId" defaultValue={asset?.ownerMembershipId ?? ""}>
          <option value="">No named owner</option>
          {data.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Vendor
        <select name="vendorId" defaultValue={asset?.vendorId ?? ""}>
          <option value="">No linked vendor</option>
          {data.vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Purchase date
        <input
          type="date"
          name="purchaseDate"
          defaultValue={dateOnly(asset?.purchaseDate ?? null)}
        />
      </label>
      <label>
        Purchase price (minor units)
        <input
          type="number"
          min={0}
          name="purchasePriceMinor"
          defaultValue={asset?.purchasePriceMinor ?? ""}
        />
      </label>
      <label>
        Currency
        <input
          name="currency"
          required
          pattern="[A-Za-z]{3}"
          maxLength={3}
          defaultValue={asset?.currency ?? "USD"}
        />
      </label>
      <label>
        Location
        <input name="location" maxLength={180} defaultValue={asset?.location ?? ""} />
      </label>
      {includeStatus ? (
        <label>
          Status
          <select name="status" defaultValue={asset?.status ?? "available"}>
            {editableAssetStatuses.map((status) => (
              <option key={status} value={status}>
                {assetStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        Condition
        <select name="condition" defaultValue={asset?.condition ?? "good"}>
          {assetConditions.map((condition) => (
            <option key={condition} value={condition}>
              {assetConditionLabels[condition]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Warranty provider
        <input
          name="warrantyProvider"
          maxLength={160}
          defaultValue={asset?.warrantyProvider ?? ""}
        />
      </label>
      <label>
        Warranty reference
        <input
          name="warrantyReference"
          maxLength={160}
          defaultValue={asset?.warrantyReference ?? ""}
        />
      </label>
      <label>
        Warranty starts
        <input
          type="date"
          name="warrantyStartDate"
          defaultValue={dateOnly(asset?.warrantyStartDate ?? null)}
        />
      </label>
      <label>
        Warranty ends
        <input
          type="date"
          name="warrantyEndDate"
          defaultValue={dateOnly(asset?.warrantyEndDate ?? null)}
        />
      </label>
      <label>
        Depreciation
        <select name="depreciationMethod" defaultValue={asset?.depreciationMethod ?? "none"}>
          {assetDepreciationMethods.map((method) => (
            <option key={method} value={method}>
              {assetDepreciationMethodLabels[method]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Depreciation starts
        <input
          type="date"
          name="depreciationStartDate"
          defaultValue={dateOnly(asset?.depreciationStartDate ?? null)}
        />
      </label>
      <label>
        Useful life (months)
        <input
          type="number"
          min={0}
          max={1200}
          name="usefulLifeMonths"
          defaultValue={asset?.usefulLifeMonths ?? ""}
        />
      </label>
      <label>
        Salvage value (minor units)
        <input
          type="number"
          min={0}
          name="salvageValueMinor"
          defaultValue={asset?.salvageValueMinor ?? ""}
        />
      </label>
      <label className="asset-form__wide">
        Notes
        <textarea
          name="notes"
          minLength={2}
          maxLength={4000}
          rows={3}
          defaultValue={asset?.notes ?? ""}
        />
      </label>
    </>
  );
}

function CreateAssetForm({ data }: { data: AssetWorkspaceData }) {
  const [state, action, pending] = useActionState(createAssetAction, initialState);
  return (
    <form action={action} className="asset-form asset-form--create">
      <MetadataFields data={data} />
      <div className="asset-form__wide asset-form__actions">
        <button
          className="button button--primary"
          type="submit"
          disabled={pending || data.categories.length === 0}
        >
          Register asset
        </button>
        <AssetActionMessage state={state} />
      </div>
    </form>
  );
}

function UpdateAssetForm({ asset, data }: { asset: AssetSummary; data: AssetWorkspaceData }) {
  const [state, action, pending] = useActionState(updateAssetAction, initialState);
  return (
    <form action={action} className="asset-form asset-form--compact">
      <input type="hidden" name="assetId" value={asset.id} />
      <MetadataFields data={data} asset={asset} />
      <div className="asset-form__wide asset-form__actions">
        <button className="button button--secondary" type="submit" disabled={pending}>
          Save metadata
        </button>
        <AssetActionMessage state={state} />
      </div>
    </form>
  );
}

function AssignmentControls({ asset, data }: { asset: AssetSummary; data: AssetWorkspaceData }) {
  const [assignState, assignAction, assigning] = useActionState(assignAssetAction, initialState);
  const [ackState, ackAction, acknowledging] = useActionState(acknowledgeAssetAction, initialState);
  const [returnState, returnAction, returning] = useActionState(returnAssetAction, initialState);
  if (asset.activeAssignment) {
    return (
      <div className="asset-control-stack">
        <div className="asset-current-assignment">
          <strong>{asset.activeAssignment.memberName}</strong>
          <span>Checked out {formatDateTime(asset.activeAssignment.checkoutAt)}</span>
          <span>Expected return {formatDateTime(asset.activeAssignment.expectedReturnAt)}</span>
          <span>
            {asset.activeAssignment.acknowledgedAt
              ? `Acknowledged ${formatDateTime(asset.activeAssignment.acknowledgedAt)}`
              : "Awaiting employee acknowledgement"}
          </span>
        </div>
        {asset.canAcknowledge && !asset.activeAssignment.acknowledgedAt ? (
          <form action={ackAction} className="asset-inline-action">
            <input type="hidden" name="assetId" value={asset.id} />
            <button className="button button--secondary" type="submit" disabled={acknowledging}>
              Acknowledge receipt
            </button>
            <AssetActionMessage state={ackState} />
          </form>
        ) : null}
        {asset.canAssign ? (
          <form action={returnAction} className="asset-form asset-form--compact">
            <input type="hidden" name="assetId" value={asset.id} />
            <label>
              Returned at
              <input
                type="datetime-local"
                name="returnedAt"
                required
                defaultValue={toDateTimeLocalValue(data.generatedAt)}
              />
            </label>
            <label>
              Return condition
              <select name="condition" defaultValue={asset.condition}>
                {assetConditions.map((condition) => (
                  <option key={condition} value={condition}>
                    {assetConditionLabels[condition]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Next status
              <select name="nextStatus" defaultValue="available">
                {(["available", "under_repair", "lost", "stolen", "retired"] as const).map(
                  (status) => (
                    <option key={status} value={status}>
                      {assetStatusLabels[status]}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="asset-form__wide">
              Return notes
              <textarea name="notes" minLength={2} maxLength={2000} rows={2} />
            </label>
            <div className="asset-form__wide asset-form__actions">
              <button className="button button--secondary" type="submit" disabled={returning}>
                Record return
              </button>
              <AssetActionMessage state={returnState} />
            </div>
          </form>
        ) : null}
      </div>
    );
  }
  if (
    !asset.canAssign ||
    ["disposed", "lost", "stolen", "retired", "under_repair"].includes(asset.status)
  ) {
    return <p className="asset-empty">No active assignment.</p>;
  }
  return (
    <form action={assignAction} className="asset-form asset-form--compact">
      <input type="hidden" name="assetId" value={asset.id} />
      <label>
        Employee
        <select name="membershipId" required defaultValue="">
          <option value="" disabled>
            Select employee
          </option>
          {data.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Checkout at
        <input
          type="datetime-local"
          name="checkoutAt"
          required
          defaultValue={toDateTimeLocalValue(data.generatedAt)}
        />
      </label>
      <label>
        Expected return
        <input type="datetime-local" name="expectedReturnAt" />
      </label>
      <label>
        Checkout condition
        <select name="condition" defaultValue={asset.condition}>
          {assetConditions.map((condition) => (
            <option key={condition} value={condition}>
              {assetConditionLabels[condition]}
            </option>
          ))}
        </select>
      </label>
      <label className="asset-form__wide">
        Checkout notes
        <textarea name="notes" minLength={2} maxLength={2000} rows={2} />
      </label>
      <div className="asset-form__wide asset-form__actions">
        <button className="button button--primary" type="submit" disabled={assigning}>
          Assign asset
        </button>
        <AssetActionMessage state={assignState} />
      </div>
    </form>
  );
}

function ConditionForm({ asset }: { asset: AssetSummary }) {
  const [state, action, pending] = useActionState(recordAssetConditionAction, initialState);
  return (
    <form action={action} className="asset-form asset-form--compact">
      <input type="hidden" name="assetId" value={asset.id} />
      <label>
        Condition
        <select name="condition" defaultValue={asset.condition}>
          {assetConditions.map((condition) => (
            <option key={condition} value={condition}>
              {assetConditionLabels[condition]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Record type
        <select name="eventType" defaultValue="inspection">
          <option value="inspection">Inspection</option>
          <option value="incident">Damage or missing incident</option>
        </select>
      </label>
      <label className="asset-form__wide">
        Notes
        <textarea name="notes" minLength={2} maxLength={2000} rows={2} />
      </label>
      <div className="asset-form__wide asset-form__actions">
        <button className="button button--secondary" type="submit" disabled={pending}>
          Record condition
        </button>
        <AssetActionMessage state={state} />
      </div>
    </form>
  );
}

function MaintenanceControls({ asset, generatedAt }: { asset: AssetSummary; generatedAt: string }) {
  const [createState, createAction, creating] = useActionState(
    createAssetMaintenanceAction,
    initialState,
  );
  return (
    <div className="asset-control-stack">
      <form action={createAction} className="asset-form asset-form--compact">
        <input type="hidden" name="assetId" value={asset.id} />
        <label>
          Maintenance type
          <select name="maintenanceType" defaultValue="inspection">
            {assetMaintenanceTypes.map((type) => (
              <option key={type} value={type}>
                {assetMaintenanceTypeLabels[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Provider
          <input name="provider" maxLength={180} />
        </label>
        <label>
          Scheduled at
          <input type="datetime-local" name="scheduledAt" />
        </label>
        <label>
          Cost (minor units)
          <input type="number" min={0} name="costMinor" />
        </label>
        <label>
          Currency
          <input
            name="currency"
            required
            pattern="[A-Za-z]{3}"
            maxLength={3}
            defaultValue={asset.currency}
          />
        </label>
        <label className="asset-check-label">
          <input type="checkbox" name="startNow" /> Start now and move asset under repair
        </label>
        <label className="asset-form__wide">
          Details
          <textarea name="details" required minLength={2} maxLength={4000} rows={2} />
        </label>
        <div className="asset-form__wide asset-form__actions">
          <button className="button button--secondary" type="submit" disabled={creating}>
            Add maintenance
          </button>
          <AssetActionMessage state={createState} />
        </div>
      </form>
      {asset.maintenance.map((record) =>
        ["scheduled", "in_progress"].includes(record.status) ? (
          <MaintenanceCompleteForm
            key={record.id}
            asset={asset}
            maintenanceId={record.id}
            label={`${record.maintenanceTypeLabel}: ${record.details}`}
            generatedAt={generatedAt}
          />
        ) : null,
      )}
    </div>
  );
}

function MaintenanceCompleteForm({
  asset,
  maintenanceId,
  label,
  generatedAt,
}: {
  asset: AssetSummary;
  maintenanceId: string;
  label: string;
  generatedAt: string;
}) {
  const [state, action, pending] = useActionState(completeAssetMaintenanceAction, initialState);
  return (
    <form action={action} className="asset-form asset-form--compact asset-maintenance-complete">
      <input type="hidden" name="assetId" value={asset.id} />
      <input type="hidden" name="maintenanceId" value={maintenanceId} />
      <p className="asset-form__wide">
        <strong>Complete:</strong> {label}
      </p>
      <label>
        Completed at
        <input
          type="datetime-local"
          name="completedAt"
          required
          defaultValue={toDateTimeLocalValue(generatedAt)}
        />
      </label>
      <label>
        Condition after
        <select name="conditionAfter" defaultValue={asset.condition}>
          {assetConditions.map((condition) => (
            <option key={condition} value={condition}>
              {assetConditionLabels[condition]}
            </option>
          ))}
        </select>
      </label>
      <label className="asset-form__wide">
        Outcome
        <textarea name="outcome" required minLength={2} maxLength={4000} rows={2} />
      </label>
      <div className="asset-form__wide asset-form__actions">
        <button className="button button--primary" type="submit" disabled={pending}>
          Complete maintenance
        </button>
        <AssetActionMessage state={state} />
      </div>
    </form>
  );
}

function DocumentLinkForm({ asset, data }: { asset: AssetSummary; data: AssetWorkspaceData }) {
  const [state, action, pending] = useActionState(attachAssetDocumentAction, initialState);
  return (
    <form action={action} className="asset-form asset-form--compact">
      <input type="hidden" name="assetId" value={asset.id} />
      <label className="asset-form__wide">
        Document
        <select name="documentId" required defaultValue="">
          <option value="" disabled>
            Select a document
          </option>
          {data.documents.map((document) => (
            <option key={document.id} value={document.id}>
              {document.title}
            </option>
          ))}
        </select>
      </label>
      <div className="asset-form__wide asset-form__actions">
        <button
          className="button button--secondary"
          type="submit"
          disabled={pending || data.documents.length === 0}
        >
          Link document
        </button>
        <AssetActionMessage state={state} />
      </div>
    </form>
  );
}

function DisposalForm({ asset, generatedAt }: { asset: AssetSummary; generatedAt: string }) {
  const [state, action, pending] = useActionState(disposeAssetAction, initialState);
  return (
    <form action={action} className="asset-form asset-form--compact asset-form--danger">
      <input type="hidden" name="assetId" value={asset.id} />
      <label>
        Disposal date
        <input type="date" name="disposalDate" required defaultValue={generatedAt.slice(0, 10)} />
      </label>
      <label>
        Method
        <select name="method" defaultValue="recycled">
          <option value="recycled">Recycled</option>
          <option value="sold">Sold</option>
          <option value="donated">Donated</option>
          <option value="destroyed">Destroyed</option>
          <option value="returned_to_vendor">Returned to vendor</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>
        Recovery value (minor units)
        <input type="number" min={0} name="valueMinor" />
      </label>
      <label className="asset-form__wide">
        Reason
        <textarea name="reason" required minLength={2} maxLength={2000} rows={2} />
      </label>
      <div className="asset-form__wide asset-form__actions">
        <button className="button button--danger" type="submit" disabled={pending}>
          Record disposal
        </button>
        <AssetActionMessage state={state} />
      </div>
    </form>
  );
}

function AssetHistory({ asset }: { asset: AssetSummary }) {
  return (
    <div className="asset-history-grid">
      <section>
        <h4>Condition history</h4>
        {asset.conditionHistory.length ? (
          <ol className="asset-timeline">
            {asset.conditionHistory.map((event) => (
              <li key={event.id}>
                <strong>{event.conditionLabel}</strong> · {event.eventType.replaceAll("_", " ")}
                <span>
                  {formatDateTime(event.createdAt)} · {event.recordedByName}
                </span>
                {event.notes ? <p>{event.notes}</p> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="asset-empty">No condition history.</p>
        )}
      </section>
      <section>
        <h4>Maintenance</h4>
        {asset.maintenance.length ? (
          <ol className="asset-timeline">
            {asset.maintenance.map((record) => (
              <li key={record.id}>
                <strong>{record.maintenanceTypeLabel}</strong> · {record.statusLabel}
                <span>
                  {formatDateTime(record.completedAt ?? record.startedAt ?? record.scheduledAt)}
                </span>
                <p>{record.details}</p>
                {record.outcome ? <p>Outcome: {record.outcome}</p> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="asset-empty">No maintenance records.</p>
        )}
      </section>
      <section>
        <h4>Documents</h4>
        {asset.documents.length ? (
          <ul className="asset-link-list">
            {asset.documents.map((document) => (
              <li key={document.id}>
                {document.canOpen ? (
                  <Link href="/documents">{document.title}</Link>
                ) : (
                  document.title
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="asset-empty">No linked documents.</p>
        )}
      </section>
      <section>
        <h4>Lifecycle</h4>
        {asset.events.length ? (
          <ol className="asset-timeline">
            {asset.events.map((event) => (
              <li key={event.id}>
                <strong>{event.eventType.replaceAll("assets.", "").replaceAll("_", " ")}</strong>
                <span>
                  {formatDateTime(event.createdAt)}
                  {event.actorName ? ` · ${event.actorName}` : ""}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="asset-empty">No lifecycle events.</p>
        )}
      </section>
    </div>
  );
}

function AssetCard({ asset, data }: { asset: AssetSummary; data: AssetWorkspaceData }) {
  return (
    <article className="asset-card">
      <header className="asset-card__header">
        <div>
          <p className="asset-card__eyebrow">
            {asset.assetTag} · {asset.categoryName}
          </p>
          <h2>{asset.name}</h2>
          <p>
            {[asset.manufacturer, asset.model, asset.serialNumber].filter(Boolean).join(" · ") ||
              "No model or serial details"}
          </p>
        </div>
        <div className="asset-card__badges">
          <span className={`asset-badge asset-badge--${asset.status}`}>{asset.statusLabel}</span>
          <span className={`asset-badge asset-badge--condition-${asset.condition}`}>
            {asset.conditionLabel}
          </span>
        </div>
      </header>
      <dl className="asset-facts">
        <div>
          <dt>Assigned to</dt>
          <dd>{asset.activeAssignment?.memberName ?? "Available pool"}</dd>
        </div>
        <div>
          <dt>Ownership</dt>
          <dd>{asset.ownershipTypeLabel}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{asset.location ?? "—"}</dd>
        </div>
        <div>
          <dt>Warranty</dt>
          <dd>
            {asset.warrantyState === "none"
              ? "No warranty date"
              : `${asset.warrantyState} · ${formatDate(asset.warrantyEndDate)}`}
          </dd>
        </div>
        <div>
          <dt>Purchase value</dt>
          <dd>{formatMoneyMinor(asset.purchasePriceMinor, asset.currency)}</dd>
        </div>
        <div>
          <dt>Estimated book value</dt>
          <dd>{formatMoneyMinor(asset.estimatedBookValueMinor, asset.currency)}</dd>
        </div>
      </dl>
      <div className="asset-card__sections">
        <details open={Boolean(asset.activeAssignment)}>
          <summary>Assignment and return</summary>
          <AssignmentControls asset={asset} data={data} />
        </details>
        {asset.canUpdate && asset.status !== "disposed" ? (
          <details>
            <summary>Metadata, warranty, and depreciation</summary>
            <UpdateAssetForm asset={asset} data={data} />
          </details>
        ) : null}
        {asset.canUpdate && asset.status !== "disposed" ? (
          <details>
            <summary>Condition and incidents</summary>
            <ConditionForm asset={asset} />
          </details>
        ) : null}
        {asset.canMaintain && asset.status !== "disposed" ? (
          <details>
            <summary>Maintenance</summary>
            <MaintenanceControls asset={asset} generatedAt={data.generatedAt} />
          </details>
        ) : null}
        {asset.canLinkDocument ? (
          <details>
            <summary>Documents</summary>
            <DocumentLinkForm asset={asset} data={data} />
          </details>
        ) : null}
        <details>
          <summary>Immutable history</summary>
          <AssetHistory asset={asset} />
        </details>
        {asset.canDispose && !asset.activeAssignment && asset.status !== "disposed" ? (
          <details>
            <summary>Disposal</summary>
            <DisposalForm asset={asset} generatedAt={data.generatedAt} />
          </details>
        ) : null}
      </div>
    </article>
  );
}

function AssetRequestForm({ data }: { data: AssetWorkspaceData }) {
  const [state, action, pending] = useActionState(createAssetRequestAction, initialState);
  return (
    <form action={action} className="asset-form">
      <label>
        Request type
        <select name="requestType" defaultValue="new_asset">
          {assetRequestTypes.map((type) => (
            <option key={type} value={type}>
              {assetRequestTypeLabels[type]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Category
        <select name="categoryId" required defaultValue="">
          <option value="" disabled>
            Select category
          </option>
          {data.categories.map((category) =>
            category.status === "active" ? (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ) : null,
          )}
        </select>
      </label>
      <label className="asset-form__wide">
        Title
        <input name="title" required minLength={2} maxLength={180} />
      </label>
      <label>
        Needed by
        <input type="date" name="neededByDate" />
      </label>
      <label>
        Expected return
        <input type="datetime-local" name="expectedReturnAt" />
      </label>
      <label className="asset-form__wide">
        Business justification
        <textarea name="justification" required minLength={10} maxLength={4000} rows={4} />
      </label>
      <div className="asset-form__wide asset-form__actions">
        <button className="button" type="submit" disabled={pending}>
          Create request
        </button>
        <AssetActionMessage state={state} />
      </div>
    </form>
  );
}

function AssetRequestActions({
  request,
  data,
}: {
  request: AssetWorkspaceData["assetRequests"][number];
  data: AssetWorkspaceData;
}) {
  const [submitState, submitAction, submitting] = useActionState(
    submitAssetRequestAction,
    initialState,
  );
  const [cancelState, cancelAction, cancelling] = useActionState(
    cancelAssetRequestAction,
    initialState,
  );
  const [fulfillState, fulfillAction, fulfilling] = useActionState(
    fulfillAssetRequestAction,
    initialState,
  );
  const candidates = data.assets.filter(
    (asset) =>
      asset.categoryId === request.categoryId && ["available", "received"].includes(asset.status),
  );
  return (
    <div className="asset-request__actions">
      {request.canSubmit ? (
        <form action={submitAction}>
          <input type="hidden" name="requestId" value={request.id} />
          <button className="button" type="submit" disabled={submitting}>
            Submit for approval
          </button>
          <AssetActionMessage state={submitState} />
        </form>
      ) : null}
      {request.canCancel ? (
        <form action={cancelAction}>
          <input type="hidden" name="requestId" value={request.id} />
          <button className="button button--secondary" type="submit" disabled={cancelling}>
            Cancel request
          </button>
          <AssetActionMessage state={cancelState} />
        </form>
      ) : null}
      {request.canFulfill ? (
        <form action={fulfillAction} className="asset-form asset-form--compact">
          <input type="hidden" name="requestId" value={request.id} />
          <label>
            Asset
            <select name="assetId" required defaultValue="">
              <option value="" disabled>
                Select matching Asset
              </option>
              {candidates.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.assetTag} · {asset.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Checkout
            <input
              type="datetime-local"
              name="checkoutAt"
              required
              defaultValue={toDateTimeLocalValue(data.generatedAt)}
            />
          </label>
          <label>
            Expected return
            <input
              type="datetime-local"
              name="expectedReturnAt"
              defaultValue={toDateTimeLocalValue(request.expectedReturnAt)}
            />
          </label>
          <label>
            Condition
            <select name="condition" defaultValue="good">
              {assetConditions.map((condition) => (
                <option key={condition} value={condition}>
                  {assetConditionLabels[condition]}
                </option>
              ))}
            </select>
          </label>
          <label className="asset-form__wide">
            Notes
            <textarea name="notes" rows={2} maxLength={2000} />
          </label>
          <div className="asset-form__wide asset-form__actions">
            <button className="button" type="submit" disabled={fulfilling || !candidates.length}>
              Fulfill request
            </button>
            <AssetActionMessage state={fulfillState} />
          </div>
        </form>
      ) : null}
    </div>
  );
}

function AssetRequestsPanel({ data }: { data: AssetWorkspaceData }) {
  return (
    <section className="asset-operations-panel">
      <header>
        <h2>Asset requests</h2>
        <span>{data.assetRequests.length}</span>
      </header>
      {data.capabilities.canCreateRequest ? (
        <details>
          <summary>Create an Asset request</summary>
          <AssetRequestForm data={data} />
        </details>
      ) : null}
      <div className="asset-request-list">
        {data.assetRequests.length ? (
          data.assetRequests.map((request) => (
            <article key={request.id} className="asset-request">
              <div>
                <p className="asset-card__eyebrow">
                  {request.requestKey} · {request.categoryName}
                </p>
                <h3>{request.title}</h3>
                <p>{request.justification}</p>
              </div>
              <dl className="asset-facts">
                <div>
                  <dt>Requester</dt>
                  <dd>{request.requesterName}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{request.requestTypeLabel}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{request.statusLabel}</dd>
                </div>
                <div>
                  <dt>Needed by</dt>
                  <dd>{formatDate(request.neededByDate)}</dd>
                </div>
              </dl>
              {request.fulfilledAssetTag ? (
                <p>
                  Fulfilled with <strong>{request.fulfilledAssetTag}</strong>.
                </p>
              ) : null}
              <AssetRequestActions request={request} data={data} />
            </article>
          ))
        ) : (
          <p className="asset-empty">No Asset requests in your scope.</p>
        )}
      </div>
    </section>
  );
}

function ReturnRequestActions({
  request,
}: {
  request: AssetWorkspaceData["returnRequests"][number];
}) {
  const [state, action, pending] = useActionState(updateAssetReturnRequestAction, initialState);
  return (
    <form action={action} className="asset-inline-actions">
      <input type="hidden" name="returnRequestId" value={request.id} />
      {request.canAcknowledge ? (
        <button
          className="button"
          type="submit"
          name="action"
          value="acknowledge"
          disabled={pending}
        >
          Acknowledge return
        </button>
      ) : null}
      {request.canCancel ? (
        <button
          className="button button--secondary"
          type="submit"
          name="action"
          value="cancel"
          disabled={pending}
        >
          Cancel return request
        </button>
      ) : null}
      <AssetActionMessage state={state} />
    </form>
  );
}

function ReturnRequestsPanel({ data }: { data: AssetWorkspaceData }) {
  const [state, action, pending] = useActionState(createAssetReturnRequestAction, initialState);
  const assigned = data.assets.filter((asset) => asset.activeAssignment);
  return (
    <section className="asset-operations-panel">
      <header>
        <h2>Asset returns</h2>
        <span>{data.returnRequests.length}</span>
      </header>
      {data.capabilities.canManageReturnRequests ? (
        <details>
          <summary>Request a manual return</summary>
          <form action={action} className="asset-form asset-form--compact">
            <label>
              Assigned Asset
              <select name="assetId" required defaultValue="">
                <option value="" disabled>
                  Select Asset
                </option>
                {assigned.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.assetTag} · {asset.activeAssignment?.memberName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Due at
              <input type="datetime-local" name="dueAt" required />
            </label>
            <label className="asset-form__wide">
              Notes
              <textarea name="notes" rows={2} maxLength={2000} />
            </label>
            <div className="asset-form__wide asset-form__actions">
              <button className="button" type="submit" disabled={pending}>
                Request return
              </button>
              <AssetActionMessage state={state} />
            </div>
          </form>
        </details>
      ) : null}
      <div className="asset-return-list">
        {data.returnRequests.length ? (
          data.returnRequests.map((request) => (
            <article key={request.id} className="asset-return-request">
              <div>
                <strong>{request.assetTag}</strong>
                <span>
                  {request.assetName} · {request.memberName}
                </span>
              </div>
              <div>
                <span>{request.reasonLabel}</span>
                <strong>{request.statusLabel}</strong>
                <span>Due {formatDateTime(request.dueAt)}</span>
              </div>
              <ReturnRequestActions request={request} />
            </article>
          ))
        ) : (
          <p className="asset-empty">No active return requests in your scope.</p>
        )}
      </div>
    </section>
  );
}

export function AssetsWorkspace({ data }: { data: AssetWorkspaceData }) {
  return (
    <div className="assets-workspace">
      <section className="asset-summary-grid" aria-label="Asset register summary">
        <div>
          <span>Total assets</span>
          <strong>{data.summary.total}</strong>
        </div>
        <div>
          <span>Available</span>
          <strong>{data.summary.available}</strong>
        </div>
        <div>
          <span>Assigned</span>
          <strong>{data.summary.assigned}</strong>
        </div>
        <div>
          <span>Under repair</span>
          <strong>{data.summary.maintenance}</strong>
        </div>
        <div>
          <span>Warranty attention</span>
          <strong>{data.summary.warrantyAttention}</strong>
        </div>
        <div>
          <span>Disposed</span>
          <strong>{data.summary.disposed}</strong>
        </div>
        <div>
          <span>Requests pending</span>
          <strong>{data.summary.pendingRequests}</strong>
        </div>
        <div>
          <span>Returns due</span>
          <strong>{data.summary.returnsDue}</strong>
        </div>
      </section>
      <AssetRequestsPanel data={data} />
      <ReturnRequestsPanel data={data} />
      {data.capabilities.canManageCategories ? (
        <details className="asset-admin-panel">
          <summary>Manage categories</summary>
          <AssetCategoryForm />
        </details>
      ) : null}
      {data.capabilities.canCreate ? (
        <details className="asset-admin-panel">
          <summary>Register an asset</summary>
          <CreateAssetForm data={data} />
        </details>
      ) : null}
      <section className="asset-register" aria-label="Asset register">
        {data.assets.length ? (
          data.assets.map((asset) => <AssetCard key={asset.id} asset={asset} data={data} />)
        ) : (
          <div className="asset-empty-state">
            <h2>No assets match these filters</h2>
            <p>Adjust the search or register the first organization asset.</p>
          </div>
        )}
      </section>
    </div>
  );
}
