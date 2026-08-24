-- Repair the shared project-child trigger so it never resolves table-specific NEW fields
-- against records from a different project table. This migration is intentionally separate
-- because previously applied migrations are immutable in deployed databases.

set lock_timeout = '10s';
set statement_timeout = '120s';

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

revoke all on function private.validate_project_child_tenant() from public, anon, authenticated;
grant execute on function private.validate_project_child_tenant() to service_role;
