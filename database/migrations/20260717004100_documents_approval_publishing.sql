-- Document review and controlled internal publication. Reuses the shared approval engine,
-- immutable document versions, permission scopes, private-file lifecycle, and document events.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('documents', 'document', 'submit_approval', 'Submit permitted document versions for formal review.', true),
  ('documents', 'document', 'publish', 'Publish approved document versions to controlled internal audiences.', true),
  ('documents', 'document', 'withdraw', 'Withdraw or supersede controlled document publications.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where permission.key in (
    'documents.document.submit_approval', 'documents.document.publish', 'documents.document.withdraw'
  )
  and role_template.key in ('owner', 'system_administrator', 'operations_administrator', 'legal_manager')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where permission.key = 'documents.document.submit_approval'
  and role_template.key in ('finance_manager', 'hr_manager', 'project_manager', 'support_manager')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.key in (
  'documents.document.submit_approval', 'documents.document.publish', 'documents.document.withdraw'
)
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.document_review_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete restrict,
  version_id uuid not null references public.document_versions(id) on delete restrict,
  approval_request_id uuid not null unique references public.approval_requests(id) on delete restrict,
  status text not null default 'pending',
  submitted_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint document_review_requests_status_valid check (
    status in ('pending', 'approved', 'rejected', 'revision_requested', 'cancelled', 'expired', 'invalidated')
  ),
  constraint document_review_requests_completion_contract check (
    (status = 'pending' and completed_at is null)
    or (status <> 'pending' and completed_at is not null)
  )
);
create unique index document_review_requests_pending_document_unique
  on public.document_review_requests (document_id) where status = 'pending';
create index document_review_requests_history_idx
  on public.document_review_requests (document_id, submitted_at desc, id desc);
create index document_review_requests_version_idx
  on public.document_review_requests (version_id, status, submitted_at desc);

create table public.document_publications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete restrict,
  version_id uuid not null references public.document_versions(id) on delete restrict,
  publication_number integer not null,
  effective_at timestamptz not null,
  expires_at timestamptz,
  release_note text,
  status text not null default 'active',
  supersedes_publication_id uuid references public.document_publications(id) on delete restrict,
  superseded_by_publication_id uuid references public.document_publications(id) on delete restrict,
  superseded_at timestamptz,
  superseded_by_membership_id uuid references public.memberships(id) on delete restrict,
  withdrawn_at timestamptz,
  withdrawn_by_membership_id uuid references public.memberships(id) on delete restrict,
  withdrawal_reason text,
  published_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint document_publications_number_valid check (publication_number > 0),
  constraint document_publications_status_valid check (status in ('active', 'superseded', 'withdrawn')),
  constraint document_publications_dates_valid check (expires_at is null or expires_at > effective_at),
  constraint document_publications_release_note_valid check (
    release_note is null or char_length(btrim(release_note)) between 1 and 1000
  ),
  constraint document_publications_withdrawal_reason_valid check (
    withdrawal_reason is null or char_length(btrim(withdrawal_reason)) between 3 and 1000
  ),
  constraint document_publications_terminal_contract check (
    (status = 'active' and superseded_at is null and superseded_by_membership_id is null
      and superseded_by_publication_id is null and withdrawn_at is null
      and withdrawn_by_membership_id is null and withdrawal_reason is null)
    or (status = 'superseded' and superseded_at is not null
      and superseded_by_membership_id is not null and withdrawn_at is null
      and withdrawn_by_membership_id is null and withdrawal_reason is null)
    or (status = 'withdrawn' and withdrawn_at is not null
      and withdrawn_by_membership_id is not null and withdrawal_reason is not null
      and superseded_at is null and superseded_by_membership_id is null
      and superseded_by_publication_id is null)
  ),
  unique (document_id, publication_number),
  constraint document_publications_not_self_superseded check (
    supersedes_publication_id is null or supersedes_publication_id <> id
  )
);
create unique index document_publications_one_active_unique
  on public.document_publications (document_id) where status = 'active';
create index document_publications_history_idx
  on public.document_publications (document_id, publication_number desc);
create index document_publications_effective_idx
  on public.document_publications (organization_id, effective_at, expires_at)
  where status = 'active';

create table public.document_publication_audiences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  publication_id uuid not null references public.document_publications(id) on delete restrict,
  audience_type text not null,
  audience_id uuid,
  created_at timestamptz not null default now(),
  constraint document_publication_audiences_type_valid check (
    audience_type in ('organization', 'department', 'team', 'membership')
  ),
  constraint document_publication_audiences_target_contract check (
    (audience_type = 'organization' and audience_id is null)
    or (audience_type <> 'organization' and audience_id is not null)
  )
);
create unique index document_publication_audiences_organization_unique
  on public.document_publication_audiences (publication_id, audience_type)
  where audience_type = 'organization';
create unique index document_publication_audiences_target_unique
  on public.document_publication_audiences (publication_id, audience_type, audience_id)
  where audience_type <> 'organization';
create index document_publication_audiences_target_idx
  on public.document_publication_audiences (organization_id, audience_type, audience_id);

create or replace function private.validate_document_review_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_version record;
  v_approval record;
begin
  select version.document_id, version.organization_id, file.status as file_status
  into v_version
  from public.document_versions as version
  join public.private_files as file on file.id = version.private_file_id
  where version.id = new.version_id;

  if v_version.document_id is distinct from new.document_id
    or v_version.organization_id is distinct from new.organization_id
    or v_version.file_status <> 'available'
  then raise exception 'Document review version must be an available version of the same document.'; end if;

  select organization_id, source_module, entity_type, entity_id, status
  into v_approval from public.approval_requests where id = new.approval_request_id;
  if v_approval.organization_id is distinct from new.organization_id
    or v_approval.source_module <> 'documents'
    or v_approval.entity_type <> 'document_review'
    or v_approval.entity_id is distinct from new.id
    or v_approval.status <> 'pending'
  then raise exception 'Document review approval request is invalid.'; end if;

  if not exists (
    select 1 from public.memberships
    where id = new.submitted_by_membership_id
      and organization_id = new.organization_id and status = 'active'
  ) then raise exception 'Document review submitter is invalid.'; end if;
  return new;
end; $$;

create or replace function private.prevent_document_review_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.document_id is distinct from old.document_id
    or new.version_id is distinct from old.version_id
    or new.approval_request_id is distinct from old.approval_request_id
    or new.submitted_by_membership_id is distinct from old.submitted_by_membership_id
    or new.submitted_at is distinct from old.submitted_at
    or new.created_at is distinct from old.created_at
  then raise exception 'Document review history is immutable.'; end if;
  if old.status <> 'pending' or new.status = 'pending' then
    raise exception 'Document review status transition is invalid.';
  end if;
  return new;
end; $$;

create or replace function private.prevent_document_review_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin raise exception 'Document review history is immutable.'; end; $$;

create or replace function private.prevent_document_version_while_review_pending()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.document_review_requests
    where document_id = new.document_id and status = 'pending'
  ) then raise exception 'A new version cannot be uploaded while document review is pending.'; end if;
  return new;
end; $$;

create or replace function private.validate_document_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_version record;
  v_prior record;
begin
  select document_id, organization_id into v_version
  from public.document_versions where id = new.version_id;
  if v_version.document_id is distinct from new.document_id
    or v_version.organization_id is distinct from new.organization_id
  then raise exception 'Publication version must belong to the same document.'; end if;

  if tg_op = 'INSERT' then
    if new.status <> 'active' then raise exception 'New publications must be active.'; end if;
    if not exists (
      select 1 from public.memberships
      where id = new.published_by_membership_id
        and organization_id = new.organization_id and status = 'active'
    ) then raise exception 'Publication actor is invalid.'; end if;
    if not exists (
      select 1 from public.document_review_requests
      where document_id = new.document_id and version_id = new.version_id and status = 'approved'
    ) then raise exception 'Only an approved document version may be published.'; end if;
    if new.supersedes_publication_id is not null then
      select document_id, organization_id, status into v_prior
      from public.document_publications where id = new.supersedes_publication_id;
      if v_prior.document_id is distinct from new.document_id
        or v_prior.organization_id is distinct from new.organization_id
        or v_prior.status <> 'superseded'
      then raise exception 'Superseded publication is invalid.'; end if;
    end if;
  else
    if new.organization_id is distinct from old.organization_id
      or new.document_id is distinct from old.document_id
      or new.version_id is distinct from old.version_id
      or new.publication_number is distinct from old.publication_number
      or new.effective_at is distinct from old.effective_at
      or new.expires_at is distinct from old.expires_at
      or new.release_note is distinct from old.release_note
      or new.supersedes_publication_id is distinct from old.supersedes_publication_id
      or new.published_by_membership_id is distinct from old.published_by_membership_id
      or new.published_at is distinct from old.published_at
      or new.created_at is distinct from old.created_at
    then raise exception 'Published document releases are immutable.'; end if;
    if old.status = 'active' and new.status not in ('superseded', 'withdrawn') then
      raise exception 'Publication status transition is invalid.';
    elsif old.status = 'superseded' and (
      new.status <> 'superseded'
      or old.superseded_by_publication_id is not null
      or new.superseded_by_publication_id is null
    ) then raise exception 'Superseded publication history is immutable.';
    elsif old.status = 'withdrawn' then
      raise exception 'Withdrawn publication history is immutable.';
    end if;
    if new.status = 'superseded' and not exists (
      select 1 from public.memberships
      where id = new.superseded_by_membership_id
        and organization_id = new.organization_id
    ) then raise exception 'Publication supersession actor is invalid.';
    elsif new.status = 'withdrawn' and not exists (
      select 1 from public.memberships
      where id = new.withdrawn_by_membership_id
        and organization_id = new.organization_id
    ) then raise exception 'Publication withdrawal actor is invalid.';
    end if;
  end if;
  return new;
end; $$;

create or replace function private.prevent_document_publication_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin raise exception 'Document publication history is immutable.'; end; $$;

create or replace function private.validate_document_publication_audience()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_publication record;
begin
  select organization_id into v_publication
  from public.document_publications where id = new.publication_id;
  if v_publication.organization_id is distinct from new.organization_id then
    raise exception 'Publication audience organization mismatch.';
  end if;
  if new.audience_type = 'department' and not exists (
    select 1 from public.departments where id = new.audience_id and organization_id = new.organization_id
  ) then raise exception 'Publication department is invalid.';
  elsif new.audience_type = 'team' and not exists (
    select 1 from public.teams where id = new.audience_id and organization_id = new.organization_id
  ) then raise exception 'Publication team is invalid.';
  elsif new.audience_type = 'membership' and not exists (
    select 1 from public.memberships where id = new.audience_id
      and organization_id = new.organization_id and status = 'active'
  ) then raise exception 'Publication member is invalid.';
  end if;
  return new;
end; $$;

create or replace function private.prevent_document_publication_audience_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin raise exception 'Publication audiences are immutable; publish a new release instead.'; end; $$;

create or replace function private.apply_document_review_approval_result()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_review record;
begin
  if new.source_module <> 'documents' or new.entity_type <> 'document_review'
    or new.entity_id is null or old.status = new.status then return new; end if;
  select id, organization_id, document_id, version_id into v_review
  from public.document_review_requests where id = new.entity_id;
  if v_review.id is null or v_review.organization_id <> new.organization_id then return new; end if;
  if new.status in ('approved', 'rejected', 'revision_requested', 'cancelled', 'expired', 'invalidated') then
    update public.document_review_requests
    set status = new.status, completed_at = coalesce(new.completed_at, now())
    where id = v_review.id and status = 'pending';
    insert into public.document_events (
      organization_id, document_id, version_id, event_type, details
    ) values (
      v_review.organization_id, v_review.document_id, v_review.version_id,
      case when new.status = 'approved' then 'document.review_approved' else 'document.review_closed' end,
      jsonb_build_object('reviewRequestId', v_review.id, 'approvalRequestId', new.id, 'status', new.status)
    );
  end if;
  return new;
end; $$;

-- Publication audiences broaden view/download only; a membership must still hold the corresponding
-- Documents permission. Edit, review, publication, withdrawal, access, archive, and hold operations
-- continue to use their permission scope and ownership boundaries.
create or replace function private.document_membership_access_allowed(
  p_document_id uuid,
  p_membership_id uuid,
  p_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_permission_key text;
  v_permission_scope text;
  v_grant_level text;
  v_scope_allowed boolean := false;
  v_manage_scope text;
  v_publication_allowed boolean := false;
begin
  select * into v_document from public.documents where id = p_document_id;
  if v_document.id is null or not exists (
    select 1 from public.memberships
    where id = p_membership_id and organization_id = v_document.organization_id and status = 'active'
  ) then return false; end if;

  v_permission_key := case p_action
    when 'view' then 'documents.document.view'
    when 'download' then 'documents.document.download'
    when 'comment' then 'documents.document.comment'
    when 'edit' then 'documents.document.update'
    when 'archive' then 'documents.document.archive'
    when 'manage_access' then 'documents.document.manage_access'
    when 'legal_hold' then 'documents.document.legal_hold'
    when 'submit_approval' then 'documents.document.submit_approval'
    when 'publish' then 'documents.document.publish'
    when 'withdraw' then 'documents.document.withdraw'
    else null
  end;
  if v_permission_key is null then return false; end if;

  v_permission_scope := private.membership_effective_permission_scope(p_membership_id, v_permission_key);
  if v_permission_scope is null then return false; end if;

  v_scope_allowed := private.crm_scope_allows_membership(
    p_membership_id, v_permission_scope,
    v_document.owner_membership_id, v_document.created_by_membership_id
  );

  select access_level into v_grant_level
  from public.document_access_grants
  where document_id = p_document_id and membership_id = p_membership_id
    and (expires_at is null or expires_at > now());

  if p_action in ('manage_access', 'legal_hold', 'submit_approval', 'publish', 'withdraw') then
    return v_scope_allowed;
  end if;

  v_manage_scope := private.membership_effective_permission_scope(
    p_membership_id, 'documents.document.manage_access'
  );
  if v_manage_scope is not null and private.crm_scope_allows_membership(
    p_membership_id, v_manage_scope,
    v_document.owner_membership_id, v_document.created_by_membership_id
  ) then return true; end if;

  if p_action in ('view', 'download') and v_grant_level in ('viewer', 'commenter', 'editor') then
    return true;
  end if;
  if p_action = 'comment' and v_grant_level in ('commenter', 'editor') then return true; end if;
  if p_action in ('edit', 'archive') and v_grant_level = 'editor' then return true; end if;

  if p_action in ('view', 'download') then
    select exists (
      select 1
      from public.document_publications as publication
      where publication.document_id = p_document_id
        and publication.status = 'active'
        and publication.effective_at <= now()
        and (publication.expires_at is null or publication.expires_at > now())
        and exists (
          select 1 from public.document_publication_audiences as audience
          where audience.publication_id = publication.id
            and (
              audience.audience_type = 'organization'
              or (audience.audience_type = 'membership' and audience.audience_id = p_membership_id)
              or (audience.audience_type = 'department' and audience.audience_id = (
                select department_id from public.memberships where id = p_membership_id
              ))
              or (audience.audience_type = 'team' and exists (
                select 1 from public.team_members
                where team_id = audience.audience_id and membership_id = p_membership_id
              ))
            )
        )
    ) into v_publication_allowed;
    if v_publication_allowed then return true; end if;
  end if;

  if not v_scope_allowed then return false; end if;
  if p_action in ('view', 'download', 'comment') then
    return v_document.classification = 'internal'
      or v_document.owner_membership_id = p_membership_id
      or v_document.created_by_membership_id = p_membership_id;
  end if;
  return v_document.owner_membership_id = p_membership_id
    or v_document.created_by_membership_id = p_membership_id;
end; $$;

create trigger document_review_requests_validate
before insert on public.document_review_requests
for each row execute function private.validate_document_review_request();
create trigger document_review_requests_prevent_update
before update on public.document_review_requests
for each row execute function private.prevent_document_review_mutation();
create trigger document_review_requests_prevent_delete
before delete on public.document_review_requests
for each row execute function private.prevent_document_review_delete();
create trigger document_versions_block_pending_review
before insert on public.document_versions
for each row execute function private.prevent_document_version_while_review_pending();
create trigger document_publications_validate
before insert or update on public.document_publications
for each row execute function private.validate_document_publication();
create trigger document_publications_prevent_delete
before delete on public.document_publications
for each row execute function private.prevent_document_publication_delete();
create trigger document_publication_audiences_validate
before insert on public.document_publication_audiences
for each row execute function private.validate_document_publication_audience();
create trigger document_publication_audiences_prevent_update
before update on public.document_publication_audiences
for each row execute function private.prevent_document_publication_audience_mutation();
create trigger document_publication_audiences_prevent_delete
before delete on public.document_publication_audiences
for each row execute function private.prevent_document_publication_audience_mutation();
create trigger approval_requests_apply_document_review
after update of status on public.approval_requests
for each row execute function private.apply_document_review_approval_result();

alter table public.document_review_requests enable row level security;
alter table public.document_publications enable row level security;
alter table public.document_publication_audiences enable row level security;

revoke all on public.document_review_requests, public.document_publications,
  public.document_publication_audiences from anon, authenticated;
grant select (
  id, organization_id, document_id, version_id, approval_request_id, status,
  submitted_by_membership_id, submitted_at, completed_at, created_at
) on public.document_review_requests to authenticated;
grant select (
  id, organization_id, document_id, version_id, publication_number, effective_at,
  expires_at, release_note, status, supersedes_publication_id,
  superseded_by_publication_id, superseded_at, withdrawn_at, published_at, created_at
) on public.document_publications to authenticated;
grant select (id, organization_id, publication_id, audience_type)
  on public.document_publication_audiences to authenticated;
grant all on public.document_review_requests, public.document_publications,
  public.document_publication_audiences to service_role;

create policy document_review_requests_select_authorized on public.document_review_requests
for select to authenticated using (private.document_access_allowed(document_id, 'view'));
create policy document_publications_select_authorized on public.document_publications
for select to authenticated using (private.document_access_allowed(document_id, 'view'));
create policy document_publication_audiences_select_authorized on public.document_publication_audiences
for select to authenticated using (exists (
  select 1 from public.document_publications as publication
  where publication.id = publication_id
    and private.document_access_allowed(publication.document_id, 'view')
));

revoke all on function private.validate_document_review_request() from public, anon, authenticated;
revoke all on function private.prevent_document_review_mutation() from public, anon, authenticated;
revoke all on function private.prevent_document_review_delete() from public, anon, authenticated;
revoke all on function private.prevent_document_version_while_review_pending() from public, anon, authenticated;
revoke all on function private.validate_document_publication() from public, anon, authenticated;
revoke all on function private.prevent_document_publication_delete() from public, anon, authenticated;
revoke all on function private.validate_document_publication_audience() from public, anon, authenticated;
revoke all on function private.prevent_document_publication_audience_mutation() from public, anon, authenticated;
revoke all on function private.apply_document_review_approval_result() from public, anon, authenticated;
