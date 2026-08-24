-- Complete the second-stage project planning, collaboration, closure, and reporting model.

set lock_timeout = '10s';
set statement_timeout = '120s';

alter table public.projects
  add column closure_status text not null default 'open',
  add column closure_notes text,
  add column closure_requested_at timestamptz,
  add column closure_requested_by_membership_id uuid references public.memberships(id) on delete set null,
  add column closed_at timestamptz,
  add column closed_by_membership_id uuid references public.memberships(id) on delete set null,
  add constraint projects_closure_status_valid check (closure_status in ('open', 'requested', 'closed'));

update public.projects
set closure_status = 'closed',
    closure_requested_at = coalesce(closure_requested_at, completed_at, updated_at),
    closed_at = coalesce(closed_at, completed_at, updated_at)
where status = 'completed';

create index projects_org_archive_updated_idx
on public.projects (organization_id, archived_at, updated_at desc);
create index projects_closure_status_idx
on public.projects (organization_id, closure_status, updated_at desc);

create table public.project_phases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  description text,
  position integer not null,
  status text not null default 'planned',
  start_date date,
  due_date date,
  completed_at timestamptz,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_phases_name_not_blank check (btrim(name) <> ''),
  constraint project_phases_position_positive check (position > 0),
  constraint project_phases_status_valid check (status in ('planned', 'active', 'completed', 'cancelled')),
  constraint project_phases_dates_valid check (due_date is null or start_date is null or due_date >= start_date),
  unique (project_id, position)
);

create unique index project_phases_name_unique_idx
on public.project_phases (project_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

create table public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.project_phases(id) on delete set null,
  name text not null,
  description text,
  due_date date,
  status text not null default 'open',
  completed_at timestamptz,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_milestones_name_not_blank check (btrim(name) <> ''),
  constraint project_milestones_status_valid check (status in ('open', 'completed', 'cancelled'))
);

create unique index project_milestones_name_unique_idx
on public.project_milestones (project_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')))
where status <> 'cancelled';
create index project_milestones_due_idx on public.project_milestones (project_id, due_date) where due_date is not null;

create table public.project_labels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  color text not null default '#2563eb',
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint project_labels_name_not_blank check (btrim(name) <> ''),
  constraint project_labels_color_valid check (color ~ '^#[0-9A-Fa-f]{6}$')
);

create unique index project_labels_name_unique_idx
on public.project_labels (project_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

create table public.project_task_labels (
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  label_id uuid not null references public.project_labels(id) on delete cascade,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (task_id, label_id)
);

create index project_task_labels_label_idx on public.project_task_labels (label_id, task_id);

create table public.project_task_watchers (
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (task_id, membership_id)
);

create index project_task_watchers_membership_idx on public.project_task_watchers (membership_id, task_id);

create table public.project_task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  label text not null,
  position integer not null,
  is_required boolean not null default true,
  is_completed boolean not null default false,
  completed_at timestamptz,
  completed_by_membership_id uuid references public.memberships(id) on delete set null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_task_checklist_label_not_blank check (btrim(label) <> ''),
  constraint project_task_checklist_position_positive check (position > 0),
  unique (task_id, position)
);

create table public.project_task_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  uploaded_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint project_task_attachments_file_name_not_blank check (btrim(file_name) <> ''),
  constraint project_task_attachments_path_not_blank check (btrim(storage_path) <> ''),
  constraint project_task_attachments_size_valid check (size_bytes between 1 and 10485760),
  constraint project_task_attachments_sha_valid check (sha256 ~ '^[0-9a-f]{64}$'),
  unique (task_id, sha256)
);

create index project_task_attachments_task_idx on public.project_task_attachments (task_id, created_at desc);

create table public.project_task_recurrences (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  template_task_id uuid not null references public.project_tasks(id) on delete cascade,
  interval_unit text not null,
  interval_count integer not null default 1,
  next_run_on date not null,
  end_on date,
  is_active boolean not null default true,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_task_recurrences_unit_valid check (interval_unit in ('day', 'week', 'month')),
  constraint project_task_recurrences_interval_valid check (interval_count between 1 and 365),
  constraint project_task_recurrences_dates_valid check (end_on is null or end_on >= next_run_on),
  unique (template_task_id)
);

create index project_task_recurrences_due_idx
on public.project_task_recurrences (project_id, next_run_on)
where is_active;

alter table public.project_tasks
  add column phase_id uuid references public.project_phases(id) on delete set null,
  add column milestone_id uuid references public.project_milestones(id) on delete set null,
  add column recurrence_id uuid references public.project_task_recurrences(id) on delete set null;

create index project_tasks_phase_idx on public.project_tasks (phase_id, status_id) where phase_id is not null;
create index project_tasks_milestone_idx on public.project_tasks (milestone_id, status_id) where milestone_id is not null;
create index project_tasks_parent_idx on public.project_tasks (parent_task_id) where parent_task_id is not null;
create index project_tasks_recurrence_idx on public.project_tasks (recurrence_id) where recurrence_id is not null;

create table public.project_closure_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  label text not null,
  position integer not null,
  is_required boolean not null default true,
  is_completed boolean not null default false,
  completed_at timestamptz,
  completed_by_membership_id uuid references public.memberships(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_closure_items_label_not_blank check (btrim(label) <> ''),
  constraint project_closure_items_position_positive check (position > 0),
  unique (project_id, position)
);

create or replace function private.seed_project_closure_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_closure_items (project_id, label, position, is_required)
  values
    (new.id, 'All required tasks are completed or cancelled', 1, true),
    (new.id, 'Time entries and delivery effort are reviewed', 2, true),
    (new.id, 'Client or internal deliverables are confirmed', 3, true),
    (new.id, 'Outstanding follow-ups are recorded', 4, true);
  return new;
end;
$$;

insert into public.project_closure_items (project_id, label, position, is_required)
select project.id, item.label, item.position, true
from public.projects as project
cross join (values
  ('All required tasks are completed or cancelled', 1),
  ('Time entries and delivery effort are reviewed', 2),
  ('Client or internal deliverables are confirmed', 3),
  ('Outstanding follow-ups are recorded', 4)
) as item(label, position)
where not exists (
  select 1 from public.project_closure_items as existing where existing.project_id = project.id
)
on conflict (project_id, position) do nothing;

create trigger projects_seed_closure_items
after insert on public.projects
for each row execute function private.seed_project_closure_items();

create or replace function private.validate_project_stage_two_child()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := to_jsonb(new);
  v_project_id uuid;
  v_task_project_id uuid;
  v_related_project_id uuid;
  v_organization_id uuid;
begin
  if tg_table_name in ('project_phases', 'project_milestones', 'project_labels', 'project_task_attachments', 'project_task_recurrences', 'project_closure_items') then
    v_project_id := (v_payload ->> 'project_id')::uuid;
  elsif tg_table_name in ('project_task_labels', 'project_task_watchers', 'project_task_checklist_items') then
    select task.project_id into v_project_id
    from public.project_tasks as task
    where task.id = (v_payload ->> 'task_id')::uuid;
  end if;

  if v_project_id is null or not exists (select 1 from public.projects as project where project.id = v_project_id) then
    raise exception using errcode = '23514', message = 'Project-scoped record references an invalid project';
  end if;

  select project.organization_id into v_organization_id
  from public.projects as project
  where project.id = v_project_id;

  if v_payload ->> 'created_by_membership_id' is not null and not exists (
    select 1 from public.memberships as membership
    where membership.id = (v_payload ->> 'created_by_membership_id')::uuid
      and membership.organization_id = v_organization_id
  ) then
    raise exception using errcode = '23514', message = 'Creator membership must belong to the project organization';
  end if;

  if v_payload ->> 'uploaded_by_membership_id' is not null and not exists (
    select 1 from public.memberships as membership
    where membership.id = (v_payload ->> 'uploaded_by_membership_id')::uuid
      and membership.organization_id = v_organization_id
  ) then
    raise exception using errcode = '23514', message = 'Uploader membership must belong to the project organization';
  end if;

  if v_payload ->> 'completed_by_membership_id' is not null and not exists (
    select 1 from public.memberships as membership
    where membership.id = (v_payload ->> 'completed_by_membership_id')::uuid
      and membership.organization_id = v_organization_id
  ) then
    raise exception using errcode = '23514', message = 'Completing membership must belong to the project organization';
  end if;

  if tg_table_name = 'project_milestones' and v_payload ->> 'phase_id' is not null then
    select phase.project_id into v_related_project_id
    from public.project_phases as phase
    where phase.id = (v_payload ->> 'phase_id')::uuid;
    if v_related_project_id is distinct from v_project_id then
      raise exception using errcode = '23514', message = 'Milestone phase must belong to the same project';
    end if;
  elsif tg_table_name = 'project_task_labels' then
    select label.project_id into v_related_project_id
    from public.project_labels as label
    where label.id = (v_payload ->> 'label_id')::uuid;
    if v_related_project_id is distinct from v_project_id then
      raise exception using errcode = '23514', message = 'Task label must belong to the same project';
    end if;
  elsif tg_table_name = 'project_task_watchers' then
    if not exists (
      select 1
      from public.project_members as member
      join public.memberships as membership on membership.id = member.membership_id
      where member.project_id = v_project_id
        and member.membership_id = (v_payload ->> 'membership_id')::uuid
        and membership.organization_id = v_organization_id
        and membership.status = 'active'
    ) then
      raise exception using errcode = '23514', message = 'Task watcher must be an active member of the project';
    end if;
  elsif tg_table_name = 'project_task_attachments' then
    select task.project_id into v_task_project_id
    from public.project_tasks as task
    where task.id = (v_payload ->> 'task_id')::uuid;
    select project.organization_id into v_organization_id
    from public.projects as project
    where project.id = v_project_id;
    if v_task_project_id is distinct from v_project_id then
      raise exception using errcode = '23514', message = 'Attachment task must belong to the same project';
    end if;
    if (v_payload ->> 'organization_id')::uuid is distinct from v_organization_id then
      raise exception using errcode = '23514', message = 'Attachment organization must match the project organization';
    end if;
  elsif tg_table_name = 'project_task_recurrences' then
    select task.project_id into v_task_project_id
    from public.project_tasks as task
    where task.id = (v_payload ->> 'template_task_id')::uuid;
    if v_task_project_id is distinct from v_project_id then
      raise exception using errcode = '23514', message = 'Recurring task template must belong to the same project';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.validate_project_task_stage_two_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_related_project_id uuid;
begin
  if new.phase_id is not null then
    select phase.project_id into v_related_project_id from public.project_phases as phase where phase.id = new.phase_id;
    if v_related_project_id is distinct from new.project_id then
      raise exception using errcode = '23514', message = 'Task phase must belong to the same project';
    end if;
  end if;

  if new.milestone_id is not null then
    select milestone.project_id into v_related_project_id from public.project_milestones as milestone where milestone.id = new.milestone_id;
    if v_related_project_id is distinct from new.project_id then
      raise exception using errcode = '23514', message = 'Task milestone must belong to the same project';
    end if;
  end if;

  if new.recurrence_id is not null then
    select recurrence.project_id into v_related_project_id from public.project_task_recurrences as recurrence where recurrence.id = new.recurrence_id;
    if v_related_project_id is distinct from new.project_id then
      raise exception using errcode = '23514', message = 'Task recurrence must belong to the same project';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.prevent_read_only_project_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_project_id uuid;
  v_archived_at timestamptz;
  v_closure_status text;
begin
  if tg_table_name in (
    'project_members', 'project_task_statuses', 'project_tasks', 'project_time_entries',
    'project_phases', 'project_milestones', 'project_labels', 'project_task_attachments',
    'project_task_recurrences', 'project_closure_items'
  ) then
    v_project_id := (v_payload ->> 'project_id')::uuid;
  elsif tg_table_name in (
    'project_task_assignees', 'project_task_comments', 'project_task_dependencies',
    'project_task_labels', 'project_task_watchers', 'project_task_checklist_items'
  ) then
    select task.project_id into v_project_id
    from public.project_tasks as task
    where task.id = (v_payload ->> 'task_id')::uuid;
  end if;

  select project.archived_at, project.closure_status
  into v_archived_at, v_closure_status
  from public.projects as project
  where project.id = v_project_id;

  if v_archived_at is not null then
    raise exception using errcode = '55000', message = 'Archived projects are read-only';
  end if;
  if v_closure_status = 'closed' then
    raise exception using errcode = '55000', message = 'Closed projects are read-only';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.validate_project_closure_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open_tasks integer;
  v_incomplete_required integer;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.closure_status <> 'closed' then
    raise exception using errcode = '23514', message = 'Complete the project closure workflow before marking the project completed';
  end if;

  if new.closure_status = 'closed' and new.status <> 'completed' then
    raise exception using errcode = '23514', message = 'A closed project must have completed status';
  end if;

  if new.closure_status = 'closed' and old.closure_status is distinct from 'closed' then
    if old.closure_status is distinct from 'requested' then
      raise exception using errcode = '23514', message = 'Project closure must be requested before final close';
    end if;

    select count(*)::integer into v_open_tasks
    from public.project_tasks as task
    join public.project_task_statuses as status on status.id = task.status_id
    where task.project_id = new.id and not status.is_terminal;

    select count(*)::integer into v_incomplete_required
    from public.project_closure_items as item
    where item.project_id = new.id and item.is_required and not item.is_completed;

    if v_open_tasks > 0 then
      raise exception using errcode = '23514', message = 'All project tasks must be completed or cancelled before closure';
    end if;
    if v_incomplete_required > 0 then
      raise exception using errcode = '23514', message = 'All required closure checks must be completed before closure';
    end if;
    if new.status <> 'completed' then
      raise exception using errcode = '23514', message = 'A closed project must have completed status';
    end if;
  end if;

  if new.closure_status <> 'closed' and new.status = 'completed' and old.status = 'completed' then
    raise exception using errcode = '23514', message = 'A completed project cannot leave the closed state';
  end if;

  return new;
end;
$$;

create or replace function private.validate_project_task_dependency_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.relationship <> 'blocks' then
    return new;
  end if;

  if exists (
    with recursive downstream(task_id) as (
      select dependency.related_task_id
      from public.project_task_dependencies as dependency
      where dependency.task_id = new.related_task_id
        and dependency.relationship = 'blocks'
      union
      select dependency.related_task_id
      from public.project_task_dependencies as dependency
      join downstream on downstream.task_id = dependency.task_id
      where dependency.relationship = 'blocks'
    )
    select 1 from downstream where task_id = new.task_id
  ) then
    raise exception using errcode = '23514', message = 'Blocking task dependencies cannot contain cycles';
  end if;

  return new;
end;
$$;

create trigger project_phases_set_updated_at before update on public.project_phases
for each row execute function private.set_updated_at();
create trigger project_milestones_set_updated_at before update on public.project_milestones
for each row execute function private.set_updated_at();
create trigger project_task_checklist_items_set_updated_at before update on public.project_task_checklist_items
for each row execute function private.set_updated_at();
create trigger project_task_recurrences_set_updated_at before update on public.project_task_recurrences
for each row execute function private.set_updated_at();
create trigger project_closure_items_set_updated_at before update on public.project_closure_items
for each row execute function private.set_updated_at();

create trigger project_phases_validate_tenant before insert or update on public.project_phases
for each row execute function private.validate_project_stage_two_child();
create trigger project_milestones_validate_tenant before insert or update on public.project_milestones
for each row execute function private.validate_project_stage_two_child();
create trigger project_labels_validate_tenant before insert or update on public.project_labels
for each row execute function private.validate_project_stage_two_child();
create trigger project_task_labels_validate_tenant before insert or update on public.project_task_labels
for each row execute function private.validate_project_stage_two_child();
create trigger project_task_watchers_validate_tenant before insert or update on public.project_task_watchers
for each row execute function private.validate_project_stage_two_child();
create trigger project_task_checklist_items_validate_tenant before insert or update on public.project_task_checklist_items
for each row execute function private.validate_project_stage_two_child();
create trigger project_task_attachments_validate_tenant before insert or update on public.project_task_attachments
for each row execute function private.validate_project_stage_two_child();
create trigger project_task_recurrences_validate_tenant before insert or update on public.project_task_recurrences
for each row execute function private.validate_project_stage_two_child();
create trigger project_closure_items_validate_tenant before insert or update on public.project_closure_items
for each row execute function private.validate_project_stage_two_child();
create trigger project_tasks_validate_stage_two_links
before insert or update of phase_id, milestone_id, recurrence_id on public.project_tasks
for each row execute function private.validate_project_task_stage_two_links();
create trigger project_task_dependencies_prevent_cycles
before insert on public.project_task_dependencies
for each row execute function private.validate_project_task_dependency_cycle();
create trigger projects_validate_closure
before update of status, closure_status on public.projects
for each row execute function private.validate_project_closure_transition();

create trigger project_members_prevent_read_only_mutation
before insert or update or delete on public.project_members
for each row execute function private.prevent_read_only_project_mutation();
create trigger project_task_statuses_prevent_read_only_mutation
before insert or update or delete on public.project_task_statuses
for each row execute function private.prevent_read_only_project_mutation();
create trigger project_tasks_prevent_read_only_mutation
before insert or update or delete on public.project_tasks
for each row execute function private.prevent_read_only_project_mutation();
create trigger project_task_assignees_prevent_read_only_mutation
before insert or update or delete on public.project_task_assignees
for each row execute function private.prevent_read_only_project_mutation();
create trigger project_task_comments_prevent_read_only_mutation
before insert or update or delete on public.project_task_comments
for each row execute function private.prevent_read_only_project_mutation();
create trigger project_task_dependencies_prevent_read_only_mutation
before insert or update or delete on public.project_task_dependencies
for each row execute function private.prevent_read_only_project_mutation();
create trigger project_time_entries_prevent_read_only_mutation
before insert or update or delete on public.project_time_entries
for each row execute function private.prevent_read_only_project_mutation();
create trigger project_phases_prevent_read_only_mutation
before insert or update or delete on public.project_phases
for each row execute function private.prevent_read_only_project_mutation();
create trigger project_milestones_prevent_read_only_mutation
before insert or update or delete on public.project_milestones
for each row execute function private.prevent_read_only_project_mutation();
create trigger project_labels_prevent_read_only_mutation
before insert or update or delete on public.project_labels
for each row execute function private.prevent_read_only_project_mutation();
create trigger project_task_labels_prevent_read_only_mutation
before insert or update or delete on public.project_task_labels
for each row execute function private.prevent_read_only_project_mutation();
create trigger project_task_watchers_prevent_read_only_mutation
before insert or update or delete on public.project_task_watchers
for each row execute function private.prevent_read_only_project_mutation();
create trigger project_task_checklist_prevent_read_only_mutation
before insert or update or delete on public.project_task_checklist_items
for each row execute function private.prevent_read_only_project_mutation();
create trigger project_task_attachments_prevent_read_only_mutation
before insert or update or delete on public.project_task_attachments
for each row execute function private.prevent_read_only_project_mutation();
create trigger project_task_recurrences_prevent_read_only_mutation
before insert or update or delete on public.project_task_recurrences
for each row execute function private.prevent_read_only_project_mutation();
create trigger project_closure_items_prevent_read_only_mutation
before insert or update or delete on public.project_closure_items
for each row execute function private.prevent_read_only_project_mutation();

alter table public.project_phases enable row level security;
alter table public.project_milestones enable row level security;
alter table public.project_labels enable row level security;
alter table public.project_task_labels enable row level security;
alter table public.project_task_watchers enable row level security;
alter table public.project_task_checklist_items enable row level security;
alter table public.project_task_attachments enable row level security;
alter table public.project_task_recurrences enable row level security;
alter table public.project_closure_items enable row level security;

revoke all on public.project_phases from anon;
revoke all on public.project_milestones from anon;
revoke all on public.project_labels from anon;
revoke all on public.project_task_labels from anon;
revoke all on public.project_task_watchers from anon;
revoke all on public.project_task_checklist_items from anon;
revoke all on public.project_task_attachments from anon;
revoke all on public.project_task_recurrences from anon;
revoke all on public.project_closure_items from anon;

grant select, insert, update, delete on public.project_phases to authenticated;
grant select, insert, update, delete on public.project_milestones to authenticated;
grant select, insert, delete on public.project_labels to authenticated;
grant select, insert, delete on public.project_task_labels to authenticated;
grant select, insert, delete on public.project_task_watchers to authenticated;
grant select, insert, update, delete on public.project_task_checklist_items to authenticated;
grant select on public.project_task_attachments to authenticated;
grant select, insert, update, delete on public.project_task_recurrences to authenticated;
grant select, insert, update on public.project_closure_items to authenticated;

grant all on public.project_phases to service_role;
grant all on public.project_milestones to service_role;
grant all on public.project_labels to service_role;
grant all on public.project_task_labels to service_role;
grant all on public.project_task_watchers to service_role;
grant all on public.project_task_checklist_items to service_role;
grant all on public.project_task_attachments to service_role;
grant all on public.project_task_recurrences to service_role;
grant all on public.project_closure_items to service_role;

create policy project_phases_select_visible on public.project_phases for select to authenticated
using (private.project_permission_allows(project_phases.project_id, 'projects.project.view'));
create policy project_phases_insert_authorized on public.project_phases for insert to authenticated
with check (private.project_permission_allows(project_phases.project_id, 'projects.project.update'));
create policy project_phases_update_authorized on public.project_phases for update to authenticated
using (private.project_permission_allows(project_phases.project_id, 'projects.project.update'))
with check (private.project_permission_allows(project_phases.project_id, 'projects.project.update'));
create policy project_phases_delete_authorized on public.project_phases for delete to authenticated
using (private.project_permission_allows(project_phases.project_id, 'projects.project.update'));

create policy project_milestones_select_visible on public.project_milestones for select to authenticated
using (private.project_permission_allows(project_milestones.project_id, 'projects.project.view'));
create policy project_milestones_insert_authorized on public.project_milestones for insert to authenticated
with check (private.project_permission_allows(project_milestones.project_id, 'projects.project.update'));
create policy project_milestones_update_authorized on public.project_milestones for update to authenticated
using (private.project_permission_allows(project_milestones.project_id, 'projects.project.update'))
with check (private.project_permission_allows(project_milestones.project_id, 'projects.project.update'));
create policy project_milestones_delete_authorized on public.project_milestones for delete to authenticated
using (private.project_permission_allows(project_milestones.project_id, 'projects.project.update'));

create policy project_labels_select_visible on public.project_labels for select to authenticated
using (private.project_permission_allows(project_labels.project_id, 'projects.task.view'));
create policy project_labels_insert_authorized on public.project_labels for insert to authenticated
with check (private.project_permission_allows(project_labels.project_id, 'projects.task.update'));
create policy project_labels_delete_authorized on public.project_labels for delete to authenticated
using (private.project_permission_allows(project_labels.project_id, 'projects.task.update'));

create policy project_task_labels_select_visible on public.project_task_labels for select to authenticated
using (private.project_task_permission_allows(project_task_labels.task_id, 'projects.task.view'));
create policy project_task_labels_insert_authorized on public.project_task_labels for insert to authenticated
with check (private.project_task_permission_allows(project_task_labels.task_id, 'projects.task.update'));
create policy project_task_labels_delete_authorized on public.project_task_labels for delete to authenticated
using (private.project_task_permission_allows(project_task_labels.task_id, 'projects.task.update'));

create policy project_task_watchers_select_visible on public.project_task_watchers for select to authenticated
using (private.project_task_permission_allows(project_task_watchers.task_id, 'projects.task.view'));
create policy project_task_watchers_insert_authorized on public.project_task_watchers for insert to authenticated
with check (
  private.project_task_permission_allows(project_task_watchers.task_id, 'projects.task.view')
  and (
    project_task_watchers.membership_id = private.current_membership_id(
      (select task.organization_id from public.project_tasks as task where task.id = project_task_watchers.task_id)
    )
    or private.project_task_permission_allows(project_task_watchers.task_id, 'projects.task.update')
  )
);
create policy project_task_watchers_delete_authorized on public.project_task_watchers for delete to authenticated
using (
  project_task_watchers.membership_id = private.current_membership_id(
    (select task.organization_id from public.project_tasks as task where task.id = project_task_watchers.task_id)
  )
  or private.project_task_permission_allows(project_task_watchers.task_id, 'projects.task.update')
);

create policy project_task_checklist_select_visible on public.project_task_checklist_items for select to authenticated
using (private.project_task_permission_allows(project_task_checklist_items.task_id, 'projects.task.view'));
create policy project_task_checklist_insert_authorized on public.project_task_checklist_items for insert to authenticated
with check (private.project_task_permission_allows(project_task_checklist_items.task_id, 'projects.task.update'));
create policy project_task_checklist_update_authorized on public.project_task_checklist_items for update to authenticated
using (private.project_task_permission_allows(project_task_checklist_items.task_id, 'projects.task.update'))
with check (private.project_task_permission_allows(project_task_checklist_items.task_id, 'projects.task.update'));
create policy project_task_checklist_delete_authorized on public.project_task_checklist_items for delete to authenticated
using (private.project_task_permission_allows(project_task_checklist_items.task_id, 'projects.task.update'));

create policy project_task_attachments_select_visible on public.project_task_attachments for select to authenticated
using (private.project_task_permission_allows(project_task_attachments.task_id, 'projects.task.view'));
create policy project_task_attachments_insert_authorized on public.project_task_attachments for insert to authenticated
with check (private.project_task_permission_allows(project_task_attachments.task_id, 'projects.task.update'));
create policy project_task_attachments_delete_authorized on public.project_task_attachments for delete to authenticated
using (private.project_task_permission_allows(project_task_attachments.task_id, 'projects.task.update'));

create policy project_task_recurrences_select_visible on public.project_task_recurrences for select to authenticated
using (private.project_permission_allows(project_task_recurrences.project_id, 'projects.task.view'));
create policy project_task_recurrences_insert_authorized on public.project_task_recurrences for insert to authenticated
with check (private.project_permission_allows(project_task_recurrences.project_id, 'projects.task.update'));
create policy project_task_recurrences_update_authorized on public.project_task_recurrences for update to authenticated
using (private.project_permission_allows(project_task_recurrences.project_id, 'projects.task.update'))
with check (private.project_permission_allows(project_task_recurrences.project_id, 'projects.task.update'));
create policy project_task_recurrences_delete_authorized on public.project_task_recurrences for delete to authenticated
using (private.project_permission_allows(project_task_recurrences.project_id, 'projects.task.update'));

create policy project_closure_items_select_visible on public.project_closure_items for select to authenticated
using (private.project_permission_allows(project_closure_items.project_id, 'projects.project.view'));
create policy project_closure_items_insert_authorized on public.project_closure_items for insert to authenticated
with check (private.project_permission_allows(project_closure_items.project_id, 'projects.project.update'));
create policy project_closure_items_update_authorized on public.project_closure_items for update to authenticated
using (private.project_permission_allows(project_closure_items.project_id, 'projects.project.update'))
with check (private.project_permission_allows(project_closure_items.project_id, 'projects.project.update'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-attachments',
  'project-attachments',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'application/pdf', 'text/plain', 'text/csv']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

revoke all on function private.seed_project_closure_items() from public, anon, authenticated;
revoke all on function private.validate_project_stage_two_child() from public, anon, authenticated;
revoke all on function private.validate_project_task_stage_two_links() from public, anon, authenticated;
revoke all on function private.prevent_read_only_project_mutation() from public, anon, authenticated;
revoke all on function private.validate_project_closure_transition() from public, anon, authenticated;
revoke all on function private.validate_project_task_dependency_cycle() from public, anon, authenticated;
