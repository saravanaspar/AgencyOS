begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(16);

select has_column('public', 'finance_estimates', 'approval_request_id', 'Estimates link to shared approvals');
select has_column('public', 'finance_invoices', 'approval_request_id', 'Invoices link to shared approvals');
select has_column('public', 'finance_credit_notes', 'approval_request_id', 'Credit notes link to shared approvals');
select has_column('public', 'finance_expenses', 'approval_request_id', 'Expenses link to shared approvals');

select has_function('private', 'validate_finance_approval_definition', array[]::text[], 'Finance policy separation validator exists');
select has_function('private', 'validate_finance_approval_link', array[]::text[], 'Finance approval-link validator exists');
select has_function('private', 'apply_finance_approval_result', array[]::text[], 'Shared approval outcomes synchronize finance state');

select ok(exists (
  select 1 from pg_trigger where tgname = 'approval_definitions_validate_finance_separation' and not tgisinternal
), 'Finance approval policies reject self approval in the database');
select ok(exists (
  select 1 from pg_trigger where tgname = 'finance_invoices_validate_shared_approval' and not tgisinternal
), 'Invoice issue state is database guarded by shared approval');
select ok(exists (
  select 1 from pg_trigger where tgname = 'finance_credit_notes_validate_shared_approval' and not tgisinternal
), 'Credit-note issue state is database guarded by shared approval');
select ok(exists (
  select 1 from pg_trigger where tgname = 'finance_expenses_validate_shared_approval' and not tgisinternal
), 'Expense payment state is database guarded by shared approval');
select ok(exists (
  select 1 from pg_trigger where tgname = 'approval_requests_apply_finance_result' and not tgisinternal
), 'Shared approval terminal states drive finance records');

select ok(exists (
  select 1 from public.permissions where key = 'hr.report.export' and is_sensitive
), 'Dedicated HR bulk-export permission is registered as sensitive');
select ok(exists (
  select 1
  from public.role_template_permissions template_permission
  join public.permissions permission on permission.id = template_permission.permission_id
  where template_permission.role_template_key = 'hr_manager'
    and permission.key = 'hr.report.export'
    and template_permission.scope = 'organization'
), 'HR Manager receives the dedicated HR export permission');
select ok(exists (
  select 1
  from public.role_template_permissions template_permission
  join public.permissions permission on permission.id = template_permission.permission_id
  where template_permission.role_template_key = 'owner'
    and permission.key = 'hr.report.export'
    and template_permission.scope = 'organization'
), 'Owner receives the dedicated HR export permission');
select ok(not exists (
  select 1
  from public.role_template_permissions template_permission
  join public.permissions permission on permission.id = template_permission.permission_id
  where template_permission.role_template_key = 'employee'
    and permission.key = 'hr.report.export'
), 'Employee template does not receive HR bulk-export permission');

select * from finish();
rollback;
