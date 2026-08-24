import { describe, expect, it } from "vitest";

import {
  hrBuiltinDocumentTemplates,
  hrDocumentTypes,
  humanizeHrDocumentType,
  parseCustomDocumentFields,
} from "@/modules/hr/documents";
import { renderHtmlToPdf } from "@/lib/server/html-to-pdf";
import {
  compileHrDocumentTemplate,
  resolveBuiltinHrTemplate,
  validateAndNormalizeHrTemplateHtml,
} from "@/modules/hr/server/document-template-compiler";

const fixedValues: Record<string, string> = {
  "organization.legal_name": "AgencyOS Private Limited",
  "organization.display_name": "AgencyOS",
  "organization.registered_address": "1 Example Road, Bengaluru",
  "employee.legal_name": "Asha Example",
  "employee.preferred_name": "Asha",
  "employee.employee_number": "EMP-001",
  "employee.work_email": "asha@example.test",
  "employee.personal_address": "2 Private Street, Bengaluru",
  "employee.designation": "Operations Manager",
  "employee.department": "Operations",
  "employee.manager_name": "Manager Example",
  "employee.joining_date": "2026-08-01",
  "employee.work_location": "Bengaluru",
  "employee.work_mode": "Hybrid",
  "document.title": "Employment document",
  "document.reference": "HR/2026/001",
  "document.issue_date": "2026-07-17",
  "document.effective_date": "2026-08-01",
  "document.expiry_date": "Not applicable",
  "document.signatory_name": "Owner Example",
  "document.signatory_title": "Director",
  "template.name": "Starter template",
  "template.version": "1",
};

function renderValues(customFields: readonly string[]): Record<string, string> {
  const values = { ...fixedValues };
  for (const key of customFields) values[`custom.${key}`] = `Reviewed ${key} wording.`;
  return values;
}

describe("HR private document templates", () => {
  it("registers every supported employment-letter template exactly once", () => {
    expect(hrDocumentTypes).toEqual([
      "offer_letter",
      "appointment_letter",
      "employment_agreement",
      "nda",
      "experience_letter",
      "relieving_letter",
      "promotion_letter",
      "salary_revision_letter",
      "warning_letter",
      "performance_letter",
    ]);
    expect(hrBuiltinDocumentTemplates.map((template) => template.key)).toEqual(hrDocumentTypes);
    expect(new Set(hrBuiltinDocumentTemplates.map((template) => template.fileName)).size).toBe(10);
    expect(humanizeHrDocumentType("nda")).toBe("NDA");
    expect(humanizeHrDocumentType("salary_revision_letter")).toBe("Salary Revision Letter");
  });

  it("parses bounded custom fields and rejects duplicates", () => {
    expect(parseCustomDocumentFields("notice_period = 30 days\nlocation = Bengaluru")).toEqual({
      notice_period: "30 days",
      location: "Bengaluru",
    });
    expect(() => parseCustomDocumentFields("notice_period = 30\nnotice_period = 60")).toThrow(
      "Duplicate custom field",
    );
    expect(() => parseCustomDocumentFields("bad key = value")).toThrow("Invalid custom field key");
  });

  it("rejects active content, external resources, and unsupported placeholders", () => {
    expect(() =>
      validateAndNormalizeHrTemplateHtml(
        "<html><head></head><body><script>alert(1)</script>{{employee.legal_name}}{{organization.legal_name}}</body></html>",
      ),
    ).toThrow("blocked-element");
    expect(() =>
      validateAndNormalizeHrTemplateHtml(
        '<html><head></head><body><img src="https://example.test/logo.png">{{employee.legal_name}}{{organization.legal_name}}</body></html>',
      ),
    ).toThrow("blocked-element:img");
    expect(() =>
      validateAndNormalizeHrTemplateHtml(
        "<html><head></head><body>{{employee.legal_name}}{{organization.legal_name}}{{secret.token}}</body></html>",
      ),
    ).toThrow("unsupported-placeholder");
    expect(() =>
      validateAndNormalizeHrTemplateHtml(
        "<html><head><style>.x{color:{{custom.color}}}</style></head><body>{{employee.legal_name}}{{organization.legal_name}}</body></html>",
      ),
    ).toThrow("placeholder-in-style");
    expect(() =>
      validateAndNormalizeHrTemplateHtml(
        '<html><head></head><body><div class="{{custom.class_name}}">{{employee.legal_name}}{{organization.legal_name}}</div></body></html>',
      ),
    ).toThrow("placeholder-in-attribute");
  });

  it("uses a positive HTML and attribute allowlist for uploaded templates", () => {
    expect(() =>
      validateAndNormalizeHrTemplateHtml(
        "<html><head></head><body><marquee>{{employee.legal_name}}{{organization.legal_name}}</marquee></body></html>",
      ),
    ).toThrow("blocked-element:marquee");
    expect(() =>
      validateAndNormalizeHrTemplateHtml(
        '<html><head></head><body><p onclick="print()">{{employee.legal_name}}{{organization.legal_name}}</p></body></html>',
      ),
    ).toThrow("blocked-attribute:onclick");
    expect(() =>
      validateAndNormalizeHrTemplateHtml(
        '<html><head><style>@font-face{font-family:x;src:local("x")}</style></head><body>{{employee.legal_name}}{{organization.legal_name}}</body></html>',
      ),
    ).toThrow("unsafe-style");

    const normalized = validateAndNormalizeHrTemplateHtml(
      '<html lang="en"><head><style>@page{size:A4} table{border-collapse:collapse}</style></head><body><table class="summary"><tbody><tr><th scope="row">Employee</th><td colspan="2">{{employee.legal_name}}</td></tr><tr><th scope="row">Organization</th><td colspan="2">{{organization.legal_name}}</td></tr></tbody></table></body></html>',
    );
    expect(normalized.html).toContain('<table class="summary">');
    expect(normalized.html).toContain('scope="row"');
    expect(normalized.placeholders).toEqual([
      "employee.legal_name",
      "organization.legal_name",
    ]);
  });

  it("loads every built-in template and escapes placeholder values", async () => {
    for (const definition of hrBuiltinDocumentTemplates) {
      const template = await resolveBuiltinHrTemplate(definition.key);
      const html = compileHrDocumentTemplate(template, {
        ...renderValues(definition.customFields),
        "employee.legal_name": '<script>alert("x")</script>',
      });
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain('<script>alert("x")</script>');
      expect(html).not.toMatch(/\{\{/);
      expect(template.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("renders an extended starter employment letter as a real PDF", async () => {
    const definition = hrBuiltinDocumentTemplates.find(
      (template) => template.key === "relieving_letter",
    );
    expect(definition).toBeDefined();
    const template = await resolveBuiltinHrTemplate("relieving_letter");
    const html = compileHrDocumentTemplate(template, renderValues(definition?.customFields ?? []));
    const pdf = await renderHtmlToPdf({ html, pageSize: "A4" });
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
  }, 60_000);
});
