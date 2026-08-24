begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(50);

select has_table('public', 'finance_expense_categories', 'Expense categories exist');
select has_table('public', 'finance_expenses', 'Expenses exist');
select has_table('public', 'finance_expense_project_allocations', 'Expense project allocations exist');
select has_table('public', 'finance_expense_receipts', 'Expense receipts exist');
select has_table('public', 'finance_expense_events', 'Expense event history exists');

select has_column('public', 'finance_expenses', 'expense_type', 'Expenses distinguish employee, project, and vendor costs');
select has_column('public', 'finance_expenses', 'category_id', 'Expenses retain a category');
select has_column('public', 'finance_expenses', 'tax_minor', 'Expenses retain tax in minor units');
select has_column('public', 'finance_expenses', 'total_minor', 'Expenses expose a generated total');
select has_column('public', 'finance_expenses', 'is_billable', 'Expenses retain billable status');
select has_column('public', 'finance_expenses', 'is_reimbursable', 'Expenses retain reimbursable status');
select has_column('public', 'finance_expenses', 'approval_status', 'Expenses retain approval state');
select has_column('public', 'finance_expenses', 'payment_status', 'Expenses retain payment state');
select has_column('public', 'finance_expense_receipts', 'private_file_id', 'Expense receipts use the private-file registry');

select has_function('private', 'finance_expense_scope_allows', array['uuid', 'uuid', 'uuid', 'text'], 'Expense scope helper exists');
select has_function('private', 'validate_finance_expense_references', array[]::text[], 'Expense reference validation exists');
select has_function('private', 'validate_finance_expense_allocation_tenant', array[]::text[], 'Expense allocation tenant validation exists');
select has_function('private', 'validate_finance_expense_receipt_tenant', array[]::text[], 'Expense receipt tenant validation exists');
select has_function('private', 'validate_finance_expense_allocation_totals', array[]::text[], 'Expense allocation total validation exists');

select ok(exists (select 1 from pg_trigger where tgname = 'finance_expenses_validate_references' and not tgisinternal), 'Expense reference trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_expense_allocations_validate_tenant' and not tgisinternal), 'Allocation tenant trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_expense_receipts_validate_tenant' and not tgisinternal), 'Receipt tenant trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_expenses_validate_allocation_totals' and not tgisinternal), 'Expense allocation-total trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_expense_events_prevent_update' and not tgisinternal), 'Expense events reject updates');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_expense_events_prevent_delete' and not tgisinternal), 'Expense events reject deletes');

select is((select relrowsecurity from pg_class where oid = 'public.finance_expense_categories'::regclass), true, 'Expense categories have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.finance_expenses'::regclass), true, 'Expenses have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.finance_expense_project_allocations'::regclass), true, 'Expense allocations have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.finance_expense_receipts'::regclass), true, 'Expense receipts have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.finance_expense_events'::regclass), true, 'Expense events have RLS');

select ok(not has_table_privilege('anon', 'public.finance_expenses', 'SELECT'), 'Anonymous users cannot read expenses');
select ok(has_table_privilege('authenticated', 'public.finance_expenses', 'SELECT'), 'Authenticated users may read expenses through RLS');
select ok(not has_table_privilege('authenticated', 'public.finance_expense_events', 'INSERT'), 'Authenticated users cannot forge expense events');
select ok(not has_table_privilege('authenticated', 'public.finance_expense_events', 'DELETE'), 'Authenticated users cannot delete expense events');

select ok(exists (select 1 from public.permissions where key = 'finance.expense.view' and is_sensitive), 'Expense view permission exists');
select ok(exists (select 1 from public.permissions where key = 'finance.expense.create' and is_sensitive), 'Expense create permission exists');
select ok(exists (select 1 from public.permissions where key = 'finance.expense.manage' and is_sensitive), 'Expense manage permission exists');
select ok(exists (select 1 from public.permissions where key = 'finance.expense.approve' and is_sensitive), 'Expense approval permission exists');
select ok(exists (select 1 from public.permissions where key = 'finance.expense.pay' and is_sensitive), 'Expense payment permission exists');
select ok(exists (select 1 from public.permissions where key = 'finance.expense_category.manage' and is_sensitive), 'Expense category permission exists');
select ok(exists (select 1 from public.permissions where key = 'finance.expense_receipt.manage' and is_sensitive), 'Expense receipt permission exists');

select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_expenses' and policyname = 'finance_expenses_select_authorized'), 'Expense select policy exists');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_expense_project_allocations' and policyname = 'finance_expense_allocations_insert_authorized'), 'Allocation insert policy exists');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_expense_receipts' and policyname = 'finance_expense_receipts_insert_authorized'), 'Receipt insert policy exists');

select ok(exists (
  select 1 from public.role_template_permissions as role_permission
  join public.permissions as permission on permission.id = role_permission.permission_id
  where role_permission.role_template_key = 'employee'
    and permission.key = 'finance.expense.create'
    and role_permission.scope = 'own'
), 'Employees create only own-scope expenses');
select ok(exists (
  select 1 from public.role_template_permissions as role_permission
  join public.permissions as permission on permission.id = role_permission.permission_id
  where role_permission.role_template_key = 'finance_manager'
    and permission.key = 'finance.expense.approve'
    and role_permission.scope = 'organization'
), 'Finance managers approve organization expenses');
select ok(exists (
  select 1 from public.role_template_permissions as role_permission
  join public.permissions as permission on permission.id = role_permission.permission_id
  where role_permission.role_template_key = 'accountant'
    and permission.key = 'finance.expense.pay'
    and role_permission.scope = 'organization'
), 'Accountants manage organization expense payments');

select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'public.finance_expenses'::regclass
    and pg_get_constraintdef(oid) ilike '%employee%project%vendor%'
), 'Expense types are constrained');
select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'public.finance_expenses'::regclass
    and pg_get_constraintdef(oid) ilike '%not_required%pending%approved%rejected%'
), 'Expense approval states are constrained');
select ok(has_function_privilege('authenticated', 'private.finance_expense_scope_allows(uuid,uuid,uuid,text)', 'EXECUTE'), 'Authenticated RLS may execute the safe expense scope helper');

select * from finish();
rollback;
