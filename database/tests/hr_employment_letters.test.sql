begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(4);

select ok(
  (
    select pg_get_constraintdef(c.oid) like all (
      array[
        '%experience_letter%',
        '%relieving_letter%',
        '%promotion_letter%',
        '%salary_revision_letter%',
        '%warning_letter%',
        '%performance_letter%'
      ]
    )
    from pg_constraint as c
    join pg_class as t on t.oid = c.conrelid
    join pg_namespace as n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'hr_document_templates'
      and c.conname = 'hr_document_templates_type_valid'
  ),
  'custom HR templates accept every extended employment-letter type'
);

select ok(
  (
    select pg_get_constraintdef(c.oid) like all (
      array[
        '%experience_letter%',
        '%relieving_letter%',
        '%promotion_letter%',
        '%salary_revision_letter%',
        '%warning_letter%',
        '%performance_letter%'
      ]
    )
    from pg_constraint as c
    join pg_class as t on t.oid = c.conrelid
    join pg_namespace as n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'hr_document_template_defaults'
      and c.conname = 'hr_document_template_defaults_type_valid'
  ),
  'template defaults accept every extended employment-letter type'
);

select ok(
  (
    select pg_get_constraintdef(c.oid) like all (
      array[
        '%experience_letter%',
        '%relieving_letter%',
        '%promotion_letter%',
        '%salary_revision_letter%',
        '%warning_letter%',
        '%performance_letter%'
      ]
    )
    from pg_constraint as c
    join pg_class as t on t.oid = c.conrelid
    join pg_namespace as n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'hr_document_template_defaults'
      and c.conname = 'hr_document_template_defaults_builtin_valid'
  ),
  'built-in defaults accept every extended employment-letter key'
);

select ok(
  (
    select pg_get_constraintdef(c.oid) like all (
      array[
        '%experience_letter%',
        '%relieving_letter%',
        '%promotion_letter%',
        '%salary_revision_letter%',
        '%warning_letter%',
        '%performance_letter%'
      ]
    )
    from pg_constraint as c
    join pg_class as t on t.oid = c.conrelid
    join pg_namespace as n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'hr_employee_documents'
      and c.conname = 'hr_employee_documents_type_valid'
  ),
  'generated private documents accept every extended employment-letter type'
);

select * from finish();
rollback;
