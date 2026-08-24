begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(10);

insert into public.identity_accounts (
  id, auth_provider, provider_subject, email, email_confirmed_at, raw_user_meta_data
)
values
  ('66666666-6666-4666-8666-666666666661'::uuid, 'agencyos', '66666666-6666-4666-8666-666666666661', 'structure-owner-a@example.test', now(), '{}'::jsonb),
  ('66666666-6666-4666-8666-666666666662'::uuid, 'agencyos', '66666666-6666-4666-8666-666666666662', 'structure-member-a@example.test', now(), '{}'::jsonb),
  ('66666666-6666-4666-8666-666666666663'::uuid, 'agencyos', '66666666-6666-4666-8666-666666666663', 'structure-owner-b@example.test', now(), '{}'::jsonb)
on conflict (id) do nothing;

select private.bootstrap_organization('66666666-6666-4666-8666-666666666661', 'Structure A', 'structure-a', 'US', 'UTC', 'USD');
select private.bootstrap_organization('66666666-6666-4666-8666-666666666663', 'Structure B', 'structure-b', 'GB', 'UTC', 'GBP');

insert into public.memberships (organization_id, user_id, status, invitation_accepted_at, activated_at)
select id, '66666666-6666-4666-8666-666666666662', 'active', now(), now()
from public.organizations where slug = 'structure-a';

insert into public.membership_roles (membership_id, role_id, assigned_by)
select membership.id, role.id, '66666666-6666-4666-8666-666666666661'
from public.memberships as membership
join public.roles as role on role.organization_id = membership.organization_id and role.key = 'employee'
where membership.user_id = '66666666-6666-4666-8666-666666666662';

insert into public.departments (organization_id, name, code, created_by)
select id, 'Delivery', 'DEL', '66666666-6666-4666-8666-666666666661'
from public.organizations where slug = 'structure-a';

insert into public.departments (organization_id, name, code, created_by)
select id, 'External', 'EXT', '66666666-6666-4666-8666-666666666663'
from public.organizations where slug = 'structure-b';

insert into public.teams (organization_id, name, created_by)
select id, 'Launch Team', '66666666-6666-4666-8666-666666666661'
from public.organizations where slug = 'structure-a';

select set_config('request.identity.id', '66666666-6666-4666-8666-666666666661', true);
set local role authenticated;

select ok(
  private.has_permission((select id from public.organizations where slug = 'structure-a'), 'settings.department.create'),
  'owner can create departments'
);

select ok(
  private.has_permission((select id from public.organizations where slug = 'structure-a'), 'settings.team.assign'),
  'owner can assign team members'
);

reset role;

select lives_ok(
  $$
    update public.memberships
    set department_id = (select id from public.departments where code = 'DEL')
    where user_id = '66666666-6666-4666-8666-666666666662'
  $$,
  'same-organization department assignment succeeds'
);

select throws_ok(
  $$
    update public.memberships
    set department_id = (select id from public.departments where code = 'EXT')
    where user_id = '66666666-6666-4666-8666-666666666662'
  $$,
  '23514',
  'membership department must belong to the same organization',
  'cross-organization department assignment is rejected'
);

select throws_ok(
  $$
    update public.memberships
    set manager_membership_id = (
      select id from public.memberships where user_id = '66666666-6666-4666-8666-666666666663'
    )
    where user_id = '66666666-6666-4666-8666-666666666662'
  $$,
  '23514',
  'membership manager must belong to the same organization',
  'cross-organization manager assignment is rejected'
);

select lives_ok(
  $$
    insert into public.team_members (team_id, membership_id, is_lead, added_by)
    select team.id, membership.id, true, '66666666-6666-4666-8666-666666666661'
    from public.teams as team
    join public.memberships as membership on membership.user_id = '66666666-6666-4666-8666-666666666662'
    where team.name = 'Launch Team'
  $$,
  'same-organization active team member assignment succeeds'
);

select is(
  (select count(*)::integer from public.team_members where is_lead),
  1,
  'team lead designation is persisted'
);

select throws_ok(
  $$
    insert into public.team_members (team_id, membership_id, added_by)
    select team.id, membership.id, '66666666-6666-4666-8666-666666666661'
    from public.teams as team
    join public.memberships as membership on membership.user_id = '66666666-6666-4666-8666-666666666663'
    where team.name = 'Launch Team'
  $$,
  '23514',
  'team member must belong to the team organization',
  'cross-organization team membership is rejected'
);

select set_config('request.identity.id', '66666666-6666-4666-8666-666666666662', true);
set local role authenticated;

select is(
  (select count(*)::integer from public.departments),
  1,
  'department RLS exposes only the active member organization'
);

select is(
  (select count(*)::integer from public.teams),
  1,
  'team RLS exposes only the active member organization'
);

select * from finish();
rollback;
