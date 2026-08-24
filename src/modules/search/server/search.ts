import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { assetPermissionKeys } from "@/modules/assets/assets";
import { calendarPermissionKeys } from "@/modules/calendar/calendar";
import { crmPermissionKeys } from "@/modules/crm/crm";
import { documentPermissionKeys } from "@/modules/documents/documents";
import { financePermissionKeys } from "@/modules/finance/finance";
import { hrPermissionKeys } from "@/modules/hr/hr";
import { legalPermissionKeys } from "@/modules/legal/legal";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import { getCurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import { projectPermissionKeys } from "@/modules/projects/projects";
import {
  globalSearchPermissionKey,
  normalizeGlobalSearchQuery,
  type GlobalSearchResponse,
  type GlobalSearchResultItem,
} from "@/modules/search/search";
import { supportPermissionKeys } from "@/modules/support/support";
import { vendorPermissionKeys } from "@/modules/vendors/vendors";

type GlobalSearchResult =
  | { allowed: true; data: GlobalSearchResponse }
  | { allowed: false; reason: AuthorizationFailureReason };

type SearchRow = GlobalSearchResultItem;

export async function searchAuthorizedRecords(
  rawQuery: unknown,
  requestedLimit = 30,
): Promise<GlobalSearchResult> {
  const query = normalizeGlobalSearchQuery(rawQuery);
  const permissionContext = await getCurrentPermissionContext();
  if (!permissionContext.allowed) return permissionContext;
  const context = permissionContext.context;
  if (!context.permissions.has(globalSearchPermissionKey)) {
    return { allowed: false, reason: "insufficient-permission" };
  }
  if (query.length < 2) {
    return { allowed: true, data: { query, items: [], truncated: false } };
  }

  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const perGroup = 6;
  const limit = Math.min(Math.max(requestedLimit, 1), 50);
  const searches: Array<Promise<SearchRow[]>> = [];

  if (context.permissions.has(crmPermissionKeys.leadView)) {
    const scope = context.permissionScopes.get(crmPermissionKeys.leadView) ?? "own";
    searches.push(database<SearchRow[]>`
      select lead.id, 'lead'::text as kind, 'CRM'::text as module,
        lead.name as title, coalesce(lead.company_name, lead.email) as subtitle,
        lead.status as badge, '/crm?lead=' || lead.id::text as href
      from public.crm_leads lead
      where lead.organization_id = ${organizationId}::uuid
        and private.crm_scope_allows_membership(
          ${membershipId}::uuid, ${scope}, lead.owner_membership_id, lead.created_by_membership_id
        )
        and strpos(lower(concat_ws(' ', lead.name, lead.company_name, lead.email, lead.phone)), lower(${query})) > 0
      order by lead.updated_at desc limit ${perGroup}
    `);
  }
  if (context.permissions.has(crmPermissionKeys.companyView)) {
    const scope = context.permissionScopes.get(crmPermissionKeys.companyView) ?? "own";
    const contactScope = context.permissionScopes.get(crmPermissionKeys.contactView) ?? "own";
    const projectScope = context.permissionScopes.get(projectPermissionKeys.projectView) ?? "own";
    const canViewContacts = context.permissions.has(crmPermissionKeys.contactView);
    const canViewProjects = context.permissions.has(projectPermissionKeys.projectView);
    const canViewInvoices = context.permissions.has(financePermissionKeys.invoiceView);
    const canViewLegal = context.permissions.has(legalPermissionKeys.view);
    const canViewSupport = context.permissions.has(supportPermissionKeys.view);
    const canViewDocuments = context.permissions.has(documentPermissionKeys.view);
    searches.push(database<SearchRow[]>`
      select company.id, 'company'::text as kind, 'CRM'::text as module,
        coalesce(company.display_name, company.legal_name) as title,
        concat_ws(' · ',
          company.legal_name,
          case when primary_contact.id is not null then
            'Primary: ' || concat_ws(' ', primary_contact.first_name, primary_contact.last_name)
          end,
          case when ${canViewProjects} then (
            select count(*)::text || ' projects' from public.projects project
            where project.company_id = company.id
              and private.project_is_visible(project.id, ${membershipId}::uuid, ${projectScope})
          ) end,
          case when ${canViewInvoices} then (
            select count(*)::text || ' invoices' from public.finance_invoices invoice
            where invoice.company_id = company.id
          ) end,
          case when ${canViewLegal} then (
            select count(*)::text || ' contracts' from public.legal_contracts contract
            where contract.counterparty_company_id = company.id
              and private.legal_contract_membership_access_allowed(
                contract.id, ${membershipId}::uuid, ${legalPermissionKeys.view}
              )
          ) end,
          case when ${canViewSupport} then (
            select count(*)::text || ' tickets' from public.support_tickets ticket
            where ticket.client_company_id = company.id
              and private.support_ticket_membership_access_allowed(
                ticket.id, ${membershipId}::uuid, ${supportPermissionKeys.view}
              )
          ) end,
          case when ${canViewDocuments} then (
            select count(*)::text || ' documents'
            from public.document_entity_links link
            join public.documents document on document.id = link.document_id
            where link.entity_type = 'client' and link.entity_id = company.id
              and private.document_membership_access_allowed(
                document.id, ${membershipId}::uuid, ${documentPermissionKeys.view}
              )
          ) end
        ) as subtitle,
        company.client_status as badge,
        '/crm?company=' || company.id::text as href
      from public.crm_companies company
      left join public.crm_contacts primary_contact
        on primary_contact.id = company.primary_contact_id
       and primary_contact.company_id = company.id
       and primary_contact.status = 'active'
       and ${canViewContacts}
       and private.crm_scope_allows_membership(
         ${membershipId}::uuid, ${contactScope},
         primary_contact.owner_membership_id, primary_contact.created_by_membership_id
       )
      where company.organization_id = ${organizationId}::uuid
        and private.crm_scope_allows_membership(
          ${membershipId}::uuid, ${scope}, company.account_owner_membership_id, company.created_by_membership_id
        )
        and strpos(lower(concat_ws(' ', company.display_name, company.legal_name, company.email,
          company.phone, primary_contact.first_name, primary_contact.last_name, primary_contact.email)), lower(${query})) > 0
      order by company.updated_at desc limit ${perGroup}
    `);
  }
  if (context.permissions.has(crmPermissionKeys.contactView)) {
    const scope = context.permissionScopes.get(crmPermissionKeys.contactView) ?? "own";
    searches.push(database<SearchRow[]>`
      select contact.id, 'contact'::text as kind, 'CRM'::text as module,
        contact.first_name || ' ' || contact.last_name as title,
        coalesce(company.display_name, company.legal_name, contact.job_title, contact.email) as subtitle,
        contact.status as badge, '/crm?contact=' || contact.id::text as href
      from public.crm_contacts contact
      left join public.crm_companies company on company.id = contact.company_id
      where contact.organization_id = ${organizationId}::uuid
        and private.crm_scope_allows_membership(
          ${membershipId}::uuid, ${scope}, contact.owner_membership_id, contact.created_by_membership_id
        )
        and strpos(lower(concat_ws(' ', contact.first_name, contact.last_name, contact.email, contact.phone, company.display_name, company.legal_name)), lower(${query})) > 0
      order by contact.updated_at desc limit ${perGroup}
    `);
  }

  if (context.permissions.has(projectPermissionKeys.projectView)) {
    const scope = context.permissionScopes.get(projectPermissionKeys.projectView) ?? "own";
    searches.push(database<SearchRow[]>`
      select project.id, 'project'::text as kind, 'Projects'::text as module,
        project.name as title, project.code as subtitle, project.status as badge,
        '/projects?project=' || project.id::text as href
      from public.projects project
      where project.organization_id = ${organizationId}::uuid
        and private.project_is_visible(project.id, ${membershipId}::uuid, ${scope})
        and strpos(lower(concat_ws(' ', project.name, project.code, project.description)), lower(${query})) > 0
      order by project.updated_at desc limit ${perGroup}
    `);
    if (context.permissions.has(projectPermissionKeys.taskView)) {
      searches.push(database<SearchRow[]>`
        select task.id, 'task'::text as kind, 'Projects'::text as module,
          task.title as title, project.code || '-' || task.task_number::text || ' · ' || project.name as subtitle,
          status.name as badge, '/projects?project=' || project.id::text as href
        from public.project_tasks task
        join public.projects project on project.id = task.project_id
        join public.project_task_statuses status on status.id = task.status_id
        where task.organization_id = ${organizationId}::uuid
          and private.project_is_visible(project.id, ${membershipId}::uuid, ${scope})
          and strpos(lower(concat_ws(' ', task.title, task.description, project.name, project.code, task.task_number::text)), lower(${query})) > 0
        order by task.updated_at desc limit ${perGroup}
      `);
    }
  }

  if (context.permissions.has(hrPermissionKeys.employeeView)) {
    const scope = context.permissionScopes.get(hrPermissionKeys.employeeView) ?? "own";
    searches.push(database<SearchRow[]>`
      select employee.id, 'employee'::text as kind, 'People'::text as module,
        private.membership_display_name(employee.membership_id) as title,
        concat_ws(' · ', membership.employee_number, designation.name, department.name) as subtitle,
        employee.lifecycle_status as badge, '/hr?employee=' || employee.membership_id::text as href
      from public.hr_employee_profiles employee
      join public.memberships membership on membership.id = employee.membership_id
      left join public.hr_designations designation on designation.id = employee.designation_id
      left join public.departments department on department.id = membership.department_id
      where employee.organization_id = ${organizationId}::uuid
        and private.crm_scope_allows_membership(
          ${membershipId}::uuid, ${scope}, employee.membership_id, employee.membership_id
        )
        and strpos(lower(concat_ws(' ', private.membership_display_name(employee.membership_id), membership.employee_number, designation.name, department.name)), lower(${query})) > 0
      order by employee.updated_at desc limit ${perGroup}
    `);
  }

  if (context.permissions.has(supportPermissionKeys.view)) {
    searches.push(database<SearchRow[]>`
      select ticket.id, 'ticket'::text as kind, 'Support'::text as module,
        ticket.subject as title, 'SUP-' || lpad(ticket.ticket_number::text, 6, '0') as subtitle,
        ticket.status as badge, '/support?q=SUP-' || lpad(ticket.ticket_number::text, 6, '0') as href
      from public.support_tickets ticket
      where ticket.organization_id = ${organizationId}::uuid
        and private.support_ticket_membership_access_allowed(
          ticket.id, ${membershipId}::uuid, 'support.ticket.view'
        )
        and strpos(lower(concat_ws(' ', ticket.subject, 'SUP-' || lpad(ticket.ticket_number::text, 6, '0'))), lower(${query})) > 0
      order by ticket.last_activity_at desc limit ${perGroup}
    `);
  }

  if (context.permissions.has(documentPermissionKeys.view)) {
    searches.push(database<SearchRow[]>`
      select document.id, 'document'::text as kind, 'Documents'::text as module,
        document.title, category.name as subtitle, document.status as badge,
        '/documents?document=' || document.id::text as href
      from public.documents document
      left join public.document_categories category on category.id = document.category_id
      where document.organization_id = ${organizationId}::uuid
        and private.document_membership_access_allowed(
          document.id, ${membershipId}::uuid, 'documents.document.view'
        )
        and strpos(lower(concat_ws(' ', document.title, category.name)), lower(${query})) > 0
      order by document.updated_at desc limit ${perGroup}
    `);
  }

  if (context.permissions.has(legalPermissionKeys.view)) {
    searches.push(database<SearchRow[]>`
      select contract.id, 'contract'::text as kind, 'Legal'::text as module,
        contract.title, contract.internal_reference || ' · ' || contract.counterparty_name as subtitle,
        contract.status as badge, '/legal?contract=' || contract.id::text as href
      from public.legal_contracts contract
      where contract.organization_id = ${organizationId}::uuid
        and private.legal_contract_membership_access_allowed(
          contract.id, ${membershipId}::uuid, 'legal.contract.view'
        )
        and strpos(lower(concat_ws(' ', contract.title, contract.internal_reference, contract.counterparty_name)), lower(${query})) > 0
      order by contract.updated_at desc limit ${perGroup}
    `);
  }

  if (context.permissions.has(assetPermissionKeys.view)) {
    searches.push(database<SearchRow[]>`
      select asset.id, 'asset'::text as kind, 'Assets'::text as module,
        asset.name, concat_ws(' · ', asset.asset_tag, asset.manufacturer, asset.model) as subtitle,
        asset.status as badge, '/assets?q=' || asset.asset_tag as href
      from public.assets asset
      where asset.organization_id = ${organizationId}::uuid
        and private.asset_membership_access_allowed(asset.id, ${membershipId}::uuid, 'assets.asset.view')
        and strpos(lower(concat_ws(' ', asset.name, asset.asset_tag, asset.serial_number, asset.manufacturer, asset.model)), lower(${query})) > 0
      order by asset.updated_at desc limit ${perGroup}
    `);
  }

  if (context.permissions.has(vendorPermissionKeys.view)) {
    searches.push(database<SearchRow[]>`
      select vendor.id, 'vendor'::text as kind, 'Vendors'::text as module,
        vendor.display_name as title, vendor.legal_name as subtitle, vendor.status as badge,
        '/vendors?q=VEN-' || lpad(vendor.vendor_number::text, 6, '0') as href
      from public.vendors vendor
      where vendor.organization_id = ${organizationId}::uuid
        and private.vendor_membership_access_allowed(vendor.id, ${membershipId}::uuid, 'vendors.vendor.view')
        and strpos(lower(concat_ws(' ', vendor.display_name, vendor.legal_name, 'VEN-' || lpad(vendor.vendor_number::text, 6, '0'))), lower(${query})) > 0
      order by vendor.updated_at desc limit ${perGroup}
    `);
  }

  if (context.permissions.has(vendorPermissionKeys.requestView)) {
    searches.push(database<SearchRow[]>`
      select request.id, 'purchase_request'::text as kind, 'Vendors'::text as module,
        'PR-' || lpad(request.request_number::text, 6, '0') || ' · ' || request.title as title,
        private.membership_display_name(request.requester_membership_id) as subtitle,
        request.status as badge,
        '/vendors?q=PR-' || lpad(request.request_number::text, 6, '0') as href
      from public.procurement_purchase_requests request
      where request.organization_id = ${organizationId}::uuid
        and private.purchase_request_membership_access_allowed(
          request.id, ${membershipId}::uuid, 'vendors.purchase_request.view'
        )
        and strpos(lower(concat_ws(' ', request.title,
          'PR-' || lpad(request.request_number::text, 6, '0'))), lower(${query})) > 0
      order by request.updated_at desc limit ${perGroup}
    `);
  }

  if (context.permissions.has(vendorPermissionKeys.purchaseOrderView)) {
    searches.push(database<SearchRow[]>`
      select purchase_order.id, 'purchase_order'::text as kind, 'Vendors'::text as module,
        'PO-' || lpad(purchase_order.purchase_order_number::text, 6, '0') as title,
        vendor.display_name as subtitle, purchase_order.status as badge,
        '/vendors?q=PO-' || lpad(purchase_order.purchase_order_number::text, 6, '0') as href
      from public.procurement_purchase_orders purchase_order
      join public.vendors vendor on vendor.id = purchase_order.vendor_id
      where purchase_order.organization_id = ${organizationId}::uuid
        and private.purchase_order_membership_access_allowed(
          purchase_order.id, ${membershipId}::uuid, 'vendors.purchase_order.view'
        )
        and strpos(lower(concat_ws(' ', 'PO-' || lpad(purchase_order.purchase_order_number::text, 6, '0'), vendor.display_name, vendor.legal_name)), lower(${query})) > 0
      order by purchase_order.updated_at desc limit ${perGroup}
    `);
  }

  if (context.permissions.has(calendarPermissionKeys.view)) {
    searches.push(database<SearchRow[]>`
      select calendar_event.id, 'calendar_event'::text as kind, 'Calendar'::text as module,
        calendar_event.title, calendar_event.event_type as subtitle,
        calendar_event.status as badge, '/calendar?event=' || calendar_event.id::text as href
      from public.calendar_events calendar_event
      where calendar_event.organization_id = ${organizationId}::uuid
        and calendar_event.status = 'active'
        and private.calendar_event_membership_access_allowed(
          calendar_event.id, ${membershipId}::uuid, 'calendar.event.view'
        )
        and strpos(lower(concat_ws(' ', calendar_event.title, calendar_event.location)), lower(${query})) > 0
      order by calendar_event.starts_at desc limit ${perGroup}
    `);
  }

  if (context.permissions.has(financePermissionKeys.estimateView)) {
    searches.push(database<SearchRow[]>`
      select estimate.id, 'estimate'::text as kind, 'Finance'::text as module,
        estimate.estimate_number as title, coalesce(company.display_name, company.legal_name) as subtitle,
        estimate.status as badge, '/finance?estimate=' || estimate.id::text as href
      from public.finance_estimates estimate
      join public.crm_companies company on company.id = estimate.company_id
      where estimate.organization_id = ${organizationId}::uuid
        and strpos(lower(concat_ws(' ', estimate.estimate_number, company.display_name, company.legal_name)), lower(${query})) > 0
      order by estimate.updated_at desc limit ${perGroup}
    `);
  }
  if (context.permissions.has(financePermissionKeys.invoiceView)) {
    searches.push(database<SearchRow[]>`
      select invoice.id, 'invoice'::text as kind, 'Finance'::text as module,
        coalesce(invoice.invoice_number, invoice.draft_reference) as title,
        coalesce(company.display_name, company.legal_name) as subtitle,
        invoice.status as badge, '/finance?invoice=' || invoice.id::text as href
      from public.finance_invoices invoice
      join public.crm_companies company on company.id = invoice.company_id
      where invoice.organization_id = ${organizationId}::uuid
        and strpos(lower(concat_ws(' ', invoice.invoice_number, invoice.draft_reference, company.display_name, company.legal_name, invoice.purchase_order_reference)), lower(${query})) > 0
      order by invoice.updated_at desc limit ${perGroup}
    `);
  }

  const groups = await Promise.all(searches);
  const allItems = groups.flat();
  const items = allItems
    .sort(
      (left, right) =>
        left.module.localeCompare(right.module) || left.title.localeCompare(right.title),
    )
    .slice(0, limit);
  return {
    allowed: true,
    data: { query, items, truncated: allItems.length > items.length },
  };
}
