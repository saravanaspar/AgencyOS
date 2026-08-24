"use server";

import { revalidatePath } from "next/cache";
import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import {
  createApprovalDefinition,
  submitApprovalForRecordAtomically,
} from "@/modules/approvals/server/approvals";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { requireDocumentAccess } from "@/modules/documents/server/documents";
import { legalPermissionKeys } from "@/modules/legal/legal";
import { requireLegalContractAccess } from "@/modules/legal/server/legal";
import { enqueueNotification } from "@/modules/notifications/server/notifications";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import {
  goodsReceiptSchema,
  purchaseOrderDocumentLinkSchema,
  purchaseOrderSchema,
  purchaseRequestIdSchema,
  purchaseRequestSchema,
  quotationSchema,
  quotationSelectionSchema,
  vendorBillPaymentSchema,
  vendorBillApprovalSchema,
  vendorBillSchema,
  vendorCategorySchema,
  vendorContactSchema,
  vendorContractLinkSchema,
  vendorDocumentLinkSchema,
  vendorNoteSchema,
  vendorSchema,
  type VendorActionState,
} from "@/modules/vendors/schemas/vendors";
import {
  VendorAccessError,
  requirePurchaseOrderAccess,
  requirePurchaseRequestAccess,
  requireVendorAccess,
} from "@/modules/vendors/server/vendors";
import {
  billMatchStatus,
  goodsReceiptKey,
  purchaseOrderKey,
  purchaseRequestKey,
  requestEstimatedTotalMinor,
  vendorKey,
  vendorPermissionKeys,
} from "@/modules/vendors/vendors";

const value = (formData: FormData, key: string) => formData.get(key);
const booleanValue = (formData: FormData, key: string) =>
  ["1", "true", "on"].includes(String(formData.get(key) ?? ""));
const success = (message: string): VendorActionState => ({ status: "success", message });
const failure = (message: string, fieldErrors?: Record<string, string[]>): VendorActionState => ({
  status: "error",
  message,
  fieldErrors,
});
const refresh = () => {
  revalidatePath("/vendors");
  revalidatePath("/assets");
  revalidatePath("/documents");
  revalidatePath("/approvals");
  revalidatePath("/notifications");
};
const isUniqueViolation = (error: unknown) =>
  Boolean(
    error && typeof error === "object" && "code" in error && Reflect.get(error, "code") === "23505",
  );

function dateTimeValue(raw: FormDataEntryValue | null): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return "";
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function parseRequestItems(raw: FormDataEntryValue | null) {
  if (typeof raw !== "string") return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [description = "", quantity = "", unit = "", price = "", ...specificationParts] = line
        .split("|")
        .map((part) => part.trim());
      return {
        description,
        quantity: Number(quantity),
        unit,
        estimatedUnitPriceMinor: Number(price),
        specifications: specificationParts.join(" | ") || null,
      };
    });
}

function parseReceiptItems(formData: FormData) {
  const items: Array<{
    purchaseOrderItemId: string;
    quantityReceived: number;
    condition: string;
    notes: string | null;
  }> = [];
  for (const [key, rawValue] of formData.entries()) {
    if (!key.startsWith("quantityReceived:")) continue;
    const purchaseOrderItemId = key.slice("quantityReceived:".length);
    const quantityReceived = Number(rawValue);
    if (!Number.isFinite(quantityReceived) || quantityReceived <= 0) continue;
    const condition = String(formData.get(`condition:${purchaseOrderItemId}`) ?? "accepted");
    const notesRaw = String(formData.get(`notes:${purchaseOrderItemId}`) ?? "").trim();
    items.push({
      purchaseOrderItemId,
      quantityReceived,
      condition,
      notes: notesRaw || null,
    });
  }
  return items;
}

async function recordVendorEvent(
  sql: TransactionSql,
  input: {
    organizationId: string;
    vendorId: string;
    actorMembershipId: string | null;
    eventType: string;
    details?: Record<string, unknown>;
  },
) {
  await sql`
    insert into public.vendor_events (
      organization_id, vendor_id, actor_membership_id, event_type, details
    ) values (
      ${input.organizationId}::uuid, ${input.vendorId}::uuid,
      ${input.actorMembershipId}::uuid, ${input.eventType},
      ${sql.json(toJsonValue(input.details ?? {}))}
    )
  `;
}

async function recordProcurementEvent(
  sql: TransactionSql,
  input: {
    organizationId: string;
    purchaseRequestId?: string | null;
    purchaseOrderId?: string | null;
    vendorBillId?: string | null;
    actorMembershipId: string | null;
    eventType: string;
    details?: Record<string, unknown>;
  },
) {
  await sql`
    insert into public.procurement_events (
      organization_id, purchase_request_id, purchase_order_id, vendor_bill_id,
      actor_membership_id, event_type, details
    ) values (
      ${input.organizationId}::uuid, ${input.purchaseRequestId ?? null}::uuid,
      ${input.purchaseOrderId ?? null}::uuid, ${input.vendorBillId ?? null}::uuid,
      ${input.actorMembershipId}::uuid, ${input.eventType},
      ${sql.json(toJsonValue(input.details ?? {}))}
    )
  `;
}

async function ensureProcurementApprovalPolicy(
  context: CurrentPermissionContext,
  hasManager: boolean,
): Promise<string> {
  const key = hasManager
    ? "procurement_purchase_request_manager_finance_operations"
    : "procurement_purchase_request_finance_operations";
  const database = getDatabaseClient();
  const existing = await database<Array<{ id: string }>>`
    select id from public.approval_definitions
    where organization_id = ${context.membership.organizationId}::uuid
      and key = ${key} and source_module = 'vendors'
      and entity_type = 'purchase_request' and status = 'active'
    limit 1
  `;
  if (existing[0]) return key;

  const steps = [
    ...(hasManager
      ? [
          {
            name: "Manager need approval",
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
      name: "Finance budget validation",
      stageOrder: hasManager ? 2 : 1,
      sortOrder: 1,
      selectorType: "role" as const,
      selectorRoleKey: "finance_manager",
      selectorMembershipId: null,
      decisionMode: "any" as const,
      conditions: {},
      commentRequired: true,
      reminderAfterHours: 24,
      escalationAfterHours: 72,
      expiresAfterHours: null,
    },
    {
      name: "Procurement authorization",
      stageOrder: hasManager ? 3 : 2,
      sortOrder: 1,
      selectorType: "role" as const,
      selectorRoleKey: "operations_administrator",
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
      name: "Purchase request approval",
      description:
        "Manager need approval when available, followed by Finance budget validation and Operations procurement authorization.",
      sourceModule: "vendors",
      entityType: "purchase_request",
      allowSelfApproval: false,
      allowReassignment: true,
      steps,
    });
    return key;
  } catch (error) {
    const raced = await database<Array<{ id: string }>>`
      select id from public.approval_definitions
      where organization_id = ${context.membership.organizationId}::uuid
        and key = ${key} and source_module = 'vendors'
        and entity_type = 'purchase_request' and status = 'active'
      limit 1
    `;
    if (!raced[0]) throw error;
    return key;
  }
}

async function ensureVendorBillApprovalPolicy(context: CurrentPermissionContext): Promise<string> {
  const database = getDatabaseClient();
  const financeApprover = await database<Array<{ id: string }>>`
    select membership.id
    from public.memberships membership
    join public.membership_roles assignment on assignment.membership_id = membership.id
    join public.roles role on role.id = assignment.role_id
    where membership.organization_id = ${context.membership.organizationId}::uuid
      and membership.status = 'active' and membership.id <> ${context.membership.id}::uuid
      and role.template_key = 'finance_manager'
    limit 1
  `;
  const selectorRoleKey = financeApprover[0] ? "finance_manager" : "owner";
  const key = `vendor_bill_${selectorRoleKey}`;
  const existing = await database<Array<{ id: string }>>`
    select id from public.approval_definitions
    where organization_id = ${context.membership.organizationId}::uuid and key = ${key}
      and source_module = 'vendors' and entity_type = 'vendor_bill' and status = 'active' limit 1
  `;
  if (existing[0]) return key;
  try {
    await createApprovalDefinition(context, {
      key,
      name: "Vendor bill approval",
      description: "Finance approval for a purchase-order matched Vendor bill.",
      sourceModule: "vendors",
      entityType: "vendor_bill",
      allowSelfApproval: false,
      allowReassignment: true,
      steps: [
        {
          name: "Finance authorization",
          stageOrder: 1,
          sortOrder: 1,
          selectorType: "role",
          selectorRoleKey,
          selectorMembershipId: null,
          decisionMode: "any",
          conditions: {},
          commentRequired: true,
          reminderAfterHours: 24,
          escalationAfterHours: 72,
          expiresAfterHours: null,
        },
      ],
    });
  } catch (error) {
    const raced = await database<Array<{ id: string }>>`select id from public.approval_definitions
      where organization_id = ${context.membership.organizationId}::uuid and key = ${key}
        and source_module = 'vendors' and entity_type = 'vendor_bill' and status = 'active' limit 1`;
    if (!raced[0]) throw error;
  }
  return key;
}

export async function createVendorCategoryAction(
  _previous: VendorActionState,
  formData: FormData,
): Promise<VendorActionState> {
  const parsed = vendorCategorySchema.safeParse({
    name: value(formData, "name"),
    description: value(formData, "description"),
  });
  if (!parsed.success)
    return failure("Check the category fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    vendorPermissionKeys.workspace,
    vendorPermissionKeys.manageCategories,
  ]);
  if (!authorization.allowed) return failure("You cannot manage vendor categories.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
        insert into public.vendor_categories (
          organization_id, name, description, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.name},
          ${parsed.data.description}, ${context.membership.id}::uuid
        ) returning id
      `;
      await writeAuditEvent(sql, context, {
        action: "vendors.category.created",
        entityType: "vendor_category",
        entityId: rows[0]?.id,
        afterState: parsed.data,
        changedFields: ["category"],
      });
    });
    refresh();
    return success("Vendor category created.");
  } catch (error) {
    return failure(
      isUniqueViolation(error)
        ? "A category with this name already exists."
        : "Category could not be created.",
    );
  }
}

export async function saveVendorAction(
  _previous: VendorActionState,
  formData: FormData,
): Promise<VendorActionState> {
  const parsed = vendorSchema.safeParse({
    vendorId: value(formData, "vendorId"),
    legalName: value(formData, "legalName"),
    displayName: value(formData, "displayName"),
    primaryCategoryId: value(formData, "primaryCategoryId"),
    categoryIds: formData.getAll("categoryIds").map(String),
    status: value(formData, "status"),
    riskClassification: value(formData, "riskClassification"),
    ownerMembershipId: value(formData, "ownerMembershipId"),
    website: value(formData, "website"),
    email: value(formData, "email"),
    phone: value(formData, "phone"),
    address: value(formData, "address"),
    countryCode: value(formData, "countryCode"),
    defaultCurrency: value(formData, "defaultCurrency"),
    paymentTermsDays: value(formData, "paymentTermsDays"),
    onboardingDate: value(formData, "onboardingDate"),
    nextReviewDate: value(formData, "nextReviewDate"),
    taxCountryCode: value(formData, "taxCountryCode"),
    taxIdentifier: value(formData, "taxIdentifier"),
    taxRegistrationName: value(formData, "taxRegistrationName"),
    bankName: value(formData, "bankName"),
    bankAccountName: value(formData, "bankAccountName"),
    bankAccountLastFour: value(formData, "bankAccountLastFour"),
    bankRoutingReference: value(formData, "bankRoutingReference"),
    paymentInstructions: value(formData, "paymentInstructions"),
  });
  if (!parsed.success)
    return failure("Check the vendor fields.", parsed.error.flatten().fieldErrors);
  const permission = parsed.data.vendorId
    ? vendorPermissionKeys.update
    : vendorPermissionKeys.create;
  const authorization = await authorizeCurrentUser([vendorPermissionKeys.workspace, permission]);
  if (!authorization.allowed) return failure("You cannot save vendor profiles.");
  const context = authorization.context;
  const canWriteSensitive = context.permissions.has(vendorPermissionKeys.viewSensitive);

  try {
    const result = await getDatabaseClient().begin(async (sql) => {
      if (parsed.data.ownerMembershipId) {
        const owners = await sql<Array<{ id: string }>>`
          select id from public.memberships
          where id = ${parsed.data.ownerMembershipId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid and status = 'active'
        `;
        if (!owners[0]) throw new Error("owner-invalid");
      }
      if (parsed.data.primaryCategoryId) {
        const categories = await sql<Array<{ id: string }>>`
          select id from public.vendor_categories
          where id = ${parsed.data.primaryCategoryId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid and status = 'active'
        `;
        if (!categories[0]) throw new Error("category-invalid");
      }
      if (parsed.data.categoryIds.length > 0) {
        const categoryRows = await sql<Array<{ id: string }>>`
          select id from public.vendor_categories
          where id = any(${parsed.data.categoryIds}::uuid[])
            and organization_id = ${context.membership.organizationId}::uuid and status = 'active'
        `;
        if (categoryRows.length !== new Set(parsed.data.categoryIds).size)
          throw new Error("category-invalid");
      }

      let vendorId = parsed.data.vendorId;
      let vendorNumber: number;
      if (vendorId) {
        await requireVendorAccess(context, vendorId, vendorPermissionKeys.update, sql);
        const rows = await sql<Array<{ vendor_number: string | number }>>`
          update public.vendors set
            legal_name = ${parsed.data.legalName}, display_name = ${parsed.data.displayName},
            primary_category_id = ${parsed.data.primaryCategoryId}::uuid,
            status = ${parsed.data.status}, risk_classification = ${parsed.data.riskClassification},
            owner_membership_id = ${parsed.data.ownerMembershipId}::uuid,
            website = ${parsed.data.website}, email = ${parsed.data.email}, phone = ${parsed.data.phone},
            address = ${parsed.data.address}, country_code = ${parsed.data.countryCode},
            default_currency = ${parsed.data.defaultCurrency},
            payment_terms_days = ${parsed.data.paymentTermsDays},
            onboarding_date = ${parsed.data.onboardingDate}::date,
            next_review_date = ${parsed.data.nextReviewDate}::date
          where id = ${vendorId}::uuid and organization_id = ${context.membership.organizationId}::uuid
          returning vendor_number
        `;
        if (!rows[0]) throw new Error("vendor-missing");
        vendorNumber = Number(rows[0].vendor_number);
      } else {
        const numberRows = await sql<Array<{ vendor_number: string | number }>>`
          insert into public.procurement_counters (organization_id, next_vendor_number)
          values (${context.membership.organizationId}::uuid, 2)
          on conflict (organization_id) do update
            set next_vendor_number = public.procurement_counters.next_vendor_number + 1,
              updated_at = now()
          returning next_vendor_number - 1 as vendor_number
        `;
        vendorNumber = Number(numberRows[0]?.vendor_number);
        const rows = await sql<Array<{ id: string }>>`
          insert into public.vendors (
            organization_id, vendor_number, legal_name, display_name, primary_category_id,
            status, risk_classification, owner_membership_id, website, email, phone,
            address, country_code, default_currency, payment_terms_days,
            onboarding_date, next_review_date, created_by_membership_id
          ) values (
            ${context.membership.organizationId}::uuid, ${vendorNumber}, ${parsed.data.legalName},
            ${parsed.data.displayName}, ${parsed.data.primaryCategoryId}::uuid,
            ${parsed.data.status}, ${parsed.data.riskClassification},
            ${parsed.data.ownerMembershipId}::uuid, ${parsed.data.website}, ${parsed.data.email},
            ${parsed.data.phone}, ${parsed.data.address}, ${parsed.data.countryCode},
            ${parsed.data.defaultCurrency}, ${parsed.data.paymentTermsDays},
            ${parsed.data.onboardingDate}::date, ${parsed.data.nextReviewDate}::date,
            ${context.membership.id}::uuid
          ) returning id
        `;
        vendorId = rows[0]?.id ?? null;
        if (!vendorId) throw new Error("vendor-create-failed");
      }

      await sql`delete from public.vendor_category_links where vendor_id = ${vendorId}::uuid`;
      const categoryIds = [...new Set(parsed.data.categoryIds)];
      if (categoryIds.length > 0) {
        await sql`
          insert into public.vendor_category_links (
            organization_id, vendor_id, category_id, created_by_membership_id
          )
          select ${context.membership.organizationId}::uuid, ${vendorId}::uuid,
            category_id, ${context.membership.id}::uuid
          from unnest(${categoryIds}::uuid[]) as category_id
        `;
      }

      if (canWriteSensitive) {
        const hasSensitiveData = [
          parsed.data.taxCountryCode,
          parsed.data.taxIdentifier,
          parsed.data.taxRegistrationName,
          parsed.data.bankName,
          parsed.data.bankAccountName,
          parsed.data.bankAccountLastFour,
          parsed.data.bankRoutingReference,
          parsed.data.paymentInstructions,
        ].some(Boolean);
        if (hasSensitiveData) {
          await sql`
            insert into public.vendor_financial_profiles (
              vendor_id, organization_id, tax_country_code, tax_identifier,
              tax_registration_name, bank_name, bank_account_name,
              bank_account_last_four, bank_routing_reference, payment_instructions,
              updated_by_membership_id
            ) values (
              ${vendorId}::uuid, ${context.membership.organizationId}::uuid,
              ${parsed.data.taxCountryCode}, ${parsed.data.taxIdentifier},
              ${parsed.data.taxRegistrationName}, ${parsed.data.bankName},
              ${parsed.data.bankAccountName}, ${parsed.data.bankAccountLastFour},
              ${parsed.data.bankRoutingReference}, ${parsed.data.paymentInstructions},
              ${context.membership.id}::uuid
            ) on conflict (vendor_id) do update set
              tax_country_code = excluded.tax_country_code,
              tax_identifier = excluded.tax_identifier,
              tax_registration_name = excluded.tax_registration_name,
              bank_name = excluded.bank_name,
              bank_account_name = excluded.bank_account_name,
              bank_account_last_four = excluded.bank_account_last_four,
              bank_routing_reference = excluded.bank_routing_reference,
              payment_instructions = excluded.payment_instructions,
              updated_by_membership_id = excluded.updated_by_membership_id
          `;
        }
      }

      await recordVendorEvent(sql, {
        organizationId: context.membership.organizationId,
        vendorId,
        actorMembershipId: context.membership.id,
        eventType: parsed.data.vendorId ? "vendors.vendor_updated" : "vendors.vendor_created",
        details: {
          status: parsed.data.status,
          riskClassification: parsed.data.riskClassification,
          categoryCount: parsed.data.categoryIds.length,
        },
      });
      await writeAuditEvent(sql, context, {
        action: parsed.data.vendorId ? "vendors.vendor.updated" : "vendors.vendor.created",
        entityType: "vendor",
        entityId: vendorId,
        afterState: {
          vendorKey: vendorKey(vendorNumber),
          displayName: parsed.data.displayName,
          status: parsed.data.status,
          riskClassification: parsed.data.riskClassification,
          sensitiveProfileUpdated: canWriteSensitive,
        },
        changedFields: [
          "vendor",
          "categories",
          ...(canWriteSensitive ? ["financial_profile"] : []),
        ],
      });
      return { vendorId, vendorNumber };
    });
    refresh();
    return success(
      `${vendorKey(result.vendorNumber)} ${parsed.data.vendorId ? "updated" : "created"}.`,
    );
  } catch (error) {
    if (error instanceof VendorAccessError) return failure(error.message);
    if (isUniqueViolation(error))
      return failure("This vendor conflicts with an existing vendor record.");
    if (error instanceof Error && error.message === "owner-invalid")
      return failure("Choose an active vendor owner.");
    if (error instanceof Error && error.message === "category-invalid")
      return failure("Choose active vendor categories.");
    return failure("Vendor could not be saved.");
  }
}

export async function addVendorContactAction(
  _previous: VendorActionState,
  formData: FormData,
): Promise<VendorActionState> {
  const parsed = vendorContactSchema.safeParse({
    vendorId: value(formData, "vendorId"),
    name: value(formData, "name"),
    roleTitle: value(formData, "roleTitle"),
    email: value(formData, "email"),
    phone: value(formData, "phone"),
    isPrimary: booleanValue(formData, "isPrimary"),
  });
  if (!parsed.success)
    return failure("Check the contact fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    vendorPermissionKeys.workspace,
    vendorPermissionKeys.update,
  ]);
  if (!authorization.allowed) return failure("You cannot add vendor contacts.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireVendorAccess(context, parsed.data.vendorId, vendorPermissionKeys.update, sql);
      if (parsed.data.isPrimary) {
        await sql`
          update public.vendor_contacts set is_primary = false
          where vendor_id = ${parsed.data.vendorId}::uuid and status = 'active'
        `;
      }
      const rows = await sql<Array<{ id: string }>>`
        insert into public.vendor_contacts (
          organization_id, vendor_id, name, role_title, email, phone,
          is_primary, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.vendorId}::uuid,
          ${parsed.data.name}, ${parsed.data.roleTitle}, ${parsed.data.email},
          ${parsed.data.phone}, ${parsed.data.isPrimary}, ${context.membership.id}::uuid
        ) returning id
      `;
      await recordVendorEvent(sql, {
        organizationId: context.membership.organizationId,
        vendorId: parsed.data.vendorId,
        actorMembershipId: context.membership.id,
        eventType: "vendors.contact_added",
        details: { contactId: rows[0]?.id, primary: parsed.data.isPrimary },
      });
      await writeAuditEvent(sql, context, {
        action: "vendors.contact.created",
        entityType: "vendor_contact",
        entityId: rows[0]?.id,
        afterState: { vendorId: parsed.data.vendorId, primary: parsed.data.isPrimary },
        changedFields: ["contact"],
      });
    });
    refresh();
    return success("Vendor contact added.");
  } catch (error) {
    return failure(
      error instanceof VendorAccessError ? error.message : "Vendor contact could not be added.",
    );
  }
}

export async function addVendorNoteAction(
  _previous: VendorActionState,
  formData: FormData,
): Promise<VendorActionState> {
  const parsed = vendorNoteSchema.safeParse({
    vendorId: value(formData, "vendorId"),
    noteType: value(formData, "noteType"),
    rating: value(formData, "rating"),
    content: value(formData, "content"),
  });
  if (!parsed.success) return failure("Check the note fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    vendorPermissionKeys.workspace,
    vendorPermissionKeys.note,
  ]);
  if (!authorization.allowed) return failure("You cannot add vendor notes.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireVendorAccess(context, parsed.data.vendorId, vendorPermissionKeys.note, sql);
      const rows = await sql<Array<{ id: string }>>`
        insert into public.vendor_notes (
          organization_id, vendor_id, note_type, rating, content, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.vendorId}::uuid,
          ${parsed.data.noteType}, ${parsed.data.rating}, ${parsed.data.content},
          ${context.membership.id}::uuid
        ) returning id
      `;
      await recordVendorEvent(sql, {
        organizationId: context.membership.organizationId,
        vendorId: parsed.data.vendorId,
        actorMembershipId: context.membership.id,
        eventType: "vendors.note_added",
        details: {
          noteId: rows[0]?.id,
          noteType: parsed.data.noteType,
          rating: parsed.data.rating,
        },
      });
      await writeAuditEvent(sql, context, {
        action: "vendors.note.created",
        entityType: "vendor_note",
        entityId: rows[0]?.id,
        afterState: {
          vendorId: parsed.data.vendorId,
          noteType: parsed.data.noteType,
          rating: parsed.data.rating,
        },
        changedFields: ["note"],
      });
    });
    refresh();
    return success("Vendor note added to immutable history.");
  } catch (error) {
    return failure(
      error instanceof VendorAccessError ? error.message : "Vendor note could not be added.",
    );
  }
}

export async function linkVendorContractAction(
  _previous: VendorActionState,
  formData: FormData,
): Promise<VendorActionState> {
  const parsed = vendorContractLinkSchema.safeParse({
    vendorId: value(formData, "vendorId"),
    contractId: value(formData, "contractId"),
    relationshipType: value(formData, "relationshipType"),
  });
  if (!parsed.success) return failure("Choose a vendor contract and relationship.");
  const authorization = await authorizeCurrentUser([
    vendorPermissionKeys.workspace,
    vendorPermissionKeys.linkContract,
    legalPermissionKeys.view,
  ]);
  if (!authorization.allowed) return failure("You cannot link Legal contracts to vendors.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireVendorAccess(
        context,
        parsed.data.vendorId,
        vendorPermissionKeys.linkContract,
        sql,
      );
      await requireLegalContractAccess(
        context,
        parsed.data.contractId,
        legalPermissionKeys.view,
        sql,
      );
      const rows = await sql<Array<{ id: string }>>`
        insert into public.vendor_contract_links (
          organization_id, vendor_id, contract_id, relationship_type, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.vendorId}::uuid,
          ${parsed.data.contractId}::uuid, ${parsed.data.relationshipType},
          ${context.membership.id}::uuid
        ) returning id
      `;
      await recordVendorEvent(sql, {
        organizationId: context.membership.organizationId,
        vendorId: parsed.data.vendorId,
        actorMembershipId: context.membership.id,
        eventType: "vendors.contract_linked",
        details: {
          contractId: parsed.data.contractId,
          relationshipType: parsed.data.relationshipType,
        },
      });
      await writeAuditEvent(sql, context, {
        action: "vendors.contract.linked",
        entityType: "vendor_contract_link",
        entityId: rows[0]?.id,
        afterState: parsed.data,
        changedFields: ["contract_link"],
      });
    });
    refresh();
    return success("Contract linked to vendor.");
  } catch (error) {
    return failure(
      isUniqueViolation(error)
        ? "This contract is already linked to the vendor."
        : error instanceof VendorAccessError
          ? error.message
          : "Contract could not be linked.",
    );
  }
}

export async function attachVendorDocumentAction(
  _previous: VendorActionState,
  formData: FormData,
): Promise<VendorActionState> {
  const parsed = vendorDocumentLinkSchema.safeParse({
    vendorId: value(formData, "vendorId"),
    documentId: value(formData, "documentId"),
  });
  if (!parsed.success) return failure("Choose a vendor and document.");
  const authorization = await authorizeCurrentUser([
    vendorPermissionKeys.workspace,
    vendorPermissionKeys.linkDocument,
  ]);
  if (!authorization.allowed) return failure("You cannot link Documents to vendors.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireVendorAccess(
        context,
        parsed.data.vendorId,
        vendorPermissionKeys.linkDocument,
        sql,
      );
      await requireDocumentAccess(context, parsed.data.documentId, "edit", sql);
      await sql`
        insert into public.document_entity_links (
          organization_id, document_id, entity_type, entity_id, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.documentId}::uuid,
          'vendor', ${parsed.data.vendorId}::uuid, ${context.membership.id}::uuid
        ) on conflict do nothing
      `;
      await recordVendorEvent(sql, {
        organizationId: context.membership.organizationId,
        vendorId: parsed.data.vendorId,
        actorMembershipId: context.membership.id,
        eventType: "vendors.document_linked",
        details: { documentId: parsed.data.documentId },
      });
      await writeAuditEvent(sql, context, {
        action: "vendors.document.linked",
        entityType: "vendor",
        entityId: parsed.data.vendorId,
        afterState: { documentId: parsed.data.documentId },
        changedFields: ["document_link"],
      });
    });
    refresh();
    return success("Document linked to vendor.");
  } catch (error) {
    return failure(
      error instanceof VendorAccessError ? error.message : "Document could not be linked.",
    );
  }
}

export async function createPurchaseRequestAction(
  _previous: VendorActionState,
  formData: FormData,
): Promise<VendorActionState> {
  const parsed = purchaseRequestSchema.safeParse({
    title: value(formData, "title"),
    businessJustification: value(formData, "businessJustification"),
    departmentId: value(formData, "departmentId"),
    projectId: value(formData, "projectId"),
    budgetMinor: value(formData, "budgetMinor"),
    currency: value(formData, "currency"),
    requiredByDate: value(formData, "requiredByDate"),
    items: parseRequestItems(value(formData, "items")),
  });
  if (!parsed.success)
    return failure(
      "Check the purchase request and item lines.",
      parsed.error.flatten().fieldErrors,
    );
  const authorization = await authorizeCurrentUser([
    vendorPermissionKeys.workspace,
    vendorPermissionKeys.requestCreate,
  ]);
  if (!authorization.allowed) return failure("You cannot create purchase requests.");
  const context = authorization.context;
  const estimatedTotalMinor = requestEstimatedTotalMinor(parsed.data.items);
  if (estimatedTotalMinor > parsed.data.budgetMinor) {
    return failure("The request item estimate exceeds the stated budget.");
  }
  try {
    const result = await getDatabaseClient().begin(async (sql) => {
      if (parsed.data.departmentId) {
        const rows = await sql<Array<{ id: string }>>`
          select id from public.departments where id = ${parsed.data.departmentId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid and status = 'active'
        `;
        if (!rows[0]) throw new Error("department-invalid");
      }
      if (parsed.data.projectId) {
        const rows = await sql<Array<{ id: string }>>`
          select id from public.projects where id = ${parsed.data.projectId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid and archived_at is null
        `;
        if (!rows[0]) throw new Error("project-invalid");
      }
      const numberRows = await sql<Array<{ request_number: string | number }>>`
        insert into public.procurement_counters (organization_id, next_request_number)
        values (${context.membership.organizationId}::uuid, 2)
        on conflict (organization_id) do update
          set next_request_number = public.procurement_counters.next_request_number + 1,
            updated_at = now()
        returning next_request_number - 1 as request_number
      `;
      const requestNumber = Number(numberRows[0]?.request_number);
      const rows = await sql<Array<{ id: string }>>`
        insert into public.procurement_purchase_requests (
          organization_id, request_number, title, business_justification,
          requester_membership_id, department_id, project_id, budget_minor,
          currency, required_by_date, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${requestNumber}, ${parsed.data.title},
          ${parsed.data.businessJustification}, ${context.membership.id}::uuid,
          ${parsed.data.departmentId}::uuid, ${parsed.data.projectId}::uuid,
          ${parsed.data.budgetMinor}, ${parsed.data.currency},
          ${parsed.data.requiredByDate}::date, ${context.membership.id}::uuid
        ) returning id
      `;
      const purchaseRequestId = rows[0]?.id;
      if (!purchaseRequestId) throw new Error("request-create-failed");
      await sql`
        insert into public.procurement_purchase_request_items (
          organization_id, purchase_request_id, description, specifications,
          quantity, unit, estimated_unit_price_minor, sort_order
        )
        select ${context.membership.organizationId}::uuid, ${purchaseRequestId}::uuid,
          item.description, item.specifications, item.quantity, item.unit,
          item.estimated_unit_price_minor, item.ordinality::integer
        from unnest(
          ${parsed.data.items.map((item) => item.description)}::text[],
          ${parsed.data.items.map((item) => item.specifications)}::text[],
          ${parsed.data.items.map((item) => item.quantity)}::numeric[],
          ${parsed.data.items.map((item) => item.unit)}::text[],
          ${parsed.data.items.map((item) => item.estimatedUnitPriceMinor)}::bigint[]
        ) with ordinality as item(
          description, specifications, quantity, unit, estimated_unit_price_minor, ordinality
        )
      `;
      await recordProcurementEvent(sql, {
        organizationId: context.membership.organizationId,
        purchaseRequestId,
        actorMembershipId: context.membership.id,
        eventType: "procurement.request_created",
        details: { requestNumber, itemCount: parsed.data.items.length, estimatedTotalMinor },
      });
      await writeAuditEvent(sql, context, {
        action: "vendors.purchase_request.created",
        entityType: "purchase_request",
        entityId: purchaseRequestId,
        afterState: {
          requestKey: purchaseRequestKey(requestNumber),
          itemCount: parsed.data.items.length,
          budgetMinor: parsed.data.budgetMinor,
          currency: parsed.data.currency,
        },
        changedFields: ["purchase_request", "items"],
      });
      return { purchaseRequestId, requestNumber };
    });
    refresh();
    return success(`${purchaseRequestKey(result.requestNumber)} created as a draft.`);
  } catch (error) {
    if (error instanceof Error && error.message === "department-invalid")
      return failure("Choose an active department.");
    if (error instanceof Error && error.message === "project-invalid")
      return failure("Choose an accessible active project.");
    return failure("Purchase request could not be created.");
  }
}

export async function submitPurchaseRequestAction(
  _previous: VendorActionState,
  formData: FormData,
): Promise<VendorActionState> {
  const parsed = purchaseRequestIdSchema.safeParse({
    purchaseRequestId: value(formData, "purchaseRequestId"),
  });
  if (!parsed.success) return failure("Purchase request reference is invalid.");
  const authorization = await authorizeCurrentUser([
    vendorPermissionKeys.workspace,
    vendorPermissionKeys.requestSubmit,
  ]);
  if (!authorization.allowed) return failure("You cannot submit purchase requests.");
  const context = authorization.context;
  try {
    const database = getDatabaseClient();
    const rows = await database.begin(async (sql) => {
      await requirePurchaseRequestAccess(
        context,
        parsed.data.purchaseRequestId,
        vendorPermissionKeys.requestSubmit,
        sql,
      );
      return sql<
        Array<{
          id: string;
          request_number: string | number;
          title: string;
          business_justification: string;
          requester_membership_id: string;
          department_id: string | null;
          project_id: string | null;
          budget_minor: string | number;
          currency: string;
          required_by_date: string | null;
          status: string;
          manager_membership_id: string | null;
          item_count: string | number;
        }>
      >`
        select request.id, request.request_number, request.title,
          request.business_justification, request.requester_membership_id,
          request.department_id, request.project_id, request.budget_minor,
          request.currency, request.required_by_date::text, request.status,
          membership.manager_membership_id,
          (select count(*) from public.procurement_purchase_request_items item
            where item.purchase_request_id = request.id) as item_count
        from public.procurement_purchase_requests request
        join public.memberships membership on membership.id = request.requester_membership_id
        where request.id = ${parsed.data.purchaseRequestId}::uuid
          and request.organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
    });
    const request = rows[0];
    if (!request || !["draft", "revision_requested", "rejected"].includes(request.status)) {
      return failure("Only draft, rejected, or revision-requested purchases can be submitted.");
    }
    const definitionKey = await ensureProcurementApprovalPolicy(
      context,
      Boolean(request.manager_membership_id),
    );
    const submitted = await submitApprovalForRecordAtomically(
      context,
      {
        definitionKey,
        title: `Purchase request: ${request.title}`,
        sourceModule: "vendors",
        entityType: "purchase_request",
        entityId: request.id,
        deepLink: "/vendors",
        departmentId: request.department_id,
        amount: Number(request.budget_minor) / 100,
        currency: request.currency,
        snapshot: {
          requestKey: purchaseRequestKey(Number(request.request_number)),
          title: request.title,
          businessJustification: request.business_justification,
          projectId: request.project_id,
          requiredByDate: request.required_by_date,
          itemCount: Number(request.item_count),
          budgetMinor: Number(request.budget_minor),
        },
        dueAt: null,
      },
      async (sql, requestId) => {
        await sql`
          update public.procurement_purchase_requests
          set status = 'pending_approval', approval_request_id = ${requestId}::uuid
          where id = ${request.id}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
            and status in ('draft', 'revision_requested', 'rejected')
        `;
        await recordProcurementEvent(sql, {
          organizationId: context.membership.organizationId,
          purchaseRequestId: request.id,
          actorMembershipId: context.membership.id,
          eventType: "procurement.request_submitted",
          details: { approvalRequestId: requestId, definitionKey },
        });
        await writeAuditEvent(sql, context, {
          action: "vendors.purchase_request.submitted",
          entityType: "purchase_request",
          entityId: request.id,
          afterState: { status: "pending_approval", approvalRequestId: requestId },
          changedFields: ["status", "approval_request_id"],
        });
      },
    );
    refresh();
    return success(
      `${purchaseRequestKey(Number(request.request_number))} submitted for approval (${submitted.requestId.slice(0, 8)}).`,
    );
  } catch (error) {
    if (error instanceof VendorAccessError) return failure(error.message);
    const message = error instanceof Error ? error.message : "";
    if (/no eligible approver|active approval policy|manager/i.test(message))
      return failure(message);
    return failure("Purchase request could not be submitted for approval.");
  }
}

export async function addVendorQuotationAction(
  _previous: VendorActionState,
  formData: FormData,
): Promise<VendorActionState> {
  const parsed = quotationSchema.safeParse({
    purchaseRequestId: value(formData, "purchaseRequestId"),
    vendorId: value(formData, "vendorId"),
    quotationReference: value(formData, "quotationReference"),
    quotedOn: value(formData, "quotedOn"),
    validUntil: value(formData, "validUntil"),
    subtotalMinor: value(formData, "subtotalMinor"),
    taxMinor: value(formData, "taxMinor"),
    shippingMinor: value(formData, "shippingMinor"),
    currency: value(formData, "currency"),
    leadTimeDays: value(formData, "leadTimeDays"),
    paymentTerms: value(formData, "paymentTerms"),
    notes: value(formData, "notes"),
    sourceDocumentId: value(formData, "sourceDocumentId"),
  });
  if (!parsed.success)
    return failure("Check the quotation fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    vendorPermissionKeys.workspace,
    vendorPermissionKeys.quotationManage,
  ]);
  if (!authorization.allowed) return failure("You cannot manage vendor quotations.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requirePurchaseRequestAccess(
        context,
        parsed.data.purchaseRequestId,
        vendorPermissionKeys.quotationManage,
        sql,
      );
      const requestRows = await sql<Array<{ status: string; currency: string }>>`
        select status, currency from public.procurement_purchase_requests
        where id = ${parsed.data.purchaseRequestId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const request = requestRows[0];
      if (!request || !["approved", "sourcing"].includes(request.status))
        throw new Error("request-not-approved");
      if (request.currency !== parsed.data.currency) throw new Error("currency-mismatch");
      await requireVendorAccess(context, parsed.data.vendorId, vendorPermissionKeys.view, sql);
      const vendorRows = await sql<Array<{ status: string }>>`
        select status from public.vendors where id = ${parsed.data.vendorId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
      `;
      if (!vendorRows[0] || vendorRows[0].status !== "active") throw new Error("vendor-inactive");
      if (parsed.data.sourceDocumentId) {
        await requireDocumentAccess(context, parsed.data.sourceDocumentId, "view", sql);
      }
      const rows = await sql<Array<{ id: string }>>`
        insert into public.procurement_vendor_quotations (
          organization_id, purchase_request_id, vendor_id, quotation_reference,
          quoted_on, valid_until, subtotal_minor, tax_minor, shipping_minor,
          currency, lead_time_days, payment_terms, notes, source_document_id,
          created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.purchaseRequestId}::uuid,
          ${parsed.data.vendorId}::uuid, ${parsed.data.quotationReference},
          ${parsed.data.quotedOn}::date, ${parsed.data.validUntil}::date,
          ${parsed.data.subtotalMinor}, ${parsed.data.taxMinor}, ${parsed.data.shippingMinor},
          ${parsed.data.currency}, ${parsed.data.leadTimeDays}, ${parsed.data.paymentTerms},
          ${parsed.data.notes}, ${parsed.data.sourceDocumentId}::uuid,
          ${context.membership.id}::uuid
        ) returning id
      `;
      await sql`
        update public.procurement_purchase_requests set status = 'sourcing'
        where id = ${parsed.data.purchaseRequestId}::uuid and status = 'approved'
      `;
      await recordProcurementEvent(sql, {
        organizationId: context.membership.organizationId,
        purchaseRequestId: parsed.data.purchaseRequestId,
        actorMembershipId: context.membership.id,
        eventType: "procurement.quotation_recorded",
        details: {
          quotationId: rows[0]?.id,
          vendorId: parsed.data.vendorId,
          totalMinor: parsed.data.subtotalMinor + parsed.data.taxMinor + parsed.data.shippingMinor,
        },
      });
      await writeAuditEvent(sql, context, {
        action: "vendors.quotation.created",
        entityType: "vendor_quotation",
        entityId: rows[0]?.id,
        afterState: {
          purchaseRequestId: parsed.data.purchaseRequestId,
          vendorId: parsed.data.vendorId,
          reference: parsed.data.quotationReference,
        },
        changedFields: ["quotation", "request_status"],
      });
    });
    refresh();
    return success("Vendor quotation recorded.");
  } catch (error) {
    if (error instanceof VendorAccessError) return failure(error.message);
    if (isUniqueViolation(error))
      return failure("This vendor quotation reference already exists for the request.");
    if (error instanceof Error && error.message === "request-not-approved")
      return failure("Quotations can be recorded only for approved or sourcing requests.");
    if (error instanceof Error && error.message === "currency-mismatch")
      return failure("Quotation currency must match the purchase request.");
    if (error instanceof Error && error.message === "vendor-inactive")
      return failure("Choose an active vendor.");
    return failure("Quotation could not be recorded.");
  }
}

export async function selectVendorQuotationAction(
  _previous: VendorActionState,
  formData: FormData,
): Promise<VendorActionState> {
  const parsed = quotationSelectionSchema.safeParse({
    purchaseRequestId: value(formData, "purchaseRequestId"),
    quotationId: value(formData, "quotationId"),
  });
  if (!parsed.success) return failure("Quotation reference is invalid.");
  const authorization = await authorizeCurrentUser([
    vendorPermissionKeys.workspace,
    vendorPermissionKeys.quotationManage,
  ]);
  if (!authorization.allowed) return failure("You cannot select vendor quotations.");
  const context = authorization.context;
  try {
    const selected = await getDatabaseClient().begin(async (sql) => {
      await requirePurchaseRequestAccess(
        context,
        parsed.data.purchaseRequestId,
        vendorPermissionKeys.quotationManage,
        sql,
      );
      const rows = await sql<
        Array<{ vendor_id: string; vendor_name: string; quotation_reference: string }>
      >`
        select quotation.vendor_id, vendor.display_name as vendor_name,
          quotation.quotation_reference
        from public.procurement_vendor_quotations quotation
        join public.vendors vendor on vendor.id = quotation.vendor_id
        join public.procurement_purchase_requests request on request.id = quotation.purchase_request_id
        where quotation.id = ${parsed.data.quotationId}::uuid
          and quotation.purchase_request_id = ${parsed.data.purchaseRequestId}::uuid
          and quotation.organization_id = ${context.membership.organizationId}::uuid
          and quotation.status = 'submitted'
          and request.status in ('approved', 'sourcing')
          and vendor.status = 'active'
        for update of quotation, request
      `;
      const quotation = rows[0];
      if (!quotation) throw new Error("quotation-not-selectable");
      await sql`
        update public.procurement_vendor_quotations
        set status = case when id = ${parsed.data.quotationId}::uuid then 'selected' else 'rejected' end
        where purchase_request_id = ${parsed.data.purchaseRequestId}::uuid
          and status in ('submitted', 'selected')
      `;
      await sql`
        update public.procurement_purchase_requests
        set status = 'sourcing', selected_vendor_id = ${quotation.vendor_id}::uuid,
          selected_quotation_id = ${parsed.data.quotationId}::uuid
        where id = ${parsed.data.purchaseRequestId}::uuid
      `;
      await recordProcurementEvent(sql, {
        organizationId: context.membership.organizationId,
        purchaseRequestId: parsed.data.purchaseRequestId,
        actorMembershipId: context.membership.id,
        eventType: "procurement.vendor_selected",
        details: { quotationId: parsed.data.quotationId, vendorId: quotation.vendor_id },
      });
      await writeAuditEvent(sql, context, {
        action: "vendors.quotation.selected",
        entityType: "purchase_request",
        entityId: parsed.data.purchaseRequestId,
        afterState: { quotationId: parsed.data.quotationId, vendorId: quotation.vendor_id },
        changedFields: ["selected_quotation", "selected_vendor"],
      });
      return quotation;
    });
    refresh();
    return success(`${selected.vendor_name} selected (${selected.quotation_reference}).`);
  } catch (error) {
    return failure(
      error instanceof VendorAccessError ? error.message : "Quotation is no longer selectable.",
    );
  }
}

export async function issuePurchaseOrderAction(
  _previous: VendorActionState,
  formData: FormData,
): Promise<VendorActionState> {
  const parsed = purchaseOrderSchema.safeParse({
    purchaseRequestId: value(formData, "purchaseRequestId"),
    issueDate: value(formData, "issueDate"),
    expectedDeliveryDate: value(formData, "expectedDeliveryDate"),
    contractId: value(formData, "contractId"),
    paymentTerms: value(formData, "paymentTerms"),
    deliveryAddress: value(formData, "deliveryAddress"),
  });
  if (!parsed.success)
    return failure("Check the purchase order fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    vendorPermissionKeys.workspace,
    vendorPermissionKeys.purchaseOrderManage,
  ]);
  if (!authorization.allowed) return failure("You cannot issue purchase orders.");
  const context = authorization.context;
  try {
    const created = await getDatabaseClient().begin(async (sql) => {
      await requirePurchaseRequestAccess(
        context,
        parsed.data.purchaseRequestId,
        vendorPermissionKeys.requestManage,
        sql,
      );
      const requestRows = await sql<
        Array<{
          request_number: string | number;
          title: string;
          requester_membership_id: string;
          status: string;
          selected_vendor_id: string | null;
          selected_quotation_id: string | null;
          quotation_subtotal_minor: string | number | null;
          quotation_tax_minor: string | number | null;
          quotation_shipping_minor: string | number | null;
          currency: string;
          quotation_payment_terms: string | null;
        }>
      >`
        select request.request_number, request.title, request.requester_membership_id,
          request.status, request.selected_vendor_id, request.selected_quotation_id,
          quotation.subtotal_minor as quotation_subtotal_minor,
          quotation.tax_minor as quotation_tax_minor,
          quotation.shipping_minor as quotation_shipping_minor,
          request.currency, quotation.payment_terms as quotation_payment_terms
        from public.procurement_purchase_requests request
        left join public.procurement_vendor_quotations quotation
          on quotation.id = request.selected_quotation_id
        where request.id = ${parsed.data.purchaseRequestId}::uuid
          and request.organization_id = ${context.membership.organizationId}::uuid
        for update of request
      `;
      const request = requestRows[0];
      if (
        !request ||
        !["approved", "sourcing"].includes(request.status) ||
        !request.selected_vendor_id ||
        !request.selected_quotation_id
      ) {
        throw new Error("request-not-ready");
      }
      if (parsed.data.contractId) {
        const links = await sql<Array<{ id: string }>>`
          select id from public.vendor_contract_links
          where vendor_id = ${request.selected_vendor_id}::uuid
            and contract_id = ${parsed.data.contractId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
        `;
        if (!links[0]) throw new Error("contract-not-linked");
      }
      const numberRows = await sql<Array<{ purchase_order_number: string | number }>>`
        insert into public.procurement_counters (organization_id, next_purchase_order_number)
        values (${context.membership.organizationId}::uuid, 2)
        on conflict (organization_id) do update
          set next_purchase_order_number = public.procurement_counters.next_purchase_order_number + 1,
            updated_at = now()
        returning next_purchase_order_number - 1 as purchase_order_number
      `;
      const purchaseOrderNumber = Number(numberRows[0]?.purchase_order_number);
      const rows = await sql<Array<{ id: string }>>`
        insert into public.procurement_purchase_orders (
          organization_id, purchase_order_number, purchase_request_id, vendor_id,
          selected_quotation_id, contract_id, issue_date, expected_delivery_date,
          subtotal_minor, tax_minor, shipping_minor, currency, payment_terms,
          delivery_address, issued_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${purchaseOrderNumber},
          ${parsed.data.purchaseRequestId}::uuid, ${request.selected_vendor_id}::uuid,
          ${request.selected_quotation_id}::uuid, ${parsed.data.contractId}::uuid,
          ${parsed.data.issueDate}::date, ${parsed.data.expectedDeliveryDate}::date,
          ${Number(request.quotation_subtotal_minor)}, ${Number(request.quotation_tax_minor)},
          ${Number(request.quotation_shipping_minor)}, ${request.currency},
          ${parsed.data.paymentTerms ?? request.quotation_payment_terms},
          ${parsed.data.deliveryAddress}, ${context.membership.id}::uuid
        ) returning id
      `;
      const purchaseOrderId = rows[0]?.id;
      if (!purchaseOrderId) throw new Error("order-create-failed");
      await sql`
        insert into public.procurement_purchase_order_items (
          organization_id, purchase_order_id, purchase_request_item_id,
          description, quantity, unit, unit_price_minor, sort_order
        )
        select item.organization_id, ${purchaseOrderId}::uuid, item.id,
          item.description, item.quantity, item.unit, item.estimated_unit_price_minor,
          item.sort_order
        from public.procurement_purchase_request_items item
        where item.purchase_request_id = ${parsed.data.purchaseRequestId}::uuid
        order by item.sort_order
      `;
      await sql`
        update public.procurement_purchase_requests set status = 'ordered'
        where id = ${parsed.data.purchaseRequestId}::uuid
      `;
      await recordProcurementEvent(sql, {
        organizationId: context.membership.organizationId,
        purchaseOrderId,
        actorMembershipId: context.membership.id,
        eventType: "procurement.purchase_order_issued",
        details: { purchaseRequestId: parsed.data.purchaseRequestId, purchaseOrderNumber },
      });
      await writeAuditEvent(sql, context, {
        action: "vendors.purchase_order.issued",
        entityType: "purchase_order",
        entityId: purchaseOrderId,
        afterState: {
          purchaseOrderKey: purchaseOrderKey(purchaseOrderNumber),
          purchaseRequestId: parsed.data.purchaseRequestId,
          vendorId: request.selected_vendor_id,
        },
        changedFields: ["purchase_order", "items", "request_status"],
      });
      return {
        purchaseOrderId,
        purchaseOrderNumber,
        requesterMembershipId: request.requester_membership_id,
        requestNumber: Number(request.request_number),
        title: request.title,
      };
    });
    if (created.requesterMembershipId !== context.membership.id) {
      await enqueueNotification({
        organizationId: context.membership.organizationId,
        recipientMembershipId: created.requesterMembershipId,
        category: "assignment",
        title: `${purchaseOrderKey(created.purchaseOrderNumber)} issued`,
        message: `${purchaseRequestKey(created.requestNumber)} — ${created.title}`,
        deepLink: "/vendors",
        sourceModule: "vendors",
        sourceEntityType: "purchase_order",
        sourceEntityId: created.purchaseOrderId,
        dedupeKey: `purchase-order-issued:${created.purchaseOrderId}`,
        createdByMembershipId: context.membership.id,
      });
    }
    refresh();
    return success(`${purchaseOrderKey(created.purchaseOrderNumber)} issued.`);
  } catch (error) {
    if (error instanceof VendorAccessError) return failure(error.message);
    if (isUniqueViolation(error))
      return failure("A purchase order already exists for this request.");
    if (error instanceof Error && error.message === "request-not-ready")
      return failure(
        "Select an active quotation for an approved request before issuing a purchase order.",
      );
    if (error instanceof Error && error.message === "contract-not-linked")
      return failure("Choose a contract already linked to the selected vendor.");
    return failure("Purchase order could not be issued.");
  }
}

export async function recordGoodsReceiptAction(
  _previous: VendorActionState,
  formData: FormData,
): Promise<VendorActionState> {
  const parsed = goodsReceiptSchema.safeParse({
    purchaseOrderId: value(formData, "purchaseOrderId"),
    receivedAt: dateTimeValue(value(formData, "receivedAt")),
    deliveryReference: value(formData, "deliveryReference"),
    status: value(formData, "status"),
    notes: value(formData, "notes"),
    items: parseReceiptItems(formData),
  });
  if (!parsed.success)
    return failure(
      "Check the receipt and received quantities.",
      parsed.error.flatten().fieldErrors,
    );
  const authorization = await authorizeCurrentUser([
    vendorPermissionKeys.workspace,
    vendorPermissionKeys.receiptRecord,
  ]);
  if (!authorization.allowed) return failure("You cannot record goods received.");
  const context = authorization.context;
  try {
    const created = await getDatabaseClient().begin(async (sql) => {
      await requirePurchaseOrderAccess(
        context,
        parsed.data.purchaseOrderId,
        vendorPermissionKeys.receiptRecord,
        sql,
      );
      const orderRows = await sql<
        Array<{
          purchase_order_number: string | number;
          purchase_request_id: string;
          requester_membership_id: string;
          status: string;
        }>
      >`
        select purchase_order.purchase_order_number, purchase_order.purchase_request_id,
          request.requester_membership_id, purchase_order.status
        from public.procurement_purchase_orders purchase_order
        join public.procurement_purchase_requests request on request.id = purchase_order.purchase_request_id
        where purchase_order.id = ${parsed.data.purchaseOrderId}::uuid
          and purchase_order.organization_id = ${context.membership.organizationId}::uuid
        for update of purchase_order, request
      `;
      const order = orderRows[0];
      if (!order || !["issued", "acknowledged", "partially_received"].includes(order.status))
        throw new Error("order-not-open");
      const itemIds = parsed.data.items.map((item) => item.purchaseOrderItemId);
      const itemRows = await sql<
        Array<{ id: string; quantity: string | number; received_quantity: string | number }>
      >`
        with locked_items as materialized (
          select item.id, item.quantity
          from public.procurement_purchase_order_items item
          where item.purchase_order_id = ${parsed.data.purchaseOrderId}::uuid
            and item.id = any(${itemIds}::uuid[])
          for update
        )
        select locked_item.id, locked_item.quantity,
          coalesce(sum(case when receipt.status <> 'rejected' and receipt_item.condition <> 'rejected'
            then receipt_item.quantity_received else 0 end), 0) as received_quantity
        from locked_items locked_item
        left join public.procurement_goods_receipt_items receipt_item
          on receipt_item.purchase_order_item_id = locked_item.id
        left join public.procurement_goods_receipts receipt on receipt.id = receipt_item.goods_receipt_id
        group by locked_item.id, locked_item.quantity
      `;
      if (itemRows.length !== new Set(itemIds).size) throw new Error("receipt-item-invalid");
      const existingById = new Map(itemRows.map((item) => [item.id, item]));
      for (const item of parsed.data.items) {
        const existing = existingById.get(item.purchaseOrderItemId);
        if (!existing) throw new Error("receipt-item-invalid");
        const outstanding = Number(existing.quantity) - Number(existing.received_quantity);
        if (item.quantityReceived > outstanding + 0.0001) throw new Error("receipt-overage");
      }
      const numberRows = await sql<Array<{ receipt_number: string | number }>>`
        insert into public.procurement_counters (organization_id, next_receipt_number)
        values (${context.membership.organizationId}::uuid, 2)
        on conflict (organization_id) do update
          set next_receipt_number = public.procurement_counters.next_receipt_number + 1,
            updated_at = now()
        returning next_receipt_number - 1 as receipt_number
      `;
      const receiptNumber = Number(numberRows[0]?.receipt_number);
      const receiptRows = await sql<Array<{ id: string }>>`
        insert into public.procurement_goods_receipts (
          organization_id, receipt_number, purchase_order_id, received_at,
          delivery_reference, status, notes, received_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${receiptNumber},
          ${parsed.data.purchaseOrderId}::uuid, ${parsed.data.receivedAt}::timestamptz,
          ${parsed.data.deliveryReference}, ${parsed.data.status}, ${parsed.data.notes},
          ${context.membership.id}::uuid
        ) returning id
      `;
      const goodsReceiptId = receiptRows[0]?.id;
      if (!goodsReceiptId) throw new Error("receipt-create-failed");
      await sql`
        insert into public.procurement_goods_receipt_items (
          organization_id, goods_receipt_id, purchase_order_item_id,
          quantity_received, condition, notes
        )
        select ${context.membership.organizationId}::uuid, ${goodsReceiptId}::uuid,
          item.purchase_order_item_id, item.quantity_received, item.condition, item.notes
        from unnest(
          ${parsed.data.items.map((item) => item.purchaseOrderItemId)}::uuid[],
          ${parsed.data.items.map((item) => item.quantityReceived)}::numeric[],
          ${parsed.data.items.map((item) => item.condition)}::text[],
          ${parsed.data.items.map((item) => item.notes)}::text[]
        ) as item(purchase_order_item_id, quantity_received, condition, notes)
      `;
      const completionRows = await sql<Array<{ complete: boolean }>>`
        select bool_and(received_quantity >= quantity) as complete
        from (
          select item.quantity,
            coalesce(sum(case when receipt.status <> 'rejected' and receipt_item.condition <> 'rejected'
              then receipt_item.quantity_received else 0 end), 0) as received_quantity
          from public.procurement_purchase_order_items item
          left join public.procurement_goods_receipt_items receipt_item on receipt_item.purchase_order_item_id = item.id
          left join public.procurement_goods_receipts receipt on receipt.id = receipt_item.goods_receipt_id
          where item.purchase_order_id = ${parsed.data.purchaseOrderId}::uuid
          group by item.id
        ) totals
      `;
      const completed = parsed.data.status === "complete" && completionRows[0]?.complete === true;
      const nextStatus =
        parsed.data.status === "rejected"
          ? order.status
          : completed
            ? "received"
            : "partially_received";
      if (parsed.data.status !== "rejected") {
        await sql`
          update public.procurement_purchase_orders set status = ${nextStatus}
          where id = ${parsed.data.purchaseOrderId}::uuid
        `;
        await sql`
          update public.procurement_purchase_requests set status = ${nextStatus}
          where id = ${order.purchase_request_id}::uuid
        `;
      }
      await recordProcurementEvent(sql, {
        organizationId: context.membership.organizationId,
        purchaseOrderId: parsed.data.purchaseOrderId,
        actorMembershipId: context.membership.id,
        eventType: completed
          ? "procurement.order_received"
          : "procurement.order_partially_received",
        details: { goodsReceiptId, receiptNumber, itemCount: parsed.data.items.length },
      });
      await writeAuditEvent(sql, context, {
        action: "vendors.goods_receipt.recorded",
        entityType: "goods_receipt",
        entityId: goodsReceiptId,
        afterState: {
          purchaseOrderId: parsed.data.purchaseOrderId,
          receiptNumber,
          status: parsed.data.status,
        },
        changedFields: ["goods_receipt", "receipt_items", "purchase_order_status"],
      });
      return {
        goodsReceiptId,
        receiptNumber,
        purchaseOrderNumber: Number(order.purchase_order_number),
        requesterMembershipId: order.requester_membership_id,
        completed,
      };
    });
    if (created.requesterMembershipId !== context.membership.id) {
      await enqueueNotification({
        organizationId: context.membership.organizationId,
        recipientMembershipId: created.requesterMembershipId,
        category: "assignment",
        title: `${goodsReceiptKey(created.receiptNumber)} recorded`,
        message: `${purchaseOrderKey(created.purchaseOrderNumber)} is ${created.completed ? "fully received" : "partially received"}.`,
        deepLink: "/vendors",
        sourceModule: "vendors",
        sourceEntityType: "goods_receipt",
        sourceEntityId: created.goodsReceiptId,
        dedupeKey: `goods-receipt:${created.goodsReceiptId}`,
        createdByMembershipId: context.membership.id,
      });
    }
    refresh();
    return success(`${goodsReceiptKey(created.receiptNumber)} recorded.`);
  } catch (error) {
    if (error instanceof VendorAccessError) return failure(error.message);
    if (error instanceof Error && error.message === "order-not-open")
      return failure("Only open purchase orders can receive goods or services.");
    if (error instanceof Error && error.message === "receipt-item-invalid")
      return failure("Choose valid purchase order items.");
    if (error instanceof Error && error.message === "receipt-overage")
      return failure("A received quantity exceeds the outstanding purchase order quantity.");
    return failure("Goods receipt could not be recorded.");
  }
}

export async function recordVendorBillAction(
  _previous: VendorActionState,
  formData: FormData,
): Promise<VendorActionState> {
  const parsed = vendorBillSchema.safeParse({
    purchaseOrderId: value(formData, "purchaseOrderId"),
    billReference: value(formData, "billReference"),
    invoiceDate: value(formData, "invoiceDate"),
    dueDate: value(formData, "dueDate"),
    subtotalMinor: value(formData, "subtotalMinor"),
    taxMinor: value(formData, "taxMinor"),
    currency: value(formData, "currency"),
    sourceDocumentId: value(formData, "sourceDocumentId"),
  });
  if (!parsed.success)
    return failure("Check the vendor bill fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    vendorPermissionKeys.workspace,
    vendorPermissionKeys.billManage,
  ]);
  if (!authorization.allowed) return failure("You cannot record vendor bills.");
  const context = authorization.context;
  try {
    const result = await getDatabaseClient().begin(async (sql) => {
      await requirePurchaseOrderAccess(
        context,
        parsed.data.purchaseOrderId,
        vendorPermissionKeys.billManage,
        sql,
      );
      const orderRows = await sql<
        Array<{
          vendor_id: string;
          total_minor: string | number;
          currency: string;
        }>
      >`
        select vendor_id, total_minor, currency from public.procurement_purchase_orders
        where id = ${parsed.data.purchaseOrderId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and status not in ('cancelled')
      `;
      const order = orderRows[0];
      if (!order) throw new Error("order-invalid");
      if (order.currency !== parsed.data.currency) throw new Error("currency-mismatch");
      if (parsed.data.sourceDocumentId) {
        await requireDocumentAccess(context, parsed.data.sourceDocumentId, "view", sql);
      }
      const totalMinor = parsed.data.subtotalMinor + parsed.data.taxMinor;
      const matchStatus = billMatchStatus({
        purchaseOrderTotalMinor: Number(order.total_minor),
        billTotalMinor: totalMinor,
      });
      const status = matchStatus === "matched" ? "matched" : "received";
      const rows = await sql<Array<{ id: string }>>`
        insert into public.procurement_vendor_bills (
          organization_id, purchase_order_id, vendor_id, bill_reference,
          invoice_date, due_date, subtotal_minor, tax_minor, currency,
          match_status, status, source_document_id,
          created_by_membership_id, updated_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.purchaseOrderId}::uuid,
          ${order.vendor_id}::uuid, ${parsed.data.billReference},
          ${parsed.data.invoiceDate}::date, ${parsed.data.dueDate}::date,
          ${parsed.data.subtotalMinor}, ${parsed.data.taxMinor}, ${parsed.data.currency},
          ${matchStatus}, ${status}, ${parsed.data.sourceDocumentId}::uuid,
          ${context.membership.id}::uuid, ${context.membership.id}::uuid
        ) returning id
      `;
      const billId = rows[0]?.id;
      if (!billId) throw new Error("bill-create-failed");
      await recordProcurementEvent(sql, {
        organizationId: context.membership.organizationId,
        vendorBillId: billId,
        actorMembershipId: context.membership.id,
        eventType:
          matchStatus === "matched" ? "procurement.bill_matched" : "procurement.bill_exception",
        details: {
          purchaseOrderId: parsed.data.purchaseOrderId,
          billReference: parsed.data.billReference,
          totalMinor,
        },
      });
      await writeAuditEvent(sql, context, {
        action: "vendors.bill.created",
        entityType: "vendor_bill",
        entityId: billId,
        afterState: {
          purchaseOrderId: parsed.data.purchaseOrderId,
          matchStatus,
          status,
          totalMinor,
        },
        changedFields: ["vendor_bill", "match_status"],
      });
      return { matchStatus };
    });
    refresh();
    return success(
      result.matchStatus === "matched"
        ? "Vendor bill recorded and matched."
        : "Vendor bill recorded with a purchase-order match exception.",
    );
  } catch (error) {
    if (error instanceof VendorAccessError) return failure(error.message);
    if (isUniqueViolation(error)) return failure("This vendor bill reference already exists.");
    if (error instanceof Error && error.message === "currency-mismatch")
      return failure("Bill currency must match the purchase order.");
    return failure("Vendor bill could not be recorded.");
  }
}

export async function submitVendorBillApprovalAction(
  _previous: VendorActionState,
  formData: FormData,
): Promise<VendorActionState> {
  const parsed = vendorBillApprovalSchema.safeParse({ billId: value(formData, "billId") });
  if (!parsed.success) return failure("Vendor bill reference is invalid.");
  const authorization = await authorizeCurrentUser([
    vendorPermissionKeys.workspace,
    vendorPermissionKeys.billSubmit,
  ]);
  if (!authorization.allowed) return failure("You cannot submit Vendor bills for approval.");
  const context = authorization.context;
  try {
    const rows = await getDatabaseClient().begin(
      (sql) => sql<
        Array<{
          id: string;
          purchase_order_id: string;
          bill_reference: string;
          total_minor: string | number;
          currency: string;
          due_date: string | null;
          status: string;
          match_status: string;
          vendor_name: string;
        }>
      >`
      select bill.id, bill.purchase_order_id, bill.bill_reference, bill.total_minor, bill.currency,
        bill.due_date::text, bill.status, bill.match_status, vendor.display_name as vendor_name
      from public.procurement_vendor_bills bill join public.vendors vendor on vendor.id = bill.vendor_id
      where bill.id = ${parsed.data.billId}::uuid and bill.organization_id = ${context.membership.organizationId}::uuid
        and private.purchase_order_membership_access_allowed(bill.purchase_order_id, ${context.membership.id}::uuid, ${vendorPermissionKeys.billSubmit})
      for update of bill
    `,
    );
    const bill = rows[0];
    if (
      !bill ||
      bill.match_status !== "matched" ||
      !["matched", "revision_requested", "rejected"].includes(bill.status)
    ) {
      return failure("Only a matched, rejected, or revision-requested bill can be submitted.");
    }
    const definitionKey = await ensureVendorBillApprovalPolicy(context);
    await submitApprovalForRecordAtomically(
      context,
      {
        definitionKey,
        title: `Vendor bill: ${bill.bill_reference}`,
        sourceModule: "vendors",
        entityType: "vendor_bill",
        entityId: bill.id,
        deepLink: "/vendors",
        departmentId: null,
        amount: Number(bill.total_minor) / 100,
        currency: bill.currency,
        dueAt: bill.due_date,
        snapshot: {
          billReference: bill.bill_reference,
          vendorName: bill.vendor_name,
          purchaseOrderId: bill.purchase_order_id,
          totalMinor: Number(bill.total_minor),
          currency: bill.currency,
          dueDate: bill.due_date,
        },
      },
      async (sql, approvalRequestId) => {
        const updated = await sql<Array<{ id: string }>>`
        update public.procurement_vendor_bills
        set status = 'pending_approval', approval_request_id = ${approvalRequestId}::uuid,
          updated_by_membership_id = ${context.membership.id}::uuid
        where id = ${bill.id}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and match_status = 'matched'
          and status in ('matched', 'revision_requested', 'rejected')
        returning id
      `;
        if (!updated[0]) throw new Error("bill-state-changed");
        await recordProcurementEvent(sql, {
          organizationId: context.membership.organizationId,
          vendorBillId: bill.id,
          actorMembershipId: context.membership.id,
          eventType: "procurement.bill_submitted",
          details: { approvalRequestId },
        });
        await writeAuditEvent(sql, context, {
          action: "vendors.bill.submitted",
          entityType: "vendor_bill",
          entityId: bill.id,
          afterState: { approvalRequestId },
          changedFields: ["status", "approvalRequestId"],
        });
      },
    );
    refresh();
    revalidatePath("/approvals");
    return success("Vendor bill submitted for shared approval.");
  } catch (error) {
    if (error instanceof VendorAccessError) return failure(error.message);
    if (error instanceof Error && error.message === "bill-state-changed") {
      return failure("The Vendor bill changed before approval submission. Refresh and try again.");
    }
    return failure("Vendor bill could not be submitted for approval.");
  }
}

export async function updateVendorBillPaymentAction(
  _previous: VendorActionState,
  formData: FormData,
): Promise<VendorActionState> {
  const parsed = vendorBillPaymentSchema.safeParse({
    billId: value(formData, "billId"),
    status: value(formData, "status"),
    paymentReference: value(formData, "paymentReference"),
  });
  if (!parsed.success)
    return failure("Check the vendor bill payment state.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    vendorPermissionKeys.workspace,
    vendorPermissionKeys.billPayment,
  ]);
  if (!authorization.allowed) return failure("You cannot manage vendor bill payments.");
  const context = authorization.context;
  if (parsed.data.status === "approved") {
    return failure("Submit a matched bill through the shared Approval workflow.");
  }
  if (parsed.data.status === "paid" && !parsed.data.paymentReference) {
    return failure("A payment reference is required when marking a bill paid.");
  }
  try {
    await getDatabaseClient().begin(async (sql) => {
      const billRows = await sql<
        Array<{
          purchase_order_id: string;
          status: string;
          match_status: string;
        }>
      >`
        select purchase_order_id, status, match_status from public.procurement_vendor_bills
        where id = ${parsed.data.billId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const bill = billRows[0];
      if (!bill) throw new Error("bill-missing");
      await requirePurchaseOrderAccess(
        context,
        bill.purchase_order_id,
        vendorPermissionKeys.billPayment,
        sql,
      );
      if (
        ["partially_paid", "paid"].includes(parsed.data.status) &&
        bill.status !== "approved" &&
        bill.status !== "partially_paid"
      ) {
        throw new Error("bill-not-approved");
      }
      if (
        ["partially_paid", "paid"].includes(parsed.data.status) &&
        bill.match_status !== "matched"
      ) {
        throw new Error("bill-unmatched");
      }
      if (bill.status === "void" || bill.status === "paid") throw new Error("bill-terminal");
      await sql`
        update public.procurement_vendor_bills
        set status = ${parsed.data.status}, payment_reference = ${parsed.data.paymentReference},
          paid_at = case when ${parsed.data.status} = 'paid' then now() else paid_at end,
          updated_by_membership_id = ${context.membership.id}::uuid
        where id = ${parsed.data.billId}::uuid
      `;
      await recordProcurementEvent(sql, {
        organizationId: context.membership.organizationId,
        vendorBillId: parsed.data.billId,
        actorMembershipId: context.membership.id,
        eventType: `procurement.bill_${parsed.data.status}`,
        details: { paymentReferencePresent: Boolean(parsed.data.paymentReference) },
      });
      await writeAuditEvent(sql, context, {
        action: "vendors.bill.payment_status_updated",
        entityType: "vendor_bill",
        entityId: parsed.data.billId,
        afterState: {
          status: parsed.data.status,
          paymentReferencePresent: Boolean(parsed.data.paymentReference),
        },
        changedFields: ["status", "payment_reference", "paid_at"],
      });
    });
    refresh();
    return success(`Vendor bill marked ${parsed.data.status.replaceAll("_", " ")}.`);
  } catch (error) {
    if (error instanceof VendorAccessError) return failure(error.message);
    if (error instanceof Error && error.message === "bill-unmatched")
      return failure("Only matched bills can be paid.");
    if (error instanceof Error && error.message === "bill-not-approved")
      return failure("The shared Approval workflow must approve this bill before payment.");
    if (error instanceof Error && error.message === "bill-terminal")
      return failure("Paid or void bills cannot be changed.");
    return failure("Vendor bill payment state could not be updated.");
  }
}

export async function attachPurchaseOrderDocumentAction(
  _previous: VendorActionState,
  formData: FormData,
): Promise<VendorActionState> {
  const parsed = purchaseOrderDocumentLinkSchema.safeParse({
    purchaseOrderId: value(formData, "purchaseOrderId"),
    documentId: value(formData, "documentId"),
  });
  if (!parsed.success) return failure("Choose a purchase order and document.");
  const authorization = await authorizeCurrentUser([
    vendorPermissionKeys.workspace,
    vendorPermissionKeys.purchaseOrderLinkDocument,
  ]);
  if (!authorization.allowed) return failure("You cannot link Documents to purchase orders.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requirePurchaseOrderAccess(
        context,
        parsed.data.purchaseOrderId,
        vendorPermissionKeys.purchaseOrderLinkDocument,
        sql,
      );
      await requireDocumentAccess(context, parsed.data.documentId, "edit", sql);
      await sql`
        insert into public.document_entity_links (
          organization_id, document_id, entity_type, entity_id, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.documentId}::uuid,
          'purchase_order', ${parsed.data.purchaseOrderId}::uuid,
          ${context.membership.id}::uuid
        ) on conflict do nothing
      `;
      await recordProcurementEvent(sql, {
        organizationId: context.membership.organizationId,
        purchaseOrderId: parsed.data.purchaseOrderId,
        actorMembershipId: context.membership.id,
        eventType: "procurement.document_linked",
        details: { documentId: parsed.data.documentId },
      });
      await writeAuditEvent(sql, context, {
        action: "vendors.purchase_order.document_linked",
        entityType: "purchase_order",
        entityId: parsed.data.purchaseOrderId,
        afterState: { documentId: parsed.data.documentId },
        changedFields: ["document_link"],
      });
    });
    refresh();
    return success("Document linked to purchase order.");
  } catch (error) {
    return failure(
      error instanceof VendorAccessError ? error.message : "Document could not be linked.",
    );
  }
}
