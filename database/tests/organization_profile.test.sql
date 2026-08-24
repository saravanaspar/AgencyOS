begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(7);

insert into public.identity_accounts (
  id, auth_provider, provider_subject, email, email_confirmed_at, raw_user_meta_data
)
values
  ('44444444-4444-4444-4444-444444444444'::uuid, 'agencyos', '44444444-4444-4444-4444-444444444444', 'profile-owner@example.test', now(), '{}'::jsonb),
  ('55555555-5555-5555-5555-555555555555'::uuid, 'agencyos', '55555555-5555-5555-5555-555555555555', 'profile-employee@example.test', now(), '{}'::jsonb)
on conflict (id) do nothing;

select private.bootstrap_organization(
  '44444444-4444-4444-4444-444444444444',
  'Profile Test Organization',
  'profile-test-organization',
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
  '55555555-5555-5555-5555-555555555555',
  'active',
  now(),
  now(),
  '44444444-4444-4444-4444-444444444444'
from public.organizations as organization
where organization.slug = 'profile-test-organization';

insert into public.membership_roles (membership_id, role_id, assigned_by)
select
  membership.id,
  role.id,
  '44444444-4444-4444-4444-444444444444'
from public.memberships as membership
join public.roles as role
  on role.organization_id = membership.organization_id
 and role.key = 'employee'
where membership.user_id = '55555555-5555-5555-5555-555555555555';

select set_config('request.identity.id', '55555555-5555-5555-5555-555555555555', true);
set local role authenticated;

select ok(
  private.has_permission(
    (select id from public.organizations where slug = 'profile-test-organization'),
    'settings.organization.view'
  ),
  'employee can view the organization profile'
);

select ok(
  not private.has_permission(
    (select id from public.organizations where slug = 'profile-test-organization'),
    'settings.organization.update'
  ),
  'employee cannot update the organization profile'
);

select is(
  (select count(*)::integer from public.organizations),
  1,
  'employee can read only their organization profile'
);

with attempted_update as (
  update public.organizations
  set legal_name = 'Unauthorized change'
  where slug = 'profile-test-organization'
  returning id
)
select count(*)::integer as attempted_update_count
from attempted_update
\gset

select is(
  :'attempted_update_count'::integer,
  0,
  'RLS filters organization updates without update permission'
);

reset role;
select set_config('request.identity.id', '44444444-4444-4444-4444-444444444444', true);
set local role authenticated;

select lives_ok(
  $$
    update public.organizations
    set
      legal_name = 'Updated Profile Test Organization',
      timezone = 'Asia/Kolkata',
      default_currency = 'INR'
    where slug = 'profile-test-organization'
  $$,
  'owner can update organization operating defaults'
);

select is(
  (select timezone from public.organizations where slug = 'profile-test-organization'),
  'Asia/Kolkata',
  'updated organization defaults are persisted'
);

select throws_ok(
  $$
    update public.organizations
    set slug = 'changed-profile-test-organization'
    where slug = 'profile-test-organization'
  $$,
  '22023',
  'organization slug is immutable',
  'database trigger prevents organization slug changes'
);

select * from finish();
rollback;
