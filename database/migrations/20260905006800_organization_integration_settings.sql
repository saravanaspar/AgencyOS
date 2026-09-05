-- Organization-managed provider configuration. Secrets remain encrypted by the
-- server and are never exposed through direct authenticated table access.
set lock_timeout = '10s';
set statement_timeout = '120s';

create table public.organization_integration_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  configuration jsonb not null default '{}'::jsonb,
  encrypted_secrets text,
  updated_by_membership_id uuid references public.memberships(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_integration_settings_configuration_object check (
    jsonb_typeof(configuration) = 'object'
  ),
  constraint organization_integration_settings_secret_bounded check (
    encrypted_secrets is null or char_length(encrypted_secrets) between 30 and 50000
  )
);

insert into public.organization_integration_settings (organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

create or replace function private.create_default_integration_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_integration_settings (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

create trigger organizations_create_integration_settings
after insert on public.organizations
for each row execute function private.create_default_integration_settings();

create trigger organization_integration_settings_set_updated_at
before update on public.organization_integration_settings
for each row execute function private.set_updated_at();

alter table public.organization_integration_settings enable row level security;
revoke all on public.organization_integration_settings from public, anon, authenticated;
grant select on public.organization_integration_settings to authenticated;
grant all on public.organization_integration_settings to service_role;

revoke all on function private.create_default_integration_settings() from public, anon, authenticated;
grant execute on function private.create_default_integration_settings() to service_role;

create policy organization_integration_settings_select_authorized
on public.organization_integration_settings for select to authenticated
using (private.has_permission(organization_id, 'settings.integration.view'));

comment on table public.organization_integration_settings is
  'Organization-managed provider settings. Secret values are stored only in a server-encrypted envelope.';
