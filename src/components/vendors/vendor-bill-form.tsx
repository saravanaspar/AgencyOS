"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { VendorActionMessage } from "@/components/vendors/vendors-action-message";
import { recordVendorBillAction } from "@/modules/vendors/actions/vendors";
import type { VendorActionState } from "@/modules/vendors/schemas/vendors";
import type { PurchaseOrderSummary, VendorWorkspaceData } from "@/modules/vendors/server/vendors";

const initialState: VendorActionState = { status: "idle", message: "" };

export function VendorBillForm({
  data,
  order,
}: {
  data: VendorWorkspaceData;
  order: PurchaseOrderSummary;
}) {
  const router = useRouter();
  const [state, setState] = useState<VendorActionState>(initialState);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const billData = new FormData(form);
    setPending(true);
    setState(initialState);

    try {
      const file = billData.get("billFile");
      if (file instanceof File && file.size > 0) {
        if (!data.capabilities.canUploadBillDocument) {
          setState({
            status: "error",
            message: "You do not have Documents permission to upload a new bill file.",
          });
          return;
        }
        const billReference = String(billData.get("billReference") ?? "").trim();
        const invoiceDate = String(billData.get("invoiceDate") ?? "").trim();
        const uploadData = new FormData();
        uploadData.set("file", file);
        uploadData.set("title", `${order.purchaseOrderKey} bill ${billReference || file.name}`);
        uploadData.set(
          "description",
          `Vendor bill source document for ${order.purchaseOrderKey} — ${order.vendorName}.`,
        );
        uploadData.set("documentDate", invoiceDate);
        uploadData.set("referenceCode", billReference);
        uploadData.set("folderId", "");
        uploadData.set("categoryId", "");
        uploadData.set("classification", data.capabilities.billDocumentClassification);
        uploadData.set("ownerMembershipId", data.currentMembershipId);
        uploadData.set("expiryDate", "");
        uploadData.set("reviewDate", "");
        uploadData.set("retentionUntil", "");
        uploadData.set("versionNote", `Source file recorded with vendor bill ${billReference}.`);
        uploadData.set("entityType", "purchase_order");
        uploadData.set("entityId", order.id);

        const response = await fetch("/api/documents/upload", {
          method: "POST",
          body: uploadData,
        });
        const result = (await response.json()) as { documentId?: string; message?: string };
        if (!response.ok || !result.documentId) {
          setState({
            status: "error",
            message: result.message ?? "The vendor bill document could not be uploaded.",
          });
          return;
        }
        billData.set("sourceDocumentId", result.documentId);
      }

      billData.delete("billFile");
      const result = await recordVendorBillAction(initialState, billData);
      setState(result);
      if (result.status === "success") {
        form.reset();
        router.refresh();
      }
    } catch {
      setState({ status: "error", message: "Vendor bill could not be recorded." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="vendor-form vendor-form--compact">
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
        Existing source document
        <select name="sourceDocumentId" defaultValue="">
          <option value="">None</option>
          {data.billSourceDocuments.map((document) => (
            <option key={document.id} value={document.id}>
              {document.title}
            </option>
          ))}
        </select>
      </label>
      {data.capabilities.canUploadBillDocument ? (
        <label className="vendor-form__wide">
          Upload new bill file
          <input
            name="billFile"
            type="file"
            accept="application/pdf,image/jpeg,image/png,text/plain,text/csv,.docx,.xlsx"
          />
          <small>
            Optional. If selected, AgencyOS creates and links a Documents record automatically, then
            queues the file for the normal quarantine and malware scan.
          </small>
        </label>
      ) : null}
      <div className="vendor-form__wide vendor-form__actions">
        <button type="submit" className="button button--secondary" disabled={pending}>
          {pending ? "Recording bill" : "Record bill"}
        </button>
        <VendorActionMessage state={state} />
      </div>
    </form>
  );
}
