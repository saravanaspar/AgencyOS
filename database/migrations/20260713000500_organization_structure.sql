-- Organization structure integrity and permission-scoped directory visibility.

set lock_timeout = '10s';
set statement_timeout = '120s';

create index if not exists departments_organization_status_name_idx
  on public.departments (organization_id, status, lower(name));

create index if not exists teams_organization_status_name_idx
  on public.teams (organization_id, status, lower(name));

create or replace function private.validate_membership_structure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_department_organization_id uuid;
  v_manager_organization_id uuid;
  v_manager_status text;
begin
  if new.department_id is not null then
    select department.organization_id
      into v_department_organization_id
    from public.departments as department
    where department.id = new.department_id;

    if v_department_organization_id is null
      or v_department_organization_id <> new.organization_id then
      raise exception using
        errcode = '23514',
        message = 'membership department must belong to the same organization';
    end if;
  end if;

  if new.manager_membership_id is not null then
    if new.manager_membership_id = new.id then
      raise exception using
        errcode = '23514',
        message = 'membership cannot manage itself';
    end if;

    select manager.organization_id, manager.status
      into v_manager_organization_id, v_manager_status
    from public.memberships as manager
    where manager.id = new.manager_membership_id;

    if v_manager_organization_id is null
      or v_manager_organization_id <> new.organization_id then
      raise exception using
        errcode = '23514',
        message = 'membership manager must belong to the same organization';
    end if;

    if v_manager_status <> 'active' then
      raise exception using
        errcode = '23514',
        message = 'membership manager must be active';
    end if;

    if exists (
      with recursive manager_chain as (
        select manager.id, manager.manager_membership_id
        from public.memberships as manager
        where manager.id = new.manager_membership_id

        union all

        select parent.id, parent.manager_membership_id
        from public.memberships as parent
        join manager_chain as child
          on parent.id = child.manager_membership_id
      )
      select 1
      from manager_chain
      where id = new.id
    ) then
      raise exception using
        errcode = '23514',
        message = 'membership manager relationship cannot contain a cycle';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_membership_structure() from public;

create trigger memberships_validate_structure
before insert or update of organization_id, department_id, manager_membership_id
on public.memberships
for each row execute function private.validate_membership_structure();

create or replace function private.validate_team_member_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_organization_id uuid;
  v_team_status text;
  v_membership_organization_id uuid;
  v_membership_status text;
begin
  select team.organization_id, team.status
    into v_team_organization_id, v_team_status
  from public.teams as team
  where team.id = new.team_id;

  select membership.organization_id, membership.status
    into v_membership_organization_id, v_membership_status
  from public.memberships as membership
  where membership.id = new.membership_id;

  if v_team_organization_id is null
    or v_membership_organization_id is null
    or v_team_organization_id <> v_membership_organization_id then
    raise exception using
      errcode = '23514',
      message = 'team member must belong to the team organization';
  end if;

  if v_team_status <> 'active' then
    raise exception using
      errcode = '23514',
      message = 'team must be active before assigning members';
  end if;

  if v_membership_status <> 'active' then
    raise exception using
      errcode = '23514',
      message = 'team member must have an active membership';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_team_member_organization() from public;

create trigger team_members_validate_organization
before insert or update of team_id, membership_id
on public.team_members
for each row execute function private.validate_team_member_organization();

drop policy if exists departments_select_member on public.departments;
drop policy if exists departments_select_authorized on public.departments;
create policy departments_select_authorized
on public.departments
for select
to authenticated
using ((select private.has_permission(organization_id, 'settings.department.view')));

drop policy if exists teams_select_member on public.teams;
drop policy if exists teams_select_authorized on public.teams;
create policy teams_select_authorized
on public.teams
for select
to authenticated
using ((select private.has_permission(organization_id, 'settings.team.view')));

drop policy if exists team_members_select_member on public.team_members;
drop policy if exists team_members_select_authorized on public.team_members;
create policy team_members_select_authorized
on public.team_members
for select
to authenticated
using (
  exists (
    select 1
    from public.teams as team
    where team.id = team_id
      and (select private.has_permission(team.organization_id, 'settings.team.view'))
  )
);
