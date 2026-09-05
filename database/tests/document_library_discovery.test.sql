begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(11);

select has_column(
  'public',
  'documents',
  'document_date',
  'Documents expose a structured document date'
);

select has_column(
  'public',
  'documents',
  'reference_code',
  'Documents expose a structured reference code'
);

select is(
  (
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'documents'
      and column_name = 'document_date'
  ),
  'date',
  'document_date is stored as a date'
);

select is(
  (
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'documents'
      and column_name = 'reference_code'
  ),
  'text',
  'reference_code is stored as text'
);

select ok(
  has_column_privilege('authenticated', 'public.documents', 'document_date', 'SELECT')
  and has_column_privilege('authenticated', 'public.documents', 'reference_code', 'SELECT'),
  'Authenticated document readers can select the safe discovery metadata through existing RLS'
);

select ok(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.document_entity_links'::regclass
      and conname = 'document_entity_links_type_valid'
  ) ilike all (array[
    '%contract%',
    '%ticket%',
    '%asset%',
    '%vendor%',
    '%purchase_order%'
  ]),
  'The final document entity catalogue preserves contract and every later-added entity type'
);

select ok(
  (
    select pg_get_functiondef(procedure.oid)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'validate_document_entity_link'
      and pg_get_function_identity_arguments(procedure.oid) = ''
  ) ilike '%public.legal_contracts%organization_id = new.organization_id%',
  'The document entity trigger validates contract links inside the same organization'
);

insert into public.identity_accounts (
  id,
  auth_provider,
  provider_subject,
  email,
  email_confirmed_at,
  raw_user_meta_data
)
values
  (
    '06600000-0000-4000-8000-000000000001'::uuid,
    'agencyos',
    '06600000-0000-4000-8000-000000000001',
    'document-discovery-a@example.test',
    now(),
    '{}'::jsonb
  ),
  (
    '06600000-0000-4000-8000-000000000002'::uuid,
    'agencyos',
    '06600000-0000-4000-8000-000000000002',
    'document-discovery-b@example.test',
    now(),
    '{}'::jsonb
  )
on conflict (id) do nothing;

select private.bootstrap_organization(
  '06600000-0000-4000-8000-000000000001',
  'Document Discovery A',
  'document-discovery-a',
  'US',
  'UTC',
  'USD'
);

select private.bootstrap_organization(
  '06600000-0000-4000-8000-000000000002',
  'Document Discovery B',
  'document-discovery-b',
  'US',
  'UTC',
  'USD'
);

insert into public.documents (
  organization_id,
  title,
  classification,
  owner_membership_id,
  created_by_membership_id,
  document_date,
  reference_code
)
select
  organization.id,
  'Contract evidence',
  'confidential',
  membership.id,
  membership.id,
  date '2026-08-31',
  'CONTRACT-066'
from public.organizations as organization
join public.memberships as membership
  on membership.organization_id = organization.id
 and membership.user_id = '06600000-0000-4000-8000-000000000001'::uuid
where organization.slug = 'document-discovery-a';

insert into public.legal_contracts (
  organization_id,
  internal_reference,
  title,
  contract_type,
  counterparty_name,
  responsible_owner_membership_id,
  status,
  created_by_membership_id
)
select
  organization.id,
  'DOC-066-A',
  'Discovery contract A',
  'other',
  'Counterparty A',
  membership.id,
  'request',
  membership.id
from public.organizations as organization
join public.memberships as membership
  on membership.organization_id = organization.id
 and membership.user_id = '06600000-0000-4000-8000-000000000001'::uuid
where organization.slug = 'document-discovery-a';

insert into public.legal_contracts (
  organization_id,
  internal_reference,
  title,
  contract_type,
  counterparty_name,
  responsible_owner_membership_id,
  status,
  created_by_membership_id
)
select
  organization.id,
  'DOC-066-B',
  'Discovery contract B',
  'other',
  'Counterparty B',
  membership.id,
  'request',
  membership.id
from public.organizations as organization
join public.memberships as membership
  on membership.organization_id = organization.id
 and membership.user_id = '06600000-0000-4000-8000-000000000002'::uuid
where organization.slug = 'document-discovery-b';

select lives_ok(
  $$
    insert into public.document_entity_links (
      organization_id,
      document_id,
      entity_type,
      entity_id,
      created_by_membership_id
    )
    select
      organization.id,
      document.id,
      'contract',
      contract.id,
      membership.id
    from public.organizations as organization
    join public.memberships as membership
      on membership.organization_id = organization.id
     and membership.user_id = '06600000-0000-4000-8000-000000000001'::uuid
    join public.documents as document
      on document.organization_id = organization.id
     and document.reference_code = 'CONTRACT-066'
    join public.legal_contracts as contract
      on contract.organization_id = organization.id
     and contract.internal_reference = 'DOC-066-A'
    where organization.slug = 'document-discovery-a'
  $$,
  'A document can link to a contract in the same organization'
);

select is(
  (
    select count(*)::integer
    from public.document_entity_links as link
    join public.organizations as organization on organization.id = link.organization_id
    where organization.slug = 'document-discovery-a'
      and link.entity_type = 'contract'
  ),
  1,
  'The same-organization contract link is persisted'
);

select throws_ok(
  $$
    insert into public.document_entity_links (
      organization_id,
      document_id,
      entity_type,
      entity_id,
      created_by_membership_id
    )
    select
      organization.id,
      document.id,
      'contract',
      foreign_contract.id,
      membership.id
    from public.organizations as organization
    join public.memberships as membership
      on membership.organization_id = organization.id
     and membership.user_id = '06600000-0000-4000-8000-000000000001'::uuid
    join public.documents as document
      on document.organization_id = organization.id
     and document.reference_code = 'CONTRACT-066'
    cross join public.legal_contracts as foreign_contract
    join public.organizations as foreign_organization
      on foreign_organization.id = foreign_contract.organization_id
     and foreign_organization.slug = 'document-discovery-b'
    where organization.slug = 'document-discovery-a'
      and foreign_contract.internal_reference = 'DOC-066-B'
  $$,
  '23514',
  'Linked entity was not found in this organization',
  'A document cannot link to a contract from another organization'
);

select ok(
  exists(
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'documents'
      and indexname = 'documents_reference_code_idx'
  ),
  'Reference-code lookup is indexed for document discovery'
);

select * from finish();
rollback;
