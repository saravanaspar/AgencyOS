-- Repair legal document links and add structured discovery metadata for people and AI.

set lock_timeout = '10s';
set statement_timeout = '120s';

alter table public.documents
  add column document_date date,
  add column reference_code text;

alter table public.documents
  add constraint documents_reference_code_valid check (
    reference_code is null
    or (char_length(btrim(reference_code)) between 1 and 120 and reference_code = btrim(reference_code))
  );

create index documents_document_date_idx
  on public.documents (organization_id, document_date desc, updated_at desc)
  where status = 'active';

create index documents_reference_code_idx
  on public.documents (organization_id, lower(reference_code))
  where reference_code is not null and status = 'active';

-- Documents intentionally expose only a safe column subset to authenticated clients.
-- New discovery metadata must be added explicitly so existing RLS-protected reads can use it.
grant select (document_date, reference_code) on public.documents to authenticated;

-- Later module migrations accidentally narrowed this catalogue and removed contracts.
alter table public.document_entity_links drop constraint document_entity_links_type_valid;
alter table public.document_entity_links add constraint document_entity_links_type_valid check (
  entity_type in (
    'client', 'contact', 'lead', 'project', 'task', 'invoice', 'estimate', 'employee',
    'contract', 'ticket', 'asset', 'vendor', 'purchase_order'
  )
);

create or replace function private.validate_document_entity_link()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_exists boolean := false;
begin
  if not exists (
    select 1 from public.documents
    where id = new.document_id and organization_id = new.organization_id
  ) or not exists (
    select 1 from public.memberships
    where id = new.created_by_membership_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514',
      message = 'Document entity link must remain inside one organization';
  end if;

  case new.entity_type
    when 'client' then select exists(select 1 from public.crm_companies where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'contact' then select exists(select 1 from public.crm_contacts where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'lead' then select exists(select 1 from public.crm_leads where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'project' then select exists(select 1 from public.projects where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'task' then select exists(select 1 from public.project_tasks where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'invoice' then select exists(select 1 from public.finance_invoices where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'estimate' then select exists(select 1 from public.finance_estimates where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'employee' then select exists(select 1 from public.memberships where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'contract' then select exists(select 1 from public.legal_contracts where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'ticket' then select exists(select 1 from public.support_tickets where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'asset' then select exists(select 1 from public.assets where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'vendor' then select exists(select 1 from public.vendors where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'purchase_order' then select exists(select 1 from public.procurement_purchase_orders where id = new.entity_id and organization_id = new.organization_id) into v_exists;
  end case;

  if not v_exists then
    raise exception using errcode = '23514',
      message = 'Linked entity was not found in this organization';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_document_entity_link() from public, anon, authenticated;
