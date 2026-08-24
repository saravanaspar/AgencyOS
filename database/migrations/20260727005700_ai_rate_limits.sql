alter table public.organization_security_policies
  add column ai_limit_per_minute integer not null default 10;

alter table public.organization_security_policies
  drop constraint organization_security_policy_rate_bounds;

alter table public.organization_security_policies
  add constraint organization_security_policy_rate_bounds check (
    login_limit_per_window between 3 and 100
    and password_reset_limit_per_window between 1 and 30
    and api_limit_per_minute between 10 and 5000
    and ai_limit_per_minute between 1 and 100
    and worker_limit_per_minute between 5 and 1000
    and export_limit_per_minute between 1 and 100
    and mcp_limit_per_minute between 1 and 500
  );
