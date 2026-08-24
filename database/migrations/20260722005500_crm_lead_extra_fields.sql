begin;

alter table public.crm_leads
  add column extra_fields jsonb not null default '{}'::jsonb;

alter table public.crm_leads
  add constraint crm_leads_extra_fields_object
  check (jsonb_typeof(extra_fields) = 'object'),
  add constraint crm_leads_extra_fields_size
  check (pg_column_size(extra_fields) <= 524288);

comment on column public.crm_leads.extra_fields is
  'Sanitized, provider-namespaced lead fields that do not map to canonical AgencyOS CRM columns.';

commit;
