-- Protect migration-managed system roles and immutable role identity fields.

set lock_timeout = '10s';
set statement_timeout = '120s';

create or replace function private.protect_role_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'system roles cannot be deleted';
    end if;
    return old;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.key is distinct from old.key
     or new.is_system is distinct from old.is_system
     or new.is_privileged is distinct from old.is_privileged
     or new.template_key is distinct from old.template_key then
    raise exception 'role identity fields are immutable';
  end if;

  if old.is_system and (
    new.name is distinct from old.name
    or new.description is distinct from old.description
    or new.status is distinct from old.status
  ) then
    raise exception 'system roles are migration-managed';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_role_integrity() from public;
grant execute on function private.protect_role_integrity() to service_role;

drop trigger if exists roles_protect_integrity on public.roles;
create trigger roles_protect_integrity
before update or delete on public.roles
for each row execute function private.protect_role_integrity();
