begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(15);

insert into public.identity_accounts (
  id, auth_provider, provider_subject, email, email_confirmed_at, raw_user_meta_data
)
values
  ('77777777-7777-4777-8777-777777777771'::uuid, 'agencyos', '77777777-7777-4777-8777-777777777771', 'crm-owner-a@example.test', now(), '{}'::jsonb),
  ('77777777-7777-4777-8777-777777777772'::uuid, 'agencyos', '77777777-7777-4777-8777-777777777772', 'crm-owner-b@example.test', now(), '{}'::jsonb),
  ('77777777-7777-4777-8777-777777777773'::uuid, 'agencyos', '77777777-7777-4777-8777-777777777773', 'crm-sales-a@example.test', now(), '{}'::jsonb)
on conflict (id) do nothing;

select private.bootstrap_organization(
  '77777777-7777-4777-8777-777777777771',
  'CRM Organization A',
  'crm-organization-a',
  'US',
  'UTC',
  'USD'
);

select private.bootstrap_organization(
  '77777777-7777-4777-8777-777777777772',
  'CRM Organization B',
  'crm-organization-b',
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
  '77777777-7777-4777-8777-777777777773',
  'active',
  now(),
  now(),
  '77777777-7777-4777-8777-777777777771'
from public.organizations as organization
where organization.slug = 'crm-organization-a';

insert into public.membership_roles (membership_id, role_id, assigned_by)
select
  membership.id,
  role.id,
  '77777777-7777-4777-8777-777777777771'
from public.memberships as membership
join public.roles as role
  on role.organization_id = membership.organization_id
 and role.key = 'sales_executive'
where membership.user_id = '77777777-7777-4777-8777-777777777773';

insert into public.teams (organization_id, name, description, status, created_by)
select id, 'CRM Team', 'CRM scope test team', 'active', '77777777-7777-4777-8777-777777777771'
from public.organizations
where slug = 'crm-organization-a';

insert into public.team_members (team_id, membership_id, is_lead, added_by)
select
  team.id,
  membership.id,
  membership.user_id = '77777777-7777-4777-8777-777777777771',
  '77777777-7777-4777-8777-777777777771'
from public.teams as team
join public.memberships as membership on membership.organization_id = team.organization_id
where team.name = 'CRM Team'
  and membership.user_id in (
    '77777777-7777-4777-8777-777777777771',
    '77777777-7777-4777-8777-777777777773'
  );

select is(
  (
    select count(*)::integer
    from public.crm_pipeline_stages as stage
    join public.organizations as organization on organization.id = stage.organization_id
    where organization.slug = 'crm-organization-a'
  ),
  7,
  'organization bootstrap creates the seven default CRM pipeline stages'
);

insert into public.crm_companies (
  organization_id,
  legal_name,
  display_name,
  account_owner_membership_id,
  created_by_membership_id,
  created_by
)
select
  organization.id,
  seed.legal_name,
  seed.display_name,
  owner_membership.id,
  creator_membership.id,
  creator_membership.user_id
from public.organizations as organization
join public.memberships as creator_membership
  on creator_membership.organization_id = organization.id
 and creator_membership.user_id = case
   when organization.slug = 'crm-organization-a' then '77777777-7777-4777-8777-777777777771'::uuid
   else '77777777-7777-4777-8777-777777777772'::uuid
 end
cross join lateral (
  values
    (
      case when organization.slug = 'crm-organization-a' then 'Assigned Company A' else 'Company B' end,
      case when organization.slug = 'crm-organization-a' then 'Assigned A' else 'B' end,
      case when organization.slug = 'crm-organization-a' then '77777777-7777-4777-8777-777777777773'::uuid else '77777777-7777-4777-8777-777777777772'::uuid end
    )
) as seed(legal_name, display_name, owner_user_id)
join public.memberships as owner_membership
  on owner_membership.organization_id = organization.id
 and owner_membership.user_id = seed.owner_user_id
where organization.slug in ('crm-organization-a', 'crm-organization-b');

insert into public.crm_companies (
  organization_id,
  legal_name,
  account_owner_membership_id,
  created_by_membership_id,
  created_by
)
select organization.id, 'Owner Company A', owner_membership.id, owner_membership.id, owner_membership.user_id
from public.organizations as organization
join public.memberships as owner_membership
  on owner_membership.organization_id = organization.id
 and owner_membership.user_id = '77777777-7777-4777-8777-777777777771'
where organization.slug = 'crm-organization-a';

insert into public.crm_contacts (
  organization_id,
  company_id,
  first_name,
  last_name,
  email,
  owner_membership_id,
  created_by_membership_id,
  created_by
)
select
  company.organization_id,
  company.id,
  'Assigned',
  'Contact',
  'assigned-contact@example.test',
  sales_membership.id,
  owner_membership.id,
  owner_membership.user_id
from public.crm_companies as company
join public.organizations as organization on organization.id = company.organization_id
join public.memberships as sales_membership
  on sales_membership.organization_id = organization.id
 and sales_membership.user_id = '77777777-7777-4777-8777-777777777773'
join public.memberships as owner_membership
  on owner_membership.organization_id = organization.id
 and owner_membership.user_id = '77777777-7777-4777-8777-777777777771'
where organization.slug = 'crm-organization-a'
  and company.legal_name = 'Assigned Company A';

insert into public.crm_leads (
  organization_id,
  name,
  stage_id,
  probability,
  owner_membership_id,
  created_by_membership_id,
  created_by
)
select
  organization.id,
  seed.name,
  stage.id,
  stage.probability,
  owner_membership.id,
  creator_membership.id,
  creator_membership.user_id
from public.organizations as organization
join public.crm_pipeline_stages as stage
  on stage.organization_id = organization.id and stage.slug = 'new'
join public.memberships as creator_membership
  on creator_membership.organization_id = organization.id
 and creator_membership.user_id = case
   when organization.slug = 'crm-organization-a' then '77777777-7777-4777-8777-777777777771'::uuid
   else '77777777-7777-4777-8777-777777777772'::uuid
 end
cross join lateral (
  values
    (
      case when organization.slug = 'crm-organization-a' then 'Assigned Lead A' else 'Lead B' end,
      case when organization.slug = 'crm-organization-a' then '77777777-7777-4777-8777-777777777773'::uuid else '77777777-7777-4777-8777-777777777772'::uuid end
    )
) as seed(name, owner_user_id)
join public.memberships as owner_membership
  on owner_membership.organization_id = organization.id
 and owner_membership.user_id = seed.owner_user_id
where organization.slug in ('crm-organization-a', 'crm-organization-b');

insert into public.crm_leads (
  organization_id,
  name,
  stage_id,
  probability,
  owner_membership_id,
  created_by_membership_id,
  created_by
)
select
  organization.id,
  'Owner Lead A',
  stage.id,
  stage.probability,
  owner_membership.id,
  owner_membership.id,
  owner_membership.user_id
from public.organizations as organization
join public.crm_pipeline_stages as stage
  on stage.organization_id = organization.id and stage.slug = 'new'
join public.memberships as owner_membership
  on owner_membership.organization_id = organization.id
 and owner_membership.user_id = '77777777-7777-4777-8777-777777777771'
where organization.slug = 'crm-organization-a';

insert into public.crm_activities (
  organization_id,
  lead_id,
  activity_type,
  subject,
  created_by_membership_id
)
select lead.organization_id, lead.id, 'note', 'Seed activity', owner_membership.id
from public.crm_leads as lead
join public.memberships as owner_membership
  on owner_membership.organization_id = lead.organization_id
 and owner_membership.user_id = '77777777-7777-4777-8777-777777777771'
where lead.name in ('Assigned Lead A', 'Owner Lead A');

select throws_ok(
  $$
    insert into public.crm_leads (
      organization_id, name, stage_id, owner_membership_id, created_by_membership_id, created_by
    )
    select
      organization_a.id,
      'Cross-tenant stage lead',
      stage_b.id,
      owner_a.id,
      owner_a.id,
      owner_a.user_id
    from public.organizations as organization_a
    join public.memberships as owner_a
      on owner_a.organization_id = organization_a.id
     and owner_a.user_id = '77777777-7777-4777-8777-777777777771'
    cross join public.organizations as organization_b
    join public.crm_pipeline_stages as stage_b
      on stage_b.organization_id = organization_b.id and stage_b.slug = 'new'
    where organization_a.slug = 'crm-organization-a'
      and organization_b.slug = 'crm-organization-b'
  $$,
  '23514',
  'CRM lead stage must belong to the same organization',
  'cross-organization pipeline stages are rejected'
);

select throws_ok(
  $$
    insert into public.crm_companies (
      organization_id, legal_name, account_owner_membership_id, created_by_membership_id, created_by
    )
    select organization_a.id, 'Cross-tenant owner company', owner_b.id, owner_a.id, owner_a.user_id
    from public.organizations as organization_a
    join public.memberships as owner_a
      on owner_a.organization_id = organization_a.id
     and owner_a.user_id = '77777777-7777-4777-8777-777777777771'
    cross join public.organizations as organization_b
    join public.memberships as owner_b
      on owner_b.organization_id = organization_b.id
     and owner_b.user_id = '77777777-7777-4777-8777-777777777772'
    where organization_a.slug = 'crm-organization-a'
      and organization_b.slug = 'crm-organization-b'
  $$,
  '23514',
  'CRM company owner must be active in the same organization',
  'cross-organization CRM ownership is rejected'
);

select throws_ok(
  $$
    insert into public.crm_activities (
      organization_id, company_id, activity_type, subject, created_by_membership_id
    )
    select organization_a.id, company_b.id, 'note', 'Cross-tenant activity', owner_a.id
    from public.organizations as organization_a
    join public.memberships as owner_a
      on owner_a.organization_id = organization_a.id
     and owner_a.user_id = '77777777-7777-4777-8777-777777777771'
    cross join public.organizations as organization_b
    join public.crm_companies as company_b on company_b.organization_id = organization_b.id
    where organization_a.slug = 'crm-organization-a'
      and organization_b.slug = 'crm-organization-b'
    limit 1
  $$,
  '23514',
  'CRM activity record must belong to the same organization',
  'cross-organization CRM activities are rejected'
);

select ok(
  private.crm_scope_allows_membership(
    (select id from public.memberships where user_id = '77777777-7777-4777-8777-777777777773'),
    'team',
    (select id from public.memberships where user_id = '77777777-7777-4777-8777-777777777771'),
    null
  ),
  'team scope allows records owned by a member of the same active team'
);

select set_config('request.identity.id', '77777777-7777-4777-8777-777777777771', true);
set local role authenticated;

select ok(
  private.has_permission(
    (select id from public.organizations where slug = 'crm-organization-a'),
    'crm.pipeline.manage'
  ),
  'organization owner receives CRM pipeline management permission'
);

select is(
  (select count(*)::integer from public.crm_companies),
  2,
  'owner can read all companies in their organization and no cross-tenant companies'
);

select is(
  (select count(*)::integer from public.crm_leads),
  2,
  'owner can read all leads in their organization and no cross-tenant leads'
);

select lives_ok(
  $$
    insert into public.crm_activities (
      organization_id, lead_id, activity_type, subject, created_by_membership_id
    )
    select lead.organization_id, lead.id, 'call', 'Owner-created activity', membership.id
    from public.crm_leads as lead
    join public.memberships as membership
      on membership.organization_id = lead.organization_id
     and membership.user_id = '77777777-7777-4777-8777-777777777771'
    where lead.name = 'Owner Lead A'
  $$,
  'authorized owner can create a CRM activity'
);

reset role;
select set_config('request.identity.id', '77777777-7777-4777-8777-777777777773', true);
set local role authenticated;

select is(
  private.effective_permission_scope(
    (select id from public.organizations where slug = 'crm-organization-a'),
    'crm.lead.view'
  ),
  'assigned_or_created',
  'sales executive receives assigned-or-created lead scope'
);

select is(
  (select count(*)::integer from public.crm_leads),
  1,
  'sales executive only sees assigned or self-created leads'
);

select is(
  (select count(*)::integer from public.crm_activities),
  1,
  'activity visibility follows the related record scope'
);

reset role;

insert into public.membership_permission_overrides (
  membership_id,
  permission_id,
  effect,
  scope,
  reason,
  granted_by
)
select
  membership.id,
  permission.id,
  'allow',
  'organization',
  'CRM pgTAP organization-scope test',
  '77777777-7777-4777-8777-777777777771'
from public.memberships as membership
cross join public.permissions as permission
where membership.user_id = '77777777-7777-4777-8777-777777777773'
  and permission.key = 'crm.lead.view';

set local role authenticated;

select is(
  (select count(*)::integer from public.crm_leads),
  2,
  'explicit allow override expands CRM lead visibility to organization scope'
);

reset role;

update public.membership_permission_overrides
set effect = 'deny', scope = null, reason = 'CRM pgTAP deny test'
where membership_id = (
  select id from public.memberships where user_id = '77777777-7777-4777-8777-777777777773'
)
and permission_id = (
  select id from public.permissions where key = 'crm.lead.view'
);

set local role authenticated;

select is(
  (select count(*)::integer from public.crm_leads),
  0,
  'explicit deny override removes CRM lead visibility'
);

select is(
  private.effective_permission_scope(
    (select id from public.organizations where slug = 'crm-organization-a'),
    'crm.lead.view'
  ),
  null,
  'effective CRM scope resolves to null when an active deny override exists'
);

select * from finish();
rollback;
