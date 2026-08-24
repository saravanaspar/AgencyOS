import "server-only";

import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  assetConditionLabels,
  assetDepreciationMethodLabels,
  assetMaintenanceStatusLabels,
  assetMaintenanceTypeLabels,
  assetOwnershipTypeLabels,
  assetPermissionKeys,
  assetStatusLabels,
  assetWarrantyState,
  straightLineBookValueMinor,
  assetRequestKey,
  assetRequestStatusLabels,
  assetRequestTypeLabels,
  assetReturnReasonLabels,
  assetReturnRequestStatusLabels,
  type AssetCategoryKind,
  type AssetCondition,
  type AssetDepreciationMethod,
  type AssetMaintenanceStatus,
  type AssetMaintenanceType,
  type AssetOwnershipType,
  type AssetStatus,
  type AssetRequestStatus,
  type AssetRequestType,
  type AssetReturnReason,
  type AssetReturnRequestStatus,
} from "@/modules/assets/assets";
import { documentPermissionKeys } from "@/modules/documents/documents";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import {
  getCurrentPermissionContext,
  type CurrentPermissionContext,
} from "@/modules/permissions/server/effective-permissions";

export interface AssetWorkspaceCategory {
  id: string;
  name: string;
  kind: AssetCategoryKind;
  description: string | null;
  status: "active" | "inactive";
}

export interface AssetAssignmentSummary {
  id: string;
  membershipId: string;
  memberName: string;
  checkoutAt: string;
  expectedReturnAt: string | null;
  checkoutCondition: AssetCondition;
  checkoutNotes: string | null;
  acknowledgedAt: string | null;
  returnedAt: string | null;
  returnCondition: AssetCondition | null;
  returnNotes: string | null;
  assignedByName: string;
  returnedByName: string | null;
}

export interface AssetConditionEventSummary {
  id: string;
  condition: AssetCondition;
  conditionLabel: string;
  eventType: string;
  notes: string | null;
  recordedByName: string;
  createdAt: string;
}

export interface AssetMaintenanceSummary {
  id: string;
  maintenanceType: AssetMaintenanceType;
  maintenanceTypeLabel: string;
  status: AssetMaintenanceStatus;
  statusLabel: string;
  provider: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  details: string;
  outcome: string | null;
  costMinor: number | null;
  currency: string;
  createdByName: string;
  completedByName: string | null;
}

export interface AssetSummary {
  id: string;
  assetTag: string;
  serialNumber: string | null;
  categoryId: string;
  categoryName: string;
  categoryKind: AssetCategoryKind;
  name: string;
  manufacturer: string | null;
  model: string | null;
  ownershipType: AssetOwnershipType;
  ownershipTypeLabel: string;
  ownerMembershipId: string | null;
  ownerName: string | null;
  vendorId: string | null;
  vendorName: string | null;
  purchaseDate: string | null;
  purchasePriceMinor: number | null;
  currency: string;
  warrantyProvider: string | null;
  warrantyStartDate: string | null;
  warrantyEndDate: string | null;
  warrantyReference: string | null;
  warrantyState: ReturnType<typeof assetWarrantyState>;
  location: string | null;
  status: AssetStatus;
  statusLabel: string;
  condition: AssetCondition;
  conditionLabel: string;
  depreciationMethod: AssetDepreciationMethod;
  depreciationMethodLabel: string;
  depreciationStartDate: string | null;
  usefulLifeMonths: number | null;
  salvageValueMinor: number | null;
  estimatedBookValueMinor: number | null;
  notes: string | null;
  disposalDate: string | null;
  disposalMethod: string | null;
  disposalReason: string | null;
  disposalValueMinor: number | null;
  activeAssignment: AssetAssignmentSummary | null;
  assignments: AssetAssignmentSummary[];
  conditionHistory: AssetConditionEventSummary[];
  maintenance: AssetMaintenanceSummary[];
  documents: Array<{
    id: string;
    title: string;
    currentVersionId: string | null;
    canOpen: boolean;
  }>;
  events: Array<{ id: string; eventType: string; actorName: string | null; createdAt: string }>;
  canUpdate: boolean;
  canAssign: boolean;
  canAcknowledge: boolean;
  canMaintain: boolean;
  canDispose: boolean;
  canLinkDocument: boolean;
}

export interface AssetRequestSummary {
  id: string;
  requestKey: string;
  requesterMembershipId: string;
  requesterName: string;
  categoryId: string;
  categoryName: string;
  requestType: AssetRequestType;
  requestTypeLabel: string;
  title: string;
  justification: string;
  neededByDate: string | null;
  expectedReturnAt: string | null;
  status: AssetRequestStatus;
  statusLabel: string;
  approvalRequestId: string | null;
  fulfilledAssetId: string | null;
  fulfilledAssetTag: string | null;
  createdAt: string;
  canSubmit: boolean;
  canCancel: boolean;
  canFulfill: boolean;
}

export interface AssetReturnRequestSummary {
  id: string;
  assetId: string;
  assetTag: string;
  assetName: string;
  membershipId: string;
  memberName: string;
  reason: AssetReturnReason;
  reasonLabel: string;
  dueAt: string;
  status: AssetReturnRequestStatus;
  statusLabel: string;
  notes: string | null;
  acknowledgedAt: string | null;
  completedAt: string | null;
  canAcknowledge: boolean;
  canCancel: boolean;
}

export interface AssetWorkspaceData {
  generatedAt: string;
  assets: AssetSummary[];
  categories: AssetWorkspaceCategory[];
  members: Array<{ id: string; name: string }>;
  vendors: Array<{ id: string; name: string }>;
  documents: Array<{ id: string; title: string }>;
  assetRequests: AssetRequestSummary[];
  returnRequests: AssetReturnRequestSummary[];
  summary: {
    total: number;
    available: number;
    assigned: number;
    maintenance: number;
    warrantyAttention: number;
    disposed: number;
    pendingRequests: number;
    returnsDue: number;
  };
  capabilities: {
    canCreate: boolean;
    canManageCategories: boolean;
    canAssign: boolean;
    canMaintain: boolean;
    canLinkDocument: boolean;
    canCreateRequest: boolean;
    canManageRequests: boolean;
    canManageReturnRequests: boolean;
  };
}

export type AssetWorkspaceResult =
  | { allowed: true; data: AssetWorkspaceData }
  | { allowed: false; reason: AuthorizationFailureReason };

export class AssetAccessError extends Error {}

export async function requireAssetAccess(
  context: CurrentPermissionContext,
  assetId: string,
  permissionKey: string,
  sql: TransactionSql,
): Promise<void> {
  const rows = await sql<Array<{ allowed: boolean }>>`
    select private.asset_membership_access_allowed(
      ${assetId}::uuid, ${context.membership.id}::uuid, ${permissionKey}
    ) as allowed
  `;
  if (!rows[0]?.allowed) throw new AssetAccessError("Asset is outside your permission scope.");
}

type AssetRow = {
  id: string;
  asset_tag: string;
  serial_number: string | null;
  category_id: string;
  category_name: string;
  category_kind: AssetCategoryKind;
  name: string;
  manufacturer: string | null;
  model: string | null;
  ownership_type: AssetOwnershipType;
  owner_membership_id: string | null;
  owner_name: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  purchase_date: string | null;
  purchase_price_minor: string | number | null;
  currency: string;
  warranty_provider: string | null;
  warranty_start_date: string | null;
  warranty_end_date: string | null;
  warranty_reference: string | null;
  location: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  depreciation_method: AssetDepreciationMethod;
  depreciation_start_date: string | null;
  useful_life_months: number | null;
  salvage_value_minor: string | number | null;
  notes: string | null;
  disposal_date: string | null;
  disposal_method: string | null;
  disposal_reason: string | null;
  disposal_value_minor: string | number | null;
  can_update: boolean;
  can_assign: boolean;
  can_acknowledge: boolean;
  can_maintain: boolean;
  can_dispose: boolean;
  can_link_document: boolean;
};

type AssignmentRow = {
  id: string;
  asset_id: string;
  membership_id: string;
  member_name: string;
  checkout_at: string;
  expected_return_at: string | null;
  checkout_condition: AssetCondition;
  checkout_notes: string | null;
  acknowledged_at: string | null;
  returned_at: string | null;
  return_condition: AssetCondition | null;
  return_notes: string | null;
  assigned_by_name: string;
  returned_by_name: string | null;
};

type ConditionRow = {
  id: string;
  asset_id: string;
  condition: AssetCondition;
  event_type: string;
  notes: string | null;
  recorded_by_name: string;
  created_at: string;
};

type MaintenanceRow = {
  id: string;
  asset_id: string;
  maintenance_type: AssetMaintenanceType;
  status: AssetMaintenanceStatus;
  provider: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  details: string;
  outcome: string | null;
  cost_minor: string | number | null;
  currency: string;
  created_by_name: string;
  completed_by_name: string | null;
};

type DocumentRow = {
  asset_id: string;
  id: string;
  title: string;
  current_version_id: string | null;
  can_open: boolean;
};

type EventRow = {
  id: string;
  asset_id: string;
  event_type: string;
  actor_name: string | null;
  created_at: string;
};

function groupRows<T extends { asset_id: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const values = grouped.get(row.asset_id) ?? [];
    values.push(row);
    grouped.set(row.asset_id, values);
  }
  return grouped;
}

function assignmentSummary(row: AssignmentRow): AssetAssignmentSummary {
  return {
    id: row.id,
    membershipId: row.membership_id,
    memberName: row.member_name,
    checkoutAt: row.checkout_at,
    expectedReturnAt: row.expected_return_at,
    checkoutCondition: row.checkout_condition,
    checkoutNotes: row.checkout_notes,
    acknowledgedAt: row.acknowledged_at,
    returnedAt: row.returned_at,
    returnCondition: row.return_condition,
    returnNotes: row.return_notes,
    assignedByName: row.assigned_by_name,
    returnedByName: row.returned_by_name,
  };
}

export async function getAssetWorkspaceData(filters?: {
  query?: string;
  status?: string;
  category?: string;
}): Promise<AssetWorkspaceResult> {
  const permissionResult = await getCurrentPermissionContext();
  if (!permissionResult.allowed) return permissionResult;
  const context = permissionResult.context;
  if (
    !context.permissions.has(assetPermissionKeys.workspace) ||
    !context.permissions.has(assetPermissionKeys.view)
  ) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const query = filters?.query?.trim() ?? "";
  const search = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const status = filters?.status ?? "all";
  const category = filters?.category ?? "all";

  const assetRows = await database<AssetRow[]>`
    select asset.id, asset.asset_tag, asset.serial_number, asset.category_id,
      category.name as category_name, category.kind as category_kind,
      asset.name, asset.manufacturer, asset.model, asset.ownership_type,
      asset.owner_membership_id,
      case when asset.owner_membership_id is null then null
        else private.membership_display_name(asset.owner_membership_id) end as owner_name,
      asset.vendor_id, vendor.display_name as vendor_name,
      asset.purchase_date::text, asset.purchase_price_minor, asset.currency,
      asset.warranty_provider, asset.warranty_start_date::text, asset.warranty_end_date::text,
      asset.warranty_reference, asset.location, asset.status, asset.condition,
      asset.depreciation_method, asset.depreciation_start_date::text,
      asset.useful_life_months, asset.salvage_value_minor, asset.notes,
      asset.disposal_date::text, asset.disposal_method, asset.disposal_reason,
      asset.disposal_value_minor,
      private.asset_membership_access_allowed(asset.id, ${membershipId}::uuid, ${assetPermissionKeys.update}) as can_update,
      private.asset_membership_access_allowed(asset.id, ${membershipId}::uuid, ${assetPermissionKeys.assign}) as can_assign,
      private.asset_membership_access_allowed(asset.id, ${membershipId}::uuid, ${assetPermissionKeys.acknowledge}) as can_acknowledge,
      private.asset_membership_access_allowed(asset.id, ${membershipId}::uuid, ${assetPermissionKeys.maintain}) as can_maintain,
      private.asset_membership_access_allowed(asset.id, ${membershipId}::uuid, ${assetPermissionKeys.dispose}) as can_dispose,
      private.asset_membership_access_allowed(asset.id, ${membershipId}::uuid, ${assetPermissionKeys.linkDocument}) as can_link_document
    from public.assets as asset
    join public.asset_categories as category on category.id = asset.category_id
    left join public.vendors as vendor on vendor.id = asset.vendor_id
    where asset.organization_id = ${organizationId}::uuid
      and private.asset_membership_access_allowed(
        asset.id, ${membershipId}::uuid, ${assetPermissionKeys.view}
      )
      and (${status} = 'all' or asset.status = ${status})
      and (${category} = 'all' or asset.category_id::text = ${category})
      and (${query} = '' or asset.asset_tag ilike ${search} escape '\\'
        or asset.name ilike ${search} escape '\\'
        or coalesce(asset.serial_number, '') ilike ${search} escape '\\'
        or coalesce(asset.manufacturer, '') ilike ${search} escape '\\'
        or coalesce(asset.model, '') ilike ${search} escape '\\'
        or coalesce(vendor.display_name, '') ilike ${search} escape '\\')
    order by case asset.status
      when 'assigned' then 1 when 'available' then 2 when 'under_repair' then 3
      when 'received' then 4 when 'ordered' then 5 when 'retired' then 6
      when 'lost' then 7 when 'stolen' then 8 else 9 end,
      asset.updated_at desc, asset.id desc
    limit 300
  `;
  const assetIds = assetRows.map((asset) => asset.id);

  const [assignmentRows, conditionRows, maintenanceRows, documentRows, eventRows, categoryRows] =
    await Promise.all([
      assetIds.length
        ? database<AssignmentRow[]>`
            select assignment.id, assignment.asset_id, assignment.membership_id,
              private.membership_display_name(assignment.membership_id) as member_name,
              assignment.checkout_at::text, assignment.expected_return_at::text,
              assignment.checkout_condition, assignment.checkout_notes,
              assignment.acknowledged_at::text, assignment.returned_at::text,
              assignment.return_condition, assignment.return_notes,
              private.membership_display_name(assignment.assigned_by_membership_id) as assigned_by_name,
              case when assignment.returned_by_membership_id is null then null
                else private.membership_display_name(assignment.returned_by_membership_id) end as returned_by_name
            from public.asset_assignments as assignment
            where assignment.asset_id = any(${assetIds}::uuid[])
            order by assignment.checkout_at desc, assignment.id desc
          `
        : Promise.resolve([]),
      assetIds.length
        ? database<ConditionRow[]>`
            select event.id, event.asset_id, event.condition, event.event_type, event.notes,
              private.membership_display_name(event.recorded_by_membership_id) as recorded_by_name,
              event.created_at::text
            from public.asset_condition_events as event
            where event.asset_id = any(${assetIds}::uuid[])
            order by event.created_at desc, event.id desc
          `
        : Promise.resolve([]),
      assetIds.length
        ? database<MaintenanceRow[]>`
            select maintenance.id, maintenance.asset_id, maintenance.maintenance_type,
              maintenance.status, maintenance.provider, maintenance.scheduled_at::text,
              maintenance.started_at::text, maintenance.completed_at::text,
              maintenance.details, maintenance.outcome, maintenance.cost_minor,
              maintenance.currency,
              private.membership_display_name(maintenance.created_by_membership_id) as created_by_name,
              case when maintenance.completed_by_membership_id is null then null
                else private.membership_display_name(maintenance.completed_by_membership_id) end as completed_by_name
            from public.asset_maintenance_records as maintenance
            where maintenance.asset_id = any(${assetIds}::uuid[])
            order by maintenance.created_at desc, maintenance.id desc
          `
        : Promise.resolve([]),
      assetIds.length
        ? database<DocumentRow[]>`
            select link.entity_id as asset_id, document.id, document.title,
              document.current_version_id,
              private.document_membership_access_allowed(
                document.id, ${membershipId}::uuid, 'download'
              ) as can_open
            from public.document_entity_links as link
            join public.documents as document on document.id = link.document_id
            where link.organization_id = ${organizationId}::uuid
              and link.entity_type = 'asset' and link.entity_id = any(${assetIds}::uuid[])
              and private.document_membership_access_allowed(
                document.id, ${membershipId}::uuid, 'view'
              )
            order by document.title
          `
        : Promise.resolve([]),
      assetIds.length
        ? database<EventRow[]>`
            select event.id, event.asset_id, event.event_type,
              case when event.actor_membership_id is null then null
                else private.membership_display_name(event.actor_membership_id) end as actor_name,
              event.created_at::text
            from public.asset_events as event
            where event.asset_id = any(${assetIds}::uuid[])
            order by event.created_at desc, event.id desc
          `
        : Promise.resolve([]),
      database<
        Array<{
          id: string;
          name: string;
          kind: AssetCategoryKind;
          description: string | null;
          status: "active" | "inactive";
        }>
      >`
        select id, name, kind, description, status
        from public.asset_categories
        where organization_id = ${organizationId}::uuid
        order by status, name
      `,
    ]);

  const canAssign = context.permissions.has(assetPermissionKeys.assign);
  const canCreate = context.permissions.has(assetPermissionKeys.create);
  const canLinkDocument =
    context.permissions.has(assetPermissionKeys.linkDocument) &&
    context.permissions.has(documentPermissionKeys.update);
  const canCreateRequest = context.permissions.has(assetPermissionKeys.requestCreate);
  const canManageRequests = context.permissions.has(assetPermissionKeys.requestManage);
  const canManageReturnRequests = context.permissions.has(assetPermissionKeys.returnRequestManage);
  const [members, vendors, documents, requestRows, returnRequestRows] = await Promise.all([
    canAssign || canCreate
      ? database<Array<{ id: string; name: string }>>`
        select membership.id, private.membership_display_name(membership.id) as name
        from public.memberships as membership
        where membership.organization_id = ${organizationId}::uuid
          and membership.status = 'active'
        order by name
      `
      : Promise.resolve([]),
    canCreate
      ? database<Array<{ id: string; name: string }>>`
        select vendor.id, vendor.display_name as name
        from public.vendors vendor
        where vendor.organization_id = ${organizationId}::uuid
          and vendor.status not in ('blocked', 'archived')
        order by vendor.display_name
      `
      : Promise.resolve([]),
    canLinkDocument
      ? database<Array<{ id: string; title: string }>>`
        select document.id, document.title
        from public.documents as document
        where document.organization_id = ${organizationId}::uuid
          and document.status = 'active'
          and private.document_membership_access_allowed(
            document.id, ${membershipId}::uuid, 'edit'
          )
        order by document.updated_at desc limit 500
      `
      : Promise.resolve([]),
    context.permissions.has(assetPermissionKeys.requestView)
      ? database<
          Array<{
            id: string;
            request_number: string | number;
            requester_membership_id: string;
            requester_name: string;
            category_id: string;
            category_name: string;
            request_type: AssetRequestType;
            title: string;
            justification: string;
            needed_by_date: string | null;
            expected_return_at: string | null;
            status: AssetRequestStatus;
            approval_request_id: string | null;
            fulfilled_asset_id: string | null;
            fulfilled_asset_tag: string | null;
            created_at: string;
            can_submit: boolean;
            can_cancel: boolean;
            can_fulfill: boolean;
          }>
        >`
          select request.id, request.request_number, request.requester_membership_id,
            private.membership_display_name(request.requester_membership_id) as requester_name,
            request.category_id, category.name as category_name, request.request_type, request.title,
            request.justification, request.needed_by_date::text, request.expected_return_at::text, request.status,
            request.approval_request_id, request.fulfilled_asset_id, asset.asset_tag as fulfilled_asset_tag,
            request.created_at::text,
            (request.requester_membership_id = ${membershipId}::uuid and request.status in ('draft', 'revision_requested', 'rejected')
              and private.asset_request_membership_access_allowed(request.id, ${membershipId}::uuid, ${assetPermissionKeys.requestSubmit})) as can_submit,
            (request.requester_membership_id = ${membershipId}::uuid and request.status in ('draft', 'revision_requested', 'rejected')
              and private.asset_request_membership_access_allowed(request.id, ${membershipId}::uuid, ${assetPermissionKeys.requestCancel})) as can_cancel,
            (request.status = 'approved' and private.asset_request_membership_access_allowed(
              request.id, ${membershipId}::uuid, ${assetPermissionKeys.requestManage})) as can_fulfill
          from public.asset_requests request
          join public.asset_categories category on category.id = request.category_id
          left join public.assets asset on asset.id = request.fulfilled_asset_id
          where request.organization_id = ${organizationId}::uuid
            and private.asset_request_membership_access_allowed(request.id, ${membershipId}::uuid, ${assetPermissionKeys.requestView})
          order by request.updated_at desc, request.id desc limit 300
        `
      : Promise.resolve([]),
    context.permissions.has(assetPermissionKeys.returnRequestView)
      ? database<
          Array<{
            id: string;
            asset_id: string;
            asset_tag: string;
            asset_name: string;
            membership_id: string;
            member_name: string;
            reason: AssetReturnReason;
            due_at: string;
            status: AssetReturnRequestStatus;
            notes: string | null;
            acknowledged_at: string | null;
            completed_at: string | null;
            can_acknowledge: boolean;
            can_cancel: boolean;
          }>
        >`
          select request.id, request.asset_id, asset.asset_tag, asset.name as asset_name, request.membership_id,
            private.membership_display_name(request.membership_id) as member_name, request.reason, request.due_at::text,
            request.status, request.notes, request.acknowledged_at::text, request.completed_at::text,
            (request.membership_id = ${membershipId}::uuid and request.status in ('pending', 'overdue') and
              private.asset_return_request_membership_access_allowed(request.id, ${membershipId}::uuid, ${assetPermissionKeys.returnRequestAcknowledge})) as can_acknowledge,
            (request.status in ('pending', 'acknowledged', 'overdue') and
              private.asset_return_request_membership_access_allowed(request.id, ${membershipId}::uuid, ${assetPermissionKeys.returnRequestManage})) as can_cancel
          from public.asset_return_requests request
          join public.assets asset on asset.id = request.asset_id
          where request.organization_id = ${organizationId}::uuid
            and private.asset_return_request_membership_access_allowed(request.id, ${membershipId}::uuid, ${assetPermissionKeys.returnRequestView})
          order by request.due_at, request.created_at desc limit 300
        `
      : Promise.resolve([]),
  ]);

  const assetRequests: AssetRequestSummary[] = requestRows.map((request) => ({
    id: request.id,
    requestKey: assetRequestKey(Number(request.request_number)),
    requesterMembershipId: request.requester_membership_id,
    requesterName: request.requester_name,
    categoryId: request.category_id,
    categoryName: request.category_name,
    requestType: request.request_type,
    requestTypeLabel: assetRequestTypeLabels[request.request_type],
    title: request.title,
    justification: request.justification,
    neededByDate: request.needed_by_date,
    expectedReturnAt: request.expected_return_at,
    status: request.status,
    statusLabel: assetRequestStatusLabels[request.status],
    approvalRequestId: request.approval_request_id,
    fulfilledAssetId: request.fulfilled_asset_id,
    fulfilledAssetTag: request.fulfilled_asset_tag,
    createdAt: request.created_at,
    canSubmit: request.can_submit,
    canCancel: request.can_cancel,
    canFulfill: request.can_fulfill,
  }));
  const returnRequests: AssetReturnRequestSummary[] = returnRequestRows.map((request) => ({
    id: request.id,
    assetId: request.asset_id,
    assetTag: request.asset_tag,
    assetName: request.asset_name,
    membershipId: request.membership_id,
    memberName: request.member_name,
    reason: request.reason,
    reasonLabel: assetReturnReasonLabels[request.reason],
    dueAt: request.due_at,
    status: request.status,
    statusLabel: assetReturnRequestStatusLabels[request.status],
    notes: request.notes,
    acknowledgedAt: request.acknowledged_at,
    completedAt: request.completed_at,
    canAcknowledge: request.can_acknowledge,
    canCancel: request.can_cancel,
  }));

  const assignments = groupRows(assignmentRows);
  const conditions = groupRows(conditionRows);
  const maintenance = groupRows(maintenanceRows);
  const documentsByAsset = groupRows(documentRows);
  const events = groupRows(eventRows);

  const assets: AssetSummary[] = assetRows.map((asset) => {
    const assetAssignments = (assignments.get(asset.id) ?? []).map(assignmentSummary);
    const purchasePriceMinor =
      asset.purchase_price_minor === null ? null : Number(asset.purchase_price_minor);
    const salvageValueMinor =
      asset.salvage_value_minor === null ? null : Number(asset.salvage_value_minor);
    return {
      id: asset.id,
      assetTag: asset.asset_tag,
      serialNumber: asset.serial_number,
      categoryId: asset.category_id,
      categoryName: asset.category_name,
      categoryKind: asset.category_kind,
      name: asset.name,
      manufacturer: asset.manufacturer,
      model: asset.model,
      ownershipType: asset.ownership_type,
      ownershipTypeLabel: assetOwnershipTypeLabels[asset.ownership_type],
      ownerMembershipId: asset.owner_membership_id,
      ownerName: asset.owner_name,
      vendorId: asset.vendor_id,
      vendorName: asset.vendor_name,
      purchaseDate: asset.purchase_date,
      purchasePriceMinor,
      currency: asset.currency,
      warrantyProvider: asset.warranty_provider,
      warrantyStartDate: asset.warranty_start_date,
      warrantyEndDate: asset.warranty_end_date,
      warrantyReference: asset.warranty_reference,
      warrantyState: assetWarrantyState({ warrantyEndDate: asset.warranty_end_date }),
      location: asset.location,
      status: asset.status,
      statusLabel: assetStatusLabels[asset.status],
      condition: asset.condition,
      conditionLabel: assetConditionLabels[asset.condition],
      depreciationMethod: asset.depreciation_method,
      depreciationMethodLabel: assetDepreciationMethodLabels[asset.depreciation_method],
      depreciationStartDate: asset.depreciation_start_date,
      usefulLifeMonths: asset.useful_life_months,
      salvageValueMinor,
      estimatedBookValueMinor:
        asset.depreciation_method === "straight_line"
          ? straightLineBookValueMinor({
              purchasePriceMinor,
              salvageValueMinor,
              usefulLifeMonths: asset.useful_life_months,
              depreciationStartDate: asset.depreciation_start_date,
            })
          : null,
      notes: asset.notes,
      disposalDate: asset.disposal_date,
      disposalMethod: asset.disposal_method,
      disposalReason: asset.disposal_reason,
      disposalValueMinor:
        asset.disposal_value_minor === null ? null : Number(asset.disposal_value_minor),
      activeAssignment:
        assetAssignments.find((assignment) => assignment.returnedAt === null) ?? null,
      assignments: assetAssignments,
      conditionHistory: (conditions.get(asset.id) ?? []).map((event) => ({
        id: event.id,
        condition: event.condition,
        conditionLabel: assetConditionLabels[event.condition],
        eventType: event.event_type,
        notes: event.notes,
        recordedByName: event.recorded_by_name,
        createdAt: event.created_at,
      })),
      maintenance: (maintenance.get(asset.id) ?? []).map((record) => ({
        id: record.id,
        maintenanceType: record.maintenance_type,
        maintenanceTypeLabel: assetMaintenanceTypeLabels[record.maintenance_type],
        status: record.status,
        statusLabel: assetMaintenanceStatusLabels[record.status],
        provider: record.provider,
        scheduledAt: record.scheduled_at,
        startedAt: record.started_at,
        completedAt: record.completed_at,
        details: record.details,
        outcome: record.outcome,
        costMinor: record.cost_minor === null ? null : Number(record.cost_minor),
        currency: record.currency,
        createdByName: record.created_by_name,
        completedByName: record.completed_by_name,
      })),
      documents: (documentsByAsset.get(asset.id) ?? []).map((document) => ({
        id: document.id,
        title: document.title,
        currentVersionId: document.current_version_id,
        canOpen: document.can_open,
      })),
      events: (events.get(asset.id) ?? []).map((event) => ({
        id: event.id,
        eventType: event.event_type,
        actorName: event.actor_name,
        createdAt: event.created_at,
      })),
      canUpdate: asset.can_update,
      canAssign: asset.can_assign,
      canAcknowledge: asset.can_acknowledge,
      canMaintain: asset.can_maintain,
      canDispose: asset.can_dispose,
      canLinkDocument: asset.can_link_document && canLinkDocument,
    };
  });

  return {
    allowed: true,
    data: {
      generatedAt: new Date().toISOString(),
      assets,
      categories: categoryRows,
      members,
      vendors,
      documents,
      assetRequests,
      returnRequests,
      summary: {
        total: assets.length,
        available: assets.filter((asset) => asset.status === "available").length,
        assigned: assets.filter((asset) => asset.status === "assigned").length,
        maintenance: assets.filter((asset) => asset.status === "under_repair").length,
        warrantyAttention: assets.filter((asset) =>
          ["expiring", "expired"].includes(asset.warrantyState),
        ).length,
        disposed: assets.filter((asset) => asset.status === "disposed").length,
        pendingRequests: assetRequests.filter((request) =>
          ["pending_approval", "approved"].includes(request.status),
        ).length,
        returnsDue: returnRequests.filter((request) =>
          ["pending", "acknowledged", "overdue"].includes(request.status),
        ).length,
      },
      capabilities: {
        canCreate,
        canManageCategories: context.permissions.has(assetPermissionKeys.manageCategories),
        canAssign,
        canMaintain: context.permissions.has(assetPermissionKeys.maintain),
        canLinkDocument,
        canCreateRequest,
        canManageRequests,
        canManageReturnRequests,
      },
    },
  };
}
