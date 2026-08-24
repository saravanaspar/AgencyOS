-- HR leave management: leave policies, balances, accrual/carry-forward, draft-to-approval
-- requests, team conflicts, private evidence, cancellation, audit history, and RLS.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('hr', 'leave_type', 'view', 'View organization leave policies.', false),
  ('hr', 'leave_type', 'manage', 'Create and maintain leave policies and accrual rules.', true),
  ('hr', 'leave_balance', 'view', 'View leave balances inside the effective employee scope.', true),
  ('hr', 'leave_balance', 'adjust', 'Apply audited leave-balance adjustments inside the effective employee scope.', true),
  ('hr', 'leave_request', 'view', 'View leave requests and calendar entries inside the effective employee scope.', true),
  ('hr', 'leave_request', 'create', 'Create and submit leave requests for the current employee.', true),
  ('hr', 'leave_request', 'cancel', 'Cancel the current employee leave requests under the leave policy.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('owner', 'hr_manager')
  and permission.module = 'hr'
  and permission.resource in ('leave_type', 'leave_balance', 'leave_request')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'team_lead', permission.id,
  case
    when permission.key in ('hr.leave_balance.view', 'hr.leave_request.view') then 'managed_employees'
    when permission.key in ('hr.leave_request.create', 'hr.leave_request.cancel') then 'own'
    else 'organization'
  end
from public.permissions as permission
where permission.key in (
  'hr.leave_type.view', 'hr.leave_balance.view', 'hr.leave_request.view',
  'hr.leave_request.create', 'hr.leave_request.cancel'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'employee', permission.id,
  case when permission.key = 'hr.leave_type.view' then 'organization' else 'own' end
from public.permissions as permission
where permission.key in (
  'hr.leave_type.view', 'hr.leave_balance.view', 'hr.leave_request.view',
  'hr.leave_request.create', 'hr.leave_request.cancel'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'hr'
  and permission.resource in ('leave_type', 'leave_balance', 'leave_request')
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.hr_leave_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text,
  description text,
  status text not null default 'active',
  is_paid boolean not null default true,
  balance_required boolean not null default true,
  accrual_frequency text not null default 'annual',
  annual_allowance_days numeric(7,2) not null default 0,
  accrual_rate_days numeric(7,2) not null default 0,
  carry_forward_limit_days numeric(7,2) not null default 0,
  attachment_required_after_days numeric(7,2),
  requires_hr_approval boolean not null default false,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_leave_types_name_valid check (char_length(btrim(name)) between 2 and 120),
  constraint hr_leave_types_code_valid check (
    code is null or (code ~ '^[A-Z0-9_-]{1,24}$')
  ),
  constraint hr_leave_types_description_valid check (
    description is null or char_length(description) <= 1000
  ),
  constraint hr_leave_types_status_valid check (status in ('active', 'inactive')),
  constraint hr_leave_types_accrual_frequency_valid check (
    accrual_frequency in ('none', 'monthly', 'annual')
  ),
  constraint hr_leave_types_day_values_valid check (
    annual_allowance_days between 0 and 366
    and accrual_rate_days between 0 and 31
    and carry_forward_limit_days between 0 and 366
    and (attachment_required_after_days is null
      or attachment_required_after_days between 0.5 and 366)
  )
);

create unique index hr_leave_types_name_unique
  on public.hr_leave_types (organization_id, lower(name));
create unique index hr_leave_types_code_unique
  on public.hr_leave_types (organization_id, code) where code is not null;
create index hr_leave_types_status_idx
  on public.hr_leave_types (organization_id, status, lower(name));

create table public.hr_leave_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  leave_type_id uuid not null references public.hr_leave_types(id) on delete cascade,
  balance_year integer not null,
  opening_days numeric(7,2) not null default 0,
  accrued_days numeric(7,2) not null default 0,
  carried_forward_days numeric(7,2) not null default 0,
  adjustment_days numeric(7,2) not null default 0,
  reserved_days numeric(7,2) not null default 0,
  used_days numeric(7,2) not null default 0,
  last_accrued_through date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_leave_balances_year_valid check (balance_year between 2000 and 2200),
  constraint hr_leave_balances_values_valid check (
    opening_days between -366 and 366
    and accrued_days between 0 and 366
    and carried_forward_days between 0 and 366
    and adjustment_days between -366 and 366
    and reserved_days between 0 and 366
    and used_days between 0 and 366
  ),
  unique (organization_id, membership_id, leave_type_id, balance_year)
);

create index hr_leave_balances_member_year_idx
  on public.hr_leave_balances (organization_id, membership_id, balance_year, leave_type_id);

create table public.hr_leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  leave_type_id uuid not null references public.hr_leave_types(id) on delete restrict,
  balance_id uuid references public.hr_leave_balances(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  day_part text not null default 'full_day',
  requested_days numeric(7,2) not null default 0,
  reason text not null,
  status text not null default 'draft',
  team_conflict_count integer not null default 0,
  approval_request_id uuid unique references public.approval_requests(id) on delete set null,
  requested_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  cancelled_by_membership_id uuid references public.memberships(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_leave_requests_dates_valid check (end_date >= start_date),
  constraint hr_leave_requests_day_part_valid check (
    day_part in ('full_day', 'morning', 'afternoon')
  ),
  constraint hr_leave_requests_requested_days_valid check (
    requested_days between 0.5 and 366
  ),
  constraint hr_leave_requests_reason_valid check (
    char_length(btrim(reason)) between 5 and 2000
  ),
  constraint hr_leave_requests_status_valid check (
    status in ('draft', 'pending', 'approved', 'rejected', 'revision_requested',
      'cancelled', 'expired', 'invalidated')
  ),
  constraint hr_leave_requests_conflict_count_valid check (team_conflict_count >= 0)
);

create unique index hr_leave_requests_draft_exact_unique
  on public.hr_leave_requests (
    organization_id, membership_id, leave_type_id, start_date, end_date, day_part
  ) where status = 'draft';
create index hr_leave_requests_member_dates_idx
  on public.hr_leave_requests (organization_id, membership_id, start_date desc, end_date desc);
create index hr_leave_requests_calendar_idx
  on public.hr_leave_requests (organization_id, status, start_date, end_date);

create table public.hr_leave_request_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  leave_request_id uuid not null references public.hr_leave_requests(id) on delete cascade,
  private_file_id uuid not null unique references public.private_files(id) on delete restrict,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  uploaded_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint hr_leave_request_attachments_file_name_valid check (
    btrim(file_name) <> '' and char_length(file_name) <= 180
  ),
  constraint hr_leave_request_attachments_mime_valid check (
    mime_type in ('application/pdf', 'image/jpeg', 'image/png')
  ),
  constraint hr_leave_request_attachments_size_valid check (size_bytes between 1 and 10485760),
  constraint hr_leave_request_attachments_sha_valid check (sha256 ~ '^[a-f0-9]{64}$'),
  unique (leave_request_id)
);

create table public.hr_leave_balance_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  balance_id uuid not null references public.hr_leave_balances(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  leave_type_id uuid not null references public.hr_leave_types(id) on delete cascade,
  balance_year integer not null,
  leave_request_id uuid references public.hr_leave_requests(id) on delete set null,
  event_type text not null,
  opening_delta numeric(7,2) not null default 0,
  accrued_delta numeric(7,2) not null default 0,
  carried_forward_delta numeric(7,2) not null default 0,
  adjustment_delta numeric(7,2) not null default 0,
  reserved_delta numeric(7,2) not null default 0,
  used_delta numeric(7,2) not null default 0,
  reason text,
  actor_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint hr_leave_balance_events_year_valid check (balance_year between 2000 and 2200),
  constraint hr_leave_balance_events_type_valid check (
    event_type in ('opened', 'accrual', 'carry_forward', 'adjustment', 'reserved',
      'reservation_released', 'consumed', 'approved_cancelled')
  ),
  constraint hr_leave_balance_events_reason_valid check (
    reason is null or char_length(btrim(reason)) between 3 and 1000
  )
);

create index hr_leave_balance_events_balance_idx
  on public.hr_leave_balance_events (balance_id, created_at desc);
create index hr_leave_balance_events_member_idx
  on public.hr_leave_balance_events (organization_id, membership_id, balance_year, created_at desc);

create or replace function private.validate_hr_leave_type_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships as membership
    where membership.id in (new.created_by_membership_id, new.updated_by_membership_id)
      and membership.organization_id = new.organization_id
    group by membership.organization_id
    having count(distinct membership.id) = case
      when new.created_by_membership_id = new.updated_by_membership_id then 1 else 2 end
  ) then
    raise exception using errcode = '23514', message = 'Leave policy actors must belong to the organization.';
  end if;
  return new;
end;
$$;

create trigger hr_leave_types_validate_tenant
  before insert or update on public.hr_leave_types
  for each row execute function private.validate_hr_leave_type_tenant();
create trigger hr_leave_types_set_updated_at
  before update on public.hr_leave_types
  for each row execute function private.set_updated_at();

create or replace function private.validate_hr_leave_balance_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.membership_id
      and membership.organization_id = new.organization_id
  ) or not exists (
    select 1 from public.hr_leave_types as leave_type
    where leave_type.id = new.leave_type_id
      and leave_type.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Leave balance references must belong to the organization.';
  end if;
  return new;
end;
$$;

create trigger hr_leave_balances_validate_tenant
  before insert or update on public.hr_leave_balances
  for each row execute function private.validate_hr_leave_balance_tenant();
create trigger hr_leave_balances_set_updated_at
  before update on public.hr_leave_balances
  for each row execute function private.set_updated_at();

create or replace function private.refresh_hr_leave_balance(
  p_organization_id uuid,
  p_membership_id uuid,
  p_leave_type_id uuid,
  p_balance_year integer,
  p_actor_membership_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.hr_leave_types%rowtype;
  v_joining_date date;
  v_balance public.hr_leave_balances%rowtype;
  v_previous_available numeric(7,2) := 0;
  v_carried numeric(7,2) := 0;
  v_target_accrual numeric(7,2) := 0;
  v_accrual_delta numeric(7,2) := 0;
  v_start_month date;
  v_end_month date;
  v_month_count integer := 0;
  v_current_date date;
begin
  if p_balance_year < 2000 or p_balance_year > 2200 then
    raise exception using errcode = '22023', message = 'Leave balance year is invalid.';
  end if;
  if not exists (
    select 1 from public.memberships
    where id = p_membership_id and organization_id = p_organization_id
  ) or not exists (
    select 1 from public.memberships
    where id = p_actor_membership_id and organization_id = p_organization_id
  ) then
    raise exception using errcode = '23514', message = 'Leave balance members must belong to the organization.';
  end if;

  select leave_type.* into v_type
  from public.hr_leave_types as leave_type
  where leave_type.id = p_leave_type_id
    and leave_type.organization_id = p_organization_id
  for share;
  if not found then
    raise exception using errcode = '23503', message = 'Leave type was not found.';
  end if;

  select employee.joining_date into v_joining_date
  from public.hr_employee_profiles as employee
  where employee.organization_id = p_organization_id
    and employee.membership_id = p_membership_id;

  select greatest(
    coalesce(previous.opening_days, 0) + coalesce(previous.accrued_days, 0)
      + coalesce(previous.carried_forward_days, 0) + coalesce(previous.adjustment_days, 0)
      - coalesce(previous.reserved_days, 0) - coalesce(previous.used_days, 0),
    0
  ) into v_previous_available
  from public.hr_leave_balances as previous
  where previous.organization_id = p_organization_id
    and previous.membership_id = p_membership_id
    and previous.leave_type_id = p_leave_type_id
    and previous.balance_year = p_balance_year - 1;
  v_previous_available := coalesce(v_previous_available, 0);
  v_carried := least(v_previous_available, v_type.carry_forward_limit_days);

  insert into public.hr_leave_balances (
    organization_id, membership_id, leave_type_id, balance_year, carried_forward_days
  ) values (
    p_organization_id, p_membership_id, p_leave_type_id, p_balance_year, v_carried
  )
  on conflict (organization_id, membership_id, leave_type_id, balance_year) do nothing;

  select balance.* into v_balance
  from public.hr_leave_balances as balance
  where balance.organization_id = p_organization_id
    and balance.membership_id = p_membership_id
    and balance.leave_type_id = p_leave_type_id
    and balance.balance_year = p_balance_year
  for update;

  if v_balance.carried_forward_days > 0 and not exists (
    select 1 from public.hr_leave_balance_events as event
    where event.balance_id = v_balance.id and event.event_type = 'carry_forward'
  ) then
    insert into public.hr_leave_balance_events (
      organization_id, balance_id, membership_id, leave_type_id, balance_year,
      event_type, carried_forward_delta, reason, actor_membership_id
    ) values (
      p_organization_id, v_balance.id, p_membership_id, p_leave_type_id, p_balance_year,
      'carry_forward', v_balance.carried_forward_days, 'Automatic carry-forward',
      p_actor_membership_id
    );
  end if;

  select timezone(organization.timezone, now())::date into v_current_date
  from public.organizations as organization where organization.id = p_organization_id;

  if v_type.accrual_frequency = 'annual'
    and v_current_date >= make_date(p_balance_year, 1, 1)
    and coalesce(v_joining_date, make_date(p_balance_year, 1, 1)) <= make_date(p_balance_year, 12, 31)
  then
    v_target_accrual := v_type.annual_allowance_days;
  elsif v_type.accrual_frequency = 'monthly' then
    v_start_month := date_trunc('month', greatest(
      make_date(p_balance_year, 1, 1),
      coalesce(v_joining_date, make_date(p_balance_year, 1, 1))
    ))::date;
    v_end_month := date_trunc('month', least(v_current_date, make_date(p_balance_year, 12, 31)))::date;
    if v_end_month >= v_start_month then
      v_month_count := (
        extract(year from age(v_end_month, v_start_month))::integer * 12
        + extract(month from age(v_end_month, v_start_month))::integer + 1
      );
      v_target_accrual := v_month_count * v_type.accrual_rate_days;
      if v_type.annual_allowance_days > 0 then
        v_target_accrual := least(v_target_accrual, v_type.annual_allowance_days);
      end if;
    end if;
  end if;

  v_accrual_delta := greatest(v_target_accrual - v_balance.accrued_days, 0);
  if v_accrual_delta > 0 then
    update public.hr_leave_balances
    set accrued_days = accrued_days + v_accrual_delta,
        last_accrued_through = least(v_current_date, make_date(p_balance_year, 12, 31)),
        updated_at = now()
    where id = v_balance.id;
    insert into public.hr_leave_balance_events (
      organization_id, balance_id, membership_id, leave_type_id, balance_year,
      event_type, accrued_delta, reason, actor_membership_id
    ) values (
      p_organization_id, v_balance.id, p_membership_id, p_leave_type_id, p_balance_year,
      'accrual', v_accrual_delta, 'Automatic ' || v_type.accrual_frequency || ' accrual',
      p_actor_membership_id
    );
  end if;

  if not exists (
    select 1 from public.hr_leave_balance_events as event
    where event.balance_id = v_balance.id and event.event_type = 'opened'
  ) then
    insert into public.hr_leave_balance_events (
      organization_id, balance_id, membership_id, leave_type_id, balance_year,
      event_type, reason, actor_membership_id
    ) values (
      p_organization_id, v_balance.id, p_membership_id, p_leave_type_id, p_balance_year,
      'opened', 'Balance opened', p_actor_membership_id
    );
  end if;

  return v_balance.id;
end;
$$;

create or replace function private.validate_hr_leave_request()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_business_days numeric(7,2);
  v_department_id uuid;
  v_balance_required boolean;
  v_current_date date;
begin
  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.membership_id
      and membership.organization_id = new.organization_id
  ) or new.requested_by_membership_id <> new.membership_id then
    raise exception using errcode = '23514', message = 'Leave requester must match an organization employee.';
  end if;

  select leave_type.balance_required into v_balance_required
  from public.hr_leave_types as leave_type
  where leave_type.id = new.leave_type_id
    and leave_type.organization_id = new.organization_id
    and (tg_op = 'UPDATE' or leave_type.status = 'active');
  if not found then
    raise exception using errcode = '23503', message = 'Active leave type was not found.';
  end if;

  if extract(year from new.start_date) <> extract(year from new.end_date) then
    raise exception using errcode = '23514', message = 'A leave request must stay inside one calendar year.';
  end if;
  if new.day_part <> 'full_day' and new.start_date <> new.end_date then
    raise exception using errcode = '23514', message = 'Half-day leave must use one date.';
  end if;

  select count(*)::numeric into v_business_days
  from generate_series(new.start_date, new.end_date, interval '1 day') as day
  where extract(isodow from day) between 1 and 5;
  if new.day_part <> 'full_day' then v_business_days := 0.5; end if;
  if v_business_days < 0.5 then
    raise exception using errcode = '23514', message = 'Leave must include at least one weekday.';
  end if;
  new.requested_days := v_business_days;

  select timezone(organization.timezone, now())::date into v_current_date
  from public.organizations as organization where organization.id = new.organization_id;
  if tg_op = 'INSERT' and new.start_date < v_current_date then
    raise exception using errcode = '23514', message = 'New leave requests cannot start in the past.';
  end if;

  if v_balance_required and new.balance_id is not null and not exists (
    select 1 from public.hr_leave_balances as balance
    where balance.id = new.balance_id
      and balance.organization_id = new.organization_id
      and balance.membership_id = new.membership_id
      and balance.leave_type_id = new.leave_type_id
      and balance.balance_year = extract(year from new.start_date)::integer
  ) then
    raise exception using errcode = '23514', message = 'Leave balance does not match the request.';
  end if;

  if new.status in ('pending', 'approved') then
    perform pg_advisory_xact_lock(hashtextextended(
      new.organization_id::text || ':leave:' || new.membership_id::text, 0
    ));
    if exists (
      select 1 from public.hr_leave_requests as existing
      where existing.organization_id = new.organization_id
        and existing.membership_id = new.membership_id
        and existing.id <> new.id
        and existing.status in ('pending', 'approved')
        and daterange(existing.start_date, existing.end_date, '[]')
          && daterange(new.start_date, new.end_date, '[]')
    ) then
      raise exception using errcode = '23505', message = 'Leave overlaps an existing request.';
    end if;
  end if;

  select membership.department_id into v_department_id
  from public.memberships as membership where membership.id = new.membership_id;
  select count(*)::integer into new.team_conflict_count
  from public.hr_leave_requests as conflict
  join public.memberships as conflict_member on conflict_member.id = conflict.membership_id
  where conflict.organization_id = new.organization_id
    and conflict.id <> new.id
    and conflict.membership_id <> new.membership_id
    and conflict.status in ('pending', 'approved')
    and v_department_id is not null
    and conflict_member.department_id = v_department_id
    and daterange(conflict.start_date, conflict.end_date, '[]')
      && daterange(new.start_date, new.end_date, '[]');
  return new;
end;
$$;

create trigger hr_leave_requests_validate
  before insert or update on public.hr_leave_requests
  for each row execute function private.validate_hr_leave_request();
create trigger hr_leave_requests_set_updated_at
  before update on public.hr_leave_requests
  for each row execute function private.set_updated_at();

create or replace function private.validate_hr_leave_attachment_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.hr_leave_requests as request
    where request.id = new.leave_request_id
      and request.organization_id = new.organization_id
  ) or not exists (
    select 1 from public.private_files as file
    where file.id = new.private_file_id
      and file.organization_id = new.organization_id
      and file.module_key = 'hr'
      and file.entity_type = 'hr_leave_request'
      and file.entity_id = new.leave_request_id
  ) or not exists (
    select 1 from public.memberships as membership
    where membership.id = new.uploaded_by_membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Leave attachment references must belong to the organization.';
  end if;
  return new;
end;
$$;

create trigger hr_leave_request_attachments_validate_tenant
  before insert or update on public.hr_leave_request_attachments
  for each row execute function private.validate_hr_leave_attachment_tenant();

create or replace function private.validate_hr_leave_balance_event_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.hr_leave_balances as balance
    where balance.id = new.balance_id
      and balance.organization_id = new.organization_id
      and balance.membership_id = new.membership_id
      and balance.leave_type_id = new.leave_type_id
      and balance.balance_year = new.balance_year
  ) or not exists (
    select 1 from public.memberships as actor
    where actor.id = new.actor_membership_id
      and actor.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Leave balance event references are inconsistent.';
  end if;
  return new;
end;
$$;

create trigger hr_leave_balance_events_validate_tenant
  before insert or update on public.hr_leave_balance_events
  for each row execute function private.validate_hr_leave_balance_event_tenant();

create or replace function private.sync_hr_leave_request_from_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.hr_leave_requests%rowtype;
  v_type public.hr_leave_types%rowtype;
  v_actor_membership_id uuid;
  v_actor_user_id uuid;
begin
  if new.source_module <> 'hr'
    or new.entity_type <> 'leave_request'
    or new.status = old.status
    or new.status = 'pending' then
    return new;
  end if;

  select request.* into v_request
  from public.hr_leave_requests as request
  where request.approval_request_id = new.id
  for update;
  if not found or v_request.status <> 'pending' then return new; end if;

  select leave_type.* into v_type from public.hr_leave_types as leave_type
  where leave_type.id = v_request.leave_type_id;

  select action.actor_membership_id into v_actor_membership_id
  from public.approval_actions as action
  where action.request_id = new.id
    and action.action in ('approved', 'rejected', 'revision_requested', 'cancelled', 'expired', 'invalidated')
  order by action.created_at desc, action.id desc
  limit 1;
  v_actor_membership_id := coalesce(v_actor_membership_id, v_request.requested_by_membership_id);

  select membership.user_id into v_actor_user_id
  from public.memberships as membership
  where membership.id = v_actor_membership_id
    and membership.organization_id = v_request.organization_id;

  if v_type.balance_required and v_request.balance_id is not null then
    perform 1 from public.hr_leave_balances where id = v_request.balance_id for update;
    if new.status = 'approved' then
      update public.hr_leave_balances
      set reserved_days = greatest(reserved_days - v_request.requested_days, 0),
          used_days = used_days + v_request.requested_days,
          updated_at = now()
      where id = v_request.balance_id;
      insert into public.hr_leave_balance_events (
        organization_id, balance_id, membership_id, leave_type_id, balance_year,
        leave_request_id, event_type, reserved_delta, used_delta, reason,
        actor_membership_id
      ) values (
        v_request.organization_id, v_request.balance_id, v_request.membership_id,
        v_request.leave_type_id, extract(year from v_request.start_date)::integer,
        v_request.id, 'consumed', -v_request.requested_days, v_request.requested_days,
        'Leave request approved', v_actor_membership_id
      );
    else
      update public.hr_leave_balances
      set reserved_days = greatest(reserved_days - v_request.requested_days, 0),
          updated_at = now()
      where id = v_request.balance_id;
      insert into public.hr_leave_balance_events (
        organization_id, balance_id, membership_id, leave_type_id, balance_year,
        leave_request_id, event_type, reserved_delta, reason, actor_membership_id
      ) values (
        v_request.organization_id, v_request.balance_id, v_request.membership_id,
        v_request.leave_type_id, extract(year from v_request.start_date)::integer,
        v_request.id, 'reservation_released', -v_request.requested_days,
        'Leave request ' || new.status, v_actor_membership_id
      );
    end if;
  end if;

  update public.hr_leave_requests
  set status = new.status,
      cancelled_by_membership_id = case when new.status = 'cancelled' then v_actor_membership_id else cancelled_by_membership_id end,
      cancelled_at = case when new.status = 'cancelled' then now() else cancelled_at end
  where id = v_request.id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, source, metadata
  ) values (
    v_request.organization_id, v_actor_user_id, 'hr.leave_request_' || new.status,
    'hr_leave_request', v_request.id::text, 'approval',
    jsonb_build_object(
      'approvalRequestId', new.id,
      'membershipId', v_request.membership_id,
      'leaveTypeId', v_request.leave_type_id,
      'startDate', v_request.start_date,
      'endDate', v_request.end_date,
      'requestedDays', v_request.requested_days
    )
  );
  return new;
end;
$$;

create trigger approval_requests_sync_hr_leave_request
  after update of status on public.approval_requests
  for each row execute function private.sync_hr_leave_request_from_approval();

-- Seed current-year balances for existing employee profiles and active leave types when rows appear.
create or replace function private.seed_hr_leave_balances_for_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member record;
  v_year integer;
begin
  if new.status <> 'active' then return new; end if;
  select extract(year from timezone(organization.timezone, now()))::integer into v_year
  from public.organizations as organization where organization.id = new.organization_id;
  for v_member in
    select employee.membership_id
    from public.hr_employee_profiles as employee
    join public.memberships as membership on membership.id = employee.membership_id
    where employee.organization_id = new.organization_id and membership.status = 'active'
  loop
    perform private.refresh_hr_leave_balance(
      new.organization_id, v_member.membership_id, new.id, v_year,
      new.created_by_membership_id
    );
  end loop;
  return new;
end;
$$;

create trigger hr_leave_types_seed_balances
  after insert on public.hr_leave_types
  for each row execute function private.seed_hr_leave_balances_for_type();

create or replace function private.seed_hr_leave_balances_for_employee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type record;
  v_year integer;
begin
  select extract(year from timezone(organization.timezone, now()))::integer into v_year
  from public.organizations as organization where organization.id = new.organization_id;
  for v_type in
    select leave_type.id
    from public.hr_leave_types as leave_type
    where leave_type.organization_id = new.organization_id and leave_type.status = 'active'
  loop
    perform private.refresh_hr_leave_balance(
      new.organization_id, new.membership_id, v_type.id, v_year,
      new.updated_by_membership_id
    );
  end loop;
  return new;
end;
$$;

create trigger hr_employee_profiles_seed_leave_balances
  after insert on public.hr_employee_profiles
  for each row execute function private.seed_hr_leave_balances_for_employee();

alter table public.hr_leave_types enable row level security;
alter table public.hr_leave_balances enable row level security;
alter table public.hr_leave_requests enable row level security;
alter table public.hr_leave_request_attachments enable row level security;
alter table public.hr_leave_balance_events enable row level security;

revoke all on public.hr_leave_types from public, anon, authenticated;
revoke all on public.hr_leave_balances from public, anon, authenticated;
revoke all on public.hr_leave_requests from public, anon, authenticated;
revoke all on public.hr_leave_request_attachments from public, anon, authenticated;
revoke all on public.hr_leave_balance_events from public, anon, authenticated;
grant select on public.hr_leave_types to authenticated;
grant select on public.hr_leave_balances to authenticated;
grant select on public.hr_leave_requests to authenticated;
grant select on public.hr_leave_request_attachments to authenticated;
grant select on public.hr_leave_balance_events to authenticated;
grant all on public.hr_leave_types to service_role;
grant all on public.hr_leave_balances to service_role;
grant all on public.hr_leave_requests to service_role;
grant all on public.hr_leave_request_attachments to service_role;
grant all on public.hr_leave_balance_events to service_role;

create policy hr_leave_types_select_authorized
on public.hr_leave_types for select to authenticated
using (
  private.has_permission(organization_id, 'hr.workspace.view')
  and private.has_permission(organization_id, 'hr.leave_type.view')
);

create policy hr_leave_types_insert_authorized
on public.hr_leave_types for insert to authenticated
with check (private.has_permission(organization_id, 'hr.leave_type.manage'));
create policy hr_leave_types_update_authorized
on public.hr_leave_types for update to authenticated
using (private.has_permission(organization_id, 'hr.leave_type.manage'))
with check (private.has_permission(organization_id, 'hr.leave_type.manage'));

create policy hr_leave_balances_select_authorized
on public.hr_leave_balances for select to authenticated
using (
  private.has_permission(organization_id, 'hr.leave_balance.view')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.leave_balance.view'),
    membership_id,
    membership_id
  )
);

create policy hr_leave_requests_select_authorized
on public.hr_leave_requests for select to authenticated
using (
  private.has_permission(organization_id, 'hr.leave_request.view')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.leave_request.view'),
    membership_id,
    membership_id
  )
);

create policy hr_leave_requests_insert_authorized
on public.hr_leave_requests for insert to authenticated
with check (
  private.has_permission(organization_id, 'hr.leave_request.create')
  and membership_id = private.current_membership_id(organization_id)
  and requested_by_membership_id = private.current_membership_id(organization_id)
  and status = 'draft'
);

create policy hr_leave_request_attachments_select_authorized
on public.hr_leave_request_attachments for select to authenticated
using (
  exists (
    select 1 from public.hr_leave_requests as request
    where request.id = leave_request_id
      and request.organization_id = organization_id
      and private.has_permission(organization_id, 'hr.leave_request.view')
      and private.crm_scope_allows_membership(
        private.current_membership_id(organization_id),
        private.effective_permission_scope(organization_id, 'hr.leave_request.view'),
        request.membership_id,
        request.membership_id
      )
  )
);

create policy hr_leave_balance_events_select_authorized
on public.hr_leave_balance_events for select to authenticated
using (
  private.has_permission(organization_id, 'hr.leave_balance.view')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.leave_balance.view'),
    membership_id,
    membership_id
  )
);
