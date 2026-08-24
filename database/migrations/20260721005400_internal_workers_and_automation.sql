-- Replace n8n-specific automation delivery with AgencyOS-owned handlers and one worker secret.

set lock_timeout = '10s';
set statement_timeout = '120s';

-- Existing external workflow definitions cannot be executed by the internal handler registry.
-- Preserve them for review, but disable them before changing the contract.
update public.automation_definitions
set enabled = false,
    last_result = 'cancelled',
    updated_at = now()
where enabled;

alter table public.automation_definitions
  rename column n8n_workflow_id to handler_key;

alter table public.automation_definitions
  drop constraint automation_definitions_workflow_not_blank,
  drop constraint automation_definitions_secret_reference_fixed,
  drop column secret_reference;

alter table public.automation_definitions
  add constraint automation_definitions_handler_key_valid
    check (handler_key ~ '^[a-z][a-z0-9._-]{2,119}$');

-- Repurpose accepted callback history as internal execution history.
alter table public.automation_callback_events
  rename to automation_execution_events;

alter table public.automation_execution_events
  rename column external_execution_id to execution_id;
alter table public.automation_execution_events
  rename column workflow_id to handler_key;
alter table public.automation_execution_events
  rename column received_at to completed_at;

alter table public.automation_execution_events
  rename constraint automation_callback_execution_not_blank to automation_execution_id_not_blank;
alter table public.automation_execution_events
  rename constraint automation_callback_workflow_not_blank to automation_execution_handler_key_valid;
alter table public.automation_execution_events
  rename constraint automation_callback_source_module_valid to automation_execution_source_module_valid;
alter table public.automation_execution_events
  rename constraint automation_callback_status_valid to automation_execution_status_valid;
alter table public.automation_execution_events
  rename constraint automation_callback_summary_bounded to automation_execution_summary_bounded;
alter table public.automation_execution_events
  rename constraint automation_callback_metadata_object to automation_execution_metadata_object;

alter table public.automation_execution_events
  drop constraint automation_callback_nonce_hash_valid,
  drop constraint automation_callback_payload_hash_valid;

drop index public.automation_callback_nonce_unique;

alter table public.automation_execution_events
  drop column nonce_hash,
  drop column payload_hash;

alter index public.automation_callback_execution_unique rename to automation_execution_unique;
alter index public.automation_callback_recent_idx rename to automation_execution_recent_idx;
alter index public.automation_callback_org_recent_idx rename to automation_execution_org_recent_idx;

alter function private.validate_automation_callback_tenant()
  rename to validate_automation_execution_tenant;
alter function private.prevent_automation_callback_mutation()
  rename to prevent_automation_execution_mutation;

create or replace function private.validate_automation_execution_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.automation_definitions as definition
    where definition.id = new.automation_id
      and definition.organization_id = new.organization_id
      and definition.handler_key = new.handler_key
      and new.source_module = any(definition.allowed_modules)
  ) then
    raise exception using errcode = '23514', message = 'Automation execution does not match its definition';
  end if;
  return new;
end;
$$;

create or replace function private.prevent_automation_execution_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'Automation execution history is append-only';
end;
$$;

alter trigger automation_callback_events_validate_tenant
  on public.automation_execution_events
  rename to automation_execution_events_validate_tenant;
alter trigger automation_callback_events_no_update
  on public.automation_execution_events
  rename to automation_execution_events_no_update;
alter trigger automation_callback_events_no_delete
  on public.automation_execution_events
  rename to automation_execution_events_no_delete;

alter policy automation_callback_events_select_authorized
  on public.automation_execution_events
  rename to automation_execution_events_select_authorized;

comment on table public.automation_execution_events is
  'Append-only final execution results produced by AgencyOS internal automation handlers.';
comment on column public.automation_definitions.handler_key is
  'Registry key for an AgencyOS-owned automation handler. Existing external definitions were disabled during migration.';

-- HTTP delivery status is no longer part of internal handler execution.
alter table public.automation_dispatches
  drop constraint automation_dispatches_http_valid,
  drop column last_http_status;

alter table public.automation_dispatch_attempts
  drop constraint automation_dispatch_attempts_http_valid,
  drop column http_status;

-- Remove the retired n8n notification channel and preference flag.
delete from public.notification_deliveries where channel = 'n8n';

drop index public.notification_deliveries_worker_due_idx;

alter table public.notification_deliveries
  drop constraint notification_deliveries_channel_valid,
  add constraint notification_deliveries_channel_valid
    check (channel in ('in_app', 'email', 'browser_push'));

create index notification_deliveries_worker_due_idx
  on public.notification_deliveries (next_attempt_at, created_at)
  where status in ('pending', 'failed') and channel in ('email', 'browser_push');

update public.user_preferences
set notification_preferences = notification_preferences - 'n8nEnabled',
    updated_at = now()
where notification_preferences ? 'n8nEnabled';

alter table public.notifications
  drop constraint notifications_category_valid,
  add constraint notifications_category_valid check (
    category in (
      'assignment',
      'mention',
      'approval_requested',
      'approval_decision',
      'task_due',
      'invoice_overdue',
      'leave_status',
      'contract_expiry',
      'licence_expiry',
      'asset_return',
      'support_reply',
      'security_alert',
      'integration_failure',
      'automation'
    )
  );

-- Recovery drills now refer to the AgencyOS worker/automation subsystem.
update public.security_restore_drills
set drill_type = 'automation'
where drill_type = 'n8n';

alter table public.security_restore_drills
  drop constraint security_restore_drills_type_valid,
  add constraint security_restore_drills_type_valid check (
    drill_type in ('database', 'minio', 'configuration', 'redis', 'automation', 'full')
  );
