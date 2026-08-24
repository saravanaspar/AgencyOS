-- AgencyOS object bytes are stored in MinIO. Supabase remains the relational database and
-- authentication provider, but runtime file operations must not depend on Supabase Storage.

comment on column public.private_files.quarantine_bucket is
  'Private MinIO bucket containing the unreleased quarantine object.';
comment on column public.private_files.quarantine_path is
  'Validated MinIO object key for the unreleased quarantine object.';
comment on column public.private_files.storage_bucket is
  'Private MinIO bucket containing the released object.';
comment on column public.private_files.storage_path is
  'Validated MinIO object key for the released object.';
comment on column public.private_files.clean_target_path is
  'Reserved MinIO object key used when a quarantined file is released.';

-- Supabase protects the managed storage schema from direct deletion. Existing bucket
-- registrations are therefore left untouched by SQL migrations. After every source object has been
-- copied and checksum-verified in MinIO, remove source objects and empty buckets through the
-- Supabase Storage API with `npm run storage:migrate:supabase -- --delete-source`.
