begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(12);

select has_column('public', 'crm_companies', 'primary_contact_id', 'Companies store a primary contact');
select col_is_fk('public', 'crm_companies', 'primary_contact_id', 'Primary contact is foreign-key protected');
select has_index('public', 'crm_companies', 'crm_companies_primary_contact_idx', 'Primary contact lookup is indexed');
select has_function('private', 'validate_crm_company_primary_contact', array[]::text[], 'Company primary-contact validator exists');
select has_function('private', 'protect_crm_primary_contact_membership', array[]::text[], 'Contact membership protector exists');
select has_trigger('public', 'crm_companies', 'crm_companies_validate_primary_contact', 'Company validation trigger exists');
select has_trigger('public', 'crm_contacts', 'crm_contacts_protect_primary_contact_membership', 'Contact protection trigger exists');
select ok((select relrowsecurity from pg_class where oid = 'public.crm_companies'::regclass), 'Company RLS remains enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.crm_contacts'::regclass), 'Contact RLS remains enabled');
select ok(has_table_privilege('authenticated', 'public.crm_companies', 'SELECT'), 'Authenticated company reads remain RLS controlled');
select ok(has_table_privilege('authenticated', 'public.crm_contacts', 'SELECT'), 'Authenticated contact reads remain RLS controlled');
select ok(
  not has_function_privilege('authenticated', 'private.validate_crm_company_primary_contact()', 'EXECUTE'),
  'Authenticated users cannot call the validator directly'
);

select * from finish();
rollback;
