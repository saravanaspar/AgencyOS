-- HR attendance: self check-in/out, manager-entered records, correction approvals,
-- monthly summaries, tenant validation, immutable audit evidence, and RLS.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('hr', 'attendance', 'view', 'View attendance records and correction status inside the effective employee scope.', true),
  ('hr', 'attendance', 'check', 'Check in and check out the current employee.', true),
  ('hr', 'attendance', 'manage', 'Create or update attendance records inside the effective employee scope.', true),
  ('hr', 'attendance_correction', 'create', 'Submit an attendance correction request for the current employee.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('owner', 'hr_manager')
  and permission.key in (
    'hr.attendance.view', 'hr.attendance.check', 'hr.attendance.manage',
    'hr.attendance_correction.create'
  )
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'team_lead', permission.id,
  case
    when permission.key in ('hr.attendance.view', 'hr.attendance.manage') then 'managed_employees'
    else 'own'
  end
from public.permissions as permission
where permission.key in (
  'hr.attendance.view', 'hr.attendance.check', 'hr.attendance.manage',
  'hr.attendance_correction.create'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'employee', permission.id, 'own'
from public.permissions as permission
where permission.key in (
  'hr.attendance.view', 'hr.attendance.check', 'hr.attendance_correction.create'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'hr'
  and permission.resource in ('attendance', 'attendance_correction')
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.hr_attendance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  attendance_date date not null,
  check_in_at timestamptz,
  check_out_at timestamptz,
  attendance_status text not null default 'present',
  late_minutes integer not null default 0,
  early_departure_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  notes text,
  source text not null default 'self',
  revision integer not null default 1,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_attendance_records_status_valid check (
    attendance_status in ('present', 'work_from_home', 'half_day', 'absent')
  ),
  constraint hr_attendance_records_source_valid check (source in ('self', 'manual', 'correction')),
  constraint hr_attendance_records_time_order check (
    check_in_at is null or check_out_at is null or check_out_at > check_in_at
  ),
  constraint hr_attendance_records_minutes_valid check (
    late_minutes between 0 and 1440
    and early_departure_minutes between 0 and 1440
    and overtime_minutes between 0 and 1440
  ),
  constraint hr_attendance_records_notes_length check (notes is null or char_length(notes) <= 2000),
  constraint hr_attendance_records_revision_positive check (revision > 0),
  unique (organization_id, membership_id, attendance_date)
);

create index hr_attendance_records_member_date_idx
  on public.hr_attendance_records (organization_id, membership_id, attendance_date desc);
create index hr_attendance_records_date_status_idx
  on public.hr_attendance_records (organization_id, attendance_date desc, attendance_status);

create table public.hr_attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  attendance_record_id uuid references public.hr_attendance_records(id) on delete set null,
  attendance_date date not null,
  proposed_check_in_at timestamptz,
  proposed_check_out_at timestamptz,
  proposed_attendance_status text not null,
  proposed_late_minutes integer not null default 0,
  proposed_early_departure_minutes integer not null default 0,
  proposed_overtime_minutes integer not null default 0,
  proposed_notes text,
  reason text not null,
  status text not null default 'pending',
  approval_request_id uuid unique references public.approval_requests(id) on delete set null,
  requested_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  reviewed_by_membership_id uuid references public.memberships(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_attendance_corrections_status_valid check (
    proposed_attendance_status in ('present', 'work_from_home', 'half_day', 'absent')
  ),
  constraint hr_attendance_corrections_time_order check (
    proposed_check_in_at is null or proposed_check_out_at is null
    or proposed_check_out_at > proposed_check_in_at
  ),
  constraint hr_attendance_corrections_minutes_valid check (
    proposed_late_minutes between 0 and 1440
    and proposed_early_departure_minutes between 0 and 1440
    and proposed_overtime_minutes between 0 and 1440
  ),
  constraint hr_attendance_corrections_notes_length check (
    proposed_notes is null or char_length(proposed_notes) <= 2000
  ),
  constraint hr_attendance_corrections_reason_length check (
    char_length(btrim(reason)) between 5 and 2000
  ),
  constraint hr_attendance_corrections_state_valid check (
    status in ('pending', 'approved', 'rejected', 'revision_requested', 'cancelled', 'expired', 'invalidated')
  )
);

create unique index hr_attendance_corrections_pending_unique
  on public.hr_attendance_corrections (organization_id, membership_id, attendance_date)
  where status = 'pending';
create index hr_attendance_corrections_member_date_idx
  on public.hr_attendance_corrections (organization_id, membership_id, attendance_date desc);
create index hr_attendance_corrections_status_idx
  on public.hr_attendance_corrections (organization_id, status, created_at desc);

create or replace function private.validate_hr_attendance_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Attendance employee must belong to the organization.';
  end if;

  if not exists (
    select 1 from public.memberships as membership
    where membership.id in (new.created_by_membership_id, new.updated_by_membership_id)
      and membership.organization_id = new.organization_id
    group by membership.organization_id
    having count(distinct membership.id) = case
      when new.created_by_membership_id = new.updated_by_membership_id then 1 else 2 end
  ) then
    raise exception using errcode = '23514', message = 'Attendance actors must belong to the organization.';
  end if;
  return new;
end;
$$;

create trigger hr_attendance_records_validate_tenant
  before insert or update on public.hr_attendance_records
  for each row execute function private.validate_hr_attendance_tenant();
create trigger hr_attendance_records_set_updated_at
  before update on public.hr_attendance_records
  for each row execute function private.set_updated_at();

create or replace function private.validate_hr_attendance_correction_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Correction employee must belong to the organization.';
  end if;
  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.requested_by_membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Correction requester must belong to the organization.';
  end if;
  if new.reviewed_by_membership_id is not null and not exists (
    select 1 from public.memberships as membership
    where membership.id = new.reviewed_by_membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Correction reviewer must belong to the organization.';
  end if;
  if new.attendance_record_id is not null and not exists (
    select 1 from public.hr_attendance_records as attendance
    where attendance.id = new.attendance_record_id
      and attendance.organization_id = new.organization_id
      and attendance.membership_id = new.membership_id
      and attendance.attendance_date = new.attendance_date
  ) then
    raise exception using errcode = '23514', message = 'Correction attendance record must match its employee and date.';
  end if;
  return new;
end;
$$;

create trigger hr_attendance_corrections_validate_tenant
  before insert or update on public.hr_attendance_corrections
  for each row execute function private.validate_hr_attendance_correction_tenant();
create trigger hr_attendance_corrections_set_updated_at
  before update on public.hr_attendance_corrections
  for each row execute function private.set_updated_at();

create or replace function private.sync_hr_attendance_correction_from_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_correction public.hr_attendance_corrections%rowtype;
  v_actor_membership_id uuid;
  v_actor_user_id uuid;
  v_attendance_id uuid;
begin
  if new.source_module <> 'hr'
    or new.entity_type <> 'attendance_correction'
    or new.status = old.status
    or new.status = 'pending' then
    return new;
  end if;

  select correction.* into v_correction
  from public.hr_attendance_corrections as correction
  where correction.approval_request_id = new.id
  for update;
  if not found then return new; end if;

  select action.actor_membership_id into v_actor_membership_id
  from public.approval_actions as action
  where action.request_id = new.id
    and action.action in ('approved', 'rejected', 'revision_requested', 'cancelled')
  order by action.created_at desc, action.id desc
  limit 1;
  v_actor_membership_id := coalesce(v_actor_membership_id, v_correction.requested_by_membership_id);

  select membership.user_id into v_actor_user_id
  from public.memberships as membership
  where membership.id = v_actor_membership_id
    and membership.organization_id = v_correction.organization_id;

  if new.status = 'approved' then
    insert into public.hr_attendance_records (
      organization_id, membership_id, attendance_date, check_in_at, check_out_at,
      attendance_status, late_minutes, early_departure_minutes, overtime_minutes,
      notes, source, created_by_membership_id, updated_by_membership_id
    ) values (
      v_correction.organization_id, v_correction.membership_id, v_correction.attendance_date,
      v_correction.proposed_check_in_at, v_correction.proposed_check_out_at,
      v_correction.proposed_attendance_status, v_correction.proposed_late_minutes,
      v_correction.proposed_early_departure_minutes, v_correction.proposed_overtime_minutes,
      v_correction.proposed_notes, 'correction', v_correction.requested_by_membership_id,
      v_actor_membership_id
    )
    on conflict (organization_id, membership_id, attendance_date) do update set
      check_in_at = excluded.check_in_at,
      check_out_at = excluded.check_out_at,
      attendance_status = excluded.attendance_status,
      late_minutes = excluded.late_minutes,
      early_departure_minutes = excluded.early_departure_minutes,
      overtime_minutes = excluded.overtime_minutes,
      notes = excluded.notes,
      source = 'correction',
      revision = public.hr_attendance_records.revision + 1,
      updated_by_membership_id = excluded.updated_by_membership_id
    returning id into v_attendance_id;
  end if;

  update public.hr_attendance_corrections
  set status = new.status,
      attendance_record_id = coalesce(v_attendance_id, attendance_record_id),
      reviewed_by_membership_id = v_actor_membership_id,
      reviewed_at = now()
  where id = v_correction.id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, source, metadata
  ) values (
    v_correction.organization_id, v_actor_user_id,
    'hr.attendance_correction_' || new.status,
    'hr_attendance_correction', v_correction.id::text, 'approval',
    jsonb_build_object(
      'approvalRequestId', new.id,
      'membershipId', v_correction.membership_id,
      'attendanceDate', v_correction.attendance_date,
      'attendanceRecordId', v_attendance_id
    )
  );
  return new;
end;
$$;

create trigger approval_requests_sync_hr_attendance_correction
  after update of status on public.approval_requests
  for each row execute function private.sync_hr_attendance_correction_from_approval();

alter table public.hr_attendance_records enable row level security;
alter table public.hr_attendance_corrections enable row level security;

revoke all on public.hr_attendance_records from public, anon, authenticated;
revoke all on public.hr_attendance_corrections from public, anon, authenticated;
grant select on public.hr_attendance_records to authenticated;
grant select on public.hr_attendance_corrections to authenticated;
grant all on public.hr_attendance_records to service_role;
grant all on public.hr_attendance_corrections to service_role;

create policy hr_attendance_records_select_authorized
on public.hr_attendance_records for select to authenticated
using (
  private.has_permission(organization_id, 'hr.workspace.view')
  and private.has_permission(organization_id, 'hr.attendance.view')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.attendance.view'),
    membership_id,
    membership_id
  )
);

create policy hr_attendance_records_insert_authorized
on public.hr_attendance_records for insert to authenticated
with check (
  (
    membership_id = private.current_membership_id(organization_id)
    and private.has_permission(organization_id, 'hr.attendance.check')
  )
  or (
    private.has_permission(organization_id, 'hr.attendance.manage')
    and private.crm_scope_allows_membership(
      private.current_membership_id(organization_id),
      private.effective_permission_scope(organization_id, 'hr.attendance.manage'),
      membership_id,
      membership_id
    )
  )
);

create policy hr_attendance_records_update_authorized
on public.hr_attendance_records for update to authenticated
using (
  private.has_permission(organization_id, 'hr.attendance.manage')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.attendance.manage'),
    membership_id,
    membership_id
  )
)
with check (
  private.has_permission(organization_id, 'hr.attendance.manage')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.attendance.manage'),
    membership_id,
    membership_id
  )
);

create policy hr_attendance_corrections_select_authorized
on public.hr_attendance_corrections for select to authenticated
using (
  private.has_permission(organization_id, 'hr.workspace.view')
  and private.has_permission(organization_id, 'hr.attendance.view')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.attendance.view'),
    membership_id,
    membership_id
  )
);

create policy hr_attendance_corrections_insert_authorized
on public.hr_attendance_corrections for insert to authenticated
with check (
  private.has_permission(organization_id, 'hr.attendance_correction.create')
  and membership_id = private.current_membership_id(organization_id)
  and requested_by_membership_id = private.current_membership_id(organization_id)
);
