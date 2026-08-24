import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { crmPermissionKeys } from "@/modules/crm/crm";
import { documentPermissionKeys } from "@/modules/documents/documents";
import { financePermissionKeys } from "@/modules/finance/finance";
import { legalPermissionKeys } from "@/modules/legal/legal";
import { projectPermissionKeys } from "@/modules/projects/projects";
import { supportPermissionKeys } from "@/modules/support/support";
import {
  getCrmImportWorkspaceData,
  type CrmImportWorkspaceData,
} from "@/modules/crm/server/imports";
import { getCrmForecastDataForContext, type CrmForecastData } from "@/modules/crm/server/forecast";
import type { CrmFilters } from "@/modules/crm/schemas/crm";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import { getCurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import type { PermissionScope } from "@/modules/permissions/permission-scopes";

export const CRM_PAGE_SIZE = 24;

export interface CrmPipelineStage {
  id: string;
  name: string;
  slug: string;
  position: number;
  probability: number;
  state: "open" | "won" | "lost";
  isActive: boolean;
  requiredFields: string[];
}

export interface CrmMemberOption {
  membershipId: string;
  displayName: string;
  email: string;
}

export interface CrmRelatedRecord {
  id: string;
  kind: "project" | "invoice" | "contract" | "ticket" | "document";
  label: string;
  metadata: string | null;
  status: string | null;
  href: string;
}

export interface CrmLinkedDocument {
  id: string;
  title: string;
  classification: "internal" | "confidential" | "restricted";
  status: "active" | "archived";
  href: string;
}

export interface CrmCompanyContactOption {
  id: string;
  companyId: string;
  name: string;
  email: string | null;
}

export interface CrmCompany {
  id: string;
  legalName: string;
  displayName: string | null;
  industry: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  clientStatus: "prospect" | "client" | "inactive";
  ownerMembershipId: string | null;
  ownerName: string | null;
  currency: string;
  paymentTermsDays: number;
  contactCount: number;
  primaryContactId: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  relatedRecords: CrmRelatedRecord[];
  updatedAt: string;
}

export interface CrmContact {
  id: string;
  companyId: string | null;
  companyName: string | null;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  preferredCommunication: "email" | "phone" | "meeting" | "none";
  isBillingContact: boolean;
  isDecisionMaker: boolean;
  consentStatus: "unknown" | "granted" | "revoked";
  status: "active" | "inactive";
  ownerMembershipId: string | null;
  ownerName: string | null;
  updatedAt: string;
}

export interface CrmLead {
  id: string;
  name: string;
  leadType: "person" | "company";
  source: string | null;
  status: "new" | "qualified" | "unqualified" | "converted" | "lost";
  stageId: string;
  stageName: string;
  stageState: "open" | "won" | "lost";
  estimatedValue: number | null;
  expectedRevenue: number;
  currency: string;
  probability: number;
  expectedCloseDate: string | null;
  ownerMembershipId: string | null;
  ownerName: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  followUpAt: string | null;
  lostReason: string | null;
  notes: string | null;
  qualificationScore: number;
  qualificationLabel: "cold" | "warm" | "qualified";
  extraFields: Record<string, unknown>;
  convertedCompanyId: string | null;
  convertedContactId: string | null;
  convertedAt: string | null;
  documents: CrmLinkedDocument[];
  createdAt: string;
  updatedAt: string;
}

export interface CrmActivity {
  id: string;
  entityType: "lead" | "company" | "contact";
  entityId: string;
  entityName: string;
  activityType: string;
  subject: string;
  details: string | null;
  dueAt: string | null;
  completedAt: string | null;
  actorName: string;
  occurredAt: string;
}

export interface CrmWorkspaceData {
  organizationId: string;
  currentMembershipId: string;
  filters: CrmFilters;
  stages: CrmPipelineStage[];
  members: CrmMemberOption[];
  leads: CrmLead[];
  companies: CrmCompany[];
  contacts: CrmContact[];
  companyContactOptions: CrmCompanyContactOption[];
  activities: CrmActivity[];
  forecast: CrmForecastData;
  imports: CrmImportWorkspaceData;
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  summary: {
    openLeads: number;
    qualifiedLeads: number;
    pipelineValue: number;
    companies: number;
    contacts: number;
  };
  capabilities: {
    canViewLeads: boolean;
    canCreateLeads: boolean;
    canUpdateLeads: boolean;
    canDeleteLeads: boolean;
    canAssignLeads: boolean;
    canViewCompanies: boolean;
    canCreateCompanies: boolean;
    canUpdateCompanies: boolean;
    canViewContacts: boolean;
    canCreateContacts: boolean;
    canUpdateContacts: boolean;
    canCreateActivities: boolean;
    canUpdateActivities: boolean;
    canManagePipeline: boolean;
    canViewImports: boolean;
    canExecuteImports: boolean;
    canManageConnections: boolean;
    canViewDocuments: boolean;
    canCreateDocuments: boolean;
    canCreateContracts: boolean;
  };
}

export type CrmWorkspaceResult =
  | { allowed: true; data: CrmWorkspaceData }
  | { allowed: false; reason: AuthorizationFailureReason };

interface StageRow {
  id: string;
  name: string;
  slug: string;
  position: number;
  probability: number;
  state: "open" | "won" | "lost";
  is_active: boolean;
  required_fields: string[];
}

interface MemberRow {
  membership_id: string;
  display_name: string;
  email: string;
}

interface LeadRow {
  id: string;
  name: string;
  lead_type: "person" | "company";
  source: string | null;
  status: CrmLead["status"];
  stage_id: string;
  stage_name: string;
  stage_state: CrmLead["stageState"];
  estimated_value: string | number | null;
  currency: string;
  probability: number;
  expected_close_date: string | null;
  owner_membership_id: string | null;
  owner_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  follow_up_at: Date | null;
  lost_reason: string | null;
  notes: string | null;
  qualification_score: number;
  qualification_label: CrmLead["qualificationLabel"];
  extra_fields: Record<string, unknown>;
  converted_company_id: string | null;
  converted_contact_id: string | null;
  converted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface CompanyRow {
  id: string;
  legal_name: string;
  display_name: string | null;
  industry: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  client_status: CrmCompany["clientStatus"];
  account_owner_membership_id: string | null;
  owner_name: string | null;
  currency: string;
  payment_terms_days: number;
  contact_count: number;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  updated_at: Date;
}

interface ContactRow {
  id: string;
  company_id: string | null;
  company_name: string | null;
  first_name: string;
  last_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  preferred_communication: CrmContact["preferredCommunication"];
  is_billing_contact: boolean;
  is_decision_maker: boolean;
  consent_status: CrmContact["consentStatus"];
  status: CrmContact["status"];
  owner_membership_id: string | null;
  owner_name: string | null;
  updated_at: Date;
}

interface ActivityRow {
  id: string;
  entity_type: CrmActivity["entityType"];
  entity_id: string;
  entity_name: string;
  activity_type: string;
  subject: string;
  details: string | null;
  due_at: Date | null;
  completed_at: Date | null;
  actor_name: string;
  occurred_at: Date;
}

interface CompanyContactOptionRow {
  id: string;
  company_id: string;
  name: string;
  email: string | null;
}

interface RelatedRecordRow {
  company_id: string;
  id: string;
  kind: CrmRelatedRecord["kind"];
  label: string;
  metadata: string | null;
  status: string | null;
  href: string;
}

interface LeadDocumentRow {
  lead_id: string;
  id: string;
  title: string;
  classification: CrmLinkedDocument["classification"];
  status: CrmLinkedDocument["status"];
}

interface CountRow {
  count: number;
}

interface SummaryRow {
  open_leads: number;
  qualified_leads: number;
  pipeline_value: string | number;
  company_count: number;
  contact_count: number;
}

function permissionScope(
  scopes: ReadonlyMap<string, PermissionScope>,
  key: string,
): PermissionScope {
  return scopes.get(key) ?? "own";
}

function mapLead(row: LeadRow, documents: CrmLinkedDocument[] = []): CrmLead {
  return {
    id: row.id,
    name: row.name,
    leadType: row.lead_type,
    source: row.source,
    status: row.status,
    stageId: row.stage_id,
    stageName: row.stage_name,
    stageState: row.stage_state,
    estimatedValue: row.estimated_value === null ? null : Number(row.estimated_value),
    expectedRevenue:
      ((row.estimated_value === null ? 0 : Number(row.estimated_value)) * row.probability) / 100,
    currency: row.currency,
    probability: row.probability,
    expectedCloseDate: row.expected_close_date,
    ownerMembershipId: row.owner_membership_id,
    ownerName: row.owner_name,
    email: row.email,
    phone: row.phone,
    companyName: row.company_name,
    followUpAt: row.follow_up_at?.toISOString() ?? null,
    lostReason: row.lost_reason,
    notes: row.notes,
    qualificationScore: row.qualification_score,
    qualificationLabel: row.qualification_label,
    extraFields: row.extra_fields,
    convertedCompanyId: row.converted_company_id,
    convertedContactId: row.converted_contact_id,
    convertedAt: row.converted_at?.toISOString() ?? null,
    documents,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getCrmWorkspaceData(filters: CrmFilters): Promise<CrmWorkspaceResult> {
  const permissionContext = await getCurrentPermissionContext();
  if (!permissionContext.allowed) return permissionContext;

  const { membership, permissions, permissionScopes } = permissionContext.context;
  if (!permissions.has(crmPermissionKeys.workspaceView)) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  const capabilities = {
    canViewLeads: permissions.has(crmPermissionKeys.leadView),
    canCreateLeads: permissions.has(crmPermissionKeys.leadCreate),
    canUpdateLeads: permissions.has(crmPermissionKeys.leadUpdate),
    canDeleteLeads: permissions.has(crmPermissionKeys.leadDelete),
    canAssignLeads: permissions.has(crmPermissionKeys.leadAssign),
    canViewCompanies: permissions.has(crmPermissionKeys.companyView),
    canCreateCompanies: permissions.has(crmPermissionKeys.companyCreate),
    canUpdateCompanies: permissions.has(crmPermissionKeys.companyUpdate),
    canViewContacts: permissions.has(crmPermissionKeys.contactView),
    canCreateContacts: permissions.has(crmPermissionKeys.contactCreate),
    canUpdateContacts: permissions.has(crmPermissionKeys.contactUpdate),
    canCreateActivities: permissions.has(crmPermissionKeys.activityCreate),
    canUpdateActivities: permissions.has(crmPermissionKeys.activityUpdate),
    canManagePipeline: permissions.has(crmPermissionKeys.pipelineManage),
    canViewImports: permissions.has(crmPermissionKeys.importView),
    canExecuteImports: permissions.has(crmPermissionKeys.importExecute),
    canManageConnections: permissions.has(crmPermissionKeys.connectionManage),
    canViewDocuments: permissions.has(documentPermissionKeys.view),
    canCreateDocuments:
      permissions.has(documentPermissionKeys.workspace) &&
      permissions.has(documentPermissionKeys.create),
    canCreateContracts:
      permissions.has(legalPermissionKeys.workspace) && permissions.has(legalPermissionKeys.create),
  };

  const database = getDatabaseClient();
  const organizationId = membership.organizationId;
  const membershipId = membership.id;
  const leadScope = permissionScope(permissionScopes, crmPermissionKeys.leadView);
  const companyScope = permissionScope(permissionScopes, crmPermissionKeys.companyView);
  const contactScope = permissionScope(permissionScopes, crmPermissionKeys.contactView);
  const projectScope = permissionScope(permissionScopes, projectPermissionKeys.projectView);
  const searchPattern = `%${filters.q}%`;
  const offset = (filters.page - 1) * CRM_PAGE_SIZE;

  try {
    const [
      stageRows,
      memberRows,
      leadRows,
      leadCountRows,
      companyRows,
      contactRows,
      activityRows,
      summaryRows,
      forecastData,
    ] = await Promise.all([
      database<StageRow[]>`
          select id, name, slug, position, probability, state, is_active,
            coalesce(array(select jsonb_array_elements_text(required_fields)), array[]::text[]) as required_fields
          from public.crm_pipeline_stages
          where organization_id = ${organizationId}::uuid
          order by position, lower(name)
        `,
      database<MemberRow[]>`
          select
            membership.id as membership_id,
            coalesce(
              profile.display_name,
              nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
              split_part(coalesce(auth_user.email, ''), '@', 1),
              'AgencyOS user'
            ) as display_name,
            coalesce(auth_user.email, '') as email
          from public.memberships as membership
          join public.identity_accounts as auth_user on auth_user.id = membership.user_id
          left join public.profiles as profile on profile.id = membership.user_id
          where membership.organization_id = ${organizationId}::uuid
            and membership.status = 'active'
          order by lower(coalesce(profile.display_name, auth_user.email, ''))
        `,
      capabilities.canViewLeads
        ? database<LeadRow[]>`
              select
                lead.id,
                lead.name,
                lead.lead_type,
                lead.source,
                lead.status,
                stage.id as stage_id,
                stage.name as stage_name,
                stage.state as stage_state,
                lead.estimated_value,
                lead.currency,
                lead.probability,
                lead.expected_close_date::text,
                lead.owner_membership_id,
                coalesce(owner_profile.display_name, owner_user.email) as owner_name,
                lead.email,
                lead.phone,
                lead.company_name,
                lead.follow_up_at,
                lead.lost_reason,
                lead.notes,
                lead.qualification_score,
                lead.qualification_label,
                lead.extra_fields,
                lead.converted_company_id,
                lead.converted_contact_id,
                lead.converted_at,
                lead.created_at,
                lead.updated_at
              from public.crm_leads as lead
              join public.crm_pipeline_stages as stage on stage.id = lead.stage_id
              left join public.memberships as owner on owner.id = lead.owner_membership_id
              left join public.identity_accounts as owner_user on owner_user.id = owner.user_id
              left join public.profiles as owner_profile on owner_profile.id = owner.user_id
              where lead.organization_id = ${organizationId}::uuid
                and private.crm_scope_allows_membership(
                  ${membershipId}::uuid,
                  ${leadScope},
                  lead.owner_membership_id,
                  lead.created_by_membership_id
                )
                and (${filters.q} = '' or (
                  lead.name ilike ${searchPattern}
                  or coalesce(lead.company_name, '') ilike ${searchPattern}
                  or coalesce(lead.email, '') ilike ${searchPattern}
                  or coalesce(lead.phone, '') ilike ${searchPattern}
                ))
                and (${filters.stage}::uuid is null or lead.stage_id = ${filters.stage}::uuid)
                and (${filters.owner}::uuid is null or lead.owner_membership_id = ${filters.owner}::uuid)
                and (${filters.status}::text is null or lead.status = ${filters.status}::text)
                and (${filters.currency}::text is null or lead.currency = ${filters.currency})
                and (
                  ${filters.scope}::text is null
                  or (${filters.scope} = 'open_opportunities' and lead.status in ('new', 'qualified') and stage.state = 'open')
                )
              order by stage.position, lead.updated_at desc, lead.id
              limit ${CRM_PAGE_SIZE}
              offset ${offset}
            `
        : Promise.resolve([] as LeadRow[]),
      capabilities.canViewLeads
        ? database<CountRow[]>`
              select count(*)::integer as count
              from public.crm_leads as lead
              join public.crm_pipeline_stages as stage on stage.id = lead.stage_id
              where lead.organization_id = ${organizationId}::uuid
                and private.crm_scope_allows_membership(
                  ${membershipId}::uuid,
                  ${leadScope},
                  lead.owner_membership_id,
                  lead.created_by_membership_id
                )
                and (${filters.q} = '' or (
                  lead.name ilike ${searchPattern}
                  or coalesce(lead.company_name, '') ilike ${searchPattern}
                  or coalesce(lead.email, '') ilike ${searchPattern}
                  or coalesce(lead.phone, '') ilike ${searchPattern}
                ))
                and (${filters.stage}::uuid is null or lead.stage_id = ${filters.stage}::uuid)
                and (${filters.owner}::uuid is null or lead.owner_membership_id = ${filters.owner}::uuid)
                and (${filters.status}::text is null or lead.status = ${filters.status}::text)
                and (${filters.currency}::text is null or lead.currency = ${filters.currency})
                and (
                  ${filters.scope}::text is null
                  or (${filters.scope} = 'open_opportunities' and lead.status in ('new', 'qualified') and stage.state = 'open')
                )
            `
        : Promise.resolve([{ count: 0 }] as CountRow[]),
      capabilities.canViewCompanies
        ? database<CompanyRow[]>`
              select
                company.id,
                company.legal_name,
                company.display_name,
                company.industry,
                company.website,
                company.email,
                company.phone,
                company.client_status,
                company.account_owner_membership_id,
                coalesce(owner_profile.display_name, owner_user.email) as owner_name,
                company.currency,
                company.payment_terms_days,
                count(contact.id)::integer as contact_count,
                company.primary_contact_id,
                concat_ws(' ', primary_contact.first_name, primary_contact.last_name) as primary_contact_name,
                primary_contact.email as primary_contact_email,
                company.updated_at
              from public.crm_companies as company
              left join public.crm_contacts as contact
                on contact.company_id = company.id
               and contact.status = 'active'
               and ${capabilities.canViewContacts}
               and private.crm_scope_allows_membership(
                 ${membershipId}::uuid,
                 ${contactScope},
                 contact.owner_membership_id,
                 contact.created_by_membership_id
               )
              left join public.crm_contacts as primary_contact
                on primary_contact.id = company.primary_contact_id
               and primary_contact.organization_id = company.organization_id
               and primary_contact.company_id = company.id
               and primary_contact.status = 'active'
               and ${capabilities.canViewContacts}
               and private.crm_scope_allows_membership(
                 ${membershipId}::uuid,
                 ${contactScope},
                 primary_contact.owner_membership_id,
                 primary_contact.created_by_membership_id
               )
              left join public.memberships as owner on owner.id = company.account_owner_membership_id
              left join public.identity_accounts as owner_user on owner_user.id = owner.user_id
              left join public.profiles as owner_profile on owner_profile.id = owner.user_id
              where company.organization_id = ${organizationId}::uuid
                and private.crm_scope_allows_membership(
                  ${membershipId}::uuid,
                  ${companyScope},
                  company.account_owner_membership_id,
                  company.created_by_membership_id
                )
                and (${filters.q} = '' or (
                  company.legal_name ilike ${searchPattern}
                  or coalesce(company.display_name, '') ilike ${searchPattern}
                  or coalesce(company.email, '') ilike ${searchPattern}
                ))
              group by company.id, owner_profile.display_name, owner_user.email,
                primary_contact.first_name, primary_contact.last_name, primary_contact.email
              order by company.updated_at desc
              limit 16
            `
        : Promise.resolve([] as CompanyRow[]),
      capabilities.canViewContacts
        ? database<ContactRow[]>`
              select
                contact.id,
                contact.company_id,
                coalesce(company.display_name, company.legal_name) as company_name,
                contact.first_name,
                contact.last_name,
                contact.job_title,
                contact.email,
                contact.phone,
                contact.preferred_communication,
                contact.is_billing_contact,
                contact.is_decision_maker,
                contact.consent_status,
                contact.status,
                contact.owner_membership_id,
                coalesce(owner_profile.display_name, owner_user.email) as owner_name,
                contact.updated_at
              from public.crm_contacts as contact
              left join public.crm_companies as company
                on company.id = contact.company_id
               and ${capabilities.canViewCompanies}
               and private.crm_scope_allows_membership(
                 ${membershipId}::uuid,
                 ${companyScope},
                 company.account_owner_membership_id,
                 company.created_by_membership_id
               )
              left join public.memberships as owner on owner.id = contact.owner_membership_id
              left join public.identity_accounts as owner_user on owner_user.id = owner.user_id
              left join public.profiles as owner_profile on owner_profile.id = owner.user_id
              where contact.organization_id = ${organizationId}::uuid
                and private.crm_scope_allows_membership(
                  ${membershipId}::uuid,
                  ${contactScope},
                  contact.owner_membership_id,
                  contact.created_by_membership_id
                )
                and (${filters.q} = '' or (
                  concat_ws(' ', contact.first_name, contact.last_name) ilike ${searchPattern}
                  or coalesce(contact.email, '') ilike ${searchPattern}
                  or coalesce(company.legal_name, '') ilike ${searchPattern}
                ))
              order by contact.updated_at desc
              limit 20
            `
        : Promise.resolve([] as ContactRow[]),
      database<ActivityRow[]>`
          select
            activity.id,
            case
              when activity.lead_id is not null then 'lead'
              when activity.company_id is not null then 'company'
              else 'contact'
            end as entity_type,
            coalesce(activity.lead_id, activity.company_id, activity.contact_id)::text as entity_id,
            coalesce(lead.name, company.display_name, company.legal_name, concat_ws(' ', contact.first_name, contact.last_name)) as entity_name,
            activity.activity_type,
            activity.subject,
            activity.details,
            activity.due_at,
            activity.completed_at,
            coalesce(actor_profile.display_name, actor_user.email, 'AgencyOS user') as actor_name,
            activity.occurred_at
          from public.crm_activities as activity
          left join public.crm_leads as lead on lead.id = activity.lead_id
          left join public.crm_companies as company on company.id = activity.company_id
          left join public.crm_contacts as contact on contact.id = activity.contact_id
          left join public.memberships as actor on actor.id = activity.created_by_membership_id
          left join public.identity_accounts as actor_user on actor_user.id = actor.user_id
          left join public.profiles as actor_profile on actor_profile.id = actor.user_id
          where activity.organization_id = ${organizationId}::uuid
            and (
              (activity.lead_id is not null and ${capabilities.canViewLeads} and private.crm_scope_allows_membership(
                ${membershipId}::uuid, ${leadScope}, lead.owner_membership_id, lead.created_by_membership_id
              ))
              or (activity.company_id is not null and ${capabilities.canViewCompanies} and private.crm_scope_allows_membership(
                ${membershipId}::uuid, ${companyScope}, company.account_owner_membership_id, company.created_by_membership_id
              ))
              or (activity.contact_id is not null and ${capabilities.canViewContacts} and private.crm_scope_allows_membership(
                ${membershipId}::uuid, ${contactScope}, contact.owner_membership_id, contact.created_by_membership_id
              ))
            )
          order by activity.occurred_at desc
          limit 30
        `,
      database<SummaryRow[]>`
          select
            count(*) filter (
              where ${capabilities.canViewLeads}
                and lead.status in ('new', 'qualified')
                and private.crm_scope_allows_membership(
                  ${membershipId}::uuid, ${leadScope}, lead.owner_membership_id, lead.created_by_membership_id
                )
            )::integer as open_leads,
            count(*) filter (
              where ${capabilities.canViewLeads}
                and lead.status = 'qualified'
                and private.crm_scope_allows_membership(
                  ${membershipId}::uuid, ${leadScope}, lead.owner_membership_id, lead.created_by_membership_id
                )
            )::integer as qualified_leads,
            coalesce(sum(lead.estimated_value * lead.probability / 100.0) filter (
              where ${capabilities.canViewLeads}
                and lead.status in ('new', 'qualified')
                and private.crm_scope_allows_membership(
                  ${membershipId}::uuid, ${leadScope}, lead.owner_membership_id, lead.created_by_membership_id
                )
            ), 0) as pipeline_value,
            (select count(*)::integer from public.crm_companies as company
              where company.organization_id = ${organizationId}::uuid
                and ${capabilities.canViewCompanies}
                and private.crm_scope_allows_membership(
                  ${membershipId}::uuid, ${companyScope}, company.account_owner_membership_id, company.created_by_membership_id
                )
            ) as company_count,
            (select count(*)::integer from public.crm_contacts as contact
              where contact.organization_id = ${organizationId}::uuid
                and ${capabilities.canViewContacts}
                and private.crm_scope_allows_membership(
                  ${membershipId}::uuid, ${contactScope}, contact.owner_membership_id, contact.created_by_membership_id
                )
            ) as contact_count
          from public.crm_leads as lead
          where lead.organization_id = ${organizationId}::uuid
        `,
      getCrmForecastDataForContext(permissionContext.context),
    ]);

    const [
      companyContactOptionRows,
      projectRelationRows,
      invoiceRelationRows,
      legalRelationRows,
      supportRelationRows,
      companyDocumentRows,
      leadDocumentRows,
    ] = await Promise.all([
      capabilities.canViewCompanies && capabilities.canViewContacts
        ? database<CompanyContactOptionRow[]>`
            select contact.id, contact.company_id,
              concat_ws(' ', contact.first_name, contact.last_name) as name,
              contact.email
            from public.crm_contacts as contact
            join public.crm_companies as company on company.id = contact.company_id
            where contact.organization_id = ${organizationId}::uuid
              and contact.status = 'active'
              and private.crm_scope_allows_membership(
                ${membershipId}::uuid, ${contactScope},
                contact.owner_membership_id, contact.created_by_membership_id
              )
              and private.crm_scope_allows_membership(
                ${membershipId}::uuid, ${companyScope},
                company.account_owner_membership_id, company.created_by_membership_id
              )
            order by contact.company_id, lower(contact.first_name), lower(contact.last_name)
            limit 500
          `
        : Promise.resolve([] as CompanyContactOptionRow[]),
      capabilities.canViewCompanies && permissions.has(projectPermissionKeys.projectView)
        ? database<RelatedRecordRow[]>`
            select project.company_id, project.id, 'project'::text as kind,
              project.name as label, project.code as metadata, project.status,
              '/projects?project=' || project.id::text as href
            from public.projects as project
            join public.crm_companies as company on company.id = project.company_id
            where project.organization_id = ${organizationId}::uuid
              and private.project_is_visible(project.id, ${membershipId}::uuid, ${projectScope})
              and private.crm_scope_allows_membership(
                ${membershipId}::uuid, ${companyScope},
                company.account_owner_membership_id, company.created_by_membership_id
              )
            order by project.updated_at desc
            limit 400
          `
        : Promise.resolve([] as RelatedRecordRow[]),
      capabilities.canViewCompanies && permissions.has(financePermissionKeys.invoiceView)
        ? database<RelatedRecordRow[]>`
            select invoice.company_id, invoice.id, 'invoice'::text as kind,
              coalesce(invoice.invoice_number, invoice.draft_reference) as label,
              invoice.due_date::text as metadata, invoice.status,
              '/finance?invoice=' || invoice.id::text as href
            from public.finance_invoices as invoice
            join public.crm_companies as company on company.id = invoice.company_id
            where invoice.organization_id = ${organizationId}::uuid
              and private.crm_scope_allows_membership(
                ${membershipId}::uuid, ${companyScope},
                company.account_owner_membership_id, company.created_by_membership_id
              )
            order by invoice.updated_at desc
            limit 400
          `
        : Promise.resolve([] as RelatedRecordRow[]),
      capabilities.canViewCompanies && permissions.has(legalPermissionKeys.view)
        ? database<RelatedRecordRow[]>`
            select contract.counterparty_company_id as company_id, contract.id,
              'contract'::text as kind, contract.title as label,
              contract.internal_reference as metadata, contract.status,
              '/legal?contract=' || contract.id::text as href
            from public.legal_contracts as contract
            join public.crm_companies as company on company.id = contract.counterparty_company_id
            where contract.organization_id = ${organizationId}::uuid
              and private.legal_contract_membership_access_allowed(
                contract.id, ${membershipId}::uuid, ${legalPermissionKeys.view}
              )
              and private.crm_scope_allows_membership(
                ${membershipId}::uuid, ${companyScope},
                company.account_owner_membership_id, company.created_by_membership_id
              )
            order by contract.updated_at desc
            limit 400
          `
        : Promise.resolve([] as RelatedRecordRow[]),
      capabilities.canViewCompanies && permissions.has(supportPermissionKeys.view)
        ? database<RelatedRecordRow[]>`
            select ticket.client_company_id as company_id, ticket.id,
              'ticket'::text as kind, ticket.subject as label,
              'SUP-' || lpad(ticket.ticket_number::text, 6, '0') as metadata,
              ticket.status, '/support?q=SUP-' || lpad(ticket.ticket_number::text, 6, '0') as href
            from public.support_tickets as ticket
            join public.crm_companies as company on company.id = ticket.client_company_id
            where ticket.organization_id = ${organizationId}::uuid
              and private.support_ticket_membership_access_allowed(
                ticket.id, ${membershipId}::uuid, ${supportPermissionKeys.view}
              )
              and private.crm_scope_allows_membership(
                ${membershipId}::uuid, ${companyScope},
                company.account_owner_membership_id, company.created_by_membership_id
              )
            order by ticket.last_activity_at desc
            limit 400
          `
        : Promise.resolve([] as RelatedRecordRow[]),
      capabilities.canViewCompanies && capabilities.canViewDocuments
        ? database<RelatedRecordRow[]>`
            select link.entity_id as company_id, document.id, 'document'::text as kind,
              document.title as label, document.classification as metadata, document.status,
              '/documents?document=' || document.id::text as href
            from public.document_entity_links as link
            join public.documents as document on document.id = link.document_id
            join public.crm_companies as company on company.id = link.entity_id
            where link.organization_id = ${organizationId}::uuid
              and link.entity_type = 'client'
              and private.document_membership_access_allowed(
                document.id, ${membershipId}::uuid, ${documentPermissionKeys.view}
              )
              and private.crm_scope_allows_membership(
                ${membershipId}::uuid, ${companyScope},
                company.account_owner_membership_id, company.created_by_membership_id
              )
            order by document.updated_at desc
            limit 400
          `
        : Promise.resolve([] as RelatedRecordRow[]),
      capabilities.canViewLeads && capabilities.canViewDocuments
        ? database<LeadDocumentRow[]>`
            select lead.id as lead_id, document.id, document.title,
              document.classification, document.status
            from public.document_entity_links as link
            join public.documents as document on document.id = link.document_id
            join public.crm_leads as lead on lead.id = link.entity_id
            where link.organization_id = ${organizationId}::uuid
              and link.entity_type = 'lead'
              and private.document_membership_access_allowed(
                document.id, ${membershipId}::uuid, ${documentPermissionKeys.view}
              )
              and private.crm_scope_allows_membership(
                ${membershipId}::uuid, ${leadScope},
                lead.owner_membership_id, lead.created_by_membership_id
              )
            order by document.updated_at desc
            limit 500
          `
        : Promise.resolve([] as LeadDocumentRow[]),
    ]);

    const relatedRecordsByCompany = new Map<string, CrmRelatedRecord[]>();
    for (const row of [
      ...projectRelationRows,
      ...invoiceRelationRows,
      ...legalRelationRows,
      ...supportRelationRows,
      ...companyDocumentRows,
    ]) {
      const records = relatedRecordsByCompany.get(row.company_id) ?? [];
      records.push({
        id: row.id,
        kind: row.kind,
        label: row.label,
        metadata: row.metadata,
        status: row.status,
        href: row.href,
      });
      relatedRecordsByCompany.set(row.company_id, records);
    }

    const documentsByLead = new Map<string, CrmLinkedDocument[]>();
    for (const row of leadDocumentRows) {
      const documents = documentsByLead.get(row.lead_id) ?? [];
      documents.push({
        id: row.id,
        title: row.title,
        classification: row.classification,
        status: row.status,
        href: `/documents?document=${row.id}`,
      });
      documentsByLead.set(row.lead_id, documents);
    }

    const importData = capabilities.canViewImports
      ? await getCrmImportWorkspaceData(permissionContext.context)
      : { connections: [], notifications: [], runs: [], errors: [] };

    const totalItems = leadCountRows[0]?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / CRM_PAGE_SIZE));
    const summary = summaryRows[0] ?? {
      open_leads: 0,
      qualified_leads: 0,
      pipeline_value: 0,
      company_count: 0,
      contact_count: 0,
    };

    return {
      allowed: true,
      data: {
        organizationId,
        currentMembershipId: membershipId,
        filters,
        stages: stageRows.map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          position: row.position,
          probability: row.probability,
          state: row.state,
          isActive: row.is_active,
          requiredFields: row.required_fields ?? [],
        })),
        members: memberRows.map((row) => ({
          membershipId: row.membership_id,
          displayName: row.display_name,
          email: row.email,
        })),
        leads: leadRows.map((row) => mapLead(row, documentsByLead.get(row.id) ?? [])),
        companies: companyRows.map((row) => ({
          id: row.id,
          legalName: row.legal_name,
          displayName: row.display_name,
          industry: row.industry,
          website: row.website,
          email: row.email,
          phone: row.phone,
          clientStatus: row.client_status,
          ownerMembershipId: row.account_owner_membership_id,
          ownerName: row.owner_name,
          currency: row.currency,
          paymentTermsDays: row.payment_terms_days,
          contactCount: row.contact_count,
          primaryContactId: row.primary_contact_id,
          primaryContactName: row.primary_contact_name || null,
          primaryContactEmail: row.primary_contact_email,
          relatedRecords: relatedRecordsByCompany.get(row.id) ?? [],
          updatedAt: row.updated_at.toISOString(),
        })),
        contacts: contactRows.map((row) => ({
          id: row.id,
          companyId: row.company_id,
          companyName: row.company_name,
          firstName: row.first_name,
          lastName: row.last_name,
          jobTitle: row.job_title,
          email: row.email,
          phone: row.phone,
          preferredCommunication: row.preferred_communication,
          isBillingContact: row.is_billing_contact,
          isDecisionMaker: row.is_decision_maker,
          consentStatus: row.consent_status,
          status: row.status,
          ownerMembershipId: row.owner_membership_id,
          ownerName: row.owner_name,
          updatedAt: row.updated_at.toISOString(),
        })),
        companyContactOptions: companyContactOptionRows.map((row) => ({
          id: row.id,
          companyId: row.company_id,
          name: row.name,
          email: row.email,
        })),
        imports: importData,
        forecast: forecastData,
        activities: activityRows.map((row) => ({
          id: row.id,
          entityType: row.entity_type,
          entityId: row.entity_id,
          entityName: row.entity_name,
          activityType: row.activity_type,
          subject: row.subject,
          details: row.details,
          dueAt: row.due_at?.toISOString() ?? null,
          completedAt: row.completed_at?.toISOString() ?? null,
          actorName: row.actor_name,
          occurredAt: row.occurred_at.toISOString(),
        })),
        pagination: {
          page: Math.min(filters.page, totalPages),
          pageSize: CRM_PAGE_SIZE,
          totalItems,
          totalPages,
        },
        summary: {
          openLeads: summary.open_leads,
          qualifiedLeads: summary.qualified_leads,
          pipelineValue: Number(summary.pipeline_value),
          companies: summary.company_count,
          contacts: summary.contact_count,
        },
        capabilities,
      },
    };
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }
}
