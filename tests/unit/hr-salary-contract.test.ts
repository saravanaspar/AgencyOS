import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("HR salary and private-slip contract", () => {
  it("creates tightly restricted effective-dated salary tables with RLS", () => {
    const migration = read("database/migrations/20260717003300_hr_salary_slips.sql");
    for (const table of [
      "hr_salary_structures",
      "hr_salary_structure_components",
      "hr_salary_slips",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on public.${table} from public, anon, authenticated`);
    }
    expect(migration).toContain("private.prepare_hr_salary_structure_revision");
    expect(migration).toContain("private.crm_scope_allows_membership");
    expect(migration).not.toContain("'team_lead', permission.id");
    expect(migration).toContain("'auditor', permission.id, 'organization'");
  });

  it("reuses the shared HTML renderer and private-file scanner", () => {
    const pdf = read("src/modules/hr/server/salary-slip-pdf.ts");
    const service = read("src/modules/hr/server/salary-slip-service.ts");
    const financeRenderer = read("src/modules/finance/pdf/browser-renderer.ts");
    expect(pdf).toContain("renderHtmlToPdf");
    expect(financeRenderer).toContain("renderHtmlToPdf");
    expect(service).toContain("createQuarantinedPrivateFile");
    expect(service).toContain('entityType: "hr_salary_slip"');
    expect(service).toContain('classification: "restricted"');
  });

  it("allocates slip versions only inside the advisory-locked private-file transaction", () => {
    const actions = read("src/modules/hr/actions/salary.ts");
    const service = read("src/modules/hr/server/salary-slip-service.ts");
    expect(actions).not.toContain("select coalesce(max(version), 0) + 1 as version");
    expect(actions).toContain("salaryRevisionNumber: structure.revision_number");
    expect(service).toContain("pg_advisory_xact_lock");
    expect(service).toContain("select coalesce(max(version), 0) + 1 as version");
  });

  it("records generation, upload, acknowledgement, and download evidence", () => {
    const actions = read("src/modules/hr/actions/salary.ts");
    const service = read("src/modules/hr/server/salary-slip-service.ts");
    const download = read("src/app/api/hr/salary-slips/[salarySlipId]/route.ts");
    expect(actions).toContain('action: "hr.salary_revision_submitted"');
    expect(actions).toContain('action: "hr.salary_slip_acknowledged"');
    expect(service).toContain('"hr.salary_slip_generated"');
    expect(service).toContain('"hr.salary_slip_uploaded"');
    expect(service).toContain('action: "hr.salary_slip_downloaded"');
    expect(download).toContain('eventType: "file.downloaded"');
    expect(download).toContain('createHash("sha256")');
  });

  it("ships revision, generation, upload, download, and acknowledgement UI", () => {
    const component = read("src/components/hr/hr-salary.tsx");
    expect(component).toContain("Create immutable revision");
    expect(component).toContain("Generate private PDF");
    expect(component).toContain("Upload private PDF");
    expect(component).toContain("Acknowledge receipt");
    expect(component).toContain("salary access automatically");
    const registry = read("src/modules/mcp/tool-registry.ts");
    expect(registry).not.toContain("data.salary.structures");
    expect(registry).not.toContain("data.salary.slips");
  });
});
