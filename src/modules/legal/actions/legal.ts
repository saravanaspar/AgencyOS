"use server";

import { revalidatePath } from "next/cache";
import type { TransactionSql } from "postgres";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { crmPermissionKeys } from "@/modules/crm/crm";
import {
  createApprovalDefinition,
  createApprovalRequest,
} from "@/modules/approvals/server/approvals";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { requireDocumentAccess } from "@/modules/documents/server/documents";
import { legalPermissionKeys } from "@/modules/legal/legal";
import {
  legalContractIdSchema,
  legalContractSchema,
  legalContractVersionSchema,
  legalLifecycleSchema,
  legalSignatureSchema,
  legalTemplateSchema,
  type LegalActionState,
} from "@/modules/legal/schemas/legal";
import { LegalAccessError, requireLegalContractAccess } from "@/modules/legal/server/legal";
import {
  legalPermissionScope,
  validateLegalOwnerAssignment,
} from "@/modules/legal/server/owner-validation";
import { enqueueNotification } from "@/modules/notifications/server/notifications";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

const success = (message: string): LegalActionState => ({ status: "success", message });
const failure = (message: string, fieldErrors?: Record<string, string[]>): LegalActionState => ({
  status: "error",
  message,
  fieldErrors,
});
const value = (formData: FormData, key: string) => formData.get(key);
const refresh = () => revalidatePath("/legal");
const isUniqueViolation = (error: unknown) =>
  Boolean(
    error && typeof error === "object" && "code" in error && Reflect.get(error, "code") === "23505",
  );

async function validateCounterpartyCompanyReference(
  sql: TransactionSql,
  context: CurrentPermissionContext,
  companyId: string | null,
): Promise<void> {
  if (!companyId) return;
  if (!context.permissions.has(crmPermissionKeys.companyView)) {
    throw new Error("company-outside-scope");
  }
  const rows = await sql<Array<{ allowed: boolean }>>`
    select exists (
      select 1 from public.crm_companies company
      where company.id = ${companyId}::uuid
        and company.organization_id = ${context.membership.organizationId}::uuid
        and company.deleted_at is null
        and private.crm_scope_allows_membership(
          ${context.membership.id}::uuid, ${legalPermissionScope(context, crmPermissionKeys.companyView)},
          company.account_owner_membership_id, company.created_by_membership_id
        )
    ) as allowed
  `;
  if (!rows[0]?.allowed) throw new Error("company-outside-scope");
}

async function ensureLegalApprovalPolicy(
  context: CurrentPermissionContext,
  input: { finance: boolean; owner: boolean },
): Promise<string> {
  const suffix = `${input.finance ? "finance" : "legal"}_${input.owner ? "owner" : "standard"}`;
  const key = `legal_contract_${suffix}`;
  const database = getDatabaseClient();
  const existing = await database<Array<{ id: string }>>`
    select id from public.approval_definitions
    where organization_id = ${context.membership.organizationId}::uuid
      and key = ${key} and source_module = 'legal' and entity_type = 'contract'
      and status = 'active'
    limit 1
  `;
  if (existing[0]) return existing[0].id;

  const steps = [
    {
      name: "Legal review",
      stageOrder: 1,
      sortOrder: 1,
      selectorType: "role" as const,
      selectorRoleKey: "legal_manager",
      selectorMembershipId: null,
      decisionMode: "any" as const,
      conditions: {},
      commentRequired: true,
      reminderAfterHours: 24,
      escalationAfterHours: 72,
      expiresAfterHours: null,
    },
    ...(input.finance
      ? [
          {
            name: "Finance review",
            stageOrder: 2,
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
        ]
      : []),
    ...(input.owner
      ? [
          {
            name: "Owner approval",
            stageOrder: input.finance ? 3 : 2,
            sortOrder: 1,
            selectorType: "role" as const,
            selectorRoleKey: "owner",
            selectorMembershipId: null,
            decisionMode: "any" as const,
            conditions: {},
            commentRequired: false,
            reminderAfterHours: 24,
            escalationAfterHours: 72,
            expiresAfterHours: null,
          },
        ]
      : []),
  ];

  try {
    return await createApprovalDefinition(context, {
      key,
      name: "Legal contract review",
      description: "Sequential legal, optional Finance, and optional Owner contract approval.",
      sourceModule: "legal",
      entityType: "contract",
      allowSelfApproval: false,
      allowReassignment: true,
      steps,
    });
  } catch (error) {
    const raced = await database<Array<{ id: string }>>`
      select id from public.approval_definitions
      where organization_id = ${context.membership.organizationId}::uuid
        and key = ${key} and source_module = 'legal' and entity_type = 'contract'
        and status = 'active'
      limit 1
    `;
    if (!raced[0]) throw error;
    return raced[0].id;
  }
}

export async function saveLegalTemplateAction(
  _previous: LegalActionState,
  formData: FormData,
): Promise<LegalActionState> {
  const parsed = legalTemplateSchema.safeParse({
    templateId: value(formData, "templateId"),
    name: value(formData, "name"),
    contractType: value(formData, "contractType"),
    description: value(formData, "description"),
    sourceDocumentId: value(formData, "sourceDocumentId"),
    sourceVersionId: value(formData, "sourceVersionId"),
    status: value(formData, "status"),
  });
  if (!parsed.success)
    return failure("Check the template fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    legalPermissionKeys.workspace,
    legalPermissionKeys.manageTemplates,
  ]);
  if (!authorization.allowed) return failure("You cannot manage legal templates.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireDocumentAccess(context, parsed.data.sourceDocumentId, "view", sql);
      const document = await sql<Array<{ valid: boolean }>>`
        select exists (
          select 1 from public.document_versions version
          join public.private_files file
            on file.id = version.private_file_id
            and file.organization_id = ${context.membership.organizationId}::uuid
          where version.id = ${parsed.data.sourceVersionId}::uuid
            and version.document_id = ${parsed.data.sourceDocumentId}::uuid
            and version.organization_id = ${context.membership.organizationId}::uuid
            and file.status = 'available'
        ) as valid
      `;
      if (!document[0]?.valid) throw new Error("template-version-invalid");

      if (parsed.data.templateId) {
        const rows = await sql<Array<{ id: string }>>`
          update public.legal_contract_templates
          set name = ${parsed.data.name}, contract_type = ${parsed.data.contractType},
            description = ${parsed.data.description}, source_document_id = ${parsed.data.sourceDocumentId}::uuid,
            source_version_id = ${parsed.data.sourceVersionId}::uuid, status = ${parsed.data.status}
          where id = ${parsed.data.templateId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
          returning id
        `;
        if (!rows[0]) throw new Error("template-not-found");
        await writeAuditEvent(sql, context, {
          action: "legal.template.updated",
          entityType: "legal_contract_template",
          entityId: rows[0].id,
          afterState: parsed.data,
          changedFields: ["template"],
        });
      } else {
        const rows = await sql<Array<{ id: string }>>`
          insert into public.legal_contract_templates (
            organization_id, name, contract_type, description, source_document_id,
            source_version_id, status, created_by_membership_id
          ) values (
            ${context.membership.organizationId}::uuid, ${parsed.data.name}, ${parsed.data.contractType},
            ${parsed.data.description}, ${parsed.data.sourceDocumentId}::uuid,
            ${parsed.data.sourceVersionId}::uuid, ${parsed.data.status}, ${context.membership.id}::uuid
          ) returning id
        `;
        await writeAuditEvent(sql, context, {
          action: "legal.template.created",
          entityType: "legal_contract_template",
          entityId: rows[0]?.id,
          afterState: parsed.data,
          changedFields: ["template"],
        });
      }
    });
    refresh();
    return success(parsed.data.templateId ? "Template updated." : "Template registered.");
  } catch (error) {
    return failure(
      isUniqueViolation(error)
        ? "A template with this name already exists."
        : error instanceof Error && error.message === "template-version-invalid"
          ? "Choose a clean scanned document version."
          : "Template could not be saved.",
    );
  }
}

export async function saveLegalContractAction(
  _previous: LegalActionState,
  formData: FormData,
): Promise<LegalActionState> {
  const parsed = legalContractSchema.safeParse({
    contractId: value(formData, "contractId"),
    internalReference: value(formData, "internalReference"),
    title: value(formData, "title"),
    contractType: value(formData, "contractType"),
    counterpartyName: value(formData, "counterpartyName"),
    counterpartyCompanyId: value(formData, "counterpartyCompanyId"),
    responsibleOwnerMembershipId: value(formData, "responsibleOwnerMembershipId"),
    departmentId: value(formData, "departmentId"),
    templateId: value(formData, "templateId"),
    effectiveDate: value(formData, "effectiveDate"),
    endDate: value(formData, "endDate"),
    renewalDate: value(formData, "renewalDate"),
    noticePeriodDays: value(formData, "noticePeriodDays"),
    jurisdiction: value(formData, "jurisdiction"),
    governingLaw: value(formData, "governingLaw"),
    contractValueMinor: value(formData, "contractValueMinor"),
    currency: value(formData, "currency"),
    financeReviewRequired: value(formData, "financeReviewRequired"),
    ownerApprovalRequired: value(formData, "ownerApprovalRequired"),
  });
  if (!parsed.success)
    return failure("Check the contract fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    legalPermissionKeys.workspace,
    parsed.data.contractId ? legalPermissionKeys.update : legalPermissionKeys.create,
  ]);
  if (!authorization.allowed) return failure("You cannot save this contract request.");
  const context = authorization.context;
  try {
    const contractId = await getDatabaseClient().begin(async (sql) => {
      const mutationPermission = parsed.data.contractId
        ? legalPermissionKeys.update
        : legalPermissionKeys.create;
      await validateLegalOwnerAssignment(
        sql,
        context,
        parsed.data.responsibleOwnerMembershipId,
        mutationPermission,
      );
      await validateCounterpartyCompanyReference(sql, context, parsed.data.counterpartyCompanyId);
      if (parsed.data.contractId) {
        await requireLegalContractAccess(
          context,
          parsed.data.contractId,
          legalPermissionKeys.update,
          sql,
        );
        const existingRows = await sql<
          Array<{ template_id: string | null; current_version_id: string | null }>
        >`
          select template_id, current_version_id
          from public.legal_contracts
          where id = ${parsed.data.contractId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
          for update
        `;
        const existing = existingRows[0];
        if (existing?.current_version_id && existing.template_id !== parsed.data.templateId) {
          throw new Error("template-locked");
        }
        const rows = await sql<Array<{ id: string; status: string }>>`
          update public.legal_contracts
          set internal_reference = ${parsed.data.internalReference}, title = ${parsed.data.title},
            contract_type = ${parsed.data.contractType}, counterparty_name = ${parsed.data.counterpartyName},
            counterparty_company_id = ${parsed.data.counterpartyCompanyId}::uuid,
            responsible_owner_membership_id = ${parsed.data.responsibleOwnerMembershipId}::uuid,
            department_id = ${parsed.data.departmentId}::uuid, template_id = ${parsed.data.templateId}::uuid,
            effective_date = ${parsed.data.effectiveDate}::date, end_date = ${parsed.data.endDate}::date,
            renewal_date = ${parsed.data.renewalDate}::date, notice_period_days = ${parsed.data.noticePeriodDays},
            jurisdiction = ${parsed.data.jurisdiction}, governing_law = ${parsed.data.governingLaw},
            contract_value_minor = ${parsed.data.contractValueMinor}, currency = ${parsed.data.currency},
            finance_review_required = ${parsed.data.financeReviewRequired},
            owner_approval_required = ${parsed.data.ownerApprovalRequired},
            status = case when status = 'request' then 'draft' else status end
          where id = ${parsed.data.contractId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
            and status in ('request', 'draft')
          returning id, status
        `;
        if (!rows[0]) throw new Error("contract-immutable");
        await sql`
          insert into public.legal_contract_events (
            organization_id, contract_id, event_type, actor_membership_id, details
          ) values (
            ${context.membership.organizationId}::uuid, ${rows[0].id}::uuid,
            'contract.metadata_updated', ${context.membership.id}::uuid,
            ${sql.json(toJsonValue({ fields: ["commercial", "legal", "dates"] }))}
          )
        `;
        await writeAuditEvent(sql, context, {
          action: "legal.contract.updated",
          entityType: "legal_contract",
          entityId: rows[0].id,
          afterState: parsed.data,
          changedFields: ["contract"],
        });
        return rows[0].id;
      }

      const rows = await sql<Array<{ id: string }>>`
        insert into public.legal_contracts (
          organization_id, internal_reference, title, contract_type, counterparty_name,
          counterparty_company_id, responsible_owner_membership_id, department_id, template_id,
          status, effective_date, end_date, renewal_date, notice_period_days, jurisdiction,
          governing_law, contract_value_minor, currency, finance_review_required,
          owner_approval_required, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.internalReference},
          ${parsed.data.title}, ${parsed.data.contractType}, ${parsed.data.counterpartyName},
          ${parsed.data.counterpartyCompanyId}::uuid, ${parsed.data.responsibleOwnerMembershipId}::uuid,
          ${parsed.data.departmentId}::uuid, ${parsed.data.templateId}::uuid, 'draft',
          ${parsed.data.effectiveDate}::date, ${parsed.data.endDate}::date,
          ${parsed.data.renewalDate}::date, ${parsed.data.noticePeriodDays},
          ${parsed.data.jurisdiction}, ${parsed.data.governingLaw},
          ${parsed.data.contractValueMinor}, ${parsed.data.currency},
          ${parsed.data.financeReviewRequired}, ${parsed.data.ownerApprovalRequired},
          ${context.membership.id}::uuid
        ) returning id
      `;
      if (parsed.data.templateId && rows[0]?.id) {
        const templateRows = await sql<
          Array<{ source_document_id: string; source_version_id: string }>
        >`
          select source_document_id, source_version_id
          from public.legal_contract_templates
          where id = ${parsed.data.templateId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
            and status = 'active'
          limit 1
        `;
        const template = templateRows[0];
        if (template) {
          const versionRows = await sql<Array<{ id: string }>>`
            insert into public.legal_contract_versions (
              organization_id, contract_id, version_number, document_id, document_version_id,
              version_kind, status, note, uploaded_by_membership_id
            ) values (
              ${context.membership.organizationId}::uuid, ${rows[0].id}::uuid, 1,
              ${template.source_document_id}::uuid, ${template.source_version_id}::uuid,
              'template', 'draft', 'Initial draft source selected from the contract template library.',
              ${context.membership.id}::uuid
            ) returning id
          `;
          await sql`
            update public.legal_contracts set current_version_id = ${versionRows[0]?.id}::uuid
            where id = ${rows[0].id}::uuid
          `;
          await sql`
            insert into public.document_entity_links (
              organization_id, document_id, entity_type, entity_id, created_by_membership_id
            ) values (
              ${context.membership.organizationId}::uuid, ${template.source_document_id}::uuid,
              'contract', ${rows[0].id}::uuid, ${context.membership.id}::uuid
            ) on conflict (document_id, entity_type, entity_id) do nothing
          `;
        }
      }
      await sql`
        insert into public.legal_contract_events (
          organization_id, contract_id, event_type, actor_membership_id, details
        ) values (
          ${context.membership.organizationId}::uuid, ${rows[0]?.id}::uuid,
          'contract.created', ${context.membership.id}::uuid, '{}'::jsonb
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "legal.contract.created",
        entityType: "legal_contract",
        entityId: rows[0]?.id,
        afterState: parsed.data,
        changedFields: ["contract"],
      });
      return rows[0]?.id ?? "";
    });
    refresh();
    return success(
      parsed.data.contractId
        ? "Contract draft updated."
        : `Contract request ${contractId} created.`,
    );
  } catch (error) {
    return failure(
      isUniqueViolation(error)
        ? "This internal reference already exists."
        : error instanceof Error && error.message === "contract-immutable"
          ? "Only request and draft contracts can be edited."
          : error instanceof Error && error.message === "template-locked"
            ? "The template source cannot change after the first contract version is created."
            : error instanceof Error && error.message === "owner-outside-scope"
              ? "Choose an active contract owner inside your permission scope."
              : error instanceof Error && error.message === "company-outside-scope"
                ? "Choose a CRM company inside your permitted scope."
                : "Contract could not be saved.",
    );
  }
}

export async function attachLegalContractVersionAction(
  _previous: LegalActionState,
  formData: FormData,
): Promise<LegalActionState> {
  const parsed = legalContractVersionSchema.safeParse({
    contractId: value(formData, "contractId"),
    documentId: value(formData, "documentId"),
    documentVersionId: value(formData, "documentVersionId"),
    versionKind: value(formData, "versionKind"),
    note: value(formData, "note"),
  });
  if (!parsed.success)
    return failure("Check the version fields.", parsed.error.flatten().fieldErrors);
  const attachmentPermission =
    parsed.data.versionKind === "signed"
      ? legalPermissionKeys.manageSignatures
      : legalPermissionKeys.update;
  const authorization = await authorizeCurrentUser([
    legalPermissionKeys.workspace,
    attachmentPermission,
  ]);
  if (!authorization.allowed) return failure("You cannot attach contract versions.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireLegalContractAccess(context, parsed.data.contractId, attachmentPermission, sql);
      await requireDocumentAccess(context, parsed.data.documentId, "view", sql);
      await sql`select pg_advisory_xact_lock(hashtext(${parsed.data.contractId}))`;
      const contractRows = await sql<Array<{ status: string }>>`
        select status from public.legal_contracts
        where id = ${parsed.data.contractId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const contractStatus = contractRows[0]?.status;
      const stateAllowed =
        parsed.data.versionKind === "signed"
          ? contractStatus === "approved" || contractStatus === "awaiting_signature"
          : contractStatus === "request" || contractStatus === "draft";
      if (!stateAllowed) throw new Error("version-state-invalid");
      const document = await sql<Array<{ valid: boolean }>>`
        select exists (
          select 1 from public.document_versions version
          join public.private_files file
            on file.id = version.private_file_id
            and file.organization_id = ${context.membership.organizationId}::uuid
          where version.id = ${parsed.data.documentVersionId}::uuid
            and version.document_id = ${parsed.data.documentId}::uuid
            and version.organization_id = ${context.membership.organizationId}::uuid
            and file.status = 'available'
        ) as valid
      `;
      if (!document[0]?.valid) throw new Error("version-not-clean");
      const next = await sql<Array<{ number: number }>>`
        select coalesce(max(version_number), 0)::integer + 1 as number
        from public.legal_contract_versions where contract_id = ${parsed.data.contractId}::uuid
      `;
      if (parsed.data.versionKind !== "signed") {
        await sql`
          update public.legal_contract_versions set status = 'superseded'
          where contract_id = ${parsed.data.contractId}::uuid and status = 'draft'
        `;
      }
      const rows = await sql<Array<{ id: string }>>`
        insert into public.legal_contract_versions (
          organization_id, contract_id, version_number, document_id, document_version_id,
          version_kind, status, note, uploaded_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.contractId}::uuid,
          ${next[0]?.number ?? 1}, ${parsed.data.documentId}::uuid,
          ${parsed.data.documentVersionId}::uuid, ${parsed.data.versionKind},
          ${parsed.data.versionKind === "signed" ? "signed" : "draft"},
          ${parsed.data.note}, ${context.membership.id}::uuid
        ) returning id
      `;
      if (parsed.data.versionKind === "signed") {
        await sql`
          update public.legal_contracts
          set current_version_id = ${rows[0]?.id}::uuid,
            signed_version_id = ${rows[0]?.id}::uuid,
            signature_status = 'signed',
            status = case when status = 'approved' then 'awaiting_signature' else status end
          where id = ${parsed.data.contractId}::uuid
        `;
      } else {
        await sql`
          update public.legal_contracts
          set current_version_id = ${rows[0]?.id}::uuid
          where id = ${parsed.data.contractId}::uuid
        `;
      }
      await sql`
        insert into public.document_entity_links (
          organization_id, document_id, entity_type, entity_id, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.documentId}::uuid,
          'contract', ${parsed.data.contractId}::uuid, ${context.membership.id}::uuid
        ) on conflict (document_id, entity_type, entity_id) do nothing
      `;
      await sql`
        insert into public.legal_contract_events (
          organization_id, contract_id, version_id, event_type, actor_membership_id, details
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.contractId}::uuid,
          ${rows[0]?.id}::uuid, 'contract.version_attached', ${context.membership.id}::uuid,
          ${sql.json(toJsonValue({ kind: parsed.data.versionKind, documentVersionId: parsed.data.documentVersionId }))}
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "legal.contract.version_attached",
        entityType: "legal_contract",
        entityId: parsed.data.contractId,
        afterState: { kind: parsed.data.versionKind, documentId: parsed.data.documentId },
        changedFields: ["currentVersion"],
      });
    });
    refresh();
    return success("Contract version attached.");
  } catch (error) {
    return failure(
      isUniqueViolation(error)
        ? "This document version is already attached to the contract."
        : error instanceof Error && error.message === "version-not-clean"
          ? "Only clean scanned document versions can be attached."
          : error instanceof Error && error.message === "version-state-invalid"
            ? "Draft versions can be attached only before review; signed copies require an approved contract."
            : error instanceof LegalAccessError
              ? error.message
              : "Contract version could not be attached.",
    );
  }
}

export async function submitLegalContractApprovalAction(formData: FormData): Promise<void> {
  const parsed = legalContractIdSchema.safeParse(value(formData, "contractId"));
  const authorization = await authorizeCurrentUser([
    legalPermissionKeys.workspace,
    legalPermissionKeys.review,
  ]);
  if (!parsed.success || !authorization.allowed) return;
  const context = authorization.context;
  const database = getDatabaseClient();
  const rows = await database.begin(async (sql) => {
    await requireLegalContractAccess(context, parsed.data, legalPermissionKeys.review, sql);
    const contracts = await sql<
      Array<{
        id: string;
        title: string;
        counterparty_name: string;
        department_id: string | null;
        contract_value_minor: string | number | null;
        currency: string | null;
        finance_review_required: boolean;
        owner_approval_required: boolean;
        current_version_id: string | null;
        status: string;
      }>
    >`
      select id, title, counterparty_name, department_id, contract_value_minor, currency,
        finance_review_required, owner_approval_required, current_version_id, status
      from public.legal_contracts
      where id = ${parsed.data}::uuid and organization_id = ${context.membership.organizationId}::uuid
      for update
    `;
    const contract = contracts[0];
    if (!contract || contract.status !== "draft" || !contract.current_version_id) return [];
    return [contract];
  });
  const contract = rows[0];
  if (!contract) return;
  const definitionId = await ensureLegalApprovalPolicy(context, {
    finance: contract.finance_review_required,
    owner: contract.owner_approval_required,
  });
  const approvalRequestId = await createApprovalRequest(context, {
    definitionId,
    title: `Contract approval: ${contract.title}`,
    entityId: contract.id,
    deepLink: "/legal",
    departmentId: contract.department_id,
    amount:
      contract.contract_value_minor === null ? null : Number(contract.contract_value_minor) / 100,
    currency: contract.currency,
    snapshot: {
      title: contract.title,
      counterparty: contract.counterparty_name,
      currentVersionId: contract.current_version_id,
      financeReviewRequired: contract.finance_review_required,
      ownerApprovalRequired: contract.owner_approval_required,
    },
    dueAt: null,
  });
  await database.begin(async (sql) => {
    await sql`
      update public.legal_contracts
      set status = 'in_review', approval_request_id = ${approvalRequestId}::uuid
      where id = ${contract.id}::uuid and status = 'draft'
    `;
    await sql`
      insert into public.legal_contract_events (
        organization_id, contract_id, event_type, actor_membership_id, details
      ) values (
        ${context.membership.organizationId}::uuid, ${contract.id}::uuid,
        'contract.submitted_for_approval', ${context.membership.id}::uuid,
        ${sql.json(toJsonValue({ approvalRequestId }))}
      )
    `;
  });
  refresh();
}

export async function updateLegalSignatureAction(
  _previous: LegalActionState,
  formData: FormData,
): Promise<LegalActionState> {
  const parsed = legalSignatureSchema.safeParse({
    contractId: value(formData, "contractId"),
    signatureStatus: value(formData, "signatureStatus"),
  });
  if (!parsed.success) return failure("Choose a signature status.");
  const authorization = await authorizeCurrentUser([
    legalPermissionKeys.workspace,
    legalPermissionKeys.manageSignatures,
  ]);
  if (!authorization.allowed) return failure("You cannot manage contract signatures.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireLegalContractAccess(
        context,
        parsed.data.contractId,
        legalPermissionKeys.manageSignatures,
        sql,
      );
      const rows = await sql<Array<{ owner_membership_id: string; title: string }>>`
        update public.legal_contracts
        set signature_status = ${parsed.data.signatureStatus},
          status = case when status = 'approved' and ${parsed.data.signatureStatus} in ('sent', 'partially_signed')
            then 'awaiting_signature' else status end
        where id = ${parsed.data.contractId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and status in ('approved', 'awaiting_signature')
        returning responsible_owner_membership_id as owner_membership_id, title
      `;
      if (!rows[0]) throw new Error("signature-state-invalid");
      await sql`
        insert into public.legal_contract_events (
          organization_id, contract_id, event_type, actor_membership_id, details
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.contractId}::uuid,
          'contract.signature_status_changed', ${context.membership.id}::uuid,
          ${sql.json(toJsonValue({ signatureStatus: parsed.data.signatureStatus }))}
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "legal.contract.signature_status_changed",
        entityType: "legal_contract",
        entityId: parsed.data.contractId,
        afterState: { signatureStatus: parsed.data.signatureStatus },
        changedFields: ["signatureStatus"],
      });
    });
    refresh();
    return success("Signature status updated.");
  } catch {
    return failure("Only approved contracts awaiting signature can be updated.");
  }
}

export async function updateLegalLifecycleAction(
  _previous: LegalActionState,
  formData: FormData,
): Promise<LegalActionState> {
  const parsed = legalLifecycleSchema.safeParse({
    contractId: value(formData, "contractId"),
    action: value(formData, "action"),
    reason: value(formData, "reason"),
  });
  if (!parsed.success)
    return failure("Check the lifecycle action.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    legalPermissionKeys.workspace,
    legalPermissionKeys.manageLifecycle,
  ]);
  if (!authorization.allowed) return failure("You cannot manage the contract lifecycle.");
  const context = authorization.context;
  try {
    const notification = await getDatabaseClient().begin(async (sql) => {
      await requireLegalContractAccess(
        context,
        parsed.data.contractId,
        legalPermissionKeys.manageLifecycle,
        sql,
      );
      const contracts = await sql<
        Array<{
          id: string;
          title: string;
          status: string;
          signature_status: string;
          signed_version_id: string | null;
          responsible_owner_membership_id: string;
          renewal_date: string | null;
          end_date: string | null;
        }>
      >`
        select id, title, status, signature_status, signed_version_id,
          responsible_owner_membership_id, renewal_date, end_date
        from public.legal_contracts
        where id = ${parsed.data.contractId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const contract = contracts[0];
      if (!contract) throw new Error("contract-not-found");
      let nextStatus: string;
      if (parsed.data.action === "await_signature") {
        if (contract.status !== "approved") throw new Error("lifecycle-invalid");
        nextStatus = "awaiting_signature";
      } else if (parsed.data.action === "activate") {
        if (
          !["approved", "awaiting_signature"].includes(contract.status) ||
          contract.signature_status !== "signed" ||
          !contract.signed_version_id
        ) {
          throw new Error("lifecycle-invalid");
        }
        nextStatus = "active";
      } else if (parsed.data.action === "terminate") {
        if (
          !parsed.data.reason ||
          !["active", "approved", "awaiting_signature"].includes(contract.status)
        ) {
          throw new Error("lifecycle-invalid");
        }
        nextStatus = "terminated";
      } else if (parsed.data.action === "expire") {
        if (contract.status !== "active") throw new Error("lifecycle-invalid");
        nextStatus = "expired";
      } else {
        if (!["request", "draft"].includes(contract.status)) throw new Error("lifecycle-invalid");
        nextStatus = "cancelled";
      }
      await sql`
        update public.legal_contracts
        set status = ${nextStatus},
          terminated_at = case when ${nextStatus} = 'terminated' then now() else null end,
          termination_reason = case when ${nextStatus} = 'terminated' then ${parsed.data.reason} else null end
        where id = ${contract.id}::uuid
      `;
      await sql`
        insert into public.legal_contract_events (
          organization_id, contract_id, event_type, actor_membership_id, details
        ) values (
          ${context.membership.organizationId}::uuid, ${contract.id}::uuid,
          ${`contract.${nextStatus}`}, ${context.membership.id}::uuid,
          ${sql.json(toJsonValue({ reason: parsed.data.reason }))}
        )
      `;
      await writeAuditEvent(sql, context, {
        action: `legal.contract.${nextStatus}`,
        entityType: "legal_contract",
        entityId: contract.id,
        afterState: { status: nextStatus },
        changedFields: ["status"],
      });
      return {
        recipientMembershipId: contract.responsible_owner_membership_id,
        title: contract.title,
        status: nextStatus,
        renewalDate: contract.renewal_date,
        endDate: contract.end_date,
      };
    });
    await enqueueNotification({
      organizationId: context.membership.organizationId,
      recipientMembershipId: notification.recipientMembershipId,
      category: "contract_expiry",
      severity: notification.status === "terminated" ? "warning" : "info",
      title: `Contract ${notification.status}`,
      message: `${notification.title} is now ${notification.status}.${
        notification.status === "active" && notification.renewalDate
          ? ` Renewal date: ${notification.renewalDate}.`
          : notification.status === "active" && notification.endDate
            ? ` End date: ${notification.endDate}.`
            : ""
      }`,
      deepLink: "/legal",
      sourceModule: "legal",
      sourceEntityType: "contract",
      sourceEntityId: parsed.data.contractId,
      dedupeKey: `legal-contract-${parsed.data.contractId}-${notification.status}`,
      createdByMembershipId: context.membership.id,
    });
    refresh();
    return success(`Contract marked ${notification.status}.`);
  } catch (error) {
    return failure(
      error instanceof LegalAccessError
        ? error.message
        : "The contract is not ready for that lifecycle action.",
    );
  }
}
