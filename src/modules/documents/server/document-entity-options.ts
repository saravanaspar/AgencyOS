import "server-only";

import type { Sql, TransactionSql } from "postgres";

import { assetPermissionKeys } from "@/modules/assets/assets";
import { crmPermissionKeys } from "@/modules/crm/crm";
import { documentPermissionKeys, type DocumentEntityType } from "@/modules/documents/documents";
import { financePermissionKeys } from "@/modules/finance/finance";
import { hrPermissionKeys } from "@/modules/hr/hr";
import { legalPermissionKeys } from "@/modules/legal/legal";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import { projectPermissionKeys } from "@/modules/projects/projects";
import { supportPermissionKeys } from "@/modules/support/support";
import { vendorPermissionKeys } from "@/modules/vendors/vendors";

export interface DocumentEntityOption {
  type: DocumentEntityType;
  id: string;
  label: string;
}

type QuerySql = Sql | TransactionSql;

export async function getDocumentEntityOptions(
  context: CurrentPermissionContext,
  sql: QuerySql,
): Promise<DocumentEntityOption[]> {
  if (!context.permissions.has(documentPermissionKeys.update)) return [];
  const membershipId = context.membership.id;
  const organizationId = context.membership.organizationId;
  const options: DocumentEntityOption[] = [];

  if (context.permissions.has(crmPermissionKeys.companyView)) {
    const scope = context.permissionScopes.get(crmPermissionKeys.companyView) ?? "own";
    options.push(
      ...(await sql<DocumentEntityOption[]>`
        select 'client'::text as type, company.id, company.display_name as label
        from public.crm_companies as company
        where company.organization_id = ${organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${membershipId}::uuid, ${scope},
            company.account_owner_membership_id, company.created_by_membership_id
          )
        order by company.display_name limit 300
      `),
    );
  }
  if (context.permissions.has(crmPermissionKeys.contactView)) {
    const scope = context.permissionScopes.get(crmPermissionKeys.contactView) ?? "own";
    options.push(
      ...(await sql<DocumentEntityOption[]>`
        select 'contact'::text as type, contact.id,
          concat_ws(' ', contact.first_name, contact.last_name) as label
        from public.crm_contacts as contact
        where contact.organization_id = ${organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${membershipId}::uuid, ${scope}, contact.owner_membership_id, contact.created_by_membership_id
          )
        order by label limit 300
      `),
    );
  }
  if (context.permissions.has(crmPermissionKeys.leadView)) {
    const scope = context.permissionScopes.get(crmPermissionKeys.leadView) ?? "own";
    options.push(
      ...(await sql<DocumentEntityOption[]>`
        select 'lead'::text as type, lead.id, lead.name as label
        from public.crm_leads as lead
        where lead.organization_id = ${organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${membershipId}::uuid, ${scope}, lead.owner_membership_id, lead.created_by_membership_id
          )
        order by lead.name limit 300
      `),
    );
  }
  if (context.permissions.has(projectPermissionKeys.projectView)) {
    const scope = context.permissionScopes.get(projectPermissionKeys.projectView) ?? "own";
    options.push(
      ...(await sql<DocumentEntityOption[]>`
        select 'project'::text as type, project.id,
          concat(project.code, ' — ', project.name) as label
        from public.projects as project
        where project.organization_id = ${organizationId}::uuid
          and private.project_is_visible(project.id, ${membershipId}::uuid, ${scope})
        order by project.name limit 300
      `),
    );
  }
  if (context.permissions.has(projectPermissionKeys.taskView)) {
    const scope = context.permissionScopes.get(projectPermissionKeys.taskView) ?? "own";
    options.push(
      ...(await sql<DocumentEntityOption[]>`
        select 'task'::text as type, task.id,
          concat(task.task_number, ' — ', task.title) as label
        from public.project_tasks as task
        where task.organization_id = ${organizationId}::uuid
          and private.project_is_visible(task.project_id, ${membershipId}::uuid, ${scope})
        order by task.updated_at desc limit 300
      `),
    );
  }
  if (context.permissions.has(financePermissionKeys.invoiceView)) {
    const scope = context.permissionScopes.get(financePermissionKeys.invoiceView) ?? "own";
    options.push(
      ...(await sql<DocumentEntityOption[]>`
        select 'invoice'::text as type, invoice.id,
          coalesce(invoice.invoice_number, invoice.draft_reference) as label
        from public.finance_invoices as invoice
        where invoice.organization_id = ${organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${membershipId}::uuid, ${scope},
            invoice.created_by_membership_id, invoice.created_by_membership_id
          )
        order by invoice.created_at desc limit 300
      `),
    );
  }
  if (context.permissions.has(financePermissionKeys.estimateView)) {
    const scope = context.permissionScopes.get(financePermissionKeys.estimateView) ?? "own";
    options.push(
      ...(await sql<DocumentEntityOption[]>`
        select 'estimate'::text as type, estimate.id, estimate.estimate_number as label
        from public.finance_estimates as estimate
        where estimate.organization_id = ${organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${membershipId}::uuid, ${scope},
            estimate.created_by_membership_id, estimate.created_by_membership_id
          )
        order by estimate.created_at desc limit 300
      `),
    );
  }
  if (context.permissions.has(hrPermissionKeys.employeeView)) {
    const scope = context.permissionScopes.get(hrPermissionKeys.employeeView) ?? "own";
    options.push(
      ...(await sql<DocumentEntityOption[]>`
        select 'employee'::text as type, membership.id,
          private.membership_display_name(membership.id) as label
        from public.memberships as membership
        where membership.organization_id = ${organizationId}::uuid and membership.status = 'active'
          and private.crm_scope_allows_membership(
            ${membershipId}::uuid, ${scope}, membership.id, membership.id
          )
        order by label limit 300
      `),
    );
  }
  if (context.permissions.has(legalPermissionKeys.view)) {
    options.push(
      ...(await sql<DocumentEntityOption[]>`
        select 'contract'::text as type, contract.id,
          concat(contract.internal_reference, ' — ', contract.title) as label
        from public.legal_contracts as contract
        where contract.organization_id = ${organizationId}::uuid
          and private.legal_contract_membership_access_allowed(
            contract.id, ${membershipId}::uuid, ${legalPermissionKeys.view}
          )
        order by contract.updated_at desc limit 300
      `),
    );
  }

  if (context.permissions.has(supportPermissionKeys.view)) {
    options.push(
      ...(await sql<DocumentEntityOption[]>`
        select 'ticket'::text as type, ticket.id,
          concat('SUP-', lpad(ticket.ticket_number::text, 6, '0'), ' — ', ticket.subject) as label
        from public.support_tickets as ticket
        where ticket.organization_id = ${organizationId}::uuid
          and private.support_ticket_membership_access_allowed(
            ticket.id, ${membershipId}::uuid, ${supportPermissionKeys.view}
          )
        order by ticket.last_activity_at desc limit 300
      `),
    );
  }
  if (context.permissions.has(assetPermissionKeys.view)) {
    options.push(
      ...(await sql<DocumentEntityOption[]>`
        select 'asset'::text as type, asset.id,
          concat(asset.asset_tag, ' — ', asset.name) as label
        from public.assets as asset
        where asset.organization_id = ${organizationId}::uuid
          and private.asset_membership_access_allowed(
            asset.id, ${membershipId}::uuid, ${assetPermissionKeys.view}
          )
        order by asset.asset_tag limit 300
      `),
    );
  }
  if (context.permissions.has(vendorPermissionKeys.view)) {
    options.push(
      ...(await sql<DocumentEntityOption[]>`
        select 'vendor'::text as type, vendor.id,
          concat('VEN-', lpad(vendor.vendor_number::text, 6, '0'), ' — ', vendor.display_name) as label
        from public.vendors as vendor
        where vendor.organization_id = ${organizationId}::uuid
          and private.vendor_membership_access_allowed(
            vendor.id, ${membershipId}::uuid, ${vendorPermissionKeys.view}
          )
        order by vendor.display_name limit 300
      `),
    );
  }
  if (context.permissions.has(vendorPermissionKeys.purchaseOrderView)) {
    options.push(
      ...(await sql<DocumentEntityOption[]>`
        select 'purchase_order'::text as type, purchase_order.id,
          concat('PO-', lpad(purchase_order.purchase_order_number::text, 6, '0'), ' — ', vendor.display_name) as label
        from public.procurement_purchase_orders as purchase_order
        join public.vendors as vendor on vendor.id = purchase_order.vendor_id
        where purchase_order.organization_id = ${organizationId}::uuid
          and private.purchase_order_membership_access_allowed(
            purchase_order.id, ${membershipId}::uuid, ${vendorPermissionKeys.purchaseOrderView}
          )
        order by purchase_order.purchase_order_number desc limit 300
      `),
    );
  }
  return options.sort((left, right) =>
    left.type === right.type
      ? left.label.localeCompare(right.label)
      : left.type.localeCompare(right.type),
  );
}
