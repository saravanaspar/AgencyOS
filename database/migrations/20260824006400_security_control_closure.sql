-- Close residual security controls by reusing the shared Approval engine for finance,
-- adding an explicit HR export permission, and enforcing separation of duties in the database.

set lock_timeout = '10s';
set statement_timeout = '120s';

-- HR bulk export is intentionally distinct from generic report viewing/export.
insert into public.permissions (module, resource, action, description, is_sensitive)
values (
  'hr',
  'report',
  'export',
  'Export bulk HR report data after the caller also passes the shared report-export gate.',
  true
)
on conflict (module, resource, action) do update
set description = excluded.description,
    is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('owner', 'hr_manager')
  and permission.key = 'hr.report.export'
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.key = 'hr.report.export'
on conflict (role_id, permission_id) do update
set scope = excluded.scope,
    conditions = excluded.conditions,
    updated_at = now();

-- Link finance records to the exact shared Approval request that controls them.
alter table public.finance_estimates
  add column approval_request_id uuid references public.approval_requests(id) on delete restrict;
alter table public.finance_invoices
  add column approval_request_id uuid references public.approval_requests(id) on delete restrict;
alter table public.finance_credit_notes
  add column approval_request_id uuid references public.approval_requests(id) on delete restrict;
alter table public.finance_expenses
  add column approval_request_id uuid references public.approval_requests(id) on delete restrict;

alter table public.finance_estimates
  add constraint finance_estimates_approval_request_unique unique (approval_request_id);
alter table public.finance_invoices
  add constraint finance_invoices_approval_request_unique unique (approval_request_id);
alter table public.finance_credit_notes
  add constraint finance_credit_notes_approval_request_unique unique (approval_request_id);
alter table public.finance_expenses
  add constraint finance_expenses_approval_request_unique unique (approval_request_id);

-- Finance approval definitions always enforce separation of duties. Amount thresholds remain
-- policy data in the existing Approval engine; finance submissions now pass their normalized amount.
update public.approval_definitions
set allow_self_approval = false
where source_module = 'finance'
  and entity_type in ('estimate', 'invoice', 'credit_note', 'expense')
  and allow_self_approval;

create or replace function private.validate_finance_approval_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_module = 'finance'
    and new.entity_type in ('estimate', 'invoice', 'credit_note', 'expense')
    and new.allow_self_approval then
    raise exception using
      errcode = '23514',
      message = 'Finance approval definitions cannot allow self-approval';
  end if;
  return new;
end;
$$;

create trigger approval_definitions_validate_finance_separation
before insert or update of source_module, entity_type, allow_self_approval
on public.approval_definitions
for each row execute function private.validate_finance_approval_definition();

-- A finance approval link must point to the same organization, module, entity type and record.
-- Pending and approved finance states are therefore impossible to forge with an unrelated request.
create or replace function private.validate_finance_approval_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_type text;
  v_request_status text;
  v_new jsonb;
  v_old jsonb;
begin
  v_new := to_jsonb(new);
  v_old := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_entity_type := case tg_table_name
    when 'finance_estimates' then 'estimate'
    when 'finance_invoices' then 'invoice'
    when 'finance_credit_notes' then 'credit_note'
    when 'finance_expenses' then 'expense'
    else null
  end;

  if v_entity_type is null then
    raise exception using errcode = '23514', message = 'Unsupported finance approval target';
  end if;

  if new.approval_request_id is not null then
    select request.status
    into v_request_status
    from public.approval_requests as request
    join public.approval_definitions as definition on definition.id = request.definition_id
    where request.id = new.approval_request_id
      and request.organization_id = new.organization_id
      and request.source_module = 'finance'
      and request.entity_type = v_entity_type
      and request.entity_id = new.id::text
      and definition.allow_self_approval = false;

    if v_request_status is null then
      raise exception using
        errcode = '23514',
        message = 'Finance approval request must match the protected record';
    end if;
  end if;

  if new.approval_status = 'pending'
    and (new.approval_request_id is null or v_request_status <> 'pending') then
    raise exception using
      errcode = '23514',
      message = 'Pending finance approval requires the matching pending shared approval request';
  end if;

  if new.approval_status = 'approved'
    and (new.approval_request_id is null or v_request_status <> 'approved') then
    raise exception using
      errcode = '23514',
      message = 'Approved finance state requires the matching approved shared approval request';
  end if;

  if tg_table_name in ('finance_estimates', 'finance_invoices', 'finance_credit_notes')
    and v_new ->> 'status' = 'pending_approval'
    and (new.approval_status <> 'pending' or new.approval_request_id is null) then
    raise exception using
      errcode = '23514',
      message = 'Pending finance document state requires shared approval';
  end if;

  if tg_table_name in ('finance_invoices', 'finance_credit_notes')
    and v_new ->> 'issued_at' is not null
    and (tg_op = 'INSERT' or v_old ->> 'issued_at' is null)
    and (new.approval_status <> 'approved' or new.approval_request_id is null
      or v_request_status <> 'approved') then
    raise exception using
      errcode = '23514',
      message = 'Finance documents cannot be issued without completed shared approval';
  end if;

  if tg_table_name = 'finance_expenses'
    and v_new ->> 'payment_status' <> 'unpaid'
    and (tg_op = 'INSERT' or v_new ->> 'payment_status' is distinct from v_old ->> 'payment_status')
    and (new.approval_status <> 'approved' or new.approval_request_id is null
      or v_request_status <> 'approved') then
    raise exception using
      errcode = '23514',
      message = 'Expense payment processing requires completed shared approval';
  end if;

  return new;
end;
$$;

create trigger finance_estimates_validate_shared_approval
before insert or update of status, approval_status, approval_request_id
on public.finance_estimates
for each row execute function private.validate_finance_approval_link();

create trigger finance_invoices_validate_shared_approval
before insert or update of status, approval_status, approval_request_id, issued_at
on public.finance_invoices
for each row execute function private.validate_finance_approval_link();

create trigger finance_credit_notes_validate_shared_approval
before insert or update of status, approval_status, approval_request_id, issued_at
on public.finance_credit_notes
for each row execute function private.validate_finance_approval_link();

create trigger finance_expenses_validate_shared_approval
before insert or update of approval_status, approval_request_id, payment_status
on public.finance_expenses
for each row execute function private.validate_finance_approval_link();

-- Reuse shared Approval outcomes as the single source of truth for finance decisions.
create or replace function private.apply_finance_approval_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_membership_id uuid;
  v_comment text;
  v_changed integer := 0;
begin
  if new.source_module <> 'finance'
    or new.entity_type not in ('estimate', 'invoice', 'credit_note', 'expense')
    or new.entity_id is null
    or old.status = new.status then
    return new;
  end if;

  select action.actor_membership_id, action.comment
  into v_actor_membership_id, v_comment
  from public.approval_actions as action
  where action.request_id = new.id
    and action.action in ('approved', 'rejected', 'revision_requested')
  order by action.created_at desc, action.id desc
  limit 1;

  if new.entity_type = 'estimate' then
    if new.status = 'approved' then
      update public.finance_estimates
      set status = 'approved', approval_status = 'approved', approval_request_id = new.id,
        approved_at = coalesce(approved_at, new.completed_at, now())
      where id = new.entity_id::uuid and organization_id = new.organization_id
        and status = 'pending_approval' and approval_request_id = new.id;
    elsif new.status in ('rejected', 'revision_requested') then
      update public.finance_estimates
      set status = 'draft', approval_status = 'rejected', approval_request_id = new.id,
        approved_at = null
      where id = new.entity_id::uuid and organization_id = new.organization_id
        and status = 'pending_approval' and approval_request_id = new.id;
    elsif new.status in ('cancelled', 'expired', 'invalidated') then
      update public.finance_estimates
      set status = 'draft', approval_status = 'not_required', approval_request_id = new.id,
        approved_at = null
      where id = new.entity_id::uuid and organization_id = new.organization_id
        and status = 'pending_approval' and approval_request_id = new.id;
    end if;

  elsif new.entity_type = 'invoice' then
    if new.status = 'approved' then
      update public.finance_invoices
      set status = 'approved', approval_status = 'approved', approval_request_id = new.id,
        approved_at = coalesce(approved_at, new.completed_at, now())
      where id = new.entity_id::uuid and organization_id = new.organization_id
        and status = 'pending_approval' and approval_request_id = new.id;
    elsif new.status in ('rejected', 'revision_requested') then
      update public.finance_invoices
      set status = 'draft', approval_status = 'rejected', approval_request_id = new.id,
        approved_at = null
      where id = new.entity_id::uuid and organization_id = new.organization_id
        and status = 'pending_approval' and approval_request_id = new.id;
    elsif new.status in ('cancelled', 'expired', 'invalidated') then
      update public.finance_invoices
      set status = 'draft', approval_status = 'not_required', approval_request_id = new.id,
        approved_at = null
      where id = new.entity_id::uuid and organization_id = new.organization_id
        and status = 'pending_approval' and approval_request_id = new.id;
    end if;
    get diagnostics v_changed = row_count;
    if v_changed > 0 and new.status in ('approved', 'rejected', 'revision_requested') then
      insert into public.finance_invoice_events (
        organization_id, invoice_id, event_type, event_data, actor_membership_id
      ) values (
        new.organization_id, new.entity_id::uuid,
        case when new.status = 'approved' then 'approved' else 'rejected' end,
        jsonb_build_object('approvalRequestId', new.id, 'approvalStatus', new.status,
          'comment', v_comment),
        v_actor_membership_id
      );
    end if;

  elsif new.entity_type = 'credit_note' then
    if new.status = 'approved' then
      update public.finance_credit_notes
      set status = 'approved', approval_status = 'approved', approval_request_id = new.id,
        approved_at = coalesce(approved_at, new.completed_at, now())
      where id = new.entity_id::uuid and organization_id = new.organization_id
        and status = 'pending_approval' and approval_request_id = new.id;
    elsif new.status in ('rejected', 'revision_requested') then
      update public.finance_credit_notes
      set status = 'draft', approval_status = 'rejected', approval_request_id = new.id,
        approved_at = null
      where id = new.entity_id::uuid and organization_id = new.organization_id
        and status = 'pending_approval' and approval_request_id = new.id;
    elsif new.status in ('cancelled', 'expired', 'invalidated') then
      update public.finance_credit_notes
      set status = 'draft', approval_status = 'not_required', approval_request_id = new.id,
        approved_at = null
      where id = new.entity_id::uuid and organization_id = new.organization_id
        and status = 'pending_approval' and approval_request_id = new.id;
    end if;
    get diagnostics v_changed = row_count;
    if v_changed > 0 and new.status in ('approved', 'rejected', 'revision_requested') then
      insert into public.finance_credit_note_events (
        organization_id, credit_note_id, event_type, event_data, actor_membership_id
      ) values (
        new.organization_id, new.entity_id::uuid,
        case when new.status = 'approved' then 'approved' else 'rejected' end,
        jsonb_build_object('approvalRequestId', new.id, 'approvalStatus', new.status,
          'comment', v_comment),
        v_actor_membership_id
      );
    end if;

  elsif new.entity_type = 'expense' then
    if new.status = 'approved' then
      update public.finance_expenses
      set approval_status = 'approved', approval_request_id = new.id,
        approved_by_membership_id = v_actor_membership_id,
        approved_at = coalesce(approved_at, new.completed_at, now()), rejection_reason = null
      where id = new.entity_id::uuid and organization_id = new.organization_id
        and approval_status = 'pending' and approval_request_id = new.id;
    elsif new.status in ('rejected', 'revision_requested') then
      update public.finance_expenses
      set approval_status = 'rejected', approval_request_id = new.id,
        approved_by_membership_id = null, approved_at = null,
        rejection_reason = left(coalesce(v_comment, 'Approval was not granted.'), 1000)
      where id = new.entity_id::uuid and organization_id = new.organization_id
        and approval_status = 'pending' and approval_request_id = new.id;
    elsif new.status in ('cancelled', 'expired', 'invalidated') then
      update public.finance_expenses
      set approval_status = 'not_required', approval_request_id = new.id,
        approved_by_membership_id = null, approved_at = null, rejection_reason = null
      where id = new.entity_id::uuid and organization_id = new.organization_id
        and approval_status = 'pending' and approval_request_id = new.id;
    end if;
    get diagnostics v_changed = row_count;
    if v_changed > 0 then
      insert into public.finance_expense_events (
        organization_id, expense_id, event_type, event_data, actor_membership_id
      ) values (
        new.organization_id, new.entity_id::uuid, 'approval_' || new.status,
        jsonb_build_object('approvalRequestId', new.id, 'approvalStatus', new.status,
          'comment', v_comment),
        v_actor_membership_id
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger approval_requests_apply_finance_result
after update of status on public.approval_requests
for each row execute function private.apply_finance_approval_result();
