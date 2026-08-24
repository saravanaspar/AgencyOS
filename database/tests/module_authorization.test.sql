begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(8);

insert into public.identity_accounts (
  id, auth_provider, provider_subject, email, email_confirmed_at, raw_user_meta_data
)
values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'agencyos', '11111111-1111-1111-1111-111111111111', 'owner-a@example.test', now(), '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'agencyos', '22222222-2222-2222-2222-222222222222', 'owner-b@example.test', now(), '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'agencyos', '33333333-3333-3333-3333-333333333333', 'employee-a@example.test', now(), '{}'::jsonb)
on conflict (id) do nothing;

select private.bootstrap_organization(
  '11111111-1111-1111-1111-111111111111',
  'Authorization Org A',
  'authorization-org-a',
  'US',
  'UTC',
  'USD'
);

select private.bootstrap_organization(
  '22222222-2222-2222-2222-222222222222',
  'Authorization Org B',
  'authorization-org-b',
  'US',
  'UTC',
  'USD'
);

insert into public.memberships (
  organization_id,
  user_id,
  status,
  invitation_accepted_at,
  activated_at,
  invited_by
)
select
  organization.id,
  '33333333-3333-3333-3333-333333333333',
  'active',
  now(),
  now(),
  '11111111-1111-1111-1111-111111111111'
from public.organizations as organization
where organization.slug = 'authorization-org-a';

insert into public.membership_roles (membership_id, role_id, assigned_by)
select
  membership.id,
  role.id,
  '11111111-1111-1111-1111-111111111111'
from public.memberships as membership
join public.organizations as organization
  on organization.id = membership.organization_id
join public.roles as role
  on role.organization_id = organization.id
 and role.key = 'employee'
where membership.user_id = '33333333-3333-3333-3333-333333333333'
  and organization.slug = 'authorization-org-a';

select set_config('request.identity.id', '33333333-3333-3333-3333-333333333333', true);
set local role authenticated;

select is(
  (select count(*)::integer from public.organizations),
  1,
  'employee can only read their own active organization'
);

select is(
  (
    select count(*)::integer
    from public.organizations
    where slug = 'authorization-org-b'
  ),
  0,
  'cross-organization records are hidden by RLS'
);

select is(
  (
    select count(*)::integer
    from public.memberships
    where organization_id = (
      select id from public.organizations where slug = 'authorization-org-b'
    )
  ),
  0,
  'cross-organization memberships are hidden by RLS'
);

select ok(
  private.has_permission(
    (select id from public.organizations where slug = 'authorization-org-a'),
    'dashboard.workspace.view'
  ),
  'employee has dashboard access'
);

select ok(
  private.has_permission(
    (select id from public.organizations where slug = 'authorization-org-a'),
    'calendar.workspace.view'
  ),
  'employee receives the calendar module grant'
);

select ok(
  private.has_permission(
    (select id from public.organizations where slug = 'authorization-org-a'),
    'finance.workspace.view'
  )
  and not private.has_permission(
    (select id from public.organizations where slug = 'authorization-org-a'),
    'finance.report.view'
  ),
  'employee receives own-expense finance access without organization reports'
);

reset role;
select set_config('request.identity.id', '11111111-1111-1111-1111-111111111111', true);
set local role authenticated;

select ok(
  private.has_permission(
    (select id from public.organizations where slug = 'authorization-org-a'),
    'finance.workspace.view'
  ),
  'owner receives every module permission'
);

select ok(
  not private.has_permission(
    (select id from public.organizations where slug = 'authorization-org-b'),
    'dashboard.workspace.view'
  ),
  'permission checks cannot cross organization boundaries'
);

select * from finish();
rollback;
