-- Protect immutable organization identifiers used in URLs, integrations, and audit records.

set lock_timeout = '10s';
set statement_timeout = '120s';

create or replace function private.prevent_organization_slug_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception using
      errcode = '22023',
      message = 'organization slug is immutable';
  end if;

  return new;
end;
$$;

create trigger organizations_prevent_slug_change
before update of slug on public.organizations
for each row execute function private.prevent_organization_slug_change();
