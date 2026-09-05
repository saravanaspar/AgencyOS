import "server-only";

import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { documentPermissionKeys } from "@/modules/documents/documents";
import { legalPermissionKeys } from "@/modules/legal/legal";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import {
  getCurrentPermissionContext,
  type CurrentPermissionContext,
} from "@/modules/permissions/server/effective-permissions";
import { projectPermissionKeys } from "@/modules/projects/projects";
import {
  purchaseOrderStatusLabels,
  purchaseRequestStatusLabels,
  quotationStatusLabels,
  receiptConditionLabels,
  receiptStatusLabels,
  vendorBillMatchStatusLabels,
  vendorBillStatusLabels,
  vendorContractRelationshipLabels,
  vendorKey,
  vendorNoteTypeLabels,
  vendorPermissionKeys,
  vendorRiskLabels,
  vendorStatusLabels,
  purchaseOrderKey,
  purchaseRequestKey,
  goodsReceiptKey,
  type PurchaseOrderStatus,
  type PurchaseRequestStatus,
  type QuotationStatus,
  type ReceiptCondition,
  type ReceiptStatus,
  type VendorBillMatchStatus,
  type VendorBillStatus,
  type VendorContractRelationshipType,
  type VendorNoteType,
  type VendorRiskClassification,
  type VendorStatus,
} from "@/modules/vendors/vendors";
import { getVendorBillWorkspaceRows } from "@/modules/vendors/server/vendor-bill-workspace";

export interface VendorCategorySummary {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
}

export interface VendorContactSummary {
  id: string;
  name: string;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  status: "active" | "inactive";
}

export interface VendorFinancialSummary {
  taxCountryCode: string | null;
  taxIdentifier: string | null;
  taxRegistrationName: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountLastFour: string | null;
  bankRoutingReference: string | null;
  paymentInstructions: string | null;
}

export interface VendorNoteSummary {
  id: string;
  noteType: VendorNoteType;
  noteTypeLabel: string;
  rating: number | null;
  content: string;
  createdByName: string;
  createdAt: string;
}

export interface VendorSummary {
  id: string;
  vendorNumber: number;
  vendorKey: string;
  legalName: string;
  displayName: string;
  primaryCategoryId: string | null;
  primaryCategoryName: string | null;
  categories: Array<{ id: string; name: string }>;
  status: VendorStatus;
  statusLabel: string;
  riskClassification: VendorRiskClassification;
  riskLabel: string;
  ownerMembershipId: string | null;
  ownerName: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  countryCode: string | null;
  defaultCurrency: string;
  paymentTermsDays: number;
  onboardingDate: string | null;
  nextReviewDate: string | null;
  financial: VendorFinancialSummary | null;
  contacts: VendorContactSummary[];
  notes: VendorNoteSummary[];
  contracts: Array<{
    id: string;
    contractId: string;
    title: string;
    relationshipType: VendorContractRelationshipType;
    relationshipLabel: string;
  }>;
  documents: Array<{
    id: string;
    title: string;
    currentVersionId: string | null;
    canOpen: boolean;
  }>;
  events: Array<{ id: string; eventType: string; actorName: string | null; createdAt: string }>;
  canUpdate: boolean;
  canViewSensitive: boolean;
  canNote: boolean;
  canLinkContract: boolean;
  canLinkDocument: boolean;
}

export interface PurchaseRequestItemSummary {
  id: string;
  description: string;
  specifications: string | null;
  quantity: number;
  unit: string;
  estimatedUnitPriceMinor: number;
  estimatedLineTotalMinor: number;
}

export interface VendorQuotationSummary {
  id: string;
  vendorId: string;
  vendorName: string;
  quotationReference: string;
  quotedOn: string;
  validUntil: string | null;
  subtotalMinor: number;
  taxMinor: number;
  shippingMinor: number;
  totalMinor: number;
  currency: string;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  notes: string | null;
  sourceDocumentId: string | null;
  sourceDocumentTitle: string | null;
  status: QuotationStatus;
  statusLabel: string;
}

export interface PurchaseRequestSummary {
  id: string;
  requestNumber: number;
  requestKey: string;
  title: string;
  businessJustification: string;
  requesterMembershipId: string;
  requesterName: string;
  departmentId: string | null;
  departmentName: string | null;
  projectId: string | null;
  projectName: string | null;
  budgetMinor: number;
  currency: string;
  requiredByDate: string | null;
  status: PurchaseRequestStatus;
  statusLabel: string;
  approvalRequestId: string | null;
  selectedVendorId: string | null;
  selectedVendorName: string | null;
  selectedQuotationId: string | null;
  items: PurchaseRequestItemSummary[];
  quotations: VendorQuotationSummary[];
  createdAt: string;
  updatedAt: string;
  canSubmit: boolean;
  canManage: boolean;
  canManageQuotations: boolean;
}

export interface PurchaseOrderItemSummary {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceMinor: number;
  lineTotalMinor: number;
  quantityReceived: number;
  quantityOutstanding: number;
}

export interface GoodsReceiptSummary {
  id: string;
  receiptNumber: number;
  receiptKey: string;
  receivedAt: string;
  deliveryReference: string | null;
  status: ReceiptStatus;
  statusLabel: string;
  notes: string | null;
  receivedByName: string;
  items: Array<{
    purchaseOrderItemId: string;
    description: string;
    quantityReceived: number;
    condition: ReceiptCondition;
    conditionLabel: string;
    notes: string | null;
  }>;
}

export interface VendorBillSummary {
  id: string;
  billReference: string;
  invoiceDate: string;
  dueDate: string | null;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  matchStatus: VendorBillMatchStatus;
  matchStatusLabel: string;
  status: VendorBillStatus;
  statusLabel: string;
  sourceDocumentId: string | null;
  sourceDocumentTitle: string | null;
  sourceDocumentCurrentVersionId: string | null;
  sourceDocumentCanOpen: boolean;
  approvalRequestId: string | null;
  paymentReference: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  canManagePayment: boolean;
  canSubmitApproval: boolean;
}

export interface PurchaseOrderSummary {
  id: string;
  purchaseOrderNumber: number;
  purchaseOrderKey: string;
  purchaseRequestId: string;
  purchaseRequestKey: string;
  requestTitle: string;
  vendorId: string;
  vendorName: string;
  selectedQuotationId: string | null;
  contractId: string | null;
  contractTitle: string | null;
  issueDate: string;
  expectedDeliveryDate: string | null;
  subtotalMinor: number;
  taxMinor: number;
  shippingMinor: number;
  totalMinor: number;
  currency: string;
  paymentTerms: string | null;
  deliveryAddress: string | null;
  status: PurchaseOrderStatus;
  statusLabel: string;
  items: PurchaseOrderItemSummary[];
  receipts: GoodsReceiptSummary[];
  bills: VendorBillSummary[];
  documents: Array<{
    id: string;
    title: string;
    currentVersionId: string | null;
    canOpen: boolean;
  }>;
  events: Array<{ id: string; eventType: string; actorName: string | null; createdAt: string }>;
  canRecordReceipt: boolean;
  canManageBill: boolean;
  canLinkDocument: boolean;
}

export interface VendorWorkspaceData {
  generatedAt: string;
  currentMembershipId: string;
  vendors: VendorSummary[];
  purchaseRequests: PurchaseRequestSummary[];
  purchaseOrders: PurchaseOrderSummary[];
  categories: VendorCategorySummary[];
  members: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  documents: Array<{ id: string; title: string }>;
  billSourceDocuments: Array<{ id: string; title: string }>;
  contracts: Array<{ id: string; title: string }>;
  summary: {
    activeVendors: number;
    highRiskVendors: number;
    pendingRequests: number;
    sourcingRequests: number;
    openPurchaseOrders: number;
    billsDue: number;
  };
  capabilities: {
    canCreateVendor: boolean;
    canManageCategories: boolean;
    canCreateRequest: boolean;
    canManageRequests: boolean;
    canManageQuotations: boolean;
    canManagePurchaseOrders: boolean;
    canRecordReceipt: boolean;
    canManageBills: boolean;
    canUploadBillDocument: boolean;
    billDocumentClassification: "internal" | "confidential";
  };
}

export type VendorWorkspaceResult =
  | { allowed: true; data: VendorWorkspaceData }
  | { allowed: false; reason: AuthorizationFailureReason };

export class VendorAccessError extends Error {}

export async function requireVendorAccess(
  context: CurrentPermissionContext,
  vendorId: string,
  permissionKey: string,
  sql: TransactionSql,
): Promise<void> {
  const rows = await sql<Array<{ allowed: boolean }>>`
    select private.vendor_membership_access_allowed(
      ${vendorId}::uuid, ${context.membership.id}::uuid, ${permissionKey}
    ) as allowed
  `;
  if (!rows[0]?.allowed) throw new VendorAccessError("Vendor is outside your permission scope.");
}

export async function requirePurchaseRequestAccess(
  context: CurrentPermissionContext,
  purchaseRequestId: string,
  permissionKey: string,
  sql: TransactionSql,
): Promise<void> {
  const rows = await sql<Array<{ allowed: boolean }>>`
    select private.purchase_request_membership_access_allowed(
      ${purchaseRequestId}::uuid, ${context.membership.id}::uuid, ${permissionKey}
    ) as allowed
  `;
  if (!rows[0]?.allowed) {
    throw new VendorAccessError("Purchase request is outside your permission scope.");
  }
}

export async function requirePurchaseOrderAccess(
  context: CurrentPermissionContext,
  purchaseOrderId: string,
  permissionKey: string,
  sql: TransactionSql,
): Promise<void> {
  const rows = await sql<Array<{ allowed: boolean }>>`
    select private.purchase_order_membership_access_allowed(
      ${purchaseOrderId}::uuid, ${context.membership.id}::uuid, ${permissionKey}
    ) as allowed
  `;
  if (!rows[0]?.allowed) {
    throw new VendorAccessError("Purchase order is outside your permission scope.");
  }
}

type VendorRow = {
  id: string;
  vendor_number: string | number;
  legal_name: string;
  display_name: string;
  primary_category_id: string | null;
  primary_category_name: string | null;
  status: VendorStatus;
  risk_classification: VendorRiskClassification;
  owner_membership_id: string | null;
  owner_name: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  country_code: string | null;
  default_currency: string;
  payment_terms_days: number;
  onboarding_date: string | null;
  next_review_date: string | null;
  can_update: boolean;
  can_sensitive: boolean;
  can_note: boolean;
  can_link_contract: boolean;
  can_link_document: boolean;
};

type ChildRow = { vendor_id: string };
type RequestChildRow = { purchase_request_id: string };
type OrderChildRow = { purchase_order_id: string };

function groupBy<T, K extends string>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const value = key(row);
    const values = grouped.get(value) ?? [];
    values.push(row);
    grouped.set(value, values);
  }
  return grouped;
}

export async function getVendorWorkspaceData(filters?: {
  query?: string;
  vendorStatus?: string;
  requestStatus?: string;
  purchaseOrderStatus?: string;
}): Promise<VendorWorkspaceResult> {
  const permissionResult = await getCurrentPermissionContext();
  if (!permissionResult.allowed) return permissionResult;
  const context = permissionResult.context;
  if (!context.permissions.has(vendorPermissionKeys.workspace)) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const query = filters?.query?.trim() ?? "";
  const search = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const vendorStatus = filters?.vendorStatus ?? "all";
  const requestStatus = filters?.requestStatus ?? "all";
  const purchaseOrderStatus = filters?.purchaseOrderStatus ?? "all";

  const vendorRows = context.permissions.has(vendorPermissionKeys.view)
    ? await database<VendorRow[]>`
        select vendor.id, vendor.vendor_number, vendor.legal_name, vendor.display_name,
          vendor.primary_category_id, category.name as primary_category_name,
          vendor.status, vendor.risk_classification, vendor.owner_membership_id,
          case when vendor.owner_membership_id is null then null
            else private.membership_display_name(vendor.owner_membership_id) end as owner_name,
          vendor.website, vendor.email, vendor.phone, vendor.address, vendor.country_code,
          vendor.default_currency, vendor.payment_terms_days, vendor.onboarding_date::text,
          vendor.next_review_date::text,
          private.vendor_membership_access_allowed(
            vendor.id, ${membershipId}::uuid, ${vendorPermissionKeys.update}
          ) as can_update,
          private.vendor_membership_access_allowed(
            vendor.id, ${membershipId}::uuid, ${vendorPermissionKeys.viewSensitive}
          ) as can_sensitive,
          private.vendor_membership_access_allowed(
            vendor.id, ${membershipId}::uuid, ${vendorPermissionKeys.note}
          ) as can_note,
          private.vendor_membership_access_allowed(
            vendor.id, ${membershipId}::uuid, ${vendorPermissionKeys.linkContract}
          ) as can_link_contract,
          private.vendor_membership_access_allowed(
            vendor.id, ${membershipId}::uuid, ${vendorPermissionKeys.linkDocument}
          ) as can_link_document
        from public.vendors vendor
        left join public.vendor_categories category on category.id = vendor.primary_category_id
        where vendor.organization_id = ${organizationId}::uuid
          and private.vendor_membership_access_allowed(
            vendor.id, ${membershipId}::uuid, ${vendorPermissionKeys.view}
          )
          and (${vendorStatus} = 'all' or vendor.status = ${vendorStatus})
          and (${query} = '' or vendor.display_name ilike ${search} escape '\\'
            or vendor.legal_name ilike ${search} escape '\\'
            or vendor.vendor_number::text ilike ${search} escape '\\'
            or coalesce(vendor.email, '') ilike ${search} escape '\\')
        order by vendor.display_name, vendor.vendor_number
        limit 500
      `
    : [];
  const vendorIds = vendorRows.map((row) => row.id);

  const canReadSensitive = context.permissions.has(vendorPermissionKeys.viewSensitive);
  const canReadNotes = context.permissions.has(vendorPermissionKeys.note);
  const [
    categoryRows,
    contactRows,
    categoryLinkRows,
    financialRows,
    contractRows,
    vendorDocumentRows,
    noteRows,
    vendorEventRows,
  ] = await Promise.all([
    database<VendorCategorySummary[]>`
        select id, name, description, status
        from public.vendor_categories
        where organization_id = ${organizationId}::uuid
        order by status, name
      `,
    vendorIds.length
      ? database<
          Array<
            ChildRow & {
              id: string;
              name: string;
              role_title: string | null;
              email: string | null;
              phone: string | null;
              is_primary: boolean;
              status: "active" | "inactive";
            }
          >
        >`
            select id, vendor_id, name, role_title, email, phone, is_primary, status
            from public.vendor_contacts where vendor_id = any(${vendorIds}::uuid[])
            order by is_primary desc, name
          `
      : Promise.resolve([]),
    vendorIds.length
      ? database<Array<ChildRow & { id: string; name: string }>>`
            select link.vendor_id, category.id, category.name
            from public.vendor_category_links link
            join public.vendor_categories category on category.id = link.category_id
            where link.vendor_id = any(${vendorIds}::uuid[])
            order by category.name
          `
      : Promise.resolve([]),
    vendorIds.length && canReadSensitive
      ? database<
          Array<
            ChildRow & {
              tax_country_code: string | null;
              tax_identifier: string | null;
              tax_registration_name: string | null;
              bank_name: string | null;
              bank_account_name: string | null;
              bank_account_last_four: string | null;
              bank_routing_reference: string | null;
              payment_instructions: string | null;
            }
          >
        >`
            select vendor_id, tax_country_code, tax_identifier, tax_registration_name,
              bank_name, bank_account_name, bank_account_last_four,
              bank_routing_reference, payment_instructions
            from public.vendor_financial_profiles where vendor_id = any(${vendorIds}::uuid[])
          `
      : Promise.resolve([]),
    vendorIds.length
      ? database<
          Array<
            ChildRow & {
              id: string;
              contract_id: string;
              title: string;
              relationship_type: VendorContractRelationshipType;
            }
          >
        >`
            select link.vendor_id, link.id, link.contract_id, contract.title, link.relationship_type
            from public.vendor_contract_links link
            join public.legal_contracts contract on contract.id = link.contract_id
            where link.vendor_id = any(${vendorIds}::uuid[])
            order by contract.title
          `
      : Promise.resolve([]),
    vendorIds.length
      ? database<
          Array<
            ChildRow & {
              id: string;
              title: string;
              current_version_id: string | null;
              can_open: boolean;
            }
          >
        >`
            select link.entity_id as vendor_id, document.id, document.title,
              document.current_version_id,
              private.document_membership_access_allowed(
                document.id, ${membershipId}::uuid, 'download'
              ) as can_open
            from public.document_entity_links link
            join public.documents document on document.id = link.document_id
            where link.organization_id = ${organizationId}::uuid
              and link.entity_type = 'vendor' and link.entity_id = any(${vendorIds}::uuid[])
              and private.document_membership_access_allowed(
                document.id, ${membershipId}::uuid, 'view'
              )
            order by document.title
          `
      : Promise.resolve([]),
    vendorIds.length && canReadNotes
      ? database<
          Array<
            ChildRow & {
              id: string;
              note_type: VendorNoteType;
              rating: number | null;
              content: string;
              created_by_name: string;
              created_at: string;
            }
          >
        >`
            select note.vendor_id, note.id, note.note_type, note.rating, note.content,
              private.membership_display_name(note.created_by_membership_id) as created_by_name,
              note.created_at::text
            from public.vendor_notes note where note.vendor_id = any(${vendorIds}::uuid[])
            order by note.created_at desc
          `
      : Promise.resolve([]),
    vendorIds.length
      ? database<
          Array<
            ChildRow & {
              id: string;
              event_type: string;
              actor_name: string | null;
              created_at: string;
            }
          >
        >`
            select event.vendor_id, event.id, event.event_type,
              case when event.actor_membership_id is null then null
                else private.membership_display_name(event.actor_membership_id) end as actor_name,
              event.created_at::text
            from public.vendor_events event where event.vendor_id = any(${vendorIds}::uuid[])
            order by event.created_at desc
          `
      : Promise.resolve([]),
  ]);

  const requestRows = context.permissions.has(vendorPermissionKeys.requestView)
    ? await database<
        Array<{
          id: string;
          request_number: string | number;
          title: string;
          business_justification: string;
          requester_membership_id: string;
          requester_name: string;
          department_id: string | null;
          department_name: string | null;
          project_id: string | null;
          project_name: string | null;
          budget_minor: string | number;
          currency: string;
          required_by_date: string | null;
          status: PurchaseRequestStatus;
          approval_request_id: string | null;
          selected_vendor_id: string | null;
          selected_vendor_name: string | null;
          selected_quotation_id: string | null;
          created_at: string;
          updated_at: string;
          can_submit: boolean;
          can_manage: boolean;
          can_quotation: boolean;
        }>
      >`
        select request.id, request.request_number, request.title, request.business_justification,
          request.requester_membership_id,
          private.membership_display_name(request.requester_membership_id) as requester_name,
          request.department_id, department.name as department_name,
          request.project_id, project.name as project_name, request.budget_minor,
          request.currency, request.required_by_date::text, request.status,
          request.approval_request_id, request.selected_vendor_id,
          selected_vendor.display_name as selected_vendor_name, request.selected_quotation_id,
          request.created_at::text, request.updated_at::text,
          private.purchase_request_membership_access_allowed(
            request.id, ${membershipId}::uuid, ${vendorPermissionKeys.requestSubmit}
          ) as can_submit,
          private.purchase_request_membership_access_allowed(
            request.id, ${membershipId}::uuid, ${vendorPermissionKeys.requestManage}
          ) as can_manage,
          private.purchase_request_membership_access_allowed(
            request.id, ${membershipId}::uuid, ${vendorPermissionKeys.quotationManage}
          ) as can_quotation
        from public.procurement_purchase_requests request
        left join public.departments department on department.id = request.department_id
        left join public.projects project on project.id = request.project_id
        left join public.vendors selected_vendor on selected_vendor.id = request.selected_vendor_id
        where request.organization_id = ${organizationId}::uuid
          and private.purchase_request_membership_access_allowed(
            request.id, ${membershipId}::uuid, ${vendorPermissionKeys.requestView}
          )
          and (${requestStatus} = 'all' or request.status = ${requestStatus})
          and (${query} = '' or request.title ilike ${search} escape '\\'
            or request.request_number::text ilike ${search} escape '\\'
            or private.membership_display_name(request.requester_membership_id) ilike ${search} escape '\\')
        order by request.updated_at desc, request.request_number desc
        limit 500
      `
    : [];
  const requestIds = requestRows.map((row) => row.id);
  const [requestItemRows, quotationRows] = await Promise.all([
    requestIds.length
      ? database<
          Array<
            RequestChildRow & {
              id: string;
              description: string;
              specifications: string | null;
              quantity: string | number;
              unit: string;
              estimated_unit_price_minor: string | number;
            }
          >
        >`
          select purchase_request_id, id, description, specifications, quantity,
            unit, estimated_unit_price_minor
          from public.procurement_purchase_request_items
          where purchase_request_id = any(${requestIds}::uuid[])
          order by sort_order, id
        `
      : Promise.resolve([]),
    requestIds.length
      ? database<
          Array<
            RequestChildRow & {
              id: string;
              vendor_id: string;
              vendor_name: string;
              quotation_reference: string;
              quoted_on: string;
              valid_until: string | null;
              subtotal_minor: string | number;
              tax_minor: string | number;
              shipping_minor: string | number;
              total_minor: string | number;
              currency: string;
              lead_time_days: number | null;
              payment_terms: string | null;
              notes: string | null;
              source_document_id: string | null;
              source_document_title: string | null;
              status: QuotationStatus;
            }
          >
        >`
          select quotation.purchase_request_id, quotation.id, quotation.vendor_id,
            vendor.display_name as vendor_name, quotation.quotation_reference,
            quotation.quoted_on::text, quotation.valid_until::text,
            quotation.subtotal_minor, quotation.tax_minor, quotation.shipping_minor,
            quotation.total_minor, quotation.currency, quotation.lead_time_days,
            quotation.payment_terms, quotation.notes, quotation.source_document_id,
            document.title as source_document_title, quotation.status
          from public.procurement_vendor_quotations quotation
          join public.vendors vendor on vendor.id = quotation.vendor_id
          left join public.documents document on document.id = quotation.source_document_id
          where quotation.purchase_request_id = any(${requestIds}::uuid[])
          order by quotation.created_at desc
        `
      : Promise.resolve([]),
  ]);

  const purchaseOrderRows = context.permissions.has(vendorPermissionKeys.purchaseOrderView)
    ? await database<
        Array<{
          id: string;
          purchase_order_number: string | number;
          purchase_request_id: string;
          request_number: string | number;
          request_title: string;
          vendor_id: string;
          vendor_name: string;
          selected_quotation_id: string | null;
          contract_id: string | null;
          contract_title: string | null;
          issue_date: string;
          expected_delivery_date: string | null;
          subtotal_minor: string | number;
          tax_minor: string | number;
          shipping_minor: string | number;
          total_minor: string | number;
          currency: string;
          payment_terms: string | null;
          delivery_address: string | null;
          status: PurchaseOrderStatus;
          can_receipt: boolean;
          can_bill: boolean;
          can_link_document: boolean;
        }>
      >`
        select purchase_order.id, purchase_order.purchase_order_number,
          purchase_order.purchase_request_id, request.request_number,
          request.title as request_title, purchase_order.vendor_id,
          vendor.display_name as vendor_name, purchase_order.selected_quotation_id,
          purchase_order.contract_id, contract.title as contract_title,
          purchase_order.issue_date::text, purchase_order.expected_delivery_date::text,
          purchase_order.subtotal_minor, purchase_order.tax_minor,
          purchase_order.shipping_minor, purchase_order.total_minor,
          purchase_order.currency, purchase_order.payment_terms,
          purchase_order.delivery_address, purchase_order.status,
          private.purchase_order_membership_access_allowed(
            purchase_order.id, ${membershipId}::uuid, ${vendorPermissionKeys.receiptRecord}
          ) as can_receipt,
          private.purchase_order_membership_access_allowed(
            purchase_order.id, ${membershipId}::uuid, ${vendorPermissionKeys.billManage}
          ) as can_bill,
          private.purchase_order_membership_access_allowed(
            purchase_order.id, ${membershipId}::uuid, ${vendorPermissionKeys.purchaseOrderLinkDocument}
          ) as can_link_document
        from public.procurement_purchase_orders purchase_order
        join public.procurement_purchase_requests request on request.id = purchase_order.purchase_request_id
        join public.vendors vendor on vendor.id = purchase_order.vendor_id
        left join public.legal_contracts contract on contract.id = purchase_order.contract_id
        where purchase_order.organization_id = ${organizationId}::uuid
          and private.purchase_order_membership_access_allowed(
            purchase_order.id, ${membershipId}::uuid, ${vendorPermissionKeys.purchaseOrderView}
          )
          and (${purchaseOrderStatus} = 'all' or purchase_order.status = ${purchaseOrderStatus})
          and (${query} = '' or vendor.display_name ilike ${search} escape '\\'
            or request.title ilike ${search} escape '\\'
            or purchase_order.purchase_order_number::text ilike ${search} escape '\\')
        order by purchase_order.updated_at desc, purchase_order.purchase_order_number desc
        limit 500
      `
    : [];
  const purchaseOrderIds = purchaseOrderRows.map((row) => row.id);
  const [orderItemRows, receiptRows, receiptItemRows, billRows, orderDocumentRows, orderEventRows] =
    await Promise.all([
      purchaseOrderIds.length
        ? database<
            Array<
              OrderChildRow & {
                id: string;
                description: string;
                quantity: string | number;
                unit: string;
                unit_price_minor: string | number;
                quantity_received: string | number;
              }
            >
          >`
            select item.purchase_order_id, item.id, item.description, item.quantity,
              item.unit, item.unit_price_minor,
              coalesce(sum(case when receipt.status <> 'rejected' and receipt_item.condition <> 'rejected'
                then receipt_item.quantity_received else 0 end), 0) as quantity_received
            from public.procurement_purchase_order_items item
            left join public.procurement_goods_receipt_items receipt_item
              on receipt_item.purchase_order_item_id = item.id
            left join public.procurement_goods_receipts receipt
              on receipt.id = receipt_item.goods_receipt_id
            where item.purchase_order_id = any(${purchaseOrderIds}::uuid[])
            group by item.id
            order by item.sort_order, item.id
          `
        : Promise.resolve([]),
      purchaseOrderIds.length
        ? database<
            Array<
              OrderChildRow & {
                id: string;
                receipt_number: string | number;
                received_at: string;
                delivery_reference: string | null;
                status: ReceiptStatus;
                notes: string | null;
                received_by_name: string;
              }
            >
          >`
            select receipt.purchase_order_id, receipt.id, receipt.receipt_number,
              receipt.received_at::text, receipt.delivery_reference, receipt.status,
              receipt.notes,
              private.membership_display_name(receipt.received_by_membership_id) as received_by_name
            from public.procurement_goods_receipts receipt
            where receipt.purchase_order_id = any(${purchaseOrderIds}::uuid[])
            order by receipt.received_at desc
          `
        : Promise.resolve([]),
      purchaseOrderIds.length
        ? database<
            Array<{
              goods_receipt_id: string;
              purchase_order_item_id: string;
              description: string;
              quantity_received: string | number;
              condition: ReceiptCondition;
              notes: string | null;
            }>
          >`
            select receipt_item.goods_receipt_id, receipt_item.purchase_order_item_id,
              item.description, receipt_item.quantity_received, receipt_item.condition,
              receipt_item.notes
            from public.procurement_goods_receipt_items receipt_item
            join public.procurement_purchase_order_items item on item.id = receipt_item.purchase_order_item_id
            where item.purchase_order_id = any(${purchaseOrderIds}::uuid[])
            order by receipt_item.created_at
          `
        : Promise.resolve([]),
      getVendorBillWorkspaceRows({
        purchaseOrderIds,
        organizationId,
        membershipId,
      }),
      purchaseOrderIds.length
        ? database<
            Array<
              OrderChildRow & {
                id: string;
                title: string;
                current_version_id: string | null;
                can_open: boolean;
              }
            >
          >`
            select link.entity_id as purchase_order_id, document.id, document.title,
              document.current_version_id,
              private.document_membership_access_allowed(
                document.id, ${membershipId}::uuid, 'download'
              ) as can_open
            from public.document_entity_links link
            join public.documents document on document.id = link.document_id
            where link.organization_id = ${organizationId}::uuid
              and link.entity_type = 'purchase_order'
              and link.entity_id = any(${purchaseOrderIds}::uuid[])
              and private.document_membership_access_allowed(
                document.id, ${membershipId}::uuid, 'view'
              )
            order by document.title
          `
        : Promise.resolve([]),
      purchaseOrderIds.length
        ? database<
            Array<
              OrderChildRow & {
                id: string;
                event_type: string;
                actor_name: string | null;
                created_at: string;
              }
            >
          >`
            select event.purchase_order_id, event.id, event.event_type,
              case when event.actor_membership_id is null then null
                else private.membership_display_name(event.actor_membership_id) end as actor_name,
              event.created_at::text
            from public.procurement_events event
            where event.purchase_order_id = any(${purchaseOrderIds}::uuid[])
            order by event.created_at desc
          `
        : Promise.resolve([]),
    ]);

  const canLinkDocuments =
    context.permissions.has(documentPermissionKeys.update) &&
    (context.permissions.has(vendorPermissionKeys.linkDocument) ||
      context.permissions.has(vendorPermissionKeys.purchaseOrderLinkDocument));
  const canManageBills = context.permissions.has(vendorPermissionKeys.billManage);
  const canUploadBillDocument =
    canManageBills &&
    context.permissions.has(documentPermissionKeys.workspace) &&
    context.permissions.has(documentPermissionKeys.view) &&
    context.permissions.has(documentPermissionKeys.create);
  const billDocumentClassification =
    (context.permissionScopes.get(documentPermissionKeys.create) ?? "own") === "own"
      ? "internal"
      : "confidential";
  const canChooseBillSourceDocument =
    canManageBills &&
    context.permissions.has(documentPermissionKeys.workspace) &&
    context.permissions.has(documentPermissionKeys.view);
  const canLinkContracts =
    context.permissions.has(vendorPermissionKeys.linkContract) &&
    context.permissions.has(legalPermissionKeys.view);
  const canCreateRequest = context.permissions.has(vendorPermissionKeys.requestCreate);
  const projectScope = context.permissionScopes.get(projectPermissionKeys.projectView) ?? "own";
  const [members, departments, projects, documents, contracts, billSourceDocuments] =
    await Promise.all([
      context.permissions.has(vendorPermissionKeys.create) ||
      context.permissions.has(vendorPermissionKeys.update)
        ? database<Array<{ id: string; name: string }>>`
          select membership.id, private.membership_display_name(membership.id) as name
          from public.memberships membership
          where membership.organization_id = ${organizationId}::uuid and membership.status = 'active'
          order by name
        `
        : Promise.resolve([]),
      canCreateRequest
        ? database<Array<{ id: string; name: string }>>`
          select id, name from public.departments
          where organization_id = ${organizationId}::uuid and status = 'active'
          order by name
        `
        : Promise.resolve([]),
      canCreateRequest && context.permissions.has(projectPermissionKeys.projectView)
        ? database<Array<{ id: string; name: string }>>`
          select project.id, concat(project.code, ' — ', project.name) as name
          from public.projects project
          where project.organization_id = ${organizationId}::uuid and project.archived_at is null
            and private.crm_scope_allows_membership(
              ${membershipId}::uuid, ${projectScope}, project.owner_membership_id,
              project.created_by_membership_id
            )
          order by project.name
        `
        : Promise.resolve([]),
      canLinkDocuments
        ? database<Array<{ id: string; title: string }>>`
          select document.id, document.title from public.documents document
          where document.organization_id = ${organizationId}::uuid and document.status = 'active'
            and private.document_membership_access_allowed(
              document.id, ${membershipId}::uuid, 'edit'
            )
          order by document.updated_at desc limit 500
        `
        : Promise.resolve([]),
      canLinkContracts
        ? database<Array<{ id: string; title: string }>>`
          select contract.id, contract.title from public.legal_contracts contract
          where contract.organization_id = ${organizationId}::uuid
            and private.legal_contract_membership_access_allowed(
              contract.id, ${membershipId}::uuid, ${legalPermissionKeys.view}
            )
          order by contract.updated_at desc limit 500
        `
        : Promise.resolve([]),
      canChooseBillSourceDocument
        ? database<Array<{ id: string; title: string }>>`
          select document.id, document.title from public.documents document
          where document.organization_id = ${organizationId}::uuid and document.status = 'active'
            and private.document_membership_access_allowed(
              document.id, ${membershipId}::uuid, 'view'
            )
          order by document.updated_at desc limit 500
        `
        : Promise.resolve([]),
    ]);

  const contactsByVendor = groupBy(contactRows, (row) => row.vendor_id);
  const categoryLinksByVendor = groupBy(categoryLinkRows, (row) => row.vendor_id);
  const financialByVendor = new Map(financialRows.map((row) => [row.vendor_id, row]));
  const contractsByVendor = groupBy(contractRows, (row) => row.vendor_id);
  const documentsByVendor = groupBy(vendorDocumentRows, (row) => row.vendor_id);
  const notesByVendor = groupBy(noteRows, (row) => row.vendor_id);
  const eventsByVendor = groupBy(vendorEventRows, (row) => row.vendor_id);

  const vendors: VendorSummary[] = vendorRows.map((row) => {
    const financial = financialByVendor.get(row.id);
    return {
      id: row.id,
      vendorNumber: Number(row.vendor_number),
      vendorKey: vendorKey(Number(row.vendor_number)),
      legalName: row.legal_name,
      displayName: row.display_name,
      primaryCategoryId: row.primary_category_id,
      primaryCategoryName: row.primary_category_name,
      categories: (categoryLinksByVendor.get(row.id) ?? []).map((category) => ({
        id: category.id,
        name: category.name,
      })),
      status: row.status,
      statusLabel: vendorStatusLabels[row.status],
      riskClassification: row.risk_classification,
      riskLabel: vendorRiskLabels[row.risk_classification],
      ownerMembershipId: row.owner_membership_id,
      ownerName: row.owner_name,
      website: row.website,
      email: row.email,
      phone: row.phone,
      address: row.address,
      countryCode: row.country_code,
      defaultCurrency: row.default_currency,
      paymentTermsDays: row.payment_terms_days,
      onboardingDate: row.onboarding_date,
      nextReviewDate: row.next_review_date,
      financial: financial
        ? {
            taxCountryCode: financial.tax_country_code,
            taxIdentifier: financial.tax_identifier,
            taxRegistrationName: financial.tax_registration_name,
            bankName: financial.bank_name,
            bankAccountName: financial.bank_account_name,
            bankAccountLastFour: financial.bank_account_last_four,
            bankRoutingReference: financial.bank_routing_reference,
            paymentInstructions: financial.payment_instructions,
          }
        : null,
      contacts: (contactsByVendor.get(row.id) ?? []).map((contact) => ({
        id: contact.id,
        name: contact.name,
        roleTitle: contact.role_title,
        email: contact.email,
        phone: contact.phone,
        isPrimary: contact.is_primary,
        status: contact.status,
      })),
      notes: (notesByVendor.get(row.id) ?? []).map((note) => ({
        id: note.id,
        noteType: note.note_type,
        noteTypeLabel: vendorNoteTypeLabels[note.note_type],
        rating: note.rating,
        content: note.content,
        createdByName: note.created_by_name,
        createdAt: note.created_at,
      })),
      contracts: (contractsByVendor.get(row.id) ?? []).map((contract) => ({
        id: contract.id,
        contractId: contract.contract_id,
        title: contract.title,
        relationshipType: contract.relationship_type,
        relationshipLabel: vendorContractRelationshipLabels[contract.relationship_type],
      })),
      documents: (documentsByVendor.get(row.id) ?? []).map((document) => ({
        id: document.id,
        title: document.title,
        currentVersionId: document.current_version_id,
        canOpen: document.can_open,
      })),
      events: (eventsByVendor.get(row.id) ?? []).map((event) => ({
        id: event.id,
        eventType: event.event_type,
        actorName: event.actor_name,
        createdAt: event.created_at,
      })),
      canUpdate: row.can_update,
      canViewSensitive: row.can_sensitive,
      canNote: row.can_note,
      canLinkContract: row.can_link_contract && canLinkContracts,
      canLinkDocument: row.can_link_document && canLinkDocuments,
    };
  });

  const itemsByRequest = groupBy(requestItemRows, (row) => row.purchase_request_id);
  const quotationsByRequest = groupBy(quotationRows, (row) => row.purchase_request_id);
  const purchaseRequests: PurchaseRequestSummary[] = requestRows.map((row) => ({
    id: row.id,
    requestNumber: Number(row.request_number),
    requestKey: purchaseRequestKey(Number(row.request_number)),
    title: row.title,
    businessJustification: row.business_justification,
    requesterMembershipId: row.requester_membership_id,
    requesterName: row.requester_name,
    departmentId: row.department_id,
    departmentName: row.department_name,
    projectId: row.project_id,
    projectName: row.project_name,
    budgetMinor: Number(row.budget_minor),
    currency: row.currency,
    requiredByDate: row.required_by_date,
    status: row.status,
    statusLabel: purchaseRequestStatusLabels[row.status],
    approvalRequestId: row.approval_request_id,
    selectedVendorId: row.selected_vendor_id,
    selectedVendorName: row.selected_vendor_name,
    selectedQuotationId: row.selected_quotation_id,
    items: (itemsByRequest.get(row.id) ?? []).map((item) => {
      const quantity = Number(item.quantity);
      const estimatedUnitPriceMinor = Number(item.estimated_unit_price_minor);
      return {
        id: item.id,
        description: item.description,
        specifications: item.specifications,
        quantity,
        unit: item.unit,
        estimatedUnitPriceMinor,
        estimatedLineTotalMinor: Math.round(quantity * estimatedUnitPriceMinor),
      };
    }),
    quotations: (quotationsByRequest.get(row.id) ?? []).map((quotation) => ({
      id: quotation.id,
      vendorId: quotation.vendor_id,
      vendorName: quotation.vendor_name,
      quotationReference: quotation.quotation_reference,
      quotedOn: quotation.quoted_on,
      validUntil: quotation.valid_until,
      subtotalMinor: Number(quotation.subtotal_minor),
      taxMinor: Number(quotation.tax_minor),
      shippingMinor: Number(quotation.shipping_minor),
      totalMinor: Number(quotation.total_minor),
      currency: quotation.currency,
      leadTimeDays: quotation.lead_time_days,
      paymentTerms: quotation.payment_terms,
      notes: quotation.notes,
      sourceDocumentId: quotation.source_document_id,
      sourceDocumentTitle: quotation.source_document_title,
      status: quotation.status,
      statusLabel: quotationStatusLabels[quotation.status],
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canSubmit: row.can_submit,
    canManage: row.can_manage,
    canManageQuotations: row.can_quotation,
  }));

  const orderItemsByOrder = groupBy(orderItemRows, (row) => row.purchase_order_id);
  const receiptsByOrder = groupBy(receiptRows, (row) => row.purchase_order_id);
  const receiptItemsByReceipt = groupBy(receiptItemRows, (row) => row.goods_receipt_id);
  const billsByOrder = groupBy(billRows, (row) => row.purchase_order_id);
  const documentsByOrder = groupBy(orderDocumentRows, (row) => row.purchase_order_id);
  const eventsByOrder = groupBy(orderEventRows, (row) => row.purchase_order_id);

  const purchaseOrders: PurchaseOrderSummary[] = purchaseOrderRows.map((row) => ({
    id: row.id,
    purchaseOrderNumber: Number(row.purchase_order_number),
    purchaseOrderKey: purchaseOrderKey(Number(row.purchase_order_number)),
    purchaseRequestId: row.purchase_request_id,
    purchaseRequestKey: purchaseRequestKey(Number(row.request_number)),
    requestTitle: row.request_title,
    vendorId: row.vendor_id,
    vendorName: row.vendor_name,
    selectedQuotationId: row.selected_quotation_id,
    contractId: row.contract_id,
    contractTitle: row.contract_title,
    issueDate: row.issue_date,
    expectedDeliveryDate: row.expected_delivery_date,
    subtotalMinor: Number(row.subtotal_minor),
    taxMinor: Number(row.tax_minor),
    shippingMinor: Number(row.shipping_minor),
    totalMinor: Number(row.total_minor),
    currency: row.currency,
    paymentTerms: row.payment_terms,
    deliveryAddress: row.delivery_address,
    status: row.status,
    statusLabel: purchaseOrderStatusLabels[row.status],
    items: (orderItemsByOrder.get(row.id) ?? []).map((item) => {
      const quantity = Number(item.quantity);
      const unitPriceMinor = Number(item.unit_price_minor);
      const quantityReceived = Number(item.quantity_received);
      return {
        id: item.id,
        description: item.description,
        quantity,
        unit: item.unit,
        unitPriceMinor,
        lineTotalMinor: Math.round(quantity * unitPriceMinor),
        quantityReceived,
        quantityOutstanding: Math.max(0, quantity - quantityReceived),
      };
    }),
    receipts: (receiptsByOrder.get(row.id) ?? []).map((receipt) => ({
      id: receipt.id,
      receiptNumber: Number(receipt.receipt_number),
      receiptKey: goodsReceiptKey(Number(receipt.receipt_number)),
      receivedAt: receipt.received_at,
      deliveryReference: receipt.delivery_reference,
      status: receipt.status,
      statusLabel: receiptStatusLabels[receipt.status],
      notes: receipt.notes,
      receivedByName: receipt.received_by_name,
      items: (receiptItemsByReceipt.get(receipt.id) ?? []).map((item) => ({
        purchaseOrderItemId: item.purchase_order_item_id,
        description: item.description,
        quantityReceived: Number(item.quantity_received),
        condition: item.condition,
        conditionLabel: receiptConditionLabels[item.condition],
        notes: item.notes,
      })),
    })),
    bills: (billsByOrder.get(row.id) ?? []).map((bill) => ({
      id: bill.id,
      billReference: bill.bill_reference,
      invoiceDate: bill.invoice_date,
      dueDate: bill.due_date,
      subtotalMinor: Number(bill.subtotal_minor),
      taxMinor: Number(bill.tax_minor),
      totalMinor: Number(bill.total_minor),
      currency: bill.currency,
      matchStatus: bill.match_status,
      matchStatusLabel: vendorBillMatchStatusLabels[bill.match_status],
      status: bill.status,
      statusLabel: vendorBillStatusLabels[bill.status],
      sourceDocumentId: bill.source_document_id,
      sourceDocumentTitle: bill.source_document_title,
      sourceDocumentCurrentVersionId: bill.source_document_current_version_id,
      sourceDocumentCanOpen: bill.source_document_can_open,
      approvalRequestId: bill.approval_request_id,
      paymentReference: bill.payment_reference,
      approvedAt: bill.approved_at,
      paidAt: bill.paid_at,
      canManagePayment: bill.can_payment,
      canSubmitApproval: bill.can_submit_approval,
    })),
    documents: (documentsByOrder.get(row.id) ?? []).map((document) => ({
      id: document.id,
      title: document.title,
      currentVersionId: document.current_version_id,
      canOpen: document.can_open,
    })),
    events: (eventsByOrder.get(row.id) ?? []).map((event) => ({
      id: event.id,
      eventType: event.event_type,
      actorName: event.actor_name,
      createdAt: event.created_at,
    })),
    canRecordReceipt: row.can_receipt,
    canManageBill: row.can_bill,
    canLinkDocument: row.can_link_document && canLinkDocuments,
  }));

  return {
    allowed: true,
    data: {
      generatedAt: new Date().toISOString(),
      currentMembershipId: context.membership.id,
      vendors,
      purchaseRequests,
      purchaseOrders,
      categories: categoryRows,
      members,
      departments,
      projects,
      documents,
      billSourceDocuments,
      contracts,
      summary: {
        activeVendors: vendors.filter((vendor) => vendor.status === "active").length,
        highRiskVendors: vendors.filter((vendor) =>
          ["high", "critical"].includes(vendor.riskClassification),
        ).length,
        pendingRequests: purchaseRequests.filter((request) => request.status === "pending_approval")
          .length,
        sourcingRequests: purchaseRequests.filter((request) =>
          ["approved", "sourcing"].includes(request.status),
        ).length,
        openPurchaseOrders: purchaseOrders.filter((order) =>
          ["issued", "acknowledged", "partially_received"].includes(order.status),
        ).length,
        billsDue: purchaseOrders.reduce(
          (count, order) =>
            count + order.bills.filter((bill) => !["paid", "void"].includes(bill.status)).length,
          0,
        ),
      },
      capabilities: {
        canCreateVendor: context.permissions.has(vendorPermissionKeys.create),
        canManageCategories: context.permissions.has(vendorPermissionKeys.manageCategories),
        canCreateRequest,
        canManageRequests: context.permissions.has(vendorPermissionKeys.requestManage),
        canManageQuotations: context.permissions.has(vendorPermissionKeys.quotationManage),
        canManagePurchaseOrders: context.permissions.has(vendorPermissionKeys.purchaseOrderManage),
        canRecordReceipt: context.permissions.has(vendorPermissionKeys.receiptRecord),
        canManageBills,
        canUploadBillDocument,
        billDocumentClassification,
      },
    },
  };
}
