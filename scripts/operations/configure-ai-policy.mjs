#!/usr/bin/env node
import process from "node:process";

import {
  createAdminClient,
  getAdminDatabaseUrl,
  redactDatabaseUrl,
} from "../database/portable-database.mjs";

function parseArgs(argv) {
  const result = {
    organization: "",
    providers: [],
    modules: [],
    enableEgress: false,
    allowMutations: false,
    disable: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--organization") result.organization = argv[++i] ?? "";
    else if (value === "--providers")
      result.providers = (argv[++i] ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    else if (value === "--modules")
      result.modules = (argv[++i] ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    else if (value === "--enable-egress") result.enableEgress = true;
    else if (value === "--allow-mutations") result.allowMutations = true;
    else if (value === "--disable") result.disable = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!result.organization) throw new Error("--organization <slug> is required.");
  if (!result.disable && !result.enableEgress)
    throw new Error("Enabling AI requires the explicit --enable-egress acknowledgement.");
  if (result.providers.some((provider) => !["gemini", "deepseek"].includes(provider))) {
    throw new Error("--providers may contain only gemini,deepseek.");
  }
  if (result.modules.some((moduleName) => !/^[a-z][a-z0-9_]{1,63}$/.test(moduleName))) {
    throw new Error("--modules contains an invalid module key.");
  }
  return result;
}

const options = parseArgs(process.argv.slice(2));
const databaseUrl = getAdminDatabaseUrl();
const sql = createAdminClient(databaseUrl);
try {
  const rows = await sql`
    update public.organization_ai_policies as policy
    set enabled = ${!options.disable},
        external_data_egress_enabled = ${!options.disable && options.enableEgress},
        allowed_providers = ${options.disable ? [] : options.providers}::text[],
        allowed_modules = ${options.disable ? [] : options.modules}::text[],
        allow_low_risk_mutations = ${!options.disable && options.allowMutations},
        updated_at = now()
    from public.organizations as organization
    where policy.organization_id = organization.id
      and organization.slug = ${options.organization}
    returning organization.slug, policy.enabled, policy.external_data_egress_enabled,
              policy.allowed_providers, policy.allowed_modules, policy.allow_low_risk_mutations
  `;
  if (!rows[0]) throw new Error(`Organization ${options.organization} was not found.`);
  console.log(`Updated AI governance on ${redactDatabaseUrl(databaseUrl)}:`);
  console.log(JSON.stringify(rows[0], null, 2));
} finally {
  await sql.end({ timeout: 5 });
}
