"use server";

import { revalidatePath } from "next/cache";
import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  createApprovalDefinition,
  submitApprovalForRecordAtomically,
} from "@/modules/approvals/server/approvals";
import { toJsonValue } from "@/lib/server/json-value";
import {
  assetAcknowledgeSchema,
  assetAssignmentSchema,
  assetCategorySchema,
  assetConditionSchema,
  assetCreateSchema,
  assetDisposalSchema,
  assetDocumentSchema,
  assetMaintenanceCompleteSchema,
  assetMaintenanceCreateSchema,
  assetReturnSchema,
  assetRequestCreateSchema,
  assetRequestFulfillSchema,
  assetRequestIdSchema,
  assetReturnRequestCreateSchema,
  assetReturnRequestUpdateSchema,
  assetUpdateSchema,
  type AssetActionState,
} from "@/modules/assets/schemas/assets";
import { AssetAccessError, requireAssetAccess } from "@/modules/assets/server/assets";
import { assetPermissionKeys, assetRequestKey } from "@/modules/assets/assets";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { documentPermissionKeys } from "@/modules/documents/documents";
import {
  requireDocumentAccess,
  requireDocumentEntityAccess,
} from "@/modules/documents/server/documents";
import { enqueueNotification } from "@/modules/notifications/server/notifications";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

const success = (message: string): AssetActionState => ({ status: "success", message });
const failure = (message: string, fieldErrors?: Record<string, string[]>): AssetActionState => ({
  status: "error",
  message,
  fieldErrors,
});
const value = (formData: FormData, key: string) => formData.get(key);
const refresh = () => revalidatePath("/assets");
const isUniqueViolation = (error: unknown) =>
  Boolean(
    error && typeof error === "object" && "code" in error && Reflect.get(error, "code") === "23505",
  );

async function recordAssetEvent(
  sql: TransactionSql,
  input: {
    organizationId: string;
    assetId: string;
    actorMembershipId: string;
    eventType: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await sql`
    insert into public.asset_events (
      organization_id, asset_id, event_type, actor_membership_id, details
    ) values (
      ${input.organizationId}::uuid, ${input.assetId}::uuid, ${input.eventType},
      ${input.actorMembershipId}::uuid, ${sql.json(toJsonValue(input.details ?? {}))}
    )
  `;
}

function metadataInput(formData: FormData) {
  return {
    assetTag: value(formData, "assetTag"),
    serialNumber: value(formData, "serialNumber"),
    categoryId: value(formData, "categoryId"),
    name: value(formData, "name"),
    manufacturer: value(formData, "manufacturer"),
    model: value(formData, "model"),
    ownershipType: value(formData, "ownershipType"),
    ownerMembershipId: value(formData, "ownerMembershipId"),
    vendorId: value(formData, "vendorId"),
    purchaseDate: value(formData, "purchaseDate"),
    purchasePriceMinor: value(formData, "purchasePriceMinor"),
    currency: value(formData, "currency"),
    warrantyProvider: value(formData, "warrantyProvider"),
    warrantyStartDate: value(formData, "warrantyStartDate"),
    warrantyEndDate: value(formData, "warrantyEndDate"),
    warrantyReference: value(formData, "warrantyReference"),
    location: value(formData, "location"),
    condition: value(formData, "condition"),
    depreciationMethod: value(formData, "depreciationMethod"),
    depreciationStartDate: value(formData, "depreciationStartDate"),
    usefulLifeMonths: value(formData, "usefulLifeMonths"),
    salvageValueMinor: value(formData, "salvageValueMinor"),
    notes: value(formData, "notes"),
    status: value(formData, "status"),
  };
}

async function ensureAssetRequestApprovalPolicy(
  context: CurrentPermissionContext,
  hasManager: boolean,
): Promise<string> {
  const database = getDatabaseClient();
  const operationsApprover = await database<Array<{ id: string }>>`
    select membership.id
    from public.memberships membership
    join public.membership_roles assignment on assignment.membership_id = membership.id
    join public.roles role on role.id = assignment.role_id
    where membership.organization_id = ${context.membership.organizationId}::uuid
      and membership.status = 'active'
      and membership.id <> ${context.membership.id}::uuid
      and role.template_key = 'operations_administrator'
    limit 1
  `;
  const authorizationRole = operationsApprover[0] ? "operations_administrator" : "owner";
  const key = hasManager
    ? `asset_request_manager_${authorizationRole}`
    : `asset_request_${authorizationRole}`;
  const existing = await database<Array<{ id: string }>>`
    select id from public.approval_definitions
    where organization_id = ${context.membership.organizationId}::uuid
      and key = ${key} and source_module = 'assets'
      and entity_type = 'asset_request' and status = 'active'
    limit 1
  `;
  if (existing[0]) return key;
  const steps = [
    ...(hasManager
      ? [
          {
            name: "Manager approval",
            stageOrder: 1,
            sortOrder: 1,
            selectorType: "manager" as const,
            selectorRoleKey: null,
            selectorMembershipId: null,
            decisionMode: "any" as const,
            conditions: {},
            commentRequired: true,
            reminderAfterHours: 24,
            escalationAfterHours: 72,
            expiresAfterHours: null,
          },
        ]
      : []),
    {
      name: "Asset authorization",
      stageOrder: hasManager ? 2 : 1,
      sortOrder: 1,
      selectorType: "role" as const,
      selectorRoleKey: authorizationRole,
      selectorMembershipId: null,
      decisionMode: "any" as const,
      conditions: {},
      commentRequired: false,
      reminderAfterHours: 24,
      escalationAfterHours: 72,
      expiresAfterHours: null,
    },
  ];
  try {
    await createApprovalDefinition(context, {
      key,
      name: "Asset request approval",
      description: `Manager approval when available, followed by ${authorizationRole === "owner" ? "Owner" : "Operations"} authorization.`,
      sourceModule: "assets",
      entityType: "asset_request",
      allowSelfApproval: false,
      allowReassignment: true,
      steps,
    });
  } catch (error) {
    const raced = await database<Array<{ id: string }>>`
      select id from public.approval_definitions
      where organization_id = ${context.membership.organizationId}::uuid
        and key = ${key} and source_module = 'assets'
        and entity_type = 'asset_request' and status = 'active' limit 1
    `;
    if (!raced[0]) throw error;
  }
  return key;
}

async function validateCategoryAndOwner(
  sql: TransactionSql,
  organizationId: string,
  categoryId: string,
  ownerMembershipId: string | null,
  vendorId: string | null,
): Promise<void> {
  const categories = await sql<Array<{ id: string }>>`
    select id from public.asset_categories
    where id = ${categoryId}::uuid and organization_id = ${organizationId}::uuid and status = 'active'
  `;
  if (!categories[0]) throw new Error("category-invalid");
  if (ownerMembershipId) {
    const owners = await sql<Array<{ id: string }>>`
      select id from public.memberships
      where id = ${ownerMembershipId}::uuid and organization_id = ${organizationId}::uuid
        and status = 'active'
    `;
    if (!owners[0]) throw new Error("owner-invalid");
  }
  if (vendorId) {
    const vendors = await sql<Array<{ id: string }>>`
      select id from public.vendors
      where id = ${vendorId}::uuid and organization_id = ${organizationId}::uuid
        and status not in ('blocked', 'archived')
    `;
    if (!vendors[0]) throw new Error("vendor-invalid");
  }
}

export async function createAssetCategoryAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetCategorySchema.safeParse({
    name: value(formData, "name"),
    kind: value(formData, "kind"),
    description: value(formData, "description"),
  });
  if (!parsed.success)
    return failure("Check the category fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    assetPermissionKeys.workspace,
    assetPermissionKeys.manageCategories,
  ]);
  if (!authorization.allowed) return failure("You cannot manage asset categories.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
        insert into public.asset_categories (
          organization_id, name, kind, description, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.name}, ${parsed.data.kind},
          ${parsed.data.description}, ${context.membership.id}::uuid
        ) returning id
      `;
      const categoryId = rows[0]?.id;
      if (!categoryId) throw new Error("create-failed");
      await writeAuditEvent(sql, context, {
        action: "assets.category.created",
        entityType: "asset_category",
        entityId: categoryId,
        afterState: parsed.data,
        changedFields: ["category"],
      });
    });
    refresh();
    return success("Asset category added.");
  } catch (error) {
    return failure(
      isUniqueViolation(error)
        ? "A category with this name already exists."
        : "Category could not be added.",
    );
  }
}

export async function createAssetAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetCreateSchema.safeParse(metadataInput(formData));
  if (!parsed.success)
    return failure("Check the asset fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    assetPermissionKeys.workspace,
    assetPermissionKeys.create,
  ]);
  if (!authorization.allowed) return failure("You cannot register assets.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await validateCategoryAndOwner(
        sql,
        context.membership.organizationId,
        parsed.data.categoryId,
        parsed.data.ownerMembershipId,
        parsed.data.vendorId,
      );
      const rows = await sql<Array<{ id: string }>>`
        insert into public.assets (
          organization_id, asset_tag, serial_number, category_id, name, manufacturer, model,
          ownership_type, owner_membership_id, vendor_id, purchase_date, purchase_price_minor, currency,
          warranty_provider, warranty_start_date, warranty_end_date, warranty_reference,
          location, status, condition, depreciation_method, depreciation_start_date,
          useful_life_months, salvage_value_minor, notes, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.assetTag}, ${parsed.data.serialNumber},
          ${parsed.data.categoryId}::uuid, ${parsed.data.name}, ${parsed.data.manufacturer},
          ${parsed.data.model}, ${parsed.data.ownershipType}, ${parsed.data.ownerMembershipId}::uuid,
          ${parsed.data.vendorId}::uuid, ${parsed.data.purchaseDate}::date, ${parsed.data.purchasePriceMinor}, ${parsed.data.currency},
          ${parsed.data.warrantyProvider}, ${parsed.data.warrantyStartDate}::date,
          ${parsed.data.warrantyEndDate}::date, ${parsed.data.warrantyReference},
          ${parsed.data.location}, ${parsed.data.status}, ${parsed.data.condition},
          ${parsed.data.depreciationMethod}, ${parsed.data.depreciationStartDate}::date,
          ${parsed.data.usefulLifeMonths}, ${parsed.data.salvageValueMinor}, ${parsed.data.notes},
          ${context.membership.id}::uuid
        ) returning id
      `;
      const assetId = rows[0]?.id;
      if (!assetId) throw new Error("create-failed");
      await sql`
        insert into public.asset_condition_events (
          organization_id, asset_id, condition, event_type, notes, recorded_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${assetId}::uuid, ${parsed.data.condition},
          'registration', ${parsed.data.notes}, ${context.membership.id}::uuid
        )
      `;
      await recordAssetEvent(sql, {
        organizationId: context.membership.organizationId,
        assetId,
        actorMembershipId: context.membership.id,
        eventType: "assets.asset_registered",
        details: { assetTag: parsed.data.assetTag, status: parsed.data.status },
      });
      await writeAuditEvent(sql, context, {
        action: "assets.asset.created",
        entityType: "asset",
        entityId: assetId,
        afterState: {
          assetTag: parsed.data.assetTag,
          serialNumber: parsed.data.serialNumber,
          status: parsed.data.status,
          condition: parsed.data.condition,
        },
        changedFields: ["asset"],
      });
    });
    refresh();
    return success(`${parsed.data.assetTag} registered.`);
  } catch (error) {
    return failure(
      isUniqueViolation(error)
        ? "Asset tag or serial number is already in use."
        : "Asset could not be registered.",
    );
  }
}

export async function updateAssetAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetUpdateSchema.safeParse({
    assetId: value(formData, "assetId"),
    ...metadataInput(formData),
  });
  if (!parsed.success)
    return failure("Check the asset fields.", parsed.error.flatten().fieldErrors);
  if (["assigned", "disposed"].includes(parsed.data.status)) {
    return failure("Use assignment or disposal controls for this lifecycle state.");
  }
  const authorization = await authorizeCurrentUser([assetPermissionKeys.workspace]);
  if (!authorization.allowed) return failure("You cannot update assets.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireAssetAccess(context, parsed.data.assetId, assetPermissionKeys.update, sql);
      await validateCategoryAndOwner(
        sql,
        context.membership.organizationId,
        parsed.data.categoryId,
        parsed.data.ownerMembershipId,
        parsed.data.vendorId,
      );
      const beforeRows = await sql<
        Array<{ status: string; condition: string; active_assignment: boolean }>
      >`
        select asset.status, asset.condition, exists(
          select 1 from public.asset_assignments assignment
          where assignment.asset_id = asset.id and assignment.returned_at is null
        ) as active_assignment
        from public.assets asset
        where asset.id = ${parsed.data.assetId}::uuid
          and asset.organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const before = beforeRows[0];
      if (!before) throw new AssetAccessError("Asset was not found.");
      if (before.active_assignment) throw new Error("active-assignment");
      await sql`
        update public.assets set
          asset_tag = ${parsed.data.assetTag}, serial_number = ${parsed.data.serialNumber},
          category_id = ${parsed.data.categoryId}::uuid, name = ${parsed.data.name},
          manufacturer = ${parsed.data.manufacturer}, model = ${parsed.data.model},
          ownership_type = ${parsed.data.ownershipType},
          owner_membership_id = ${parsed.data.ownerMembershipId}::uuid,
          vendor_id = ${parsed.data.vendorId}::uuid,
          purchase_date = ${parsed.data.purchaseDate}::date,
          purchase_price_minor = ${parsed.data.purchasePriceMinor}, currency = ${parsed.data.currency},
          warranty_provider = ${parsed.data.warrantyProvider},
          warranty_start_date = ${parsed.data.warrantyStartDate}::date,
          warranty_end_date = ${parsed.data.warrantyEndDate}::date,
          warranty_reference = ${parsed.data.warrantyReference}, location = ${parsed.data.location},
          status = ${parsed.data.status}, condition = ${parsed.data.condition},
          depreciation_method = ${parsed.data.depreciationMethod},
          depreciation_start_date = ${parsed.data.depreciationStartDate}::date,
          useful_life_months = ${parsed.data.usefulLifeMonths},
          salvage_value_minor = ${parsed.data.salvageValueMinor}, notes = ${parsed.data.notes}
        where id = ${parsed.data.assetId}::uuid
      `;
      if (before.condition !== parsed.data.condition) {
        await sql`
          insert into public.asset_condition_events (
            organization_id, asset_id, condition, event_type, notes, recorded_by_membership_id
          ) values (
            ${context.membership.organizationId}::uuid, ${parsed.data.assetId}::uuid,
            ${parsed.data.condition}, 'inspection', ${parsed.data.notes}, ${context.membership.id}::uuid
          )
        `;
      }
      await recordAssetEvent(sql, {
        organizationId: context.membership.organizationId,
        assetId: parsed.data.assetId,
        actorMembershipId: context.membership.id,
        eventType: "assets.asset_updated",
        details: { status: parsed.data.status, condition: parsed.data.condition },
      });
      await writeAuditEvent(sql, context, {
        action: "assets.asset.updated",
        entityType: "asset",
        entityId: parsed.data.assetId,
        beforeState: { status: before.status, condition: before.condition },
        afterState: { status: parsed.data.status, condition: parsed.data.condition },
        changedFields: ["metadata", "status", "condition"],
      });
    });
    refresh();
    return success("Asset details updated.");
  } catch (error) {
    if (error instanceof AssetAccessError) return failure(error.message);
    if (isUniqueViolation(error)) return failure("Asset tag or serial number is already in use.");
    if (error instanceof Error && error.message === "active-assignment") {
      return failure("Return the active assignment before changing asset lifecycle metadata.");
    }
    return failure("Asset could not be updated.");
  }
}

export async function assignAssetAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetAssignmentSchema.safeParse({
    assetId: value(formData, "assetId"),
    membershipId: value(formData, "membershipId"),
    checkoutAt: value(formData, "checkoutAt"),
    expectedReturnAt: value(formData, "expectedReturnAt"),
    condition: value(formData, "condition"),
    notes: value(formData, "notes"),
  });
  if (!parsed.success)
    return failure("Check the assignment fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    assetPermissionKeys.workspace,
    assetPermissionKeys.assign,
  ]);
  if (!authorization.allowed) return failure("You cannot assign assets.");
  const context = authorization.context;
  let assetTag = "Asset";
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireAssetAccess(context, parsed.data.assetId, assetPermissionKeys.assign, sql);
      const assetRows = await sql<Array<{ asset_tag: string; status: string }>>`
        select asset_tag, status from public.assets
        where id = ${parsed.data.assetId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const asset = assetRows[0];
      if (!asset) throw new AssetAccessError("Asset was not found.");
      assetTag = asset.asset_tag;
      if (!["available", "received"].includes(asset.status)) throw new Error("not-available");
      const assigneeRows = await sql<Array<{ id: string }>>`
        select id from public.memberships
        where id = ${parsed.data.membershipId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid and status = 'active'
      `;
      if (!assigneeRows[0]) throw new Error("assignee-invalid");
      await sql`
        insert into public.asset_assignments (
          organization_id, asset_id, membership_id, checkout_at, expected_return_at,
          checkout_condition, checkout_notes, assigned_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.assetId}::uuid,
          ${parsed.data.membershipId}::uuid, ${parsed.data.checkoutAt}::timestamptz,
          ${parsed.data.expectedReturnAt}::timestamptz, ${parsed.data.condition},
          ${parsed.data.notes}, ${context.membership.id}::uuid
        )
      `;
      await sql`
        update public.assets set status = 'assigned', condition = ${parsed.data.condition}
        where id = ${parsed.data.assetId}::uuid
      `;
      await sql`
        insert into public.asset_condition_events (
          organization_id, asset_id, condition, event_type, notes, recorded_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.assetId}::uuid,
          ${parsed.data.condition}, 'checkout', ${parsed.data.notes}, ${context.membership.id}::uuid
        )
      `;
      await recordAssetEvent(sql, {
        organizationId: context.membership.organizationId,
        assetId: parsed.data.assetId,
        actorMembershipId: context.membership.id,
        eventType: "assets.asset_assigned",
        details: {
          membershipId: parsed.data.membershipId,
          expectedReturnAt: parsed.data.expectedReturnAt,
        },
      });
      await writeAuditEvent(sql, context, {
        action: "assets.asset.assigned",
        entityType: "asset",
        entityId: parsed.data.assetId,
        afterState: {
          assignedToMembershipId: parsed.data.membershipId,
          checkoutAt: parsed.data.checkoutAt,
          condition: parsed.data.condition,
        },
        changedFields: ["assignment", "status", "condition"],
      });
    });
    if (parsed.data.membershipId !== context.membership.id) {
      await enqueueNotification({
        organizationId: context.membership.organizationId,
        recipientMembershipId: parsed.data.membershipId,
        category: "assignment",
        title: `${assetTag} assigned to you`,
        message: "Review the checkout condition and acknowledge receipt in Assets.",
        deepLink: "/assets",
        sourceModule: "assets",
        sourceEntityType: "asset",
        sourceEntityId: parsed.data.assetId,
        dedupeKey: `asset-assigned:${parsed.data.assetId}:${parsed.data.membershipId}`,
        createdByMembershipId: context.membership.id,
      });
    }
    refresh();
    return success(`${assetTag} checked out.`);
  } catch (error) {
    if (error instanceof AssetAccessError) return failure(error.message);
    if (error instanceof Error && error.message === "not-available") {
      return failure("Only available or newly received assets can be assigned.");
    }
    if (isUniqueViolation(error)) return failure("This asset already has an active assignment.");
    return failure("Asset could not be assigned.");
  }
}

export async function acknowledgeAssetAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetAcknowledgeSchema.safeParse({ assetId: value(formData, "assetId") });
  if (!parsed.success) return failure("Asset reference is invalid.");
  const authorization = await authorizeCurrentUser([
    assetPermissionKeys.workspace,
    assetPermissionKeys.acknowledge,
  ]);
  if (!authorization.allowed) return failure("You cannot acknowledge this asset.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireAssetAccess(context, parsed.data.assetId, assetPermissionKeys.acknowledge, sql);
      const rows = await sql<Array<{ id: string }>>`
        update public.asset_assignments set acknowledged_at = now()
        where asset_id = ${parsed.data.assetId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and membership_id = ${context.membership.id}::uuid
          and returned_at is null and acknowledged_at is null
        returning id
      `;
      if (!rows[0]) throw new Error("not-active-assignment");
      await recordAssetEvent(sql, {
        organizationId: context.membership.organizationId,
        assetId: parsed.data.assetId,
        actorMembershipId: context.membership.id,
        eventType: "assets.assignment_acknowledged",
      });
      await writeAuditEvent(sql, context, {
        action: "assets.assignment.acknowledged",
        entityType: "asset",
        entityId: parsed.data.assetId,
        changedFields: ["acknowledgement"],
      });
    });
    refresh();
    return success("Asset receipt acknowledged.");
  } catch (error) {
    return failure(
      error instanceof AssetAccessError
        ? error.message
        : "Active assignment could not be acknowledged.",
    );
  }
}

export async function returnAssetAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetReturnSchema.safeParse({
    assetId: value(formData, "assetId"),
    returnedAt: value(formData, "returnedAt"),
    condition: value(formData, "condition"),
    nextStatus: value(formData, "nextStatus"),
    notes: value(formData, "notes"),
  });
  if (!parsed.success)
    return failure("Check the return fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    assetPermissionKeys.workspace,
    assetPermissionKeys.assign,
  ]);
  if (!authorization.allowed) return failure("You cannot record asset returns.");
  const context = authorization.context;
  let assigneeId: string | null = null;
  let assetTag = "Asset";
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireAssetAccess(context, parsed.data.assetId, assetPermissionKeys.assign, sql);
      const rows = await sql<
        Array<{ asset_tag: string; assignment_id: string | null; membership_id: string | null }>
      >`
        select asset.asset_tag, assignment.id as assignment_id, assignment.membership_id
        from public.assets asset
        left join public.asset_assignments assignment
          on assignment.asset_id = asset.id and assignment.returned_at is null
        where asset.id = ${parsed.data.assetId}::uuid
          and asset.organization_id = ${context.membership.organizationId}::uuid
        for update of asset
      `;
      const row = rows[0];
      if (!row?.assignment_id || !row.membership_id) throw new Error("no-assignment");
      assigneeId = row.membership_id;
      assetTag = row.asset_tag;
      await sql`
        update public.asset_assignments set
          returned_at = ${parsed.data.returnedAt}::timestamptz,
          return_condition = ${parsed.data.condition}, return_notes = ${parsed.data.notes},
          returned_by_membership_id = ${context.membership.id}::uuid
        where id = ${row.assignment_id}::uuid
      `;
      await sql`
        update public.assets set status = ${parsed.data.nextStatus}, condition = ${parsed.data.condition}
        where id = ${parsed.data.assetId}::uuid
      `;
      await sql`
        update public.asset_return_requests set status = 'completed', completed_at = ${parsed.data.returnedAt}::timestamptz, updated_at = now()
        where assignment_id = ${row.assignment_id}::uuid and status in ('pending', 'acknowledged', 'overdue')
      `;
      await sql`
        insert into public.asset_condition_events (
          organization_id, asset_id, condition, event_type, notes, recorded_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.assetId}::uuid,
          ${parsed.data.condition}, 'return', ${parsed.data.notes}, ${context.membership.id}::uuid
        )
      `;
      await recordAssetEvent(sql, {
        organizationId: context.membership.organizationId,
        assetId: parsed.data.assetId,
        actorMembershipId: context.membership.id,
        eventType: "assets.asset_returned",
        details: { membershipId: row.membership_id, nextStatus: parsed.data.nextStatus },
      });
      await writeAuditEvent(sql, context, {
        action: "assets.asset.returned",
        entityType: "asset",
        entityId: parsed.data.assetId,
        afterState: {
          returnedByMembershipId: context.membership.id,
          condition: parsed.data.condition,
          status: parsed.data.nextStatus,
        },
        changedFields: ["assignment", "status", "condition"],
      });
    });
    if (assigneeId && assigneeId !== context.membership.id) {
      await enqueueNotification({
        organizationId: context.membership.organizationId,
        recipientMembershipId: assigneeId,
        category: "asset_return",
        title: `${assetTag} return recorded`,
        message: `The asset return was recorded with condition ${parsed.data.condition}.`,
        deepLink: "/assets",
        sourceModule: "assets",
        sourceEntityType: "asset",
        sourceEntityId: parsed.data.assetId,
        dedupeKey: `asset-returned:${parsed.data.assetId}:${parsed.data.returnedAt}`,
        createdByMembershipId: context.membership.id,
      });
    }
    refresh();
    return success(`${assetTag} returned.`);
  } catch (error) {
    if (error instanceof AssetAccessError) return failure(error.message);
    if (error instanceof Error && error.message === "no-assignment") {
      return failure("This asset has no active assignment to return.");
    }
    return failure("Asset return could not be recorded.");
  }
}

export async function recordAssetConditionAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetConditionSchema.safeParse({
    assetId: value(formData, "assetId"),
    condition: value(formData, "condition"),
    eventType: value(formData, "eventType"),
    notes: value(formData, "notes"),
  });
  if (!parsed.success)
    return failure("Check the condition fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([assetPermissionKeys.workspace]);
  if (!authorization.allowed) return failure("You cannot record asset condition.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireAssetAccess(context, parsed.data.assetId, assetPermissionKeys.update, sql);
      await sql`
        update public.assets set condition = ${parsed.data.condition}
        where id = ${parsed.data.assetId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
      `;
      await sql`
        insert into public.asset_condition_events (
          organization_id, asset_id, condition, event_type, notes, recorded_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.assetId}::uuid,
          ${parsed.data.condition}, ${parsed.data.eventType}, ${parsed.data.notes},
          ${context.membership.id}::uuid
        )
      `;
      await recordAssetEvent(sql, {
        organizationId: context.membership.organizationId,
        assetId: parsed.data.assetId,
        actorMembershipId: context.membership.id,
        eventType: `assets.${parsed.data.eventType}_recorded`,
        details: { condition: parsed.data.condition },
      });
      await writeAuditEvent(sql, context, {
        action: `assets.asset.${parsed.data.eventType}`,
        entityType: "asset",
        entityId: parsed.data.assetId,
        afterState: { condition: parsed.data.condition },
        changedFields: ["condition"],
      });
    });
    refresh();
    return success("Condition history updated.");
  } catch (error) {
    return failure(
      error instanceof AssetAccessError ? error.message : "Condition could not be recorded.",
    );
  }
}

export async function createAssetMaintenanceAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetMaintenanceCreateSchema.safeParse({
    assetId: value(formData, "assetId"),
    maintenanceType: value(formData, "maintenanceType"),
    provider: value(formData, "provider"),
    scheduledAt: value(formData, "scheduledAt"),
    details: value(formData, "details"),
    costMinor: value(formData, "costMinor"),
    currency: value(formData, "currency"),
    startNow: value(formData, "startNow"),
  });
  if (!parsed.success)
    return failure("Check the maintenance fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    assetPermissionKeys.workspace,
    assetPermissionKeys.maintain,
  ]);
  if (!authorization.allowed) return failure("You cannot manage maintenance.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireAssetAccess(context, parsed.data.assetId, assetPermissionKeys.maintain, sql);
      const rows = await sql<Array<{ status: string; active_assignment: boolean }>>`
        select asset.status, exists(
          select 1 from public.asset_assignments assignment
          where assignment.asset_id = asset.id and assignment.returned_at is null
        ) as active_assignment
        from public.assets asset
        where asset.id = ${parsed.data.assetId}::uuid
          and asset.organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const asset = rows[0];
      if (!asset) throw new AssetAccessError("Asset was not found.");
      if (["disposed", "lost", "stolen"].includes(asset.status)) throw new Error("inactive-asset");
      if (parsed.data.startNow && asset.active_assignment) throw new Error("active-assignment");
      const maintenanceRows = await sql<Array<{ id: string }>>`
        insert into public.asset_maintenance_records (
          organization_id, asset_id, maintenance_type, status, provider, scheduled_at,
          started_at, details, cost_minor, currency, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.assetId}::uuid,
          ${parsed.data.maintenanceType}, ${parsed.data.startNow ? "in_progress" : "scheduled"},
          ${parsed.data.provider}, ${parsed.data.scheduledAt}::timestamptz,
          ${parsed.data.startNow ? new Date().toISOString() : null}::timestamptz,
          ${parsed.data.details}, ${parsed.data.costMinor}, ${parsed.data.currency},
          ${context.membership.id}::uuid
        ) returning id
      `;
      if (!maintenanceRows[0]) throw new Error("create-failed");
      if (parsed.data.startNow) {
        await sql`update public.assets set status = 'under_repair' where id = ${parsed.data.assetId}::uuid`;
      }
      await recordAssetEvent(sql, {
        organizationId: context.membership.organizationId,
        assetId: parsed.data.assetId,
        actorMembershipId: context.membership.id,
        eventType: parsed.data.startNow
          ? "assets.maintenance_started"
          : "assets.maintenance_scheduled",
        details: { maintenanceType: parsed.data.maintenanceType },
      });
      await writeAuditEvent(sql, context, {
        action: parsed.data.startNow
          ? "assets.maintenance.started"
          : "assets.maintenance.scheduled",
        entityType: "asset",
        entityId: parsed.data.assetId,
        afterState: {
          maintenanceType: parsed.data.maintenanceType,
          scheduledAt: parsed.data.scheduledAt,
        },
        changedFields: ["maintenance"],
      });
    });
    refresh();
    return success(parsed.data.startNow ? "Maintenance started." : "Maintenance scheduled.");
  } catch (error) {
    if (error instanceof AssetAccessError) return failure(error.message);
    if (error instanceof Error && error.message === "active-assignment") {
      return failure("Return the asset before starting maintenance.");
    }
    if (error instanceof Error && error.message === "inactive-asset") {
      return failure("Disposed, lost, or stolen assets cannot enter maintenance.");
    }
    return failure("Maintenance record could not be created.");
  }
}

export async function completeAssetMaintenanceAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetMaintenanceCompleteSchema.safeParse({
    maintenanceId: value(formData, "maintenanceId"),
    assetId: value(formData, "assetId"),
    completedAt: value(formData, "completedAt"),
    conditionAfter: value(formData, "conditionAfter"),
    outcome: value(formData, "outcome"),
  });
  if (!parsed.success)
    return failure("Check the completion fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    assetPermissionKeys.workspace,
    assetPermissionKeys.maintain,
  ]);
  if (!authorization.allowed) return failure("You cannot complete maintenance.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireAssetAccess(context, parsed.data.assetId, assetPermissionKeys.maintain, sql);
      const rows = await sql<Array<{ status: string }>>`
        select status from public.asset_maintenance_records
        where id = ${parsed.data.maintenanceId}::uuid
          and asset_id = ${parsed.data.assetId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      if (!rows[0] || rows[0].status === "completed" || rows[0].status === "cancelled") {
        throw new Error("maintenance-inactive");
      }
      await sql`
        update public.asset_maintenance_records set
          status = 'completed',
          started_at = coalesce(started_at, scheduled_at, created_at),
          completed_at = ${parsed.data.completedAt}::timestamptz,
          outcome = ${parsed.data.outcome}, completed_by_membership_id = ${context.membership.id}::uuid
        where id = ${parsed.data.maintenanceId}::uuid
      `;
      await sql`
        update public.assets set status = 'available', condition = ${parsed.data.conditionAfter}
        where id = ${parsed.data.assetId}::uuid
      `;
      await sql`
        insert into public.asset_condition_events (
          organization_id, asset_id, condition, event_type, notes, recorded_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.assetId}::uuid,
          ${parsed.data.conditionAfter}, 'maintenance', ${parsed.data.outcome},
          ${context.membership.id}::uuid
        )
      `;
      await recordAssetEvent(sql, {
        organizationId: context.membership.organizationId,
        assetId: parsed.data.assetId,
        actorMembershipId: context.membership.id,
        eventType: "assets.maintenance_completed",
        details: {
          maintenanceId: parsed.data.maintenanceId,
          condition: parsed.data.conditionAfter,
        },
      });
      await writeAuditEvent(sql, context, {
        action: "assets.maintenance.completed",
        entityType: "asset",
        entityId: parsed.data.assetId,
        afterState: {
          maintenanceId: parsed.data.maintenanceId,
          condition: parsed.data.conditionAfter,
        },
        changedFields: ["maintenance", "status", "condition"],
      });
    });
    refresh();
    return success("Maintenance completed and asset returned to available stock.");
  } catch (error) {
    return failure(
      error instanceof AssetAccessError ? error.message : "Maintenance could not be completed.",
    );
  }
}

export async function disposeAssetAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetDisposalSchema.safeParse({
    assetId: value(formData, "assetId"),
    disposalDate: value(formData, "disposalDate"),
    method: value(formData, "method"),
    reason: value(formData, "reason"),
    valueMinor: value(formData, "valueMinor"),
  });
  if (!parsed.success)
    return failure("Check the disposal fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    assetPermissionKeys.workspace,
    assetPermissionKeys.dispose,
  ]);
  if (!authorization.allowed) return failure("You cannot dispose of assets.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireAssetAccess(context, parsed.data.assetId, assetPermissionKeys.dispose, sql);
      const rows = await sql<Array<{ status: string; active_assignment: boolean }>>`
        select asset.status, exists(
          select 1 from public.asset_assignments assignment
          where assignment.asset_id = asset.id and assignment.returned_at is null
        ) as active_assignment
        from public.assets asset
        where asset.id = ${parsed.data.assetId}::uuid
          and asset.organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const asset = rows[0];
      if (!asset) throw new AssetAccessError("Asset was not found.");
      if (asset.active_assignment) throw new Error("active-assignment");
      if (asset.status === "disposed") throw new Error("already-disposed");
      await sql`
        update public.assets set
          status = 'disposed', disposal_date = ${parsed.data.disposalDate}::date,
          disposal_method = ${parsed.data.method}, disposal_reason = ${parsed.data.reason},
          disposal_value_minor = ${parsed.data.valueMinor},
          disposed_by_membership_id = ${context.membership.id}::uuid
        where id = ${parsed.data.assetId}::uuid
      `;
      await sql`
        insert into public.asset_condition_events (
          organization_id, asset_id, condition, event_type, notes, recorded_by_membership_id
        ) select organization_id, id, condition, 'disposal', ${parsed.data.reason},
          ${context.membership.id}::uuid from public.assets where id = ${parsed.data.assetId}::uuid
      `;
      await recordAssetEvent(sql, {
        organizationId: context.membership.organizationId,
        assetId: parsed.data.assetId,
        actorMembershipId: context.membership.id,
        eventType: "assets.asset_disposed",
        details: { method: parsed.data.method, disposalDate: parsed.data.disposalDate },
      });
      await writeAuditEvent(sql, context, {
        action: "assets.asset.disposed",
        entityType: "asset",
        entityId: parsed.data.assetId,
        afterState: {
          method: parsed.data.method,
          disposalDate: parsed.data.disposalDate,
          valueMinor: parsed.data.valueMinor,
        },
        changedFields: ["status", "disposal"],
      });
    });
    refresh();
    return success("Asset disposal recorded.");
  } catch (error) {
    if (error instanceof AssetAccessError) return failure(error.message);
    if (error instanceof Error && error.message === "active-assignment") {
      return failure("Return the asset before disposal.");
    }
    return failure("Asset could not be disposed.");
  }
}

export async function attachAssetDocumentAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetDocumentSchema.safeParse({
    assetId: value(formData, "assetId"),
    documentId: value(formData, "documentId"),
  });
  if (!parsed.success) return failure("Choose a valid document.");
  const authorization = await authorizeCurrentUser([
    assetPermissionKeys.workspace,
    assetPermissionKeys.linkDocument,
    documentPermissionKeys.update,
  ]);
  if (!authorization.allowed) return failure("You cannot link documents to assets.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireAssetAccess(context, parsed.data.assetId, assetPermissionKeys.linkDocument, sql);
      await requireDocumentAccess(context, parsed.data.documentId, "edit", sql);
      await requireDocumentEntityAccess(context, "asset", parsed.data.assetId, sql);
      await sql`
        insert into public.document_entity_links (
          organization_id, document_id, entity_type, entity_id, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.documentId}::uuid,
          'asset', ${parsed.data.assetId}::uuid, ${context.membership.id}::uuid
        ) on conflict (document_id, entity_type, entity_id) do nothing
      `;
      await recordAssetEvent(sql, {
        organizationId: context.membership.organizationId,
        assetId: parsed.data.assetId,
        actorMembershipId: context.membership.id,
        eventType: "assets.document_linked",
        details: { documentId: parsed.data.documentId },
      });
      await writeAuditEvent(sql, context, {
        action: "assets.document.linked",
        entityType: "asset",
        entityId: parsed.data.assetId,
        afterState: { documentId: parsed.data.documentId },
        changedFields: ["documents"],
      });
    });
    refresh();
    return success("Document linked to asset.");
  } catch (error) {
    return failure(
      error instanceof AssetAccessError ? error.message : "Document could not be linked.",
    );
  }
}

export async function createAssetRequestAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetRequestCreateSchema.safeParse({
    categoryId: value(formData, "categoryId"),
    requestType: value(formData, "requestType"),
    title: value(formData, "title"),
    justification: value(formData, "justification"),
    neededByDate: value(formData, "neededByDate"),
    expectedReturnAt: value(formData, "expectedReturnAt"),
  });
  if (!parsed.success)
    return failure("Check the request fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    assetPermissionKeys.workspace,
    assetPermissionKeys.requestCreate,
  ]);
  if (!authorization.allowed) return failure("You cannot create Asset requests.");
  const context = authorization.context;
  let requestNumber = 0;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await validateCategoryAndOwner(
        sql,
        context.membership.organizationId,
        parsed.data.categoryId,
        null,
        null,
      );
      const counter = await sql<Array<{ value: string | number }>>`
        insert into public.asset_request_counters (organization_id, next_number)
        values (${context.membership.organizationId}::uuid, 2)
        on conflict (organization_id) do update set next_number = public.asset_request_counters.next_number + 1, updated_at = now()
        returning next_number - 1 as value
      `;
      requestNumber = Number(counter[0]?.value ?? 0);
      const rows = await sql<Array<{ id: string }>>`
        insert into public.asset_requests (
          organization_id, request_number, requester_membership_id, category_id, request_type,
          title, justification, needed_by_date, expected_return_at, created_by_membership_id, updated_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${requestNumber}, ${context.membership.id}::uuid,
          ${parsed.data.categoryId}::uuid, ${parsed.data.requestType}, ${parsed.data.title},
          ${parsed.data.justification}, ${parsed.data.neededByDate}::date, ${parsed.data.expectedReturnAt}::timestamptz,
          ${context.membership.id}::uuid, ${context.membership.id}::uuid
        ) returning id
      `;
      const requestId = rows[0]?.id;
      if (!requestId) throw new Error("create-failed");
      await writeAuditEvent(sql, context, {
        action: "assets.request.created",
        entityType: "asset_request",
        entityId: requestId,
        afterState: {
          requestKey: assetRequestKey(requestNumber),
          requestType: parsed.data.requestType,
          categoryId: parsed.data.categoryId,
        },
        changedFields: ["request"],
      });
    });
    refresh();
    revalidatePath("/approvals");
    return success(`${assetRequestKey(requestNumber)} created.`);
  } catch {
    return failure("Asset request could not be created.");
  }
}

export async function submitAssetRequestAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetRequestIdSchema.safeParse({ requestId: value(formData, "requestId") });
  if (!parsed.success) return failure("Asset request reference is invalid.");
  const authorization = await authorizeCurrentUser([
    assetPermissionKeys.workspace,
    assetPermissionKeys.requestSubmit,
  ]);
  if (!authorization.allowed) return failure("You cannot submit Asset requests.");
  const context = authorization.context;
  try {
    const rows = await getDatabaseClient().begin(
      (sql) => sql<
        Array<{
          id: string;
          request_number: string | number;
          title: string;
          justification: string;
          request_type: string;
          category_id: string;
          category_name: string;
          needed_by_date: string | null;
          expected_return_at: string | null;
          status: string;
          manager_membership_id: string | null;
        }>
      >`
      select request.id, request.request_number, request.title, request.justification, request.request_type,
        request.category_id, category.name as category_name, request.needed_by_date::text,
        request.expected_return_at::text, request.status, membership.manager_membership_id
      from public.asset_requests request
      join public.asset_categories category on category.id = request.category_id
      join public.memberships membership on membership.id = request.requester_membership_id
      where request.id = ${parsed.data.requestId}::uuid
        and request.organization_id = ${context.membership.organizationId}::uuid
        and request.requester_membership_id = ${context.membership.id}::uuid
      for update of request
    `,
    );
    const request = rows[0];
    if (!request || !["draft", "revision_requested", "rejected"].includes(request.status)) {
      return failure("Only your draft, rejected, or revision-requested request can be submitted.");
    }
    const definitionKey = await ensureAssetRequestApprovalPolicy(
      context,
      Boolean(request.manager_membership_id),
    );
    await submitApprovalForRecordAtomically(
      context,
      {
        definitionKey,
        title: `Asset request: ${request.title}`,
        sourceModule: "assets",
        entityType: "asset_request",
        entityId: request.id,
        deepLink: "/assets",
        departmentId: null,
        amount: null,
        currency: null,
        dueAt: null,
        snapshot: {
          requestKey: assetRequestKey(Number(request.request_number)),
          title: request.title,
          justification: request.justification,
          requestType: request.request_type,
          categoryId: request.category_id,
          categoryName: request.category_name,
          neededByDate: request.needed_by_date,
          expectedReturnAt: request.expected_return_at,
        },
      },
      async (sql, approvalRequestId) => {
        const updated = await sql<Array<{ id: string }>>`
        update public.asset_requests
        set status = 'pending_approval', approval_request_id = ${approvalRequestId}::uuid,
          updated_by_membership_id = ${context.membership.id}::uuid
        where id = ${request.id}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and requester_membership_id = ${context.membership.id}::uuid
          and status in ('draft', 'revision_requested', 'rejected')
        returning id
      `;
        if (!updated[0]) throw new Error("request-state-changed");
        await writeAuditEvent(sql, context, {
          action: "assets.request.submitted",
          entityType: "asset_request",
          entityId: request.id,
          afterState: { approvalRequestId },
          changedFields: ["status", "approvalRequestId"],
        });
      },
    );
    refresh();
    revalidatePath("/approvals");
    return success("Asset request submitted for approval.");
  } catch (error) {
    if (error instanceof Error && error.message === "request-state-changed") {
      return failure(
        "The Asset request changed before approval submission. Refresh and try again.",
      );
    }
    return failure("Asset request could not be submitted.");
  }
}

export async function cancelAssetRequestAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetRequestIdSchema.safeParse({ requestId: value(formData, "requestId") });
  if (!parsed.success) return failure("Asset request reference is invalid.");
  const authorization = await authorizeCurrentUser([
    assetPermissionKeys.workspace,
    assetPermissionKeys.requestCancel,
  ]);
  if (!authorization.allowed) return failure("You cannot cancel Asset requests.");
  const context = authorization.context;
  try {
    const cancelled = await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
        update public.asset_requests
        set status = 'cancelled', cancelled_at = now(),
          updated_by_membership_id = ${context.membership.id}::uuid
        where id = ${parsed.data.requestId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and requester_membership_id = ${context.membership.id}::uuid
          and status in ('draft', 'revision_requested', 'rejected')
        returning id
      `;
      if (!rows[0]) return false;
      await writeAuditEvent(sql, context, {
        action: "assets.request.cancelled",
        entityType: "asset_request",
        entityId: parsed.data.requestId,
        afterState: { status: "cancelled" },
        changedFields: ["status", "cancelledAt"],
      });
      return true;
    });
    if (!cancelled) return failure("Only your unsubmitted request can be cancelled.");
    refresh();
    return success("Asset request cancelled.");
  } catch {
    return failure("Asset request could not be cancelled.");
  }
}

export async function fulfillAssetRequestAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetRequestFulfillSchema.safeParse({
    requestId: value(formData, "requestId"),
    assetId: value(formData, "assetId"),
    checkoutAt: value(formData, "checkoutAt"),
    expectedReturnAt: value(formData, "expectedReturnAt"),
    condition: value(formData, "condition"),
    notes: value(formData, "notes"),
  });
  if (!parsed.success)
    return failure("Check the fulfillment fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    assetPermissionKeys.workspace,
    assetPermissionKeys.requestManage,
    assetPermissionKeys.assign,
  ]);
  if (!authorization.allowed) return failure("You cannot fulfill Asset requests.");
  const context = authorization.context;
  let requesterId = "";
  let assetTag = "Asset";
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireAssetAccess(context, parsed.data.assetId, assetPermissionKeys.assign, sql);
      const requests = await sql<
        Array<{ requester_membership_id: string; category_id: string; status: string }>
      >`
        select requester_membership_id, category_id, status from public.asset_requests
        where id = ${parsed.data.requestId}::uuid and organization_id = ${context.membership.organizationId}::uuid for update
      `;
      const request = requests[0];
      if (!request || request.status !== "approved") throw new Error("not-approved");
      const assets = await sql<Array<{ asset_tag: string; category_id: string; status: string }>>`
        select asset_tag, category_id, status from public.assets
        where id = ${parsed.data.assetId}::uuid and organization_id = ${context.membership.organizationId}::uuid for update
      `;
      const asset = assets[0];
      if (
        !asset ||
        !["available", "received"].includes(asset.status) ||
        asset.category_id !== request.category_id
      )
        throw new Error("asset-invalid");
      requesterId = request.requester_membership_id;
      assetTag = asset.asset_tag;
      const assignments = await sql<Array<{ id: string }>>`
        insert into public.asset_assignments (organization_id, asset_id, membership_id, checkout_at, expected_return_at,
          checkout_condition, checkout_notes, assigned_by_membership_id) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.assetId}::uuid, ${requesterId}::uuid,
          ${parsed.data.checkoutAt}::timestamptz, ${parsed.data.expectedReturnAt}::timestamptz,
          ${parsed.data.condition}, ${parsed.data.notes}, ${context.membership.id}::uuid) returning id
      `;
      const assignmentId = assignments[0]?.id;
      if (!assignmentId) throw new Error("assignment-failed");
      await sql`update public.assets set status = 'assigned', condition = ${parsed.data.condition} where id = ${parsed.data.assetId}::uuid`;
      await sql`update public.asset_requests set status = 'fulfilled', fulfilled_asset_id = ${parsed.data.assetId}::uuid,
        fulfilled_assignment_id = ${assignmentId}::uuid, fulfilled_at = now(), updated_by_membership_id = ${context.membership.id}::uuid
        where id = ${parsed.data.requestId}::uuid`;
      await recordAssetEvent(sql, {
        organizationId: context.membership.organizationId,
        assetId: parsed.data.assetId,
        actorMembershipId: context.membership.id,
        eventType: "assets.request_fulfilled",
        details: { requestId: parsed.data.requestId, membershipId: requesterId },
      });
      await writeAuditEvent(sql, context, {
        action: "assets.request.fulfilled",
        entityType: "asset_request",
        entityId: parsed.data.requestId,
        afterState: { assetId: parsed.data.assetId, assignmentId },
        changedFields: ["status", "fulfilledAssetId", "assignment"],
      });
    });
    if (requesterId)
      await enqueueNotification({
        organizationId: context.membership.organizationId,
        recipientMembershipId: requesterId,
        category: "assignment",
        title: `${assetTag} assigned to you`,
        message: "Your approved Asset request has been fulfilled.",
        deepLink: "/assets",
        sourceModule: "assets",
        sourceEntityType: "asset_request",
        sourceEntityId: parsed.data.requestId,
        dedupeKey: `asset-request-fulfilled:${parsed.data.requestId}`,
        createdByMembershipId: context.membership.id,
      });
    refresh();
    return success("Approved Asset request fulfilled.");
  } catch (error) {
    if (error instanceof Error && error.message === "not-approved")
      return failure("Only an approved request can be fulfilled.");
    if (error instanceof Error && error.message === "asset-invalid")
      return failure("Choose an available Asset from the requested category.");
    return failure("Asset request could not be fulfilled.");
  }
}

export async function createAssetReturnRequestAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetReturnRequestCreateSchema.safeParse({
    assetId: value(formData, "assetId"),
    dueAt: value(formData, "dueAt"),
    notes: value(formData, "notes"),
  });
  if (!parsed.success)
    return failure("Check the return request fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    assetPermissionKeys.workspace,
    assetPermissionKeys.returnRequestManage,
  ]);
  if (!authorization.allowed) return failure("You cannot create Asset return requests.");
  const context = authorization.context;
  try {
    const rows = await getDatabaseClient()<Array<{ id: string }>>`
      insert into public.asset_return_requests (organization_id, asset_id, assignment_id, membership_id, reason, due_at, requested_by_membership_id, notes)
      select assignment.organization_id, assignment.asset_id, assignment.id, assignment.membership_id, 'manual',
        ${parsed.data.dueAt}::timestamptz, ${context.membership.id}::uuid, ${parsed.data.notes}
      from public.asset_assignments assignment
      where assignment.asset_id = ${parsed.data.assetId}::uuid and assignment.organization_id = ${context.membership.organizationId}::uuid
        and assignment.returned_at is null returning id
    `;
    const row = rows[0];
    if (!row) return failure("This Asset has no active assignment.");
    refresh();
    return success("Asset return requested.");
  } catch (error) {
    return failure(
      isUniqueViolation(error)
        ? "An active return request already exists."
        : "Return request could not be created.",
    );
  }
}

export async function updateAssetReturnRequestAction(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = assetReturnRequestUpdateSchema.safeParse({
    returnRequestId: value(formData, "returnRequestId"),
    action: value(formData, "action"),
    notes: value(formData, "notes"),
  });
  if (!parsed.success) return failure("Return request action is invalid.");
  const permission =
    parsed.data.action === "acknowledge"
      ? assetPermissionKeys.returnRequestAcknowledge
      : assetPermissionKeys.returnRequestManage;
  const authorization = await authorizeCurrentUser([assetPermissionKeys.workspace, permission]);
  if (!authorization.allowed) return failure("You cannot update this return request.");
  const context = authorization.context;
  try {
    const updated = await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string; asset_id: string; status: string }>>`
        update public.asset_return_requests
        set status = ${parsed.data.action === "acknowledge" ? "acknowledged" : "cancelled"},
          acknowledged_at = case when ${parsed.data.action} = 'acknowledge' then now() else acknowledged_at end,
          cancelled_at = case when ${parsed.data.action} = 'cancel' then now() else cancelled_at end,
          notes = coalesce(${parsed.data.notes}, notes), updated_at = now()
        where id = ${parsed.data.returnRequestId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and (
            (${parsed.data.action} = 'acknowledge' and status in ('pending', 'overdue'))
            or (${parsed.data.action} = 'cancel' and status in ('pending', 'acknowledged', 'overdue'))
          )
          and (${parsed.data.action} <> 'acknowledge' or membership_id = ${context.membership.id}::uuid)
        returning id, asset_id, status
      `;
      const row = rows[0];
      if (!row) return false;
      const eventType =
        parsed.data.action === "acknowledge"
          ? "assets.return_request_acknowledged"
          : "assets.return_request_cancelled";
      await recordAssetEvent(sql, {
        organizationId: context.membership.organizationId,
        assetId: row.asset_id,
        actorMembershipId: context.membership.id,
        eventType,
        details: { returnRequestId: row.id, notesPresent: Boolean(parsed.data.notes) },
      });
      await writeAuditEvent(sql, context, {
        action:
          parsed.data.action === "acknowledge"
            ? "assets.return_request.acknowledged"
            : "assets.return_request.cancelled",
        entityType: "asset_return_request",
        entityId: row.id,
        afterState: { status: row.status, notesPresent: Boolean(parsed.data.notes) },
        changedFields: [
          "status",
          parsed.data.action === "acknowledge" ? "acknowledgedAt" : "cancelledAt",
          "notes",
        ],
      });
      return true;
    });
    if (!updated) return failure("Return request is no longer actionable.");
    refresh();
    return success(
      parsed.data.action === "acknowledge"
        ? "Return request acknowledged."
        : "Return request cancelled.",
    );
  } catch {
    return failure("Return request could not be updated.");
  }
}
