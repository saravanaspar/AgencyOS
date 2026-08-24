-- Tenant-isolated CRM foundation: companies, contacts, leads, pipeline and activities.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('crm', 'company', 'view', 'View permitted CRM company records.', false),
  ('crm', 'company', 'create', 'Create CRM company records.', false),
  ('crm', 'company', 'update', 'Update permitted CRM company records.', false),
  ('crm', 'contact', 'view', 'View permitted CRM contact records.', false),
  ('crm', 'contact', 'create', 'Create CRM contact records.', false),
  ('crm', 'contact', 'update', 'Update permitted CRM contact records.', false),
  ('crm', 'lead', 'view', 'View permitted CRM lead records.', false),
  ('crm', 'lead', 'create', 'Create CRM lead records.', false),
  ('crm', 'lead', 'update', 'Update permitted CRM lead records.', false),
  ('crm', 'lead', 'delete', 'Permanently delete unconverted CRM leads.', true),
  ('crm', 'lead', 'assign', 'Assign CRM records to another active member.', true),
  ('crm', 'activity', 'create', 'Add CRM calls, emails, meetings, notes and follow-ups.', false),
  ('crm', 'pipeline', 'manage', 'Configure CRM pipeline stages and probabilities.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'owner', permission.id, 'organization'
from public.permissions as permission
where permission.module = 'crm'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'sales_manager', permission.id, 'organization'
from public.permissions as permission
where permission.module = 'crm'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select
  'sales_executive',
  permission.id,
  case
    when permission.key in ('crm.company.view', 'crm.company.update', 'crm.contact.view', 'crm.contact.update', 'crm.lead.view', 'crm.lead.update')
      then 'assigned_or_created'
    else 'organization'
  end
from public.permissions as permission
where permission.key in (
  'crm.company.view', 'crm.company.create', 'crm.company.update',
  'crm.contact.view', 'crm.contact.create', 'crm.contact.update',
  'crm.lead.view', 'crm.lead.create', 'crm.lead.update',
  'crm.activity.create'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('system_administrator', 'operations_administrator')
  and permission.key in ('crm.company.view', 'crm.contact.view', 'crm.lead.view')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'crm'
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.crm_pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  position integer not null,
  probability smallint not null default 0,
  state text not null default 'open',
  required_fields jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_pipeline_stages_name_not_blank check (btrim(name) <> ''),
  constraint crm_pipeline_stages_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint crm_pipeline_stages_position_positive check (position > 0),
  constraint crm_pipeline_stages_probability_valid check (probability between 0 and 100),
  constraint crm_pipeline_stages_state_valid check (state in ('open', 'won', 'lost')),
  constraint crm_pipeline_stages_required_fields_array check (jsonb_typeof(required_fields) = 'array'),
  unique (organization_id, slug),
  unique (organization_id, position)
);

create index crm_pipeline_stages_org_active_idx
  on public.crm_pipeline_stages (organization_id, is_active, position);

create table public.crm_companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legal_name text not null,
  display_name text,
  industry text,
  website text,
  registration_details jsonb not null default '{}'::jsonb,
  tax_identifiers jsonb not null default '{}'::jsonb,
  billing_address jsonb not null default '{}'::jsonb,
  service_address jsonb not null default '{}'::jsonb,
  email text,
  phone text,
  account_owner_membership_id uuid references public.memberships(id) on delete set null,
  client_status text not null default 'prospect',
  payment_terms_days integer not null default 30,
  currency text not null default 'USD',
  credit_limit numeric(18,2),
  notes text,
  tags text[] not null default '{}'::text[],
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_companies_legal_name_not_blank check (btrim(legal_name) <> ''),
  constraint crm_companies_status_valid check (client_status in ('prospect', 'client', 'inactive')),
  constraint crm_companies_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint crm_companies_payment_terms_valid check (payment_terms_days between 0 and 365),
  constraint crm_companies_credit_limit_valid check (credit_limit is null or credit_limit >= 0),
  constraint crm_companies_registration_object check (jsonb_typeof(registration_details) = 'object'),
  constraint crm_companies_tax_object check (jsonb_typeof(tax_identifiers) = 'object'),
  constraint crm_companies_billing_object check (jsonb_typeof(billing_address) = 'object'),
  constraint crm_companies_service_object check (jsonb_typeof(service_address) = 'object')
);

create unique index crm_companies_org_legal_name_unique
  on public.crm_companies (organization_id, lower(legal_name));
create index crm_companies_owner_idx
  on public.crm_companies (organization_id, account_owner_membership_id, updated_at desc);
create index crm_companies_search_idx
  on public.crm_companies (organization_id, lower(coalesce(display_name, legal_name)));

create table public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid references public.crm_companies(id) on delete set null,
  first_name text not null,
  last_name text not null,
  job_title text,
  email text,
  phone text,
  preferred_communication text not null default 'email',
  is_billing_contact boolean not null default false,
  is_decision_maker boolean not null default false,
  portal_access_enabled boolean not null default false,
  consent_status text not null default 'unknown',
  status text not null default 'active',
  owner_membership_id uuid references public.memberships(id) on delete set null,
  notes text,
  tags text[] not null default '{}'::text[],
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_contacts_first_name_not_blank check (btrim(first_name) <> ''),
  constraint crm_contacts_last_name_not_blank check (btrim(last_name) <> ''),
  constraint crm_contacts_preferred_communication_valid check (preferred_communication in ('email', 'phone', 'meeting', 'none')),
  constraint crm_contacts_consent_status_valid check (consent_status in ('unknown', 'granted', 'revoked')),
  constraint crm_contacts_status_valid check (status in ('active', 'inactive'))
);

create unique index crm_contacts_org_email_unique
  on public.crm_contacts (organization_id, lower(email)) where email is not null;
create index crm_contacts_company_idx on public.crm_contacts (organization_id, company_id, status);
create index crm_contacts_owner_idx on public.crm_contacts (organization_id, owner_membership_id, updated_at desc);

create table public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  lead_type text not null default 'company',
  source text,
  status text not null default 'new',
  stage_id uuid not null references public.crm_pipeline_stages(id) on delete restrict,
  stage_entered_at timestamptz not null default now(),
  estimated_value numeric(18,2),
  currency text not null default 'USD',
  probability smallint not null default 0,
  expected_close_date date,
  owner_membership_id uuid references public.memberships(id) on delete set null,
  email text,
  phone text,
  company_name text,
  follow_up_at timestamptz,
  lost_reason text,
  qualification jsonb not null default '{}'::jsonb,
  qualification_score smallint not null default 0,
  qualification_label text not null default 'cold',
  notes text,
  tags text[] not null default '{}'::text[],
  converted_company_id uuid references public.crm_companies(id) on delete set null,
  converted_contact_id uuid references public.crm_contacts(id) on delete set null,
  converted_at timestamptz,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_leads_name_not_blank check (btrim(name) <> ''),
  constraint crm_leads_type_valid check (lead_type in ('person', 'company')),
  constraint crm_leads_status_valid check (status in ('new', 'qualified', 'unqualified', 'converted', 'lost')),
  constraint crm_leads_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint crm_leads_value_valid check (estimated_value is null or estimated_value >= 0),
  constraint crm_leads_probability_valid check (probability between 0 and 100),
  constraint crm_leads_qualification_object check (jsonb_typeof(qualification) = 'object'),
  constraint crm_leads_qualification_score_valid check (qualification_score between 0 and 100),
  constraint crm_leads_qualification_label_valid check (qualification_label in ('cold', 'warm', 'qualified')),
  constraint crm_leads_conversion_consistent check (
    (status = 'converted' and converted_company_id is not null and converted_at is not null)
    or (status <> 'converted' and converted_at is null)
  )
);

create index crm_leads_pipeline_idx
  on public.crm_leads (organization_id, stage_id, status, updated_at desc);
create index crm_leads_owner_idx
  on public.crm_leads (organization_id, owner_membership_id, status, updated_at desc);
create index crm_leads_follow_up_idx
  on public.crm_leads (organization_id, follow_up_at) where follow_up_at is not null;
create index crm_leads_email_idx
  on public.crm_leads (organization_id, lower(email)) where email is not null;

create table public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete cascade,
  company_id uuid references public.crm_companies(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete cascade,
  activity_type text not null,
  subject text not null,
  details text,
  due_at timestamptz,
  completed_at timestamptz,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint crm_activities_one_entity check (
    num_nonnulls(lead_id, company_id, contact_id) = 1
  ),
  constraint crm_activities_type_valid check (
    activity_type in ('call', 'email', 'meeting', 'note', 'follow_up', 'proposal_sent', 'contract_sent', 'client_response', 'status_change')
  ),
  constraint crm_activities_subject_not_blank check (btrim(subject) <> '')
);

create index crm_activities_org_time_idx on public.crm_activities (organization_id, occurred_at desc);
create index crm_activities_lead_idx on public.crm_activities (lead_id, occurred_at desc) where lead_id is not null;
create index crm_activities_company_idx on public.crm_activities (company_id, occurred_at desc) where company_id is not null;
create index crm_activities_contact_idx on public.crm_activities (contact_id, occurred_at desc) where contact_id is not null;

create trigger crm_pipeline_stages_set_updated_at
before update on public.crm_pipeline_stages
for each row execute function private.set_updated_at();

create trigger crm_companies_set_updated_at
before update on public.crm_companies
for each row execute function private.set_updated_at();

create trigger crm_contacts_set_updated_at
before update on public.crm_contacts
for each row execute function private.set_updated_at();

create trigger crm_leads_set_updated_at
before update on public.crm_leads
for each row execute function private.set_updated_at();

create or replace function private.validate_crm_company_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner_organization_id uuid;
  v_creator_organization_id uuid;
begin
  if new.account_owner_membership_id is not null then
    select organization_id into v_owner_organization_id
    from public.memberships where id = new.account_owner_membership_id and status = 'active';
    if v_owner_organization_id is null or v_owner_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'CRM company owner must be active in the same organization';
    end if;
  end if;

  select organization_id into v_creator_organization_id
  from public.memberships where id = new.created_by_membership_id;
  if v_creator_organization_id is null or v_creator_organization_id <> new.organization_id then
    raise exception using errcode = '23514', message = 'CRM company creator must belong to the same organization';
  end if;
  return new;
end;
$$;

create trigger crm_companies_validate_tenant
before insert or update of organization_id, account_owner_membership_id, created_by_membership_id
on public.crm_companies
for each row execute function private.validate_crm_company_tenant();

create or replace function private.validate_crm_contact_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_related_organization_id uuid;
begin
  if new.company_id is not null then
    select organization_id into v_related_organization_id from public.crm_companies where id = new.company_id;
    if v_related_organization_id is null or v_related_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'CRM contact company must belong to the same organization';
    end if;
  end if;

  if new.owner_membership_id is not null then
    select organization_id into v_related_organization_id
    from public.memberships where id = new.owner_membership_id and status = 'active';
    if v_related_organization_id is null or v_related_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'CRM contact owner must be active in the same organization';
    end if;
  end if;

  select organization_id into v_related_organization_id
  from public.memberships where id = new.created_by_membership_id;
  if v_related_organization_id is null or v_related_organization_id <> new.organization_id then
    raise exception using errcode = '23514', message = 'CRM contact creator must belong to the same organization';
  end if;
  return new;
end;
$$;

create trigger crm_contacts_validate_tenant
before insert or update of organization_id, company_id, owner_membership_id, created_by_membership_id
on public.crm_contacts
for each row execute function private.validate_crm_contact_tenant();

create or replace function private.validate_crm_lead_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_related_organization_id uuid;
begin
  select organization_id into v_related_organization_id from public.crm_pipeline_stages where id = new.stage_id;
  if v_related_organization_id is null or v_related_organization_id <> new.organization_id then
    raise exception using errcode = '23514', message = 'CRM lead stage must belong to the same organization';
  end if;

  if new.owner_membership_id is not null then
    select organization_id into v_related_organization_id
    from public.memberships where id = new.owner_membership_id and status = 'active';
    if v_related_organization_id is null or v_related_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'CRM lead owner must be active in the same organization';
    end if;
  end if;

  select organization_id into v_related_organization_id
  from public.memberships where id = new.created_by_membership_id;
  if v_related_organization_id is null or v_related_organization_id <> new.organization_id then
    raise exception using errcode = '23514', message = 'CRM lead creator must belong to the same organization';
  end if;

  if new.converted_company_id is not null then
    select organization_id into v_related_organization_id from public.crm_companies where id = new.converted_company_id;
    if v_related_organization_id is null or v_related_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'Converted CRM company must belong to the same organization';
    end if;
  end if;

  if new.converted_contact_id is not null then
    select organization_id into v_related_organization_id from public.crm_contacts where id = new.converted_contact_id;
    if v_related_organization_id is null or v_related_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'Converted CRM contact must belong to the same organization';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
    new.stage_entered_at = now();
  end if;
  return new;
end;
$$;

create trigger crm_leads_validate_tenant
before insert or update of organization_id, stage_id, owner_membership_id, created_by_membership_id, converted_company_id, converted_contact_id
on public.crm_leads
for each row execute function private.validate_crm_lead_tenant();

create or replace function private.validate_crm_activity_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_related_organization_id uuid;
begin
  if new.lead_id is not null then
    select organization_id into v_related_organization_id from public.crm_leads where id = new.lead_id;
  elsif new.company_id is not null then
    select organization_id into v_related_organization_id from public.crm_companies where id = new.company_id;
  else
    select organization_id into v_related_organization_id from public.crm_contacts where id = new.contact_id;
  end if;

  if v_related_organization_id is null or v_related_organization_id <> new.organization_id then
    raise exception using errcode = '23514', message = 'CRM activity record must belong to the same organization';
  end if;

  select organization_id into v_related_organization_id
  from public.memberships where id = new.created_by_membership_id and status = 'active';
  if v_related_organization_id is null or v_related_organization_id <> new.organization_id then
    raise exception using errcode = '23514', message = 'CRM activity creator must be active in the same organization';
  end if;
  return new;
end;
$$;

create trigger crm_activities_validate_tenant
before insert or update of organization_id, lead_id, company_id, contact_id, created_by_membership_id
on public.crm_activities
for each row execute function private.validate_crm_activity_tenant();

create or replace function private.crm_scope_allows_membership(
  p_membership_id uuid,
  p_scope text,
  p_owner_membership_id uuid,
  p_created_by_membership_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships%rowtype;
  v_target_membership_id uuid := coalesce(p_owner_membership_id, p_created_by_membership_id);
begin
  select * into v_membership
  from public.memberships
  where id = p_membership_id and status = 'active';

  if v_membership.id is null then return false; end if;
  if p_scope = 'organization' then return true; end if;
  if p_scope in ('own', 'assigned') then return v_target_membership_id = p_membership_id; end if;
  if p_scope = 'assigned_or_created' then
    return p_owner_membership_id = p_membership_id or p_created_by_membership_id = p_membership_id;
  end if;
  if v_target_membership_id is null then return false; end if;

  if p_scope = 'team' then
    return exists (
      select 1
      from public.team_members as mine
      join public.team_members as theirs on theirs.team_id = mine.team_id
      join public.teams as team on team.id = mine.team_id and team.status = 'active'
      where mine.membership_id = p_membership_id
        and theirs.membership_id = v_target_membership_id
        and team.organization_id = v_membership.organization_id
    );
  end if;

  if p_scope = 'department' then
    return exists (
      select 1 from public.memberships as target
      where target.id = v_target_membership_id
        and target.organization_id = v_membership.organization_id
        and target.department_id is not null
        and target.department_id = v_membership.department_id
    );
  end if;

  if p_scope = 'managed_employees' then
    return exists (
      with recursive reports as (
        select id from public.memberships where manager_membership_id = p_membership_id
        union all
        select child.id
        from public.memberships as child
        join reports as parent on child.manager_membership_id = parent.id
      )
      select 1 from reports where id = v_target_membership_id
    );
  end if;

  return false;
end;
$$;

create or replace function private.effective_permission_scope(
  p_organization_id uuid,
  p_permission_key text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
  v_override_effect text;
  v_override_scope text;
  v_role_scope text;
begin
  v_membership_id := private.current_membership_id(p_organization_id);
  if v_membership_id is null then return null; end if;

  select effect, scope into v_override_effect, v_override_scope
  from public.membership_permission_overrides as override_grant
  join public.permissions as permission on permission.id = override_grant.permission_id
  where override_grant.membership_id = v_membership_id
    and permission.key = p_permission_key
    and (override_grant.expires_at is null or override_grant.expires_at > now())
  limit 1;

  if v_override_effect = 'deny' then return null; end if;

  select role_permission.scope into v_role_scope
  from public.membership_roles as assignment
  join public.roles as role on role.id = assignment.role_id
    and role.organization_id = p_organization_id and role.status = 'active'
  join public.role_permissions as role_permission on role_permission.role_id = role.id
  join public.permissions as permission on permission.id = role_permission.permission_id
  where assignment.membership_id = v_membership_id and permission.key = p_permission_key
  order by case role_permission.scope
    when 'organization' then 8 when 'selected_projects' then 7 when 'managed_employees' then 6
    when 'department' then 5 when 'team' then 4 when 'assigned_or_created' then 3
    when 'assigned' then 2 else 1 end desc
  limit 1;

  if v_override_effect = 'allow' then return coalesce(v_override_scope, v_role_scope, 'organization'); end if;
  return v_role_scope;
end;
$$;

create or replace function private.seed_crm_pipeline_stages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.crm_pipeline_stages (organization_id, name, slug, position, probability, state, created_by)
  values
    (new.id, 'New', 'new', 10, 10, 'open', new.created_by),
    (new.id, 'Contacted', 'contacted', 20, 25, 'open', new.created_by),
    (new.id, 'Qualified', 'qualified', 30, 50, 'open', new.created_by),
    (new.id, 'Proposal', 'proposal', 40, 70, 'open', new.created_by),
    (new.id, 'Negotiation', 'negotiation', 50, 85, 'open', new.created_by),
    (new.id, 'Won', 'won', 60, 100, 'won', new.created_by),
    (new.id, 'Lost', 'lost', 70, 0, 'lost', new.created_by)
  on conflict (organization_id, slug) do nothing;
  return new;
end;
$$;

create trigger organizations_seed_crm_pipeline
  after insert on public.organizations
  for each row execute function private.seed_crm_pipeline_stages();

insert into public.crm_pipeline_stages (organization_id, name, slug, position, probability, state, created_by)
select organization.id, stage.name, stage.slug, stage.position, stage.probability, stage.state, organization.created_by
from public.organizations as organization
cross join (values
  ('New', 'new', 10, 10, 'open'),
  ('Contacted', 'contacted', 20, 25, 'open'),
  ('Qualified', 'qualified', 30, 50, 'open'),
  ('Proposal', 'proposal', 40, 70, 'open'),
  ('Negotiation', 'negotiation', 50, 85, 'open'),
  ('Won', 'won', 60, 100, 'won'),
  ('Lost', 'lost', 70, 0, 'lost')
) as stage(name, slug, position, probability, state)
on conflict (organization_id, slug) do nothing;

alter table public.crm_pipeline_stages enable row level security;
alter table public.crm_companies enable row level security;
alter table public.crm_contacts enable row level security;
alter table public.crm_leads enable row level security;
alter table public.crm_activities enable row level security;

revoke all on public.crm_pipeline_stages from anon;
revoke all on public.crm_companies from anon;
revoke all on public.crm_contacts from anon;
revoke all on public.crm_leads from anon;
revoke all on public.crm_activities from anon;

grant select, insert, update, delete on public.crm_pipeline_stages to authenticated;
grant select, insert, update on public.crm_companies to authenticated;
grant select, insert, update on public.crm_contacts to authenticated;
grant select, insert, update, delete on public.crm_leads to authenticated;
grant select, insert on public.crm_activities to authenticated;

grant all on public.crm_pipeline_stages to service_role;
grant all on public.crm_companies to service_role;
grant all on public.crm_contacts to service_role;
grant all on public.crm_leads to service_role;
grant all on public.crm_activities to service_role;

create policy crm_pipeline_stages_select_authorized
on public.crm_pipeline_stages for select to authenticated
using (
  private.has_permission(organization_id, 'crm.workspace.view')
  and (
    private.has_permission(organization_id, 'crm.lead.view')
    or private.has_permission(organization_id, 'crm.pipeline.manage')
  )
);

create policy crm_pipeline_stages_manage_authorized
on public.crm_pipeline_stages for all to authenticated
using (private.has_permission(organization_id, 'crm.pipeline.manage'))
with check (private.has_permission(organization_id, 'crm.pipeline.manage'));

create policy crm_companies_select_scoped
on public.crm_companies for select to authenticated
using (
  private.has_permission(organization_id, 'crm.company.view')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'crm.company.view'),
    account_owner_membership_id,
    created_by_membership_id
  )
);

create policy crm_companies_insert_authorized
on public.crm_companies for insert to authenticated
with check (
  private.has_permission(organization_id, 'crm.company.create')
  and created_by_membership_id = private.current_membership_id(organization_id)
  and (
    account_owner_membership_id is null
    or account_owner_membership_id = private.current_membership_id(organization_id)
    or private.has_permission(organization_id, 'crm.lead.assign')
  )
);

create policy crm_companies_update_scoped
on public.crm_companies for update to authenticated
using (
  private.has_permission(organization_id, 'crm.company.update')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'crm.company.update'),
    account_owner_membership_id,
    created_by_membership_id
  )
)
with check (
  private.has_permission(organization_id, 'crm.company.update')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'crm.company.update'),
    account_owner_membership_id,
    created_by_membership_id
  )
  and (
    account_owner_membership_id is null
    or account_owner_membership_id = private.current_membership_id(organization_id)
    or private.has_permission(organization_id, 'crm.lead.assign')
  )
);

create policy crm_contacts_select_scoped
on public.crm_contacts for select to authenticated
using (
  private.has_permission(organization_id, 'crm.contact.view')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'crm.contact.view'),
    owner_membership_id,
    created_by_membership_id
  )
);

create policy crm_contacts_insert_authorized
on public.crm_contacts for insert to authenticated
with check (
  private.has_permission(organization_id, 'crm.contact.create')
  and created_by_membership_id = private.current_membership_id(organization_id)
  and (
    owner_membership_id is null
    or owner_membership_id = private.current_membership_id(organization_id)
    or private.has_permission(organization_id, 'crm.lead.assign')
  )
  and (
    company_id is null
    or exists (
      select 1
      from public.crm_companies as company
      where company.id = crm_contacts.company_id
        and company.organization_id = crm_contacts.organization_id
        and private.has_permission(company.organization_id, 'crm.company.view')
        and private.crm_scope_allows_membership(
          private.current_membership_id(company.organization_id),
          private.effective_permission_scope(company.organization_id, 'crm.company.view'),
          company.account_owner_membership_id,
          company.created_by_membership_id
        )
    )
  )
);

create policy crm_contacts_update_scoped
on public.crm_contacts for update to authenticated
using (
  private.has_permission(organization_id, 'crm.contact.update')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'crm.contact.update'),
    owner_membership_id,
    created_by_membership_id
  )
)
with check (
  private.has_permission(organization_id, 'crm.contact.update')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'crm.contact.update'),
    owner_membership_id,
    created_by_membership_id
  )
  and (
    owner_membership_id is null
    or owner_membership_id = private.current_membership_id(organization_id)
    or private.has_permission(organization_id, 'crm.lead.assign')
  )
  and (
    company_id is null
    or exists (
      select 1
      from public.crm_companies as company
      where company.id = crm_contacts.company_id
        and company.organization_id = crm_contacts.organization_id
        and private.has_permission(company.organization_id, 'crm.company.view')
        and private.crm_scope_allows_membership(
          private.current_membership_id(company.organization_id),
          private.effective_permission_scope(company.organization_id, 'crm.company.view'),
          company.account_owner_membership_id,
          company.created_by_membership_id
        )
    )
  )
);

create policy crm_leads_select_scoped
on public.crm_leads for select to authenticated
using (
  private.has_permission(organization_id, 'crm.lead.view')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'crm.lead.view'),
    owner_membership_id,
    created_by_membership_id
  )
);

create policy crm_leads_insert_authorized
on public.crm_leads for insert to authenticated
with check (
  private.has_permission(organization_id, 'crm.lead.create')
  and created_by_membership_id = private.current_membership_id(organization_id)
  and (
    owner_membership_id is null
    or owner_membership_id = private.current_membership_id(organization_id)
    or private.has_permission(organization_id, 'crm.lead.assign')
  )
);

create policy crm_leads_update_scoped
on public.crm_leads for update to authenticated
using (
  private.has_permission(organization_id, 'crm.lead.update')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'crm.lead.update'),
    owner_membership_id,
    created_by_membership_id
  )
)
with check (
  private.has_permission(organization_id, 'crm.lead.update')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'crm.lead.update'),
    owner_membership_id,
    created_by_membership_id
  )
  and (
    owner_membership_id is null
    or owner_membership_id = private.current_membership_id(organization_id)
    or private.has_permission(organization_id, 'crm.lead.assign')
  )
);

create policy crm_leads_delete_scoped
on public.crm_leads for delete to authenticated
using (
  status <> 'converted'
  and private.has_permission(organization_id, 'crm.lead.delete')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'crm.lead.delete'),
    owner_membership_id,
    created_by_membership_id
  )
);

create policy crm_activities_select_scoped
on public.crm_activities for select to authenticated
using (
  (lead_id is not null and exists (
    select 1 from public.crm_leads as lead
    where lead.id = crm_activities.lead_id
      and private.has_permission(lead.organization_id, 'crm.lead.view')
      and private.crm_scope_allows_membership(
        private.current_membership_id(lead.organization_id),
        private.effective_permission_scope(lead.organization_id, 'crm.lead.view'),
        lead.owner_membership_id, lead.created_by_membership_id
      )
  ))
  or (company_id is not null and exists (
    select 1 from public.crm_companies as company
    where company.id = crm_activities.company_id
      and private.has_permission(company.organization_id, 'crm.company.view')
      and private.crm_scope_allows_membership(
        private.current_membership_id(company.organization_id),
        private.effective_permission_scope(company.organization_id, 'crm.company.view'),
        company.account_owner_membership_id, company.created_by_membership_id
      )
  ))
  or (contact_id is not null and exists (
    select 1 from public.crm_contacts as contact
    where contact.id = crm_activities.contact_id
      and private.has_permission(contact.organization_id, 'crm.contact.view')
      and private.crm_scope_allows_membership(
        private.current_membership_id(contact.organization_id),
        private.effective_permission_scope(contact.organization_id, 'crm.contact.view'),
        contact.owner_membership_id, contact.created_by_membership_id
      )
  ))
);

create policy crm_activities_insert_authorized
on public.crm_activities for insert to authenticated
with check (
  private.has_permission(organization_id, 'crm.activity.create')
  and created_by_membership_id = private.current_membership_id(organization_id)
  and (
    (lead_id is not null and exists (
      select 1 from public.crm_leads as lead
      where lead.id = crm_activities.lead_id
        and lead.organization_id = crm_activities.organization_id
        and private.has_permission(lead.organization_id, 'crm.lead.view')
        and private.crm_scope_allows_membership(
          private.current_membership_id(lead.organization_id),
          private.effective_permission_scope(lead.organization_id, 'crm.lead.view'),
          lead.owner_membership_id,
          lead.created_by_membership_id
        )
    ))
    or (company_id is not null and exists (
      select 1 from public.crm_companies as company
      where company.id = crm_activities.company_id
        and company.organization_id = crm_activities.organization_id
        and private.has_permission(company.organization_id, 'crm.company.view')
        and private.crm_scope_allows_membership(
          private.current_membership_id(company.organization_id),
          private.effective_permission_scope(company.organization_id, 'crm.company.view'),
          company.account_owner_membership_id,
          company.created_by_membership_id
        )
    ))
    or (contact_id is not null and exists (
      select 1 from public.crm_contacts as contact
      where contact.id = crm_activities.contact_id
        and contact.organization_id = crm_activities.organization_id
        and private.has_permission(contact.organization_id, 'crm.contact.view')
        and private.crm_scope_allows_membership(
          private.current_membership_id(contact.organization_id),
          private.effective_permission_scope(contact.organization_id, 'crm.contact.view'),
          contact.owner_membership_id,
          contact.created_by_membership_id
        )
    ))
  )
);
