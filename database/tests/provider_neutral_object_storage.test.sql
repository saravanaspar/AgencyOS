begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(4);

select ok(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conname = 'hr_document_template_defaults_source_valid'
  ) like '%object_storage%',
  'HR template defaults use the provider-neutral object-storage label'
);

select ok(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conname = 'hr_employee_documents_template_source_valid'
  ) like '%object_storage%',
  'Rendered HR documents use the provider-neutral object-storage label'
);

select ok(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conname = 'security_restore_drills_type_valid'
  ) like '%object_storage%',
  'Restore drills use the provider-neutral object-storage label'
);

select ok(
  pg_get_functiondef('private.validate_hr_document_template_default()'::regprocedure)
    like '%source_type = ''object_storage''%',
  'The HR default trigger validates the provider-neutral source label'
);

select * from finish();
rollback;
