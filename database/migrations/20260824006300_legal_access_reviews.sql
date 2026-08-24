-- Periodic legal-access review. Campaigns snapshot effective sensitive legal access,
-- reviewers attest retain/revoke decisions, and completion evidence is append-only and hashed.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('legal', 'access_review', 'view', 'View organization legal-access review evidence.', true),
  ('legal', 'access_review', 'manage_access', 'Attest, revoke, and complete legal-access reviews.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where permission.module = 'legal'
  and permission.resource = 'access_review'
  and role_template.key in ('owner', 'legal_manager')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key = 'legal.access_review.view'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'legal' and permission.resource = 'access_review'
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.legal_access_review_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scheduled_for date not null,
  opened_at timestamptz not null default now(),
  due_at timestamptz not null,
  snapshot_item_count integer not null,
  created_source text not null default 'worker',
  created_by_membership_id uuid references public.memberships(id) on delete restrict,
  completed_at timestamptz,
  completed_by_membership_id uuid references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint legal_access_review_campaigns_schedule_valid check (
    due_at = opened_at + interval '14 days'
  ),
  constraint legal_access_review_campaigns_item_count_valid check (snapshot_item_count >= 0),
  constraint legal_access_review_campaigns_source_valid check (created_source in ('worker', 'web')),
  constraint legal_access_review_campaigns_creator_valid check (
    (created_source = 'worker' and created_by_membership_id is null)
    or (created_source = 'web' and created_by_membership_id is not null)
  ),
  constraint legal_access_review_campaigns_completion_valid check (
    (completed_at is null and completed_by_membership_id is null)
    or (completed_at is not null and completed_by_membership_id is not null)
  ),
  unique (organization_id, scheduled_for)
);
create unique index legal_access_review_campaigns_one_open_idx
  on public.legal_access_review_campaigns (organization_id)
  where completed_at is null;
create index legal_access_review_campaigns_history_idx
  on public.legal_access_review_campaigns (organization_id, scheduled_for desc, id desc);

create table public.legal_access_review_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.legal_access_review_campaigns(id) on delete restrict,
  subject_membership_id uuid not null references public.memberships(id) on delete restrict,
  subject_user_id uuid not null references public.identity_accounts(id) on delete restrict,
  subject_display_name text not null,
  subject_email text not null,
  access_snapshot jsonb not null,
  permission_count integer not null,
  snapshot_digest text not null,
  created_at timestamptz not null default now(),
  constraint legal_access_review_items_name_valid check (
    char_length(btrim(subject_display_name)) between 1 and 180
  ),
  constraint legal_access_review_items_email_valid check (
    char_length(btrim(subject_email)) between 3 and 320
  ),
  constraint legal_access_review_items_snapshot_valid check (
    jsonb_typeof(access_snapshot) = 'object'
    and jsonb_typeof(access_snapshot -> 'permissions') = 'array'
    and jsonb_array_length(access_snapshot -> 'permissions') > 0
  ),
  constraint legal_access_review_items_permission_count_valid check (
    permission_count > 0
    and permission_count = jsonb_array_length(access_snapshot -> 'permissions')
  ),
  constraint legal_access_review_items_digest_valid check (snapshot_digest ~ '^[0-9a-f]{64}$'),
  unique (campaign_id, subject_membership_id),
  unique (campaign_id, id)
);
create index legal_access_review_items_campaign_idx
  on public.legal_access_review_items (campaign_id, subject_display_name, id);

create table public.legal_access_review_attestations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.legal_access_review_campaigns(id) on delete restrict,
  item_id uuid not null,
  reviewer_membership_id uuid not null references public.memberships(id) on delete restrict,
  decision text not null,
  rationale text not null,
  self_review boolean not null default false,
  reviewed_access_digest text not null,
  revocation_snapshot jsonb not null default '{}'::jsonb,
  evidence_snapshot jsonb not null,
  attestation_digest text not null,
  attested_at timestamptz not null default now(),
  constraint legal_access_review_attestations_item_fk
    foreign key (campaign_id, item_id)
    references public.legal_access_review_items(campaign_id, id) on delete restrict,
  constraint legal_access_review_attestations_decision_valid check (
    decision in ('retain', 'revoke')
  ),
  constraint legal_access_review_attestations_rationale_valid check (
    char_length(btrim(rationale)) between 10 and 1000
  ),
  constraint legal_access_review_attestations_access_digest_valid check (
    reviewed_access_digest ~ '^[0-9a-f]{64}$'
  ),
  constraint legal_access_review_attestations_revocation_object check (
    jsonb_typeof(revocation_snapshot) = 'object'
  ),
  constraint legal_access_review_attestations_evidence_object check (
    jsonb_typeof(evidence_snapshot) = 'object'
  ),
  constraint legal_access_review_attestations_digest_valid check (
    attestation_digest ~ '^[0-9a-f]{64}$'
  ),
  unique (item_id)
);
create index legal_access_review_attestations_campaign_idx
  on public.legal_access_review_attestations (campaign_id, attested_at, id);

create table public.legal_access_review_completions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null unique references public.legal_access_review_campaigns(id) on delete restrict,
  completed_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  item_count integer not null default 0,
  retain_count integer not null default 0,
  revoke_count integer not null default 0,
  self_review_count integer not null default 0,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  evidence_digest text not null,
  completed_at timestamptz not null default now(),
  constraint legal_access_review_completions_counts_valid check (
    item_count >= 0 and retain_count >= 0 and revoke_count >= 0 and self_review_count >= 0
    and retain_count + revoke_count = item_count
    and self_review_count <= item_count
  ),
  constraint legal_access_review_completions_evidence_object check (
    jsonb_typeof(evidence_snapshot) = 'object'
  ),
  constraint legal_access_review_completions_digest_valid check (
    evidence_digest ~ '^[0-9a-f]{64}$'
  )
);
create index legal_access_review_completions_history_idx
  on public.legal_access_review_completions (organization_id, completed_at desc, id desc);

create or replace function private.legal_access_review_membership_access_allowed(
  p_campaign_id uuid,
  p_membership_id uuid,
  p_permission_key text
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_organization_id uuid; v_scope text;
begin
  select campaign.organization_id into v_organization_id
  from public.legal_access_review_campaigns as campaign
  where campaign.id = p_campaign_id;
  if v_organization_id is null then return false; end if;
  if not exists (
    select 1 from public.memberships as membership
    where membership.id = p_membership_id
      and membership.organization_id = v_organization_id
      and membership.status = 'active'
  ) then return false; end if;
  v_scope := private.membership_effective_permission_scope(
    p_membership_id, p_permission_key
  );
  return v_scope = 'organization';
end; $$;

create or replace function private.legal_access_review_access_allowed(
  p_campaign_id uuid,
  p_permission_key text
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_organization_id uuid; v_membership_id uuid;
begin
  select campaign.organization_id into v_organization_id
  from public.legal_access_review_campaigns as campaign
  where campaign.id = p_campaign_id;
  if v_organization_id is null then return false; end if;
  v_membership_id := private.current_membership_id(v_organization_id);
  if v_membership_id is null then return false; end if;
  return private.legal_access_review_membership_access_allowed(
    p_campaign_id, v_membership_id, p_permission_key
  );
end; $$;

create or replace function private.legal_access_review_sha256(p_evidence jsonb)
returns text
language sql immutable security definer set search_path = '' as $$
  select encode(extensions.digest(convert_to(p_evidence::text, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function private.validate_legal_access_review_campaign()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.created_by_membership_id is not null and not exists (
    select 1 from public.memberships as membership
    where membership.id = new.created_by_membership_id
      and membership.organization_id = new.organization_id
      and membership.status = 'active'
  ) then
    raise exception 'Legal access-review creator must be an active organization member.';
  end if;
  return new;
end; $$;

create or replace function private.protect_legal_access_review_campaign()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Legal access-review campaigns are permanent.';
  end if;
  if new.id <> old.id or new.organization_id <> old.organization_id
    or new.scheduled_for <> old.scheduled_for or new.opened_at <> old.opened_at
    or new.due_at <> old.due_at or new.snapshot_item_count <> old.snapshot_item_count
    or new.created_source <> old.created_source
    or new.created_by_membership_id is distinct from old.created_by_membership_id
    or new.created_at <> old.created_at
  then raise exception 'Legal access-review campaign evidence is immutable.'; end if;
  if old.completed_at is not null
    or new.completed_at is null
    or new.completed_by_membership_id is null
    or not exists (
      select 1 from public.legal_access_review_completions as completion
      where completion.campaign_id = old.id
        and completion.organization_id = old.organization_id
        and completion.completed_at = new.completed_at
        and completion.completed_by_membership_id = new.completed_by_membership_id
    )
  then raise exception 'Legal access-review campaign completion is invalid.'; end if;
  return new;
end; $$;

create or replace function private.validate_legal_access_review_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_campaign public.legal_access_review_campaigns%rowtype;
begin
  select * into v_campaign from public.legal_access_review_campaigns
  where id = new.campaign_id;
  if v_campaign.id is null or v_campaign.organization_id <> new.organization_id
    or v_campaign.completed_at is not null
  then raise exception 'Legal access-review item campaign is invalid.'; end if;
  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.subject_membership_id
      and membership.organization_id = new.organization_id
      and membership.user_id = new.subject_user_id
      and membership.status = 'active'
  ) then raise exception 'Legal access-review subject must be an active organization member.'; end if;
  if exists (
    select 1 from jsonb_array_elements(new.access_snapshot -> 'permissions') as entry
    left join public.permissions as permission
      on permission.id = (entry ->> 'permissionId')::uuid
    where permission.id is null or permission.module <> 'legal' or not permission.is_sensitive
      or permission.key is distinct from entry ->> 'key'
      or entry ->> 'effectiveScope' is null
      or jsonb_typeof(entry -> 'sources') <> 'array'
  ) then raise exception 'Legal access-review snapshot contains invalid access evidence.'; end if;
  new.snapshot_digest := private.legal_access_review_sha256(new.access_snapshot);
  return new;
end; $$;

create or replace function private.validate_legal_access_review_attestation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_item public.legal_access_review_items%rowtype;
  v_campaign public.legal_access_review_campaigns%rowtype;
begin
  select * into v_item from public.legal_access_review_items where id = new.item_id;
  select * into v_campaign from public.legal_access_review_campaigns where id = new.campaign_id;
  if v_item.id is null or v_campaign.id is null
    or v_item.campaign_id <> new.campaign_id
    or v_item.organization_id <> new.organization_id
    or v_campaign.organization_id <> new.organization_id
    or v_campaign.completed_at is not null
  then raise exception 'Legal access-review attestation scope is invalid.'; end if;
  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.reviewer_membership_id
      and membership.organization_id = new.organization_id
      and membership.status = 'active'
  ) then raise exception 'Legal access-review reviewer must be an active organization member.'; end if;
  if new.reviewed_access_digest <> v_item.snapshot_digest then
    raise exception 'Legal access-review snapshot digest does not match.';
  end if;
  if new.self_review <> (new.reviewer_membership_id = v_item.subject_membership_id) then
    raise exception 'Self-review evidence must be explicitly and accurately flagged.';
  end if;
  if new.decision = 'retain' and new.revocation_snapshot <> '{}'::jsonb then
    raise exception 'Retain attestations cannot contain revocation evidence.';
  end if;
  if new.decision = 'revoke' then
    if jsonb_typeof(new.revocation_snapshot -> 'overrides') <> 'array'
      or jsonb_array_length(new.revocation_snapshot -> 'overrides') <> v_item.permission_count
      or exists (
        select 1
        from jsonb_array_elements(v_item.access_snapshot -> 'permissions') as entry
        join public.permissions as permission
          on permission.id = (entry ->> 'permissionId')::uuid
        left join public.membership_permission_overrides as override_grant
          on override_grant.membership_id = v_item.subject_membership_id
         and override_grant.permission_id = permission.id
        where override_grant.effect is distinct from 'deny'
          or override_grant.expires_at is not null
      )
    then raise exception 'Revoke attestations require permanent explicit deny overrides.'; end if;
  end if;
  new.evidence_snapshot := jsonb_build_object(
    'campaignId', new.campaign_id,
    'itemId', new.item_id,
    'subjectMembershipId', v_item.subject_membership_id,
    'reviewerMembershipId', new.reviewer_membership_id,
    'decision', new.decision,
    'rationale', new.rationale,
    'selfReview', new.self_review,
    'reviewedAccessDigest', new.reviewed_access_digest,
    'revocation', new.revocation_snapshot,
    'attestedAt', new.attested_at
  );
  new.attestation_digest := private.legal_access_review_sha256(new.evidence_snapshot);
  return new;
end; $$;

create or replace function private.validate_legal_access_review_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_campaign public.legal_access_review_campaigns%rowtype;
  v_item_count integer;
  v_attestation_count integer;
begin
  select * into v_campaign from public.legal_access_review_campaigns
  where id = new.campaign_id for update;
  if v_campaign.id is null or v_campaign.organization_id <> new.organization_id
    or v_campaign.completed_at is not null
  then raise exception 'Legal access-review completion scope is invalid.'; end if;
  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.completed_by_membership_id
      and membership.organization_id = new.organization_id
      and membership.status = 'active'
  ) or not private.legal_access_review_membership_access_allowed(
    new.campaign_id, new.completed_by_membership_id, 'legal.access_review.manage_access'
  ) then raise exception 'Legal access-review completer requires organization access.'; end if;

  select count(*)::integer into v_item_count
  from public.legal_access_review_items as item
  where item.campaign_id = new.campaign_id
    and item.organization_id = new.organization_id;
  select count(*)::integer into v_attestation_count
  from public.legal_access_review_attestations as attestation
  where attestation.campaign_id = new.campaign_id
    and attestation.organization_id = new.organization_id;
  if v_item_count <> v_campaign.snapshot_item_count
    or v_attestation_count <> v_item_count
    or exists (
      select 1 from public.legal_access_review_items as item
      where item.campaign_id = new.campaign_id
        and item.organization_id = new.organization_id
        and not exists (
          select 1 from public.legal_access_review_attestations as attestation
          where attestation.item_id = item.id
            and attestation.campaign_id = item.campaign_id
            and attestation.organization_id = item.organization_id
        )
    )
  then raise exception 'Every legal access-review item requires an immutable attestation.'; end if;

  select count(*)::integer,
    count(*) filter (where attestation.decision = 'retain')::integer,
    count(*) filter (where attestation.decision = 'revoke')::integer,
    count(*) filter (where attestation.self_review)::integer
  into new.item_count, new.retain_count, new.revoke_count, new.self_review_count
  from public.legal_access_review_attestations as attestation
  where attestation.campaign_id = new.campaign_id
    and attestation.organization_id = new.organization_id;

  new.evidence_snapshot := jsonb_build_object(
    'campaign', jsonb_build_object(
      'id', v_campaign.id,
      'organizationId', v_campaign.organization_id,
      'scheduledFor', v_campaign.scheduled_for,
      'openedAt', v_campaign.opened_at,
      'dueAt', v_campaign.due_at,
      'snapshotItemCount', v_campaign.snapshot_item_count
    ),
    'completion', jsonb_build_object(
      'completedByMembershipId', new.completed_by_membership_id,
      'completedAt', new.completed_at,
      'itemCount', new.item_count,
      'retainCount', new.retain_count,
      'revokeCount', new.revoke_count,
      'selfReviewCount', new.self_review_count
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemId', item.id,
        'subjectMembershipId', item.subject_membership_id,
        'accessSnapshotDigest', item.snapshot_digest,
        'attestationId', attestation.id,
        'attestationDigest', attestation.attestation_digest,
        'decision', attestation.decision,
        'selfReview', attestation.self_review,
        'attestedAt', attestation.attested_at
      ) order by item.id)
      from public.legal_access_review_items as item
      join public.legal_access_review_attestations as attestation on attestation.item_id = item.id
      where item.campaign_id = new.campaign_id
        and item.organization_id = new.organization_id
    ), '[]'::jsonb)
  );
  new.evidence_digest := private.legal_access_review_sha256(new.evidence_snapshot);
  return new;
end; $$;

create or replace function private.prevent_legal_access_review_evidence_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin raise exception 'Legal access-review evidence is immutable.'; end; $$;

create trigger legal_access_review_campaigns_validate
before insert on public.legal_access_review_campaigns
for each row execute function private.validate_legal_access_review_campaign();
create trigger legal_access_review_campaigns_protect
before update or delete on public.legal_access_review_campaigns
for each row execute function private.protect_legal_access_review_campaign();
create trigger legal_access_review_items_validate
before insert on public.legal_access_review_items
for each row execute function private.validate_legal_access_review_item();
create trigger legal_access_review_items_immutable
before update or delete on public.legal_access_review_items
for each row execute function private.prevent_legal_access_review_evidence_mutation();
create trigger legal_access_review_attestations_validate
before insert on public.legal_access_review_attestations
for each row execute function private.validate_legal_access_review_attestation();
create trigger legal_access_review_attestations_immutable
before update or delete on public.legal_access_review_attestations
for each row execute function private.prevent_legal_access_review_evidence_mutation();
create trigger legal_access_review_completions_validate
before insert on public.legal_access_review_completions
for each row execute function private.validate_legal_access_review_completion();
create trigger legal_access_review_completions_immutable
before update or delete on public.legal_access_review_completions
for each row execute function private.prevent_legal_access_review_evidence_mutation();

alter table public.legal_access_review_campaigns enable row level security;
alter table public.legal_access_review_items enable row level security;
alter table public.legal_access_review_attestations enable row level security;
alter table public.legal_access_review_completions enable row level security;

revoke all on public.legal_access_review_campaigns, public.legal_access_review_items,
  public.legal_access_review_attestations, public.legal_access_review_completions
  from anon, authenticated;
grant select on public.legal_access_review_campaigns, public.legal_access_review_items,
  public.legal_access_review_attestations, public.legal_access_review_completions
  to authenticated;
grant all on public.legal_access_review_campaigns, public.legal_access_review_items,
  public.legal_access_review_attestations, public.legal_access_review_completions
  to service_role;

create policy legal_access_review_campaigns_select on public.legal_access_review_campaigns
for select to authenticated using (
  private.legal_access_review_access_allowed(id, 'legal.access_review.view')
);
create policy legal_access_review_items_select on public.legal_access_review_items
for select to authenticated using (
  private.legal_access_review_access_allowed(campaign_id, 'legal.access_review.view')
);
create policy legal_access_review_attestations_select on public.legal_access_review_attestations
for select to authenticated using (
  private.legal_access_review_access_allowed(campaign_id, 'legal.access_review.view')
);
create policy legal_access_review_completions_select on public.legal_access_review_completions
for select to authenticated using (
  private.legal_access_review_access_allowed(campaign_id, 'legal.access_review.view')
);

revoke all on function private.legal_access_review_membership_access_allowed(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function private.legal_access_review_access_allowed(uuid, text)
  from public, anon;
revoke all on function private.legal_access_review_sha256(jsonb)
  from public, anon, authenticated;
revoke all on function private.validate_legal_access_review_campaign()
  from public, anon, authenticated;
revoke all on function private.protect_legal_access_review_campaign()
  from public, anon, authenticated;
revoke all on function private.validate_legal_access_review_item()
  from public, anon, authenticated;
revoke all on function private.validate_legal_access_review_attestation()
  from public, anon, authenticated;
revoke all on function private.validate_legal_access_review_completion()
  from public, anon, authenticated;
revoke all on function private.prevent_legal_access_review_evidence_mutation()
  from public, anon, authenticated;
grant execute on function private.legal_access_review_membership_access_allowed(uuid, uuid, text)
  to service_role;
grant execute on function private.legal_access_review_access_allowed(uuid, text)
  to authenticated, service_role;
