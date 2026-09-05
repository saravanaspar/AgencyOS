#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const required = path.join(
  root,
  "database",
  "migrations",
  "20260819006100_first_party_identity_context.sql",
);

try {
  await fs.access(required);
} catch {
  throw new Error(
    "Refusing cleanup: first-party identity migration is missing. Overlay the no-Supabase source before running this command.",
  );
}

const removable = [
  "supabase",
  "src/integrations/supabase",
  "scripts/storage/migrate-supabase-storage-to-object-storage.mjs",
  "scripts/database/generate-types.mjs",
  "database/tests/notification_realtime.test.sql",
  "src/modules/security/mfa-qr-code.ts",
  "tests/unit/mfa-qr-code.test.ts",
  "docs/DATABASE_PORTABILITY.md",
];

for (const relative of removable) {
  const target = path.join(root, relative);
  await fs.rm(target, { recursive: true, force: true });
  console.log(`Removed legacy artifact: ${relative}`);
}

console.log(
  "Supabase source/runtime artifacts removed. Historical SQL may still mention the old provider solely for one-time migration compatibility.",
);
