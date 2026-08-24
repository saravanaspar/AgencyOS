-- Native projects and task-management foundation.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('projects', 'project', 'view', 'View projects inside the effective role scope.', false),
  ('projects', 'project', 'create', 'Create client or internal projects.', false),
  ('projects', 'project', 'update', 'Update projects inside the effective role scope.', false),
  ('projects', 'project', 'archive', 'Archive and restore projects.', true),
  ('projects', 'project', 'assign', 'Assign project ownership and members.', true),
  ('projects', 'task', 'view', 'View project tasks inside visible projects.', false),
  ('projects', 'task', 'create', 'Create tasks inside visible projects.', false),
  ('projects', 'task', 'update', 'Update tasks inside visible projects.', false),
  ('projects', 'task', 'assign', 'Assign tasks to project members.', true),
  ('projects', 'comment', 'create', 'Add project task comments.', false),
  ('projects', 'time', 'view', 'View time entries inside visible projects.', false),
  ('projects', 'time', 'create', 'Log personal time against project tasks.', false)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('owner', 'project_manager') and permission.module = 'projects'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'employee', permission.id, 'assigned'
from public.permissions as permission
where permission.key in (
  'projects.project.view', 'projects.task.view', 'projects.task.create', 'projects.task.update',
  'projects.comment.create', 'projects.time.view', 'projects.time.create'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('system_administrator', 'operations_administrator', 'auditor')
  and permission.key in ('projects.project.view', 'projects.task.view', 'projects.time.view')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'projects'
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.project_number_sequences (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  next_number integer not null default 1,
  constraint project_number_sequences_positive check (next_number > 0)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  project_type text not null default 'client',
  company_id uuid references public.crm_companies(id) on delete set null,
  status text not null default 'planned',
  priority text not null default 'normal',
  visibility text not null default 'members',
  owner_membership_id uuid not null references public.memberships(id) on delete restrict,
  start_date date,
  due_date date,
  completed_at timestamptz,
  archived_at timestamptz,
  next_task_number integer not null default 1,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_code_format check (code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
  constraint projects_name_not_blank check (btrim(name) <> ''),
  constraint projects_type_valid check (project_type in ('client', 'internal')),
  constraint projects_status_valid check (status in ('planned', 'active', 'on_hold', 'completed', 'cancelled')),
  constraint projects_priority_valid check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint projects_visibility_valid check (visibility in ('organization', 'members', 'private')),
  constraint projects_dates_valid check (due_date is null or start_date is null or due_date >= start_date),
  constraint projects_client_consistent check (project_type = 'internal' or company_id is not null),
  constraint projects_task_number_positive check (next_task_number > 0),
  unique (organization_id, code)
);

create index projects_org_status_idx on public.projects (organization_id, status, updated_at desc);
create index projects_owner_idx on public.projects (organization_id, owner_membership_id, status);
create index projects_company_idx on public.projects (company_id) where company_id is not null;

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  role text not null default 'member',
  added_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (project_id, membership_id),
  constraint project_members_role_valid check (role in ('owner', 'manager', 'member', 'viewer'))
);

create index project_members_membership_idx on public.project_members (membership_id, project_id);

create table public.project_task_statuses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  slug text not null,
  position integer not null,
  is_terminal boolean not null default false,
  is_cancelled boolean not null default false,
  created_at timestamptz not null default now(),
  constraint project_task_statuses_name_not_blank check (btrim(name) <> ''),
  constraint project_task_statuses_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint project_task_statuses_position_positive check (position > 0),
  constraint project_task_statuses_terminal_consistent check (not is_cancelled or is_terminal),
  unique (project_id, slug),
  unique (project_id, position)
);

create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_number integer not null,
  title text not null,
  description text,
  status_id uuid not null references public.project_task_statuses(id) on delete restrict,
  priority text not null default 'normal',
  parent_task_id uuid references public.project_tasks(id) on delete set null,
  start_date date,
  due_date date,
  estimated_minutes integer,
  completed_at timestamptz,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_tasks_number_positive check (task_number > 0),
  constraint project_tasks_title_not_blank check (btrim(title) <> ''),
  constraint project_tasks_priority_valid check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint project_tasks_dates_valid check (due_date is null or start_date is null or due_date >= start_date),
  constraint project_tasks_estimate_valid check (estimated_minutes is null or estimated_minutes between 1 and 100000),
  constraint project_tasks_not_self_parent check (parent_task_id is null or parent_task_id <> id),
  unique (project_id, task_number)
);

create index project_tasks_project_status_idx on public.project_tasks (project_id, status_id, updated_at desc);
create index project_tasks_org_due_idx on public.project_tasks (organization_id, due_date) where due_date is not null;

create table public.project_task_assignees (
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  assigned_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (task_id, membership_id)
);

create index project_task_assignees_membership_idx on public.project_task_assignees (membership_id, task_id);

create table public.project_task_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  body text not null,
  is_internal boolean not null default true,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_task_comments_body_not_blank check (btrim(body) <> '')
);

create index project_task_comments_task_idx on public.project_task_comments (task_id, created_at desc);

create table public.project_task_dependencies (
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  related_task_id uuid not null references public.project_tasks(id) on delete cascade,
  relationship text not null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (task_id, related_task_id, relationship),
  constraint project_task_dependencies_relationship_valid check (
    relationship in ('blocks', 'related_to', 'duplicate_of', 'parent_of')
  ),
  constraint project_task_dependencies_not_self check (task_id <> related_task_id)
);

create table public.project_time_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.project_tasks(id) on delete set null,
  membership_id uuid not null references public.memberships(id) on delete restrict,
  work_date date not null,
  minutes integer not null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_time_entries_minutes_valid check (minutes between 1 and 1440)
);

create index project_time_entries_project_date_idx on public.project_time_entries (project_id, work_date desc);
create index project_time_entries_member_date_idx on public.project_time_entries (membership_id, work_date desc);

create or replace function private.next_project_code(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number integer;
begin
  insert into public.project_number_sequences (organization_id, next_number)
  values (p_organization_id, 2)
  on conflict (organization_id) do update
    set next_number = public.project_number_sequences.next_number + 1
  returning next_number - 1 into v_number;
  return 'PRJ-' || lpad(v_number::text, 4, '0');
end;
$$;

create or replace function private.seed_project_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, membership_id, role, added_by_membership_id)
  values (new.id, new.owner_membership_id, 'owner', new.owner_membership_id)
  on conflict (project_id, membership_id) do update set role = 'owner';

  insert into public.project_task_statuses (project_id, name, slug, position, is_terminal, is_cancelled)
  values
    (new.id, 'Backlog', 'backlog', 1, false, false),
    (new.id, 'Ready', 'ready', 2, false, false),
    (new.id, 'In Progress', 'in-progress', 3, false, false),
    (new.id, 'Review', 'review', 4, false, false),
    (new.id, 'Blocked', 'blocked', 5, false, false),
    (new.id, 'Completed', 'completed', 6, true, false),
    (new.id, 'Cancelled', 'cancelled', 7, true, true);
  return new;
end;
$$;

create trigger projects_seed_workflow
after insert on public.projects
for each row execute function private.seed_project_workflow();

create trigger projects_set_updated_at before update on public.projects
for each row execute function private.set_updated_at();
create trigger project_tasks_set_updated_at before update on public.project_tasks
for each row execute function private.set_updated_at();
create trigger project_task_comments_set_updated_at before update on public.project_task_comments
for each row execute function private.set_updated_at();
create trigger project_time_entries_set_updated_at before update on public.project_time_entries
for each row execute function private.set_updated_at();

create or replace function private.validate_project_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.memberships where id = new.owner_membership_id and status = 'active';
  if v_org is null or v_org <> new.organization_id then
    raise exception using errcode = '23514', message = 'Project owner must be active in the same organization';
  end if;
  select organization_id into v_org from public.memberships where id = new.created_by_membership_id;
  if v_org is null or v_org <> new.organization_id then
    raise exception using errcode = '23514', message = 'Project creator must belong to the same organization';
  end if;
  if new.company_id is not null then
    select organization_id into v_org from public.crm_companies where id = new.company_id;
    if v_org is null or v_org <> new.organization_id then
      raise exception using errcode = '23514', message = 'Project client must belong to the same organization';
    end if;
  end if;
  return new;
end;
$$;

create trigger projects_validate_tenant
before insert or update of organization_id, owner_membership_id, created_by_membership_id, company_id
on public.projects for each row execute function private.validate_project_tenant();

create or replace function private.project_is_visible(p_project_id uuid, p_membership_id uuid, p_scope text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects as project
    where project.id = p_project_id
      and project.organization_id = (select organization_id from public.memberships where id = p_membership_id and status = 'active')
      and (
        (p_scope = 'organization' and project.visibility = 'organization')
        or project.owner_membership_id = p_membership_id
        or project.created_by_membership_id = p_membership_id
        or exists (
          select 1 from public.project_members as member
          where member.project_id = project.id and member.membership_id = p_membership_id
        )
        or private.crm_scope_allows_membership(
          p_membership_id, p_scope, project.owner_membership_id, project.created_by_membership_id
        )
      )
  );
$$;

create or replace function private.project_permission_allows(
  p_project_id uuid,
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects as project
    where project.id = p_project_id
      and private.has_permission(project.organization_id, p_permission_key)
      and private.project_is_visible(
        project.id,
        private.current_membership_id(project.organization_id),
        private.effective_permission_scope(project.organization_id, p_permission_key)
      )
  );
$$;

create or replace function private.project_task_permission_allows(
  p_task_id uuid,
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_tasks as task
    where task.id = p_task_id
      and private.project_permission_allows(task.project_id, p_permission_key)
  );
$$;

create or replace function private.validate_project_child_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_org uuid;
  v_payload jsonb := to_jsonb(new);
  v_membership_id uuid;
  v_status_id uuid;
  v_parent_task_id uuid;
  v_related_task_id uuid;
  v_task_id uuid;
begin
  if tg_table_name in ('project_members', 'project_task_statuses', 'project_tasks', 'project_time_entries') then
    v_project_id := nullif(v_payload ->> 'project_id', '')::uuid;
  elsif tg_table_name in ('project_task_assignees', 'project_task_comments', 'project_task_dependencies') then
    select task.project_id into v_project_id
    from public.project_tasks as task
    where task.id = nullif(v_payload ->> 'task_id', '')::uuid;
  end if;

  select project.organization_id into v_org
  from public.projects as project
  where project.id = v_project_id;
  if v_org is null then
    raise exception using errcode = '23514', message = 'Project child must reference an existing project';
  end if;

  if v_payload ? 'organization_id'
    and nullif(v_payload ->> 'organization_id', '')::uuid <> v_org then
    raise exception using errcode = '23514', message = 'Project child must belong to the same organization';
  end if;

  foreach v_membership_id in array array[
    nullif(v_payload ->> 'membership_id', '')::uuid,
    nullif(v_payload ->> 'added_by_membership_id', '')::uuid,
    nullif(v_payload ->> 'assigned_by_membership_id', '')::uuid,
    nullif(v_payload ->> 'created_by_membership_id', '')::uuid
  ] loop
    if v_membership_id is not null and not exists (
      select 1 from public.memberships as membership
      where membership.id = v_membership_id
        and membership.organization_id = v_org
        and membership.status = 'active'
    ) then
      raise exception using errcode = '23514', message = 'Project membership references must be active in the same organization';
    end if;
  end loop;

  if tg_table_name = 'project_task_assignees' then
    v_membership_id := nullif(v_payload ->> 'membership_id', '')::uuid;
    if not exists (
      select 1 from public.project_members as member
      where member.project_id = v_project_id
        and member.membership_id = v_membership_id
    ) then
      raise exception using errcode = '23514', message = 'Task assignee must be a project member';
    end if;
  elsif tg_table_name = 'project_tasks' then
    v_status_id := nullif(v_payload ->> 'status_id', '')::uuid;
    v_parent_task_id := nullif(v_payload ->> 'parent_task_id', '')::uuid;
    if not exists (
      select 1 from public.project_task_statuses as status
      where status.id = v_status_id and status.project_id = v_project_id
    ) then
      raise exception using errcode = '23514', message = 'Task status must belong to the same project';
    end if;
    if v_parent_task_id is not null and not exists (
      select 1 from public.project_tasks as parent
      where parent.id = v_parent_task_id and parent.project_id = v_project_id
    ) then
      raise exception using errcode = '23514', message = 'Parent task must belong to the same project';
    end if;
  elsif tg_table_name = 'project_task_dependencies' then
    v_related_task_id := nullif(v_payload ->> 'related_task_id', '')::uuid;
    if not exists (
      select 1 from public.project_tasks as related
      where related.id = v_related_task_id and related.project_id = v_project_id
    ) then
      raise exception using errcode = '23514', message = 'Task dependencies must remain in one project';
    end if;
  elsif tg_table_name = 'project_time_entries' then
    v_task_id := nullif(v_payload ->> 'task_id', '')::uuid;
    if v_task_id is not null and not exists (
      select 1 from public.project_tasks as task
      where task.id = v_task_id and task.project_id = v_project_id
    ) then
      raise exception using errcode = '23514', message = 'Time-entry task must belong to the same project';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.sync_project_owner_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, membership_id, role, added_by_membership_id)
  values (new.id, new.owner_membership_id, 'owner', new.owner_membership_id)
  on conflict (project_id, membership_id) do update set role = 'owner';

  if tg_op = 'UPDATE' and old.owner_membership_id <> new.owner_membership_id then
    update public.project_members
    set role = 'manager'
    where project_id = new.id
      and membership_id = old.owner_membership_id
      and role = 'owner';
  end if;
  return new;
end;
$$;

create or replace function private.validate_project_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and exists (
    select 1
    from public.project_tasks as task
    join public.project_task_statuses as status on status.id = task.status_id
    where task.project_id = new.id and not status.is_terminal
  ) then
    raise exception using errcode = '23514', message = 'All project tasks must be completed or cancelled before project completion';
  end if;
  return new;
end;
$$;

create or replace function private.validate_project_task_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_terminal boolean;
  v_cancelled boolean;
begin
  select status.is_terminal, status.is_cancelled
    into v_terminal, v_cancelled
  from public.project_task_statuses as status
  where status.id = new.status_id and status.project_id = new.project_id;

  if v_terminal and not v_cancelled and exists (
    select 1
    from public.project_tasks as child
    join public.project_task_statuses as child_status on child_status.id = child.status_id
    where child.parent_task_id = new.id and not child_status.is_terminal
  ) then
    raise exception using errcode = '23514', message = 'Complete or cancel all subtasks before completing this task';
  end if;

  if new.parent_task_id is not null and exists (
    with recursive ancestors as (
      select parent.id, parent.parent_task_id
      from public.project_tasks as parent
      where parent.id = new.parent_task_id
      union all
      select parent.id, parent.parent_task_id
      from public.project_tasks as parent
      join ancestors on parent.id = ancestors.parent_task_id
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception using errcode = '23514', message = 'Task parent relationships cannot contain cycles';
  end if;
  return new;
end;
$$;

create trigger projects_sync_owner_member
before update of owner_membership_id on public.projects
for each row execute function private.sync_project_owner_member();
create trigger projects_validate_completion
before update of status on public.projects
for each row execute function private.validate_project_completion();
create trigger project_tasks_validate_transition
before insert or update of status_id, parent_task_id on public.project_tasks
for each row execute function private.validate_project_task_transition();

create trigger project_members_validate_tenant before insert or update on public.project_members
for each row execute function private.validate_project_child_tenant();
create trigger project_task_statuses_validate_tenant before insert or update on public.project_task_statuses
for each row execute function private.validate_project_child_tenant();
create trigger project_tasks_validate_tenant before insert or update on public.project_tasks
for each row execute function private.validate_project_child_tenant();
create trigger project_task_assignees_validate_tenant before insert or update on public.project_task_assignees
for each row execute function private.validate_project_child_tenant();
create trigger project_task_comments_validate_tenant before insert or update on public.project_task_comments
for each row execute function private.validate_project_child_tenant();
create trigger project_task_dependencies_validate_tenant before insert or update on public.project_task_dependencies
for each row execute function private.validate_project_child_tenant();
create trigger project_time_entries_validate_tenant before insert or update on public.project_time_entries
for each row execute function private.validate_project_child_tenant();

alter table public.project_number_sequences enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_task_statuses enable row level security;
alter table public.project_tasks enable row level security;
alter table public.project_task_assignees enable row level security;
alter table public.project_task_comments enable row level security;
alter table public.project_task_dependencies enable row level security;
alter table public.project_time_entries enable row level security;

revoke all on public.project_number_sequences from anon, authenticated;
revoke all on public.projects from anon;
revoke all on public.project_members from anon;
revoke all on public.project_task_statuses from anon;
revoke all on public.project_tasks from anon;
revoke all on public.project_task_assignees from anon;
revoke all on public.project_task_comments from anon;
revoke all on public.project_task_dependencies from anon;
revoke all on public.project_time_entries from anon;

grant select, insert, update on public.projects to authenticated;
grant select, insert, update, delete on public.project_members to authenticated;
grant select, insert, update on public.project_task_statuses to authenticated;
grant select, insert, update on public.project_tasks to authenticated;
grant select, insert, delete on public.project_task_assignees to authenticated;
grant select, insert, update on public.project_task_comments to authenticated;
grant select, insert, delete on public.project_task_dependencies to authenticated;
grant select, insert, update on public.project_time_entries to authenticated;

grant all on public.project_number_sequences to service_role;
grant all on public.projects to service_role;
grant all on public.project_members to service_role;
grant all on public.project_task_statuses to service_role;
grant all on public.project_tasks to service_role;
grant all on public.project_task_assignees to service_role;
grant all on public.project_task_comments to service_role;
grant all on public.project_task_dependencies to service_role;
grant all on public.project_time_entries to service_role;

create policy projects_select_scoped on public.projects for select to authenticated
using (private.project_permission_allows(projects.id, 'projects.project.view'));

create policy projects_insert_authorized on public.projects for insert to authenticated
with check (
  private.has_permission(projects.organization_id, 'projects.project.create')
  and projects.created_by_membership_id = private.current_membership_id(projects.organization_id)
  and (
    projects.owner_membership_id = private.current_membership_id(projects.organization_id)
    or private.has_permission(projects.organization_id, 'projects.project.assign')
  )
);

create policy projects_update_scoped on public.projects for update to authenticated
using (private.project_permission_allows(projects.id, 'projects.project.update'))
with check (
  private.project_permission_allows(projects.id, 'projects.project.update')
  and (
    projects.owner_membership_id = private.current_membership_id(projects.organization_id)
    or private.has_permission(projects.organization_id, 'projects.project.assign')
  )
);

create policy project_members_select_visible on public.project_members for select to authenticated
using (private.project_permission_allows(project_members.project_id, 'projects.project.view'));
create policy project_members_insert_authorized on public.project_members for insert to authenticated
with check (private.project_permission_allows(project_members.project_id, 'projects.project.assign'));
create policy project_members_update_authorized on public.project_members for update to authenticated
using (private.project_permission_allows(project_members.project_id, 'projects.project.assign'))
with check (private.project_permission_allows(project_members.project_id, 'projects.project.assign'));
create policy project_members_delete_authorized on public.project_members for delete to authenticated
using (private.project_permission_allows(project_members.project_id, 'projects.project.assign'));

create policy project_task_statuses_select_visible on public.project_task_statuses for select to authenticated
using (private.project_permission_allows(project_task_statuses.project_id, 'projects.task.view'));

create policy project_tasks_select_visible on public.project_tasks for select to authenticated
using (private.project_permission_allows(project_tasks.project_id, 'projects.task.view'));
create policy project_tasks_insert_visible on public.project_tasks for insert to authenticated
with check (
  private.project_permission_allows(project_tasks.project_id, 'projects.task.create')
  and project_tasks.created_by_membership_id = private.current_membership_id(project_tasks.organization_id)
);
create policy project_tasks_update_visible on public.project_tasks for update to authenticated
using (private.project_permission_allows(project_tasks.project_id, 'projects.task.update'))
with check (private.project_permission_allows(project_tasks.project_id, 'projects.task.update'));

create policy project_task_assignees_select_visible on public.project_task_assignees for select to authenticated
using (private.project_task_permission_allows(project_task_assignees.task_id, 'projects.task.view'));
create policy project_task_assignees_insert_authorized on public.project_task_assignees for insert to authenticated
with check (private.project_task_permission_allows(project_task_assignees.task_id, 'projects.task.assign'));
create policy project_task_assignees_delete_authorized on public.project_task_assignees for delete to authenticated
using (private.project_task_permission_allows(project_task_assignees.task_id, 'projects.task.assign'));

create policy project_task_comments_select_visible on public.project_task_comments for select to authenticated
using (private.project_task_permission_allows(project_task_comments.task_id, 'projects.task.view'));
create policy project_task_comments_insert_visible on public.project_task_comments for insert to authenticated
with check (
  private.project_task_permission_allows(project_task_comments.task_id, 'projects.comment.create')
  and project_task_comments.created_by_membership_id = private.current_membership_id(project_task_comments.organization_id)
);

create policy project_task_dependencies_select_visible on public.project_task_dependencies for select to authenticated
using (private.project_task_permission_allows(project_task_dependencies.task_id, 'projects.task.view'));
create policy project_task_dependencies_insert_authorized on public.project_task_dependencies for insert to authenticated
with check (private.project_task_permission_allows(project_task_dependencies.task_id, 'projects.task.update'));
create policy project_task_dependencies_delete_authorized on public.project_task_dependencies for delete to authenticated
using (private.project_task_permission_allows(project_task_dependencies.task_id, 'projects.task.update'));

create policy project_time_entries_select_visible on public.project_time_entries for select to authenticated
using (private.project_permission_allows(project_time_entries.project_id, 'projects.time.view'));
create policy project_time_entries_insert_own on public.project_time_entries for insert to authenticated
with check (
  private.project_permission_allows(project_time_entries.project_id, 'projects.time.create')
  and project_time_entries.membership_id = private.current_membership_id(project_time_entries.organization_id)
);

revoke all on function private.next_project_code(uuid) from public, anon, authenticated;
revoke all on function private.seed_project_workflow() from public, anon;
revoke all on function private.project_is_visible(uuid, uuid, text) from public, anon;
revoke all on function private.project_permission_allows(uuid, text) from public, anon;
revoke all on function private.project_task_permission_allows(uuid, text) from public, anon;
revoke all on function private.sync_project_owner_member() from public, anon;
revoke all on function private.validate_project_completion() from public, anon;
revoke all on function private.validate_project_task_transition() from public, anon;
revoke all on function private.validate_project_tenant() from public, anon;
revoke all on function private.validate_project_child_tenant() from public, anon;
grant execute on function private.project_is_visible(uuid, uuid, text) to authenticated, service_role;
grant execute on function private.project_permission_allows(uuid, text) to authenticated, service_role;
grant execute on function private.project_task_permission_allows(uuid, text) to authenticated, service_role;
grant execute on function private.next_project_code(uuid) to service_role;
