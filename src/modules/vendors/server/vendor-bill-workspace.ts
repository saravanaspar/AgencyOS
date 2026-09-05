import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import type { VendorBillMatchStatus, VendorBillStatus } from "@/modules/vendors/vendors";
import { vendorPermissionKeys } from "@/modules/vendors/vendors";

export interface VendorBillWorkspaceRow {
  purchase_order_id: string;
  id: string;
  bill_reference: string;
  invoice_date: string;
  due_date: string | null;
  subtotal_minor: string | number;
  tax_minor: string | number;
  total_minor: string | number;
  currency: string;
  match_status: VendorBillMatchStatus;
  status: VendorBillStatus;
  source_document_id: string | null;
  source_document_title: string | null;
  source_document_current_version_id: string | null;
  source_document_can_open: boolean;
  approval_request_id: string | null;
  payment_reference: string | null;
  approved_at: string | null;
  paid_at: string | null;
  can_payment: boolean;
  can_submit_approval: boolean;
}

export async function getVendorBillWorkspaceRows(input: {
  purchaseOrderIds: string[];
  organizationId: string;
  membershipId: string;
}): Promise<VendorBillWorkspaceRow[]> {
  if (!input.purchaseOrderIds.length) return [];
  const database = getDatabaseClient();
  return database<VendorBillWorkspaceRow[]>`
    select bill.purchase_order_id, bill.id, bill.bill_reference,
      bill.invoice_date::text, bill.due_date::text, bill.subtotal_minor,
      bill.tax_minor, bill.total_minor, bill.currency, bill.match_status,
      bill.status, bill.source_document_id, document.title as source_document_title,
      document.current_version_id as source_document_current_version_id,
      coalesce(private.document_membership_access_allowed(
        document.id, ${input.membershipId}::uuid, 'download'
      ), false) as source_document_can_open,
      bill.approval_request_id, bill.payment_reference, bill.approved_at::text, bill.paid_at::text,
      private.purchase_order_membership_access_allowed(
        bill.purchase_order_id, ${input.membershipId}::uuid, ${vendorPermissionKeys.billPayment}
      ) as can_payment,
      (bill.match_status = 'matched' and bill.status in ('matched', 'revision_requested', 'rejected') and
        private.purchase_order_membership_access_allowed(
          bill.purchase_order_id, ${input.membershipId}::uuid, ${vendorPermissionKeys.billSubmit}
        )) as can_submit_approval
    from public.procurement_vendor_bills bill
    left join public.documents document
      on document.id = bill.source_document_id
      and document.organization_id = ${input.organizationId}::uuid
    where bill.organization_id = ${input.organizationId}::uuid
      and bill.purchase_order_id = any(${input.purchaseOrderIds}::uuid[])
    order by bill.invoice_date desc, bill.created_at desc
  `;
}
