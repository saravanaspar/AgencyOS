-- Align Support's project/client validation with the canonical Projects schema.
create or replace function private.validate_support_ticket()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.memberships where id = new.created_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Ticket creator must belong to its organization';
  end if;
  if new.assigned_agent_membership_id is not null and not exists (
    select 1 from public.memberships where id = new.assigned_agent_membership_id
      and organization_id = new.organization_id and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Assigned agent must be active in the ticket organization';
  end if;
  if new.assigned_team_id is not null and not exists (
    select 1 from public.teams where id = new.assigned_team_id
      and organization_id = new.organization_id and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Assigned team must be active in the ticket organization';
  end if;
  if new.category_id is not null and not exists (
    select 1 from public.support_ticket_categories where id = new.category_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Ticket category must belong to its organization';
  end if;
  if new.client_company_id is not null and not exists (
    select 1 from public.crm_companies where id = new.client_company_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Ticket client must belong to its organization';
  end if;
  if new.contact_id is not null and not exists (
    select 1 from public.crm_contacts where id = new.contact_id
      and organization_id = new.organization_id
      and (new.client_company_id is null or company_id = new.client_company_id)
  ) then
    raise exception using errcode = '23514', message = 'Ticket contact must match its organization and client';
  end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects as project where project.id = new.project_id
      and project.organization_id = new.organization_id
      and (new.client_company_id is null or project.company_id = new.client_company_id)
  ) then
    raise exception using errcode = '23514', message = 'Ticket project must match its organization and client';
  end if;
  return new;
end;
$$;
