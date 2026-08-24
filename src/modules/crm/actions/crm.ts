"use server";

import { revalidatePath } from "next/cache";
import type { Sql, TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { legalPermissionKeys } from "@/modules/legal/legal";
import {
  calculateLeadQualificationScore,
  crmPermissionKeys,
  leadQualificationLabel,
  normalizeCrmCompanyName,
  normalizeCrmEmail,
  normalizeCrmPhone,
  normalizeCrmPipelineSlug,
} from "@/modules/crm/crm";
import {
  activityCompleteSchema,
  activityCreateSchema,
  companyCreateSchema,
  companyPrimaryContactSchema,
  companyUpdateSchema,
  contactCreateSchema,
  contactUpdateSchema,
  crmForecastTargetSchema,
  type CrmActionState,
  leadConvertSchema,
  leadCreateSchema,
  leadDeleteSchema,
  leadQualificationSchema,
  leadStageUpdateSchema,
  leadUpdateSchema,
  pipelineStageCreateSchema,
  pipelineStageUpdateSchema,
} from "@/modules/crm/schemas/crm";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import type { PermissionScope } from "@/modules/permissions/permission-scopes";

class CrmActionError extends Error {}

type QuerySql = Sql | TransactionSql;

interface LeadRecord {
  id: string;
  name: string;
  lead_type: "person" | "company";
  status: "new" | "qualified" | "unqualified" | "converted" | "lost";
  source: string | null;
  stage_id: string;
  estimated_value: string | number | null;
  currency: string;
  probability: number;
  expected_close_date: string | null;
  owner_membership_id: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  notes: string | null;
  qualification_score: number;
  qualification_label: string;
  converted_company_id: string | null;
  converted_contact_id: string | null;
  converted_at: Date | null;
  follow_up_at: Date | null;
  created_at: Date;
  created_by_membership_id: string;
}

interface CompanyRecord {
  id: string;
  legal_name: string;
  display_name: string | null;
  industry: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  account_owner_membership_id: string | null;
  currency: string;
  payment_terms_days: number;
  notes: string | null;
  primary_contact_id?: string | null;
  created_by_membership_id: string;
}

interface ContactRecord {
  id: string;
  company_id: string | null;
  first_name: string;
  last_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  preferred_communication: string;
  is_billing_contact: boolean;
  is_decision_maker: boolean;
  consent_status: string;
  owner_membership_id: string | null;
  notes: string | null;
  created_by_membership_id: string;
}

function values(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function errorState(
  message: string,
  fieldErrors?: Record<string, string[]>,
  duplicateWarnings?: string[],
): CrmActionState {
  return { status: "error", message, fieldErrors, duplicateWarnings };
}

function successState(message: string): CrmActionState {
  return { status: "success", message };
}

function refreshCrm() {
  revalidatePath("/crm");
  revalidatePath("/dashboard");
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

function crmMutationErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  const required = message.match(/crm-stage-required-field:([a-z0-9_]+)/i)?.[1];
  if (required) {
    return `Complete the required stage field: ${required.replaceAll("_", " ")}.`;
  }
  if (message.includes("crm-lost-reason-required")) {
    return "Enter why the opportunity was lost before closing it.";
  }
  return error instanceof CrmActionError ? error.message : fallback;
}

async function authorize(
  requiredPermissions: readonly string[],
): Promise<CurrentPermissionContext> {
  const result = await authorizeCurrentUser(requiredPermissions);
  if (!result.allowed) {
    throw new CrmActionError(
      result.reason === "insufficient-permission"
        ? "You do not have permission to perform this CRM action."
        : "Your session or organization access is no longer active.",
    );
  }
  return result.context;
}

function permissionScope(
  context: CurrentPermissionContext,
  permissionKey: string,
): PermissionScope {
  return context.permissionScopes.get(permissionKey) ?? "own";
}

async function validateOwner(
  sql: QuerySql,
  organizationId: string,
  ownerMembershipId: string | null,
): Promise<void> {
  if (!ownerMembershipId) return;
  const rows = await sql<{ id: string }[]>`
    select id
    from public.memberships
    where id = ${ownerMembershipId}::uuid
      and organization_id = ${organizationId}::uuid
      and status = 'active'
    limit 1
  `;
  if (!rows[0]) throw new CrmActionError("Choose an active owner in this organization.");
}

async function validateCompanyReference(
  sql: QuerySql,
  context: CurrentPermissionContext,
  companyId: string | null,
): Promise<void> {
  if (!companyId) return;
  if (!context.permissions.has(crmPermissionKeys.companyView)) {
    throw new CrmActionError("You cannot link contacts to companies you cannot view.");
  }

  const scope = permissionScope(context, crmPermissionKeys.companyView);
  const rows = await sql<{ id: string }[]>`
    select company.id
    from public.crm_companies as company
    where company.id = ${companyId}::uuid
      and company.organization_id = ${context.membership.organizationId}::uuid
      and private.crm_scope_allows_membership(
        ${context.membership.id}::uuid,
        ${scope},
        company.account_owner_membership_id,
        company.created_by_membership_id
      )
    limit 1
  `;
  if (!rows[0]) throw new CrmActionError("Company not found or outside your permitted scope.");
}

function ensureAssignmentAllowed(
  context: CurrentPermissionContext,
  ownerMembershipId: string | null,
): string {
  const resolvedOwner = ownerMembershipId ?? context.membership.id;
  if (
    resolvedOwner !== context.membership.id &&
    !context.permissions.has(crmPermissionKeys.leadAssign)
  ) {
    throw new CrmActionError("You cannot assign CRM records to another owner.");
  }
  return resolvedOwner;
}

async function getLeadForMutation(
  sql: QuerySql,
  context: CurrentPermissionContext,
  leadId: string,
  permissionKey: string,
  lock = false,
): Promise<LeadRecord> {
  const scope = permissionScope(context, permissionKey);
  const rows = lock
    ? await sql<LeadRecord[]>`
        select
          id, name, lead_type, status, source, stage_id, estimated_value, currency, probability,
          expected_close_date::text, owner_membership_id, email, phone, company_name, notes,
          qualification_score, qualification_label, converted_company_id, converted_contact_id,
          converted_at, follow_up_at, created_at, created_by_membership_id
        from public.crm_leads as lead
        where lead.id = ${leadId}::uuid
          and lead.organization_id = ${context.membership.organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${context.membership.id}::uuid,
            ${scope},
            lead.owner_membership_id,
            lead.created_by_membership_id
          )
        for update
      `
    : await sql<LeadRecord[]>`
        select
          id, name, lead_type, status, source, stage_id, estimated_value, currency, probability,
          expected_close_date::text, owner_membership_id, email, phone, company_name, notes,
          qualification_score, qualification_label, converted_company_id, converted_contact_id,
          converted_at, follow_up_at, created_at, created_by_membership_id
        from public.crm_leads as lead
        where lead.id = ${leadId}::uuid
          and lead.organization_id = ${context.membership.organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${context.membership.id}::uuid,
            ${scope},
            lead.owner_membership_id,
            lead.created_by_membership_id
          )
      `;

  const lead = rows[0];
  if (!lead) throw new CrmActionError("Lead not found or outside your permitted scope.");
  return lead;
}

async function writeAudit(
  sql: QuerySql,
  context: CurrentPermissionContext,
  input: {
    action: string;
    entityType: string;
    entityId: string;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    changedFields?: string[];
    metadata?: Record<string, unknown>;
  },
) {
  await sql`
    insert into public.audit_events (
      organization_id, actor_user_id, action, entity_type, entity_id, source,
      before_state, after_state, changed_fields, metadata
    )
    values (
      ${context.membership.organizationId}::uuid,
      ${context.user.id}::uuid,
      ${input.action},
      ${input.entityType},
      ${input.entityId},
      'web',
      ${input.beforeState ? sql.json(input.beforeState as never) : null},
      ${input.afterState ? sql.json(input.afterState as never) : null},
      ${input.changedFields ?? []}::text[],
      ${sql.json({ actorMembershipId: context.membership.id, ...(input.metadata ?? {}) })}
    )
  `;
}

async function duplicateLeadWarnings(
  sql: QuerySql,
  organizationId: string,
  input: { email: string | null; phone: string | null; companyName: string | null },
): Promise<string[]> {
  const email = normalizeCrmEmail(input.email);
  const phone = normalizeCrmPhone(input.phone);
  const companyName = normalizeCrmCompanyName(input.companyName);
  if (!email && !phone && !companyName) return [];

  const rows = await sql<{ email_match: boolean; phone_match: boolean; company_match: boolean }[]>`
    select
      (${email}::text is not null and lower(coalesce(email, '')) = ${email}) as email_match,
      (${phone}::text is not null and regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') = ${phone}) as phone_match,
      (${companyName}::text is not null and lower(regexp_replace(coalesce(company_name, ''), '\\s+', ' ', 'g')) = ${companyName}) as company_match
    from public.crm_leads
    where organization_id = ${organizationId}::uuid
      and status not in ('converted', 'lost')
      and (
        (${email}::text is not null and lower(coalesce(email, '')) = ${email})
        or (${phone}::text is not null and regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') = ${phone})
        or (${companyName}::text is not null and lower(regexp_replace(coalesce(company_name, ''), '\\s+', ' ', 'g')) = ${companyName})
      )
    order by updated_at desc
    limit 5
  `;

  return rows.map((row) => {
    const matches = [
      row.email_match ? "email" : null,
      row.phone_match ? "phone" : null,
      row.company_match ? "company" : null,
    ].filter(Boolean);
    return `An active lead matches by ${matches.join(", ")}.`;
  });
}

export async function createCompanyAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const parsed = companyCreateSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState(
      "Check the company fields and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }

  try {
    const context = await authorize([crmPermissionKeys.companyCreate]);
    const ownerMembershipId = ensureAssignmentAllowed(context, parsed.data.ownerMembershipId);
    const database = getDatabaseClient();

    const companyId = await database.begin(async (sql) => {
      await validateOwner(sql, context.membership.organizationId, ownerMembershipId);
      const rows = await sql<{ id: string }[]>`
        insert into public.crm_companies (
          organization_id, legal_name, display_name, industry, website, email, phone,
          account_owner_membership_id, currency, payment_terms_days, notes,
          created_by_membership_id, created_by
        )
        values (
          ${context.membership.organizationId}::uuid,
          ${parsed.data.legalName},
          ${parsed.data.displayName},
          ${parsed.data.industry},
          ${parsed.data.website},
          ${normalizeCrmEmail(parsed.data.email)},
          ${parsed.data.phone},
          ${ownerMembershipId}::uuid,
          ${parsed.data.currency},
          ${parsed.data.paymentTermsDays},
          ${parsed.data.notes},
          ${context.membership.id}::uuid,
          ${context.user.id}::uuid
        )
        returning id
      `;
      const company = rows[0];
      if (!company) throw new CrmActionError("The company could not be created.");
      await writeAudit(sql, context, {
        action: "crm.company_created",
        entityType: "crm_company",
        entityId: company.id,
        afterState: {
          legalName: parsed.data.legalName,
          ownerMembershipId,
          clientStatus: "prospect",
        },
        changedFields: ["legalName", "ownerMembershipId", "clientStatus"],
      });
      return company.id;
    });

    refreshCrm();
    return successState(`Company created (${companyId.slice(0, 8)}).`);
  } catch (error) {
    return errorState(
      isUniqueViolation(error)
        ? "A company with that name already exists."
        : error instanceof CrmActionError
          ? error.message
          : "The company could not be created.",
    );
  }
}

export async function updateCompanyAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const parsed = companyUpdateSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState(
      "Check the company fields and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }

  try {
    const context = await authorize([crmPermissionKeys.companyUpdate]);
    const scope = permissionScope(context, crmPermissionKeys.companyUpdate);
    const ownerMembershipId = ensureAssignmentAllowed(context, parsed.data.ownerMembershipId);
    const database = getDatabaseClient();

    await database.begin(async (sql) => {
      await validateOwner(sql, context.membership.organizationId, ownerMembershipId);
      const beforeRows = await sql<CompanyRecord[]>`
        select id, legal_name, display_name, industry, website, email, phone,
          account_owner_membership_id, currency, payment_terms_days, notes, created_by_membership_id
        from public.crm_companies as company
        where id = ${parsed.data.companyId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${context.membership.id}::uuid, ${scope},
            company.account_owner_membership_id, company.created_by_membership_id
          )
        for update
      `;
      const before = beforeRows[0];
      if (!before) throw new CrmActionError("Company not found or outside your permitted scope.");

      await sql`
        update public.crm_companies
        set legal_name = ${parsed.data.legalName},
            display_name = ${parsed.data.displayName},
            industry = ${parsed.data.industry},
            website = ${parsed.data.website},
            email = ${normalizeCrmEmail(parsed.data.email)},
            phone = ${parsed.data.phone},
            account_owner_membership_id = ${ownerMembershipId}::uuid,
            currency = ${parsed.data.currency},
            payment_terms_days = ${parsed.data.paymentTermsDays},
            notes = ${parsed.data.notes}
        where id = ${before.id}::uuid
      `;

      await writeAudit(sql, context, {
        action: "crm.company_updated",
        entityType: "crm_company",
        entityId: before.id,
        beforeState: {
          legalName: before.legal_name,
          ownerMembershipId: before.account_owner_membership_id,
        },
        afterState: { legalName: parsed.data.legalName, ownerMembershipId },
        changedFields: ["legalName", "ownerMembershipId"],
      });
    });

    refreshCrm();
    return successState("Company updated.");
  } catch (error) {
    return errorState(
      error instanceof CrmActionError ? error.message : "The company could not be updated.",
    );
  }
}

export async function setCompanyPrimaryContactAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const parsed = companyPrimaryContactSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Choose a valid primary contact.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize([crmPermissionKeys.companyUpdate]);
    const companyScope = permissionScope(context, crmPermissionKeys.companyUpdate);
    const database = getDatabaseClient();

    await database.begin(async (sql) => {
      const companyRows = await sql<CompanyRecord[]>`
        select id, legal_name, display_name, industry, website, email, phone,
          account_owner_membership_id, currency, payment_terms_days, notes,
          primary_contact_id, created_by_membership_id
        from public.crm_companies as company
        where company.id = ${parsed.data.companyId}::uuid
          and company.organization_id = ${context.membership.organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${context.membership.id}::uuid, ${companyScope},
            company.account_owner_membership_id, company.created_by_membership_id
          )
        for update
      `;
      const company = companyRows[0];
      if (!company) throw new CrmActionError("Company not found or outside your permitted scope.");

      if (parsed.data.primaryContactId) {
        if (!context.permissions.has(crmPermissionKeys.contactView)) {
          throw new CrmActionError("You cannot choose a contact you cannot view.");
        }
        const contactScope = permissionScope(context, crmPermissionKeys.contactView);
        const contactRows = await sql<Array<{ id: string }>>`
          select contact.id
          from public.crm_contacts as contact
          where contact.id = ${parsed.data.primaryContactId}::uuid
            and contact.organization_id = ${context.membership.organizationId}::uuid
            and contact.company_id = ${company.id}::uuid
            and contact.status = 'active'
            and private.crm_scope_allows_membership(
              ${context.membership.id}::uuid, ${contactScope},
              contact.owner_membership_id, contact.created_by_membership_id
            )
          limit 1
        `;
        if (!contactRows[0]) {
          throw new CrmActionError("Choose an active contact linked to this company.");
        }
      }

      await sql`
        update public.crm_companies
        set primary_contact_id = ${parsed.data.primaryContactId}::uuid
        where id = ${company.id}::uuid
      `;

      await writeAudit(sql, context, {
        action: "crm.company_primary_contact_updated",
        entityType: "crm_company",
        entityId: company.id,
        beforeState: { primaryContactId: company.primary_contact_id ?? null },
        afterState: { primaryContactId: parsed.data.primaryContactId },
        changedFields: ["primaryContactId"],
      });
    });

    refreshCrm();
    return successState(
      parsed.data.primaryContactId ? "Primary contact updated." : "Primary contact cleared.",
    );
  } catch (error) {
    return errorState(
      error instanceof CrmActionError ? error.message : "The primary contact could not be updated.",
    );
  }
}

export async function createContactAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const parsed = contactCreateSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState(
      "Check the contact fields and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }

  try {
    const context = await authorize([crmPermissionKeys.contactCreate]);
    const ownerMembershipId = ensureAssignmentAllowed(context, parsed.data.ownerMembershipId);
    const database = getDatabaseClient();

    await database.begin(async (sql) => {
      await validateOwner(sql, context.membership.organizationId, ownerMembershipId);
      await validateCompanyReference(sql, context, parsed.data.companyId);
      const rows = await sql<{ id: string }[]>`
        insert into public.crm_contacts (
          organization_id, company_id, first_name, last_name, job_title, email, phone,
          preferred_communication, is_billing_contact, is_decision_maker, consent_status,
          owner_membership_id, notes, created_by_membership_id, created_by
        )
        values (
          ${context.membership.organizationId}::uuid,
          ${parsed.data.companyId}::uuid,
          ${parsed.data.firstName}, ${parsed.data.lastName}, ${parsed.data.jobTitle},
          ${normalizeCrmEmail(parsed.data.email)}, ${parsed.data.phone},
          ${parsed.data.preferredCommunication}, ${parsed.data.isBillingContact},
          ${parsed.data.isDecisionMaker}, ${parsed.data.consentStatus},
          ${ownerMembershipId}::uuid, ${parsed.data.notes},
          ${context.membership.id}::uuid, ${context.user.id}::uuid
        )
        returning id
      `;
      const contact = rows[0];
      if (!contact) throw new CrmActionError("The contact could not be created.");
      await writeAudit(sql, context, {
        action: "crm.contact_created",
        entityType: "crm_contact",
        entityId: contact.id,
        afterState: {
          name: `${parsed.data.firstName} ${parsed.data.lastName}`,
          companyId: parsed.data.companyId,
          ownerMembershipId,
        },
        changedFields: ["name", "companyId", "ownerMembershipId"],
      });
    });

    refreshCrm();
    return successState("Contact created.");
  } catch (error) {
    return errorState(
      isUniqueViolation(error)
        ? "A contact with that email already exists for this organization."
        : error instanceof CrmActionError
          ? error.message
          : "The contact could not be created.",
    );
  }
}

export async function updateContactAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const parsed = contactUpdateSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState(
      "Check the contact fields and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }

  try {
    const context = await authorize([crmPermissionKeys.contactUpdate]);
    const scope = permissionScope(context, crmPermissionKeys.contactUpdate);
    const ownerMembershipId = ensureAssignmentAllowed(context, parsed.data.ownerMembershipId);
    const database = getDatabaseClient();

    await database.begin(async (sql) => {
      await validateOwner(sql, context.membership.organizationId, ownerMembershipId);
      await validateCompanyReference(sql, context, parsed.data.companyId);
      const beforeRows = await sql<ContactRecord[]>`
        select id, company_id, first_name, last_name, job_title, email, phone,
          preferred_communication, is_billing_contact, is_decision_maker, consent_status,
          owner_membership_id, notes, created_by_membership_id
        from public.crm_contacts as contact
        where id = ${parsed.data.contactId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${context.membership.id}::uuid, ${scope},
            contact.owner_membership_id, contact.created_by_membership_id
          )
        for update
      `;
      const before = beforeRows[0];
      if (!before) throw new CrmActionError("Contact not found or outside your permitted scope.");

      await sql`
        update public.crm_contacts
        set company_id = ${parsed.data.companyId}::uuid,
            first_name = ${parsed.data.firstName},
            last_name = ${parsed.data.lastName},
            job_title = ${parsed.data.jobTitle},
            email = ${normalizeCrmEmail(parsed.data.email)},
            phone = ${parsed.data.phone},
            preferred_communication = ${parsed.data.preferredCommunication},
            is_billing_contact = ${parsed.data.isBillingContact},
            is_decision_maker = ${parsed.data.isDecisionMaker},
            consent_status = ${parsed.data.consentStatus},
            owner_membership_id = ${ownerMembershipId}::uuid,
            notes = ${parsed.data.notes}
        where id = ${before.id}::uuid
      `;

      await writeAudit(sql, context, {
        action: "crm.contact_updated",
        entityType: "crm_contact",
        entityId: before.id,
        beforeState: {
          companyId: before.company_id,
          ownerMembershipId: before.owner_membership_id,
        },
        afterState: { companyId: parsed.data.companyId, ownerMembershipId },
        changedFields: ["companyId", "ownerMembershipId"],
      });
    });

    refreshCrm();
    return successState("Contact updated.");
  } catch (error) {
    return errorState(
      error instanceof CrmActionError ? error.message : "The contact could not be updated.",
    );
  }
}

export async function createLeadAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const parsed = leadCreateSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the lead fields and try again.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize([crmPermissionKeys.leadCreate]);
    const ownerMembershipId = ensureAssignmentAllowed(context, parsed.data.ownerMembershipId);
    const database = getDatabaseClient();
    const warnings = await duplicateLeadWarnings(database, context.membership.organizationId, {
      email: parsed.data.email,
      phone: parsed.data.phone,
      companyName: parsed.data.companyName,
    });
    if (warnings.length > 0) {
      return errorState(
        "Possible duplicate lead found. Review the existing record before creating another.",
        undefined,
        warnings,
      );
    }

    const score = calculateLeadQualificationScore({
      hasEmail: Boolean(parsed.data.email),
      hasPhone: Boolean(parsed.data.phone),
      hasEstimatedValue: parsed.data.estimatedValue !== null,
      hasExpectedCloseDate: Boolean(parsed.data.expectedCloseDate),
      hasOwner: Boolean(ownerMembershipId),
      hasCompanyName: Boolean(parsed.data.companyName),
    });
    const qualificationLabel = leadQualificationLabel(score);

    await database.begin(async (sql) => {
      await validateOwner(sql, context.membership.organizationId, ownerMembershipId);
      const stages = await sql<{ id: string; probability: number }[]>`
        select id, probability
        from public.crm_pipeline_stages
        where id = ${parsed.data.stageId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and is_active
        limit 1
      `;
      const stage = stages[0];
      if (!stage) throw new CrmActionError("Choose an active pipeline stage.");

      const rows = await sql<{ id: string }[]>`
        insert into public.crm_leads (
          organization_id, name, lead_type, source, stage_id, estimated_value, currency,
          probability, expected_close_date, owner_membership_id, email, phone, company_name,
          follow_up_at, notes, qualification_score, qualification_label,
          created_by_membership_id, created_by
        )
        values (
          ${context.membership.organizationId}::uuid,
          ${parsed.data.name}, ${parsed.data.leadType}, ${parsed.data.source},
          ${parsed.data.stageId}::uuid, ${parsed.data.estimatedValue}, ${parsed.data.currency},
          ${parsed.data.probability || stage.probability}, ${parsed.data.expectedCloseDate}::date,
          ${ownerMembershipId}::uuid, ${normalizeCrmEmail(parsed.data.email)}, ${parsed.data.phone},
          ${parsed.data.companyName}, ${parsed.data.followUpAt}::timestamptz, ${parsed.data.notes},
          ${score}, ${qualificationLabel}, ${context.membership.id}::uuid, ${context.user.id}::uuid
        )
        returning id
      `;
      const lead = rows[0];
      if (!lead) throw new CrmActionError("The lead could not be created.");

      await sql`
        insert into public.crm_activities (
          organization_id, lead_id, activity_type, subject, details,
          created_by_membership_id, occurred_at
        )
        values (
          ${context.membership.organizationId}::uuid, ${lead.id}::uuid,
          'status_change', 'Lead created', ${parsed.data.notes},
          ${context.membership.id}::uuid, now()
        )
      `;
      await writeAudit(sql, context, {
        action: "crm.lead_created",
        entityType: "crm_lead",
        entityId: lead.id,
        afterState: {
          name: parsed.data.name,
          stageId: parsed.data.stageId,
          ownerMembershipId,
          qualificationScore: score,
        },
        changedFields: ["name", "stageId", "ownerMembershipId", "qualificationScore"],
      });
    });

    refreshCrm();
    return successState("Lead created.");
  } catch (error) {
    return errorState(crmMutationErrorMessage(error, "The lead could not be created."));
  }
}

export async function updateLeadAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const parsed = leadUpdateSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the lead fields and try again.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize([crmPermissionKeys.leadUpdate]);
    const ownerMembershipId = ensureAssignmentAllowed(context, parsed.data.ownerMembershipId);
    const database = getDatabaseClient();

    await database.begin(async (sql) => {
      const before = await getLeadForMutation(
        sql,
        context,
        parsed.data.leadId,
        crmPermissionKeys.leadUpdate,
        true,
      );
      if (before.status === "converted") throw new CrmActionError("Converted leads are read-only.");
      await validateOwner(sql, context.membership.organizationId, ownerMembershipId);

      const score = calculateLeadQualificationScore({
        hasEmail: Boolean(parsed.data.email),
        hasPhone: Boolean(parsed.data.phone),
        hasEstimatedValue: parsed.data.estimatedValue !== null,
        hasExpectedCloseDate: Boolean(parsed.data.expectedCloseDate),
        hasOwner: Boolean(ownerMembershipId),
        hasCompanyName: Boolean(parsed.data.companyName),
      });

      await sql`
        update public.crm_leads
        set name = ${parsed.data.name}, lead_type = ${parsed.data.leadType},
            source = ${parsed.data.source}, status = ${parsed.data.status},
            stage_id = ${parsed.data.stageId}::uuid, estimated_value = ${parsed.data.estimatedValue},
            currency = ${parsed.data.currency}, probability = ${parsed.data.probability},
            expected_close_date = ${parsed.data.expectedCloseDate}::date,
            owner_membership_id = ${ownerMembershipId}::uuid,
            email = ${normalizeCrmEmail(parsed.data.email)}, phone = ${parsed.data.phone},
            company_name = ${parsed.data.companyName}, follow_up_at = ${parsed.data.followUpAt}::timestamptz,
            notes = ${parsed.data.notes}, lost_reason = ${parsed.data.lostReason},
            qualification_score = ${score}, qualification_label = ${leadQualificationLabel(score)}
        where id = ${before.id}::uuid
      `;

      await writeAudit(sql, context, {
        action: "crm.lead_updated",
        entityType: "crm_lead",
        entityId: before.id,
        beforeState: {
          status: before.status,
          stageId: before.stage_id,
          ownerMembershipId: before.owner_membership_id,
        },
        afterState: { status: parsed.data.status, stageId: parsed.data.stageId, ownerMembershipId },
        changedFields: ["status", "stageId", "ownerMembershipId", "qualificationScore"],
      });
    });

    refreshCrm();
    return successState("Lead updated.");
  } catch (error) {
    return errorState(crmMutationErrorMessage(error, "The lead could not be updated."));
  }
}

export async function updateLeadStageAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const parsed = leadStageUpdateSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Choose a valid pipeline stage.");

  try {
    const context = await authorize([crmPermissionKeys.leadUpdate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const lead = await getLeadForMutation(
        sql,
        context,
        parsed.data.leadId,
        crmPermissionKeys.leadUpdate,
        true,
      );
      if (lead.status === "converted")
        throw new CrmActionError("Converted leads cannot change stage.");
      const stageRows = await sql<
        {
          id: string;
          name: string;
          probability: number;
          state: string;
          required_fields: string[];
        }[]
      >`
        select id, name, probability, state,
          coalesce(array(select jsonb_array_elements_text(required_fields)), array[]::text[]) as required_fields
        from public.crm_pipeline_stages
        where id = ${parsed.data.stageId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and is_active
        limit 1
      `;
      const stage = stageRows[0];
      if (!stage) throw new CrmActionError("Pipeline stage not found.");
      const nextStatus = stage.state === "lost" ? "lost" : lead.status;
      if (stage.state === "lost" && !parsed.data.lostReason) {
        throw new CrmActionError("Enter a lost reason before moving this opportunity to Lost.");
      }

      await sql`
        update public.crm_leads
        set stage_id = ${stage.id}::uuid,
            probability = ${stage.probability},
            status = ${nextStatus},
            lost_reason = case when ${stage.state} = 'lost' then ${parsed.data.lostReason} else lost_reason end,
            stage_entered_at = now()
        where id = ${lead.id}::uuid
      `;
      await sql`
        insert into public.crm_activities (
          organization_id, lead_id, activity_type, subject, details, created_by_membership_id
        )
        values (
          ${context.membership.organizationId}::uuid, ${lead.id}::uuid, 'status_change',
          ${`Moved to ${stage.name}`}, ${`Previous stage: ${lead.stage_id}`}, ${context.membership.id}::uuid
        )
      `;
      await writeAudit(sql, context, {
        action: "crm.lead_stage_changed",
        entityType: "crm_lead",
        entityId: lead.id,
        beforeState: { stageId: lead.stage_id, status: lead.status },
        afterState: { stageId: stage.id, status: nextStatus },
        changedFields: ["stageId", "probability", "status", "stageEnteredAt"],
      });
    });

    refreshCrm();
    return successState("Lead stage updated.");
  } catch (error) {
    return errorState(crmMutationErrorMessage(error, "The stage could not be updated."));
  }
}

export async function qualifyLeadAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const parsed = leadQualificationSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Choose a valid qualification decision.");

  try {
    const context = await authorize([crmPermissionKeys.leadUpdate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const lead = await getLeadForMutation(
        sql,
        context,
        parsed.data.leadId,
        crmPermissionKeys.leadUpdate,
        true,
      );
      if (lead.status === "converted")
        throw new CrmActionError("Converted leads cannot be requalified.");
      await sql`
        update public.crm_leads
        set status = ${parsed.data.status},
            qualification_label = ${parsed.data.status === "qualified" ? "qualified" : "cold"},
            qualification = jsonb_build_object(
              'decision', ${parsed.data.status},
              'reason', ${parsed.data.reason},
              'decidedAt', now(),
              'decidedByMembershipId', ${context.membership.id}
            )
        where id = ${lead.id}::uuid
      `;
      await sql`
        insert into public.crm_activities (
          organization_id, lead_id, activity_type, subject, details, created_by_membership_id
        )
        values (
          ${context.membership.organizationId}::uuid, ${lead.id}::uuid, 'status_change',
          ${parsed.data.status === "qualified" ? "Lead qualified" : "Lead unqualified"},
          ${parsed.data.reason}, ${context.membership.id}::uuid
        )
      `;
      await writeAudit(sql, context, {
        action: "crm.lead_qualification_changed",
        entityType: "crm_lead",
        entityId: lead.id,
        beforeState: { status: lead.status, qualificationLabel: lead.qualification_label },
        afterState: { status: parsed.data.status, reason: parsed.data.reason },
        changedFields: ["status", "qualification", "qualificationLabel"],
      });
    });

    refreshCrm();
    return successState(
      parsed.data.status === "qualified" ? "Lead qualified." : "Lead marked unqualified.",
    );
  } catch (error) {
    return errorState(
      error instanceof CrmActionError ? error.message : "The qualification could not be saved.",
    );
  }
}

export async function deleteLeadAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const parsed = leadDeleteSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Choose a valid lead.");

  try {
    const context = await authorize([crmPermissionKeys.leadDelete]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const lead = await getLeadForMutation(
        sql,
        context,
        parsed.data.leadId,
        crmPermissionKeys.leadDelete,
        true,
      );
      if (lead.status === "converted")
        throw new CrmActionError("Converted leads must remain for reporting.");
      await writeAudit(sql, context, {
        action: "crm.lead_deleted",
        entityType: "crm_lead",
        entityId: lead.id,
        beforeState: { name: lead.name, status: lead.status },
        changedFields: ["deleted"],
      });
      await sql`delete from public.crm_leads where id = ${lead.id}::uuid`;
    });
    refreshCrm();
    return successState("Lead deleted.");
  } catch (error) {
    return errorState(
      error instanceof CrmActionError ? error.message : "The lead could not be deleted.",
    );
  }
}

export async function createActivityAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const parsed = activityCreateSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState(
      "Check the activity fields and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }

  const targets = [parsed.data.leadId, parsed.data.companyId, parsed.data.contactId].filter(
    Boolean,
  );
  if (targets.length !== 1) return errorState("Select exactly one CRM record for the activity.");

  try {
    const targetViewPermission = parsed.data.leadId
      ? crmPermissionKeys.leadView
      : parsed.data.companyId
        ? crmPermissionKeys.companyView
        : crmPermissionKeys.contactView;
    const context = await authorize([crmPermissionKeys.activityCreate, targetViewPermission]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      let entityType = "";
      let entityId = "";
      if (parsed.data.leadId) {
        await getLeadForMutation(sql, context, parsed.data.leadId, crmPermissionKeys.leadView);
        entityType = "crm_lead";
        entityId = parsed.data.leadId;
      } else if (parsed.data.companyId) {
        const scope = permissionScope(context, crmPermissionKeys.companyView);
        const rows = await sql<{ id: string }[]>`
          select id from public.crm_companies as company
          where id = ${parsed.data.companyId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
            and private.crm_scope_allows_membership(
              ${context.membership.id}::uuid, ${scope},
              company.account_owner_membership_id, company.created_by_membership_id
            )
        `;
        if (!rows[0])
          throw new CrmActionError("Company not found or outside your permitted scope.");
        entityType = "crm_company";
        entityId = parsed.data.companyId;
      } else if (parsed.data.contactId) {
        const scope = permissionScope(context, crmPermissionKeys.contactView);
        const rows = await sql<{ id: string }[]>`
          select id from public.crm_contacts as contact
          where id = ${parsed.data.contactId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
            and private.crm_scope_allows_membership(
              ${context.membership.id}::uuid, ${scope},
              contact.owner_membership_id, contact.created_by_membership_id
            )
        `;
        if (!rows[0])
          throw new CrmActionError("Contact not found or outside your permitted scope.");
        entityType = "crm_contact";
        entityId = parsed.data.contactId;
      }

      const rows = await sql<{ id: string }[]>`
        insert into public.crm_activities (
          organization_id, lead_id, company_id, contact_id, activity_type, subject, details,
          due_at, created_by_membership_id
        )
        values (
          ${context.membership.organizationId}::uuid,
          ${parsed.data.leadId}::uuid, ${parsed.data.companyId}::uuid, ${parsed.data.contactId}::uuid,
          ${parsed.data.activityType}, ${parsed.data.subject}, ${parsed.data.details},
          ${parsed.data.dueAt}::timestamptz, ${context.membership.id}::uuid
        )
        returning id
      `;
      if (parsed.data.leadId && parsed.data.activityType === "follow_up" && parsed.data.dueAt) {
        await sql`
          update public.crm_leads
          set follow_up_at = case
            when follow_up_at is null then ${parsed.data.dueAt}::timestamptz
            else least(follow_up_at, ${parsed.data.dueAt}::timestamptz)
          end
          where id = ${parsed.data.leadId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
        `;
      }
      await writeAudit(sql, context, {
        action: "crm.activity_created",
        entityType,
        entityId,
        afterState: {
          activityId: rows[0]?.id,
          type: parsed.data.activityType,
          subject: parsed.data.subject,
        },
        changedFields: ["activity"],
      });
    });
    refreshCrm();
    return successState("Activity added.");
  } catch (error) {
    return errorState(
      error instanceof CrmActionError ? error.message : "The activity could not be added.",
    );
  }
}

export async function completeActivityAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const parsed = activityCompleteSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Choose a valid activity.");

  try {
    const context = await authorize([crmPermissionKeys.activityUpdate]);
    const scope = permissionScope(context, crmPermissionKeys.activityUpdate);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const rows = await sql<Array<{ id: string; lead_id: string | null; activity_type: string }>>`
        select activity.id, activity.lead_id, activity.activity_type
        from public.crm_activities activity
        left join public.crm_leads lead on lead.id = activity.lead_id
        left join public.crm_companies company on company.id = activity.company_id
        left join public.crm_contacts contact on contact.id = activity.contact_id
        where activity.id = ${parsed.data.activityId}::uuid
          and activity.organization_id = ${context.membership.organizationId}::uuid
          and activity.completed_at is null
          and (
            (activity.lead_id is not null and private.crm_scope_allows_membership(
              ${context.membership.id}::uuid, ${scope}, lead.owner_membership_id, lead.created_by_membership_id
            ))
            or (activity.company_id is not null and private.crm_scope_allows_membership(
              ${context.membership.id}::uuid, ${scope}, company.account_owner_membership_id, company.created_by_membership_id
            ))
            or (activity.contact_id is not null and private.crm_scope_allows_membership(
              ${context.membership.id}::uuid, ${scope}, contact.owner_membership_id, contact.created_by_membership_id
            ))
          )
        for update of activity
      `;
      const activity = rows[0];
      if (!activity) throw new CrmActionError("Activity not found or already complete.");
      await sql`update public.crm_activities set completed_at = now() where id = ${activity.id}::uuid`;
      if (activity.lead_id && activity.activity_type === "follow_up") {
        await sql`
          update public.crm_leads lead
          set follow_up_at = (
            select min(next_activity.due_at)
            from public.crm_activities next_activity
            where next_activity.lead_id = lead.id
              and next_activity.activity_type = 'follow_up'
              and next_activity.completed_at is null
              and next_activity.due_at is not null
          )
          where lead.id = ${activity.lead_id}::uuid
        `;
      }
      await writeAudit(sql, context, {
        action: "crm.activity_completed",
        entityType: "crm_activity",
        entityId: activity.id,
        changedFields: ["completedAt"],
      });
    });
    refreshCrm();
    return successState("Activity completed.");
  } catch (error) {
    return errorState(
      error instanceof CrmActionError ? error.message : "The activity could not be completed.",
    );
  }
}

export async function convertLeadAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const parsed = leadConvertSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Choose a valid lead.");

  try {
    const required: string[] = [crmPermissionKeys.leadUpdate, crmPermissionKeys.companyCreate];
    if (parsed.data.createContact) required.push(crmPermissionKeys.contactCreate);
    if (parsed.data.createContractRequest) {
      required.push(legalPermissionKeys.workspace, legalPermissionKeys.create);
    }
    const context = await authorize(required);
    const database = getDatabaseClient();

    const result = await database.begin(async (sql) => {
      const lead = await getLeadForMutation(
        sql,
        context,
        parsed.data.leadId,
        crmPermissionKeys.leadUpdate,
        true,
      );
      if (lead.converted_at || lead.status === "converted") {
        throw new CrmActionError("This lead has already been converted.");
      }
      if (lead.status !== "qualified") {
        throw new CrmActionError("Qualify the lead before conversion.");
      }

      const normalizedCompany = normalizeCrmCompanyName(lead.company_name ?? lead.name);
      const companyUpdateScope = permissionScope(context, crmPermissionKeys.companyUpdate);
      const companyRows = await sql<
        {
          id: string;
          can_update: boolean;
          currency: string;
          payment_terms_days: number;
        }[]
      >`
        select
          company.id, company.currency, company.payment_terms_days,
          private.crm_scope_allows_membership(
            ${context.membership.id}::uuid,
            ${companyUpdateScope},
            company.account_owner_membership_id,
            company.created_by_membership_id
          ) as can_update
        from public.crm_companies as company
        where company.organization_id = ${context.membership.organizationId}::uuid
          and lower(regexp_replace(coalesce(company.display_name, company.legal_name), '\\s+', ' ', 'g')) = ${normalizedCompany}
        order by company.created_at
        limit 1
      `;
      let companyId = companyRows[0]?.id;
      const conversionOwnerMembershipId =
        lead.owner_membership_id === context.membership.id ||
        context.permissions.has(crmPermissionKeys.leadAssign)
          ? (lead.owner_membership_id ?? context.membership.id)
          : context.membership.id;

      if (!companyId) {
        const createdCompanies = await sql<{ id: string }[]>`
          insert into public.crm_companies (
            organization_id, legal_name, display_name, email, phone, account_owner_membership_id,
            client_status, currency, notes, created_by_membership_id, created_by
          )
          values (
            ${context.membership.organizationId}::uuid,
            ${lead.company_name ?? lead.name}, ${lead.company_name ?? lead.name},
            ${lead.email}, ${lead.phone}, ${conversionOwnerMembershipId}::uuid,
            'client', ${lead.currency}, ${lead.notes}, ${context.membership.id}::uuid, ${context.user.id}::uuid
          )
          returning id
        `;
        companyId = createdCompanies[0]?.id;
      } else {
        if (
          !context.permissions.has(crmPermissionKeys.companyUpdate) ||
          !companyRows[0]?.can_update
        ) {
          throw new CrmActionError(
            "A matching company already exists outside your permitted update scope.",
          );
        }
        await sql`update public.crm_companies set client_status = 'client' where id = ${companyId}::uuid`;
      }
      if (!companyId) throw new CrmActionError("The client company could not be created.");

      let contactId: string | null = null;
      if (parsed.data.createContact && (lead.email || lead.phone || lead.lead_type === "person")) {
        const nameParts = lead.name.trim().split(/\s+/);
        const firstName = nameParts.shift() ?? lead.name;
        const lastName = nameParts.join(" ") || "Contact";
        const contactViewScope = permissionScope(context, crmPermissionKeys.contactView);
        const existingContacts = lead.email
          ? await sql<{ id: string; company_id: string | null; can_view: boolean }[]>`
              select
                contact.id,
                contact.company_id,
                private.crm_scope_allows_membership(
                  ${context.membership.id}::uuid,
                  ${contactViewScope},
                  contact.owner_membership_id,
                  contact.created_by_membership_id
                ) as can_view
              from public.crm_contacts as contact
              where contact.organization_id = ${context.membership.organizationId}::uuid
                and lower(contact.email) = ${normalizeCrmEmail(lead.email)}
              limit 1
            `
          : [];
        const existingContact = existingContacts[0];
        if (
          existingContact &&
          (!context.permissions.has(crmPermissionKeys.contactView) || !existingContact.can_view)
        ) {
          throw new CrmActionError(
            "A contact with this email already exists outside your permitted scope.",
          );
        }
        if (existingContact?.company_id && existingContact.company_id !== companyId) {
          throw new CrmActionError(
            "A contact with this email is already linked to another company.",
          );
        }
        contactId = existingContact?.id ?? null;
        if (!contactId) {
          const contacts = await sql<{ id: string }[]>`
            insert into public.crm_contacts (
              organization_id, company_id, first_name, last_name, email, phone,
              is_decision_maker, consent_status, owner_membership_id,
              created_by_membership_id, created_by
            )
            values (
              ${context.membership.organizationId}::uuid, ${companyId}::uuid,
              ${firstName}, ${lastName}, ${lead.email}, ${lead.phone}, true, 'unknown',
              ${conversionOwnerMembershipId}::uuid,
              ${context.membership.id}::uuid, ${context.user.id}::uuid
            )
            returning id
          `;
          contactId = contacts[0]?.id ?? null;
        }
      }

      let billingProfileId: string | null = null;
      if (parsed.data.createBillingProfile) {
        const billingRows = await sql<Array<{ id: string }>>`
          insert into public.crm_client_billing_profiles (
            organization_id, company_id, source_lead_id, billing_contact_id, currency,
            payment_terms_days, created_by_membership_id
          ) values (
            ${context.membership.organizationId}::uuid, ${companyId}::uuid, ${lead.id}::uuid,
            ${contactId}::uuid, ${companyRows[0]?.currency ?? lead.currency},
            ${companyRows[0]?.payment_terms_days ?? 30}, ${context.membership.id}::uuid
          )
          on conflict (organization_id, company_id) do update
          set source_lead_id = coalesce(public.crm_client_billing_profiles.source_lead_id, excluded.source_lead_id),
              billing_contact_id = coalesce(public.crm_client_billing_profiles.billing_contact_id, excluded.billing_contact_id),
              currency = excluded.currency, payment_terms_days = excluded.payment_terms_days, updated_at = now()
          returning id
        `;
        billingProfileId = billingRows[0]?.id ?? null;
      }

      let legalContractId: string | null = null;
      if (parsed.data.createContractRequest) {
        const reference = `CRM-${lead.id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
        const contractValueMinor =
          lead.estimated_value === null ? null : Math.round(Number(lead.estimated_value) * 100);
        const contractRows = await sql<Array<{ id: string }>>`
          insert into public.legal_contracts (
            organization_id, internal_reference, title, contract_type, counterparty_name,
            counterparty_company_id, responsible_owner_membership_id, status, contract_value_minor,
            currency, created_by_membership_id
          ) values (
            ${context.membership.organizationId}::uuid, ${reference},
            ${`${lead.company_name ?? lead.name} client contract request`}, 'client_contract',
            ${lead.company_name ?? lead.name}, ${companyId}::uuid, ${conversionOwnerMembershipId}::uuid,
            'request', ${contractValueMinor}, ${lead.currency}, ${context.membership.id}::uuid
          )
          on conflict (organization_id, internal_reference) do update
            set counterparty_company_id = excluded.counterparty_company_id
          returning id
        `;
        legalContractId = contractRows[0]?.id ?? null;
      }

      const wonStages = await sql<{ id: string }[]>`
        select id from public.crm_pipeline_stages
        where organization_id = ${context.membership.organizationId}::uuid
          and state = 'won' and is_active
        order by position
        limit 1
      `;

      await sql`
        update public.crm_leads
        set status = 'converted',
            stage_id = coalesce(${wonStages[0]?.id ?? null}::uuid, stage_id),
            probability = 100,
            converted_company_id = ${companyId}::uuid,
            converted_contact_id = ${contactId}::uuid,
            converted_at = now()
        where id = ${lead.id}::uuid
      `;
      await sql`
        insert into public.crm_lead_conversions (
          organization_id, lead_id, company_id, contact_id, billing_profile_id, legal_contract_id,
          converted_by_membership_id, source, original_stage_id, original_estimated_value,
          original_probability, sales_cycle_days, evidence
        ) values (
          ${context.membership.organizationId}::uuid, ${lead.id}::uuid, ${companyId}::uuid,
          ${contactId}::uuid, ${billingProfileId}::uuid, ${legalContractId}::uuid,
          ${context.membership.id}::uuid, ${lead.source}, ${lead.stage_id}::uuid,
          ${lead.estimated_value}, ${lead.probability},
          extract(epoch from (now() - ${lead.created_at}::timestamptz)) / 86400.0,
          ${sql.json({
            conversionOwnerMembershipId,
            createContact: parsed.data.createContact,
            createBillingProfile: parsed.data.createBillingProfile,
            createContractRequest: parsed.data.createContractRequest,
          })}
        )
        on conflict (lead_id) do nothing
      `;
      await sql`
        insert into public.crm_activities (
          organization_id, lead_id, activity_type, subject, details, created_by_membership_id
        )
        values (
          ${context.membership.organizationId}::uuid, ${lead.id}::uuid,
          'status_change', 'Lead converted',
          ${`Client company ${companyId}${contactId ? `, contact ${contactId}` : ""}${billingProfileId ? `, billing profile ${billingProfileId}` : ""}${legalContractId ? `, contract request ${legalContractId}` : ""} created or linked.`},
          ${context.membership.id}::uuid
        )
      `;
      await writeAudit(sql, context, {
        action: "crm.lead_converted",
        entityType: "crm_lead",
        entityId: lead.id,
        beforeState: { status: lead.status, convertedCompanyId: lead.converted_company_id },
        afterState: {
          status: "converted",
          companyId,
          contactId,
          billingProfileId,
          legalContractId,
        },
        changedFields: [
          "status",
          "stageId",
          "probability",
          "convertedCompanyId",
          "convertedContactId",
          "convertedAt",
          "billingProfileId",
          "legalContractId",
        ],
      });

      return { companyId, contactId, billingProfileId, legalContractId };
    });

    refreshCrm();
    return successState(
      `Lead converted to client company${result.contactId ? ", contact" : ""}${result.billingProfileId ? ", billing profile" : ""}${result.legalContractId ? ", and contract request" : ""}.`,
    );
  } catch (error) {
    return errorState(
      error instanceof CrmActionError ? error.message : "The lead could not be converted.",
    );
  }
}

export async function createPipelineStageAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const parsed = pipelineStageCreateSchema.safeParse({
    ...values(formData),
    requiredFields: formData.getAll("requiredFields").map(String),
  });
  if (!parsed.success) {
    return errorState("Check the stage fields and try again.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize([crmPermissionKeys.pipelineManage]);
    const slug = normalizeCrmPipelineSlug(parsed.data.name);
    if (!slug) return errorState("Use at least one letter or number in the stage name.");
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const positions = await sql<{ next_position: number }[]>`
        select coalesce(max(position), 0) + 10 as next_position
        from public.crm_pipeline_stages
        where organization_id = ${context.membership.organizationId}::uuid
      `;
      const rows = await sql<{ id: string }[]>`
        insert into public.crm_pipeline_stages (
          organization_id, name, slug, position, probability, state, required_fields, created_by
        )
        values (
          ${context.membership.organizationId}::uuid,
          ${parsed.data.name},
          ${slug},
          ${positions[0]?.next_position ?? 10},
          ${parsed.data.probability},
          ${parsed.data.state},
          ${sql.json(parsed.data.requiredFields)},
          ${context.user.id}::uuid
        )
        returning id
      `;
      await writeAudit(sql, context, {
        action: "crm.pipeline_stage_created",
        entityType: "crm_pipeline_stage",
        entityId: rows[0]?.id ?? "unknown",
        afterState: parsed.data,
        changedFields: ["name", "position", "probability", "state", "requiredFields"],
      });
    });
    refreshCrm();
    return successState("Pipeline stage created.");
  } catch (error) {
    return errorState(
      isUniqueViolation(error)
        ? "A pipeline stage with that name already exists."
        : error instanceof CrmActionError
          ? error.message
          : "The pipeline stage could not be created.",
    );
  }
}

export async function updatePipelineStageAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const parsed = pipelineStageUpdateSchema.safeParse({
    ...values(formData),
    requiredFields: formData.getAll("requiredFields").map(String),
  });
  if (!parsed.success) {
    return errorState("Check the stage fields and try again.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize([crmPermissionKeys.pipelineManage]);
    const slug = normalizeCrmPipelineSlug(parsed.data.name);
    if (!slug) return errorState("Use at least one letter or number in the stage name.");
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
        update public.crm_pipeline_stages
        set name = ${parsed.data.name}, slug = ${slug}, probability = ${parsed.data.probability},
          state = ${parsed.data.state}, required_fields = ${sql.json(parsed.data.requiredFields)},
          is_active = ${parsed.data.isActive}
        where id = ${parsed.data.stageId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        returning id
      `;
      if (!rows[0]) throw new CrmActionError("Pipeline stage not found.");
      await writeAudit(sql, context, {
        action: "crm.pipeline_stage_updated",
        entityType: "crm_pipeline_stage",
        entityId: rows[0].id,
        afterState: parsed.data,
        changedFields: ["name", "probability", "state", "requiredFields", "isActive"],
      });
    });
    refreshCrm();
    return successState("Pipeline stage updated.");
  } catch (error) {
    return errorState(
      isUniqueViolation(error)
        ? "A pipeline stage with that name already exists."
        : error instanceof CrmActionError
          ? error.message
          : "The pipeline stage could not be updated.",
    );
  }
}

export async function setCrmForecastTargetAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const parsed = crmForecastTargetSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the forecast target.", parsed.error.flatten().fieldErrors);
  }
  const month = `${parsed.data.month.slice(0, 7)}-01`;
  try {
    const context = await authorize([crmPermissionKeys.pipelineManage]);
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
        insert into public.crm_forecast_targets (
          organization_id, month, currency, target_value, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${month}::date, ${parsed.data.currency},
          ${parsed.data.targetValue}, ${context.membership.id}::uuid
        )
        on conflict (organization_id, month, currency) do update
          set target_value = excluded.target_value, updated_at = now()
        returning id
      `;
      await writeAudit(sql, context, {
        action: "crm.forecast_target_saved",
        entityType: "crm_forecast_target",
        entityId: rows[0]?.id ?? "unknown",
        afterState: { month, currency: parsed.data.currency, targetValue: parsed.data.targetValue },
        changedFields: ["forecastTarget"],
      });
    });
    refreshCrm();
    return successState("Forecast target saved.");
  } catch {
    return errorState("The forecast target could not be saved.");
  }
}
