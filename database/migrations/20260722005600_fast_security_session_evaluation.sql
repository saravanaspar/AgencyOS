create or replace function private.evaluate_security_session(
  p_organization_id uuid,
  p_membership_id uuid,
  p_user_id uuid,
  p_session_id uuid,
  p_assurance_level text,
  p_issued_at timestamptz,
  p_privileged boolean,
  p_ip_address inet,
  p_user_agent text,
  p_request_id text
)
returns table (
  decision text,
  effective_assurance_level text,
  effective_reauthenticated_at timestamptz,
  reauthentication_minutes integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.organization_security_policies%rowtype;
  v_session public.security_sessions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_created_at timestamptz;
  v_reauthenticated_at timestamptz;
  v_reason text;
begin
  select *
  into v_policy
  from public.organization_security_policies
  where organization_id = p_organization_id;

  if not found then
    v_policy.require_privileged_mfa := true;
    v_policy.absolute_session_minutes := 720;
    v_policy.idle_timeout_minutes := 30;
    v_policy.reauthentication_minutes := 15;
  end if;

  if p_assurance_level not in ('aal1', 'aal2') then
    raise exception using errcode = '22023', message = 'Unsupported assurance level';
  end if;

  if p_privileged and v_policy.require_privileged_mfa and p_assurance_level <> 'aal2' then
    return query select
      'mfa-required'::text,
      p_assurance_level,
      null::timestamptz,
      v_policy.reauthentication_minutes;
    return;
  end if;

  if p_session_id is null then
    return query select
      'active'::text,
      p_assurance_level,
      null::timestamptz,
      v_policy.reauthentication_minutes;
    return;
  end if;

  select *
  into v_session
  from public.security_sessions
  where id = p_session_id
  for update;

  if found then
    if v_session.organization_id <> p_organization_id
       or v_session.membership_id <> p_membership_id
       or v_session.user_id <> p_user_id
       or v_session.status = 'revoked' then
      return query select
        'session-revoked'::text,
        p_assurance_level,
        v_session.reauthenticated_at,
        v_policy.reauthentication_minutes;
      return;
    end if;

    if v_session.status = 'expired' then
      return query select
        'session-expired'::text,
        p_assurance_level,
        v_session.reauthenticated_at,
        v_policy.reauthentication_minutes;
      return;
    end if;

    if v_session.absolute_expires_at <= v_now or v_session.idle_expires_at <= v_now then
      v_reason := case
        when v_session.absolute_expires_at <= v_now then 'absolute_session_expired'
        else 'idle_timeout_expired'
      end;

      update public.security_sessions
      set status = 'expired',
          revoked_at = v_now,
          revocation_reason = v_reason
      where id = p_session_id and status = 'active';

      insert into public.security_events (
        organization_id, membership_id, session_id, event_type, severity,
        ip_address, user_agent, request_id, metadata
      ) values (
        p_organization_id, p_membership_id, p_session_id,
        'security.session_expired', 'warning', p_ip_address, p_user_agent,
        p_request_id, jsonb_build_object('reason', v_reason)
      );

      return query select
        'session-expired'::text,
        p_assurance_level,
        v_session.reauthenticated_at,
        v_policy.reauthentication_minutes;
      return;
    end if;

    v_reauthenticated_at := case
      when p_assurance_level = 'aal2' and v_session.assurance_level <> 'aal2' then v_now
      else coalesce(v_session.reauthenticated_at, p_issued_at, v_session.created_at)
    end;

    update public.security_sessions
    set assurance_level = p_assurance_level,
        last_seen_at = v_now,
        idle_expires_at = v_now + make_interval(mins => v_policy.idle_timeout_minutes),
        reauthenticated_at = v_reauthenticated_at,
        ip_address = coalesce(p_ip_address, ip_address),
        user_agent = coalesce(p_user_agent, user_agent)
    where id = p_session_id;

    return query select
      'active'::text,
      p_assurance_level,
      v_reauthenticated_at,
      v_policy.reauthentication_minutes;
    return;
  end if;

  v_created_at := least(coalesce(p_issued_at, v_now), v_now);
  v_reauthenticated_at := v_created_at;

  insert into public.security_sessions (
    id, organization_id, membership_id, user_id, status, assurance_level,
    ip_address, user_agent, created_at, last_seen_at, absolute_expires_at,
    idle_expires_at, reauthenticated_at
  ) values (
    p_session_id, p_organization_id, p_membership_id, p_user_id, 'active',
    p_assurance_level, p_ip_address, p_user_agent, v_created_at, v_now,
    v_created_at + make_interval(mins => v_policy.absolute_session_minutes),
    v_now + make_interval(mins => v_policy.idle_timeout_minutes),
    v_reauthenticated_at
  );

  insert into public.security_events (
    organization_id, membership_id, session_id, event_type, severity,
    ip_address, user_agent, request_id, metadata
  ) values (
    p_organization_id, p_membership_id, p_session_id,
    'security.session_created', 'info', p_ip_address, p_user_agent,
    p_request_id, jsonb_build_object('assuranceLevel', p_assurance_level)
  );

  return query select
    'active'::text,
    p_assurance_level,
    v_reauthenticated_at,
    v_policy.reauthentication_minutes;
end;
$$;

comment on function private.evaluate_security_session(
  uuid, uuid, uuid, uuid, text, timestamptz, boolean, inet, text, text
) is 'Atomically validates and refreshes one authenticated security session in a single database round trip.';

revoke all on function private.evaluate_security_session(
  uuid, uuid, uuid, uuid, text, timestamptz, boolean, inet, text, text
) from public, anon, authenticated;

grant execute on function private.evaluate_security_session(
  uuid, uuid, uuid, uuid, text, timestamptz, boolean, inet, text, text
) to service_role;
