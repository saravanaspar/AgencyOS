set lock_timeout = '10s';
set statement_timeout = '60s';

-- This helper accepts an arbitrary membership ID and is used only from trusted
-- workers and security-definer approval triggers. API clients must use
-- private.has_permission(), which is scoped to auth.uid().
revoke all on function private.membership_has_permission(uuid, text)
from public, anon, authenticated;

grant execute on function private.membership_has_permission(uuid, text)
to service_role;
