begin;

alter table public.crm_companies
  add column primary_contact_id uuid;

alter table public.crm_companies
  add constraint crm_companies_primary_contact_fk
  foreign key (primary_contact_id) references public.crm_contacts(id) on delete set null;

create index crm_companies_primary_contact_idx
  on public.crm_companies (organization_id, primary_contact_id)
  where primary_contact_id is not null;

create or replace function private.validate_crm_company_primary_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact_record record;
begin
  if new.primary_contact_id is null then
    return new;
  end if;

  select contact.organization_id, contact.company_id, contact.status
  into contact_record
  from public.crm_contacts as contact
  where contact.id = new.primary_contact_id;

  if not found
     or contact_record.organization_id <> new.organization_id
     or contact_record.company_id is distinct from new.id
     or contact_record.status <> 'active' then
    raise exception 'Primary contact must be an active contact linked to this company.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_crm_company_primary_contact() from public, anon, authenticated;
grant execute on function private.validate_crm_company_primary_contact() to service_role;

create trigger crm_companies_validate_primary_contact
before insert or update of primary_contact_id, organization_id
on public.crm_companies
for each row execute function private.validate_crm_company_primary_contact();

create or replace function private.protect_crm_primary_contact_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.crm_companies as company
    where company.primary_contact_id = old.id
      and (
        new.organization_id <> company.organization_id
        or new.company_id is distinct from company.id
        or new.status <> 'active'
      )
  ) then
    raise exception 'A primary contact must remain active and linked to its company.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_crm_primary_contact_membership() from public, anon, authenticated;
grant execute on function private.protect_crm_primary_contact_membership() to service_role;

create trigger crm_contacts_protect_primary_contact_membership
before update of organization_id, company_id, status
on public.crm_contacts
for each row execute function private.protect_crm_primary_contact_membership();

comment on column public.crm_companies.primary_contact_id is
  'Active CRM contact designated as the company primary contact. Tenant and company membership are trigger-enforced.';

commit;
