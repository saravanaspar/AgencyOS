export const legacySelfManagedMigrationVersions = new Set(["20260718005300", "20260722005500"]);

function classify(values) {
  const states = Object.values(values).map(Boolean);
  if (states.every(Boolean)) return "applied";
  if (states.every((value) => !value)) return "not_applied";
  return "partial";
}

export async function inspectLegacySelfManagedMigration(sql, version) {
  if (version === "20260718005300") {
    const [state] = await sql`
      select
        exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'crm_companies' and column_name = 'primary_contact_id'
        ) as column_exists,
        exists (
          select 1 from pg_constraint
          where conname = 'crm_companies_primary_contact_fk'
            and conrelid = 'public.crm_companies'::regclass
        ) as fk_exists,
        to_regclass('public.crm_companies_primary_contact_idx') is not null as index_exists,
        exists (
          select 1 from pg_trigger
          where tgname = 'crm_companies_validate_primary_contact'
            and tgrelid = 'public.crm_companies'::regclass
            and not tgisinternal
        ) as company_trigger_exists,
        exists (
          select 1 from pg_trigger
          where tgname = 'crm_contacts_protect_primary_contact_membership'
            and tgrelid = 'public.crm_contacts'::regclass
            and not tgisinternal
        ) as contact_trigger_exists,
        to_regprocedure('private.validate_crm_company_primary_contact()') is not null as validator_exists,
        to_regprocedure('private.protect_crm_primary_contact_membership()') is not null as protector_exists
    `;
    return { state: classify(state), evidence: state };
  }

  if (version === "20260722005500") {
    const [state] = await sql`
      select
        exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'crm_leads' and column_name = 'extra_fields'
        ) as column_exists,
        exists (
          select 1 from pg_constraint
          where conname = 'crm_leads_extra_fields_object'
            and conrelid = 'public.crm_leads'::regclass
        ) as object_constraint_exists,
        exists (
          select 1 from pg_constraint
          where conname = 'crm_leads_extra_fields_size'
            and conrelid = 'public.crm_leads'::regclass
        ) as size_constraint_exists
    `;
    return { state: classify(state), evidence: state };
  }

  throw new Error(`No recovery probe is defined for self-managed migration ${version}.`);
}
