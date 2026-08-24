import { createHash } from "node:crypto";

import { renderCompiledFinanceDocument } from "@/modules/finance/pdf/browser-renderer";
import { safeFileStem } from "@/modules/finance/pdf/html";
import { compileFinanceDocumentHtml } from "@/modules/finance/pdf/template-compiler";
import type { FinancePdfInput, RenderedFinancePdf } from "@/modules/finance/pdf/types";

export {
  financePdfStyleFromInvoiceSettings,
  getInvoiceNinjaTemplate,
  invoiceNinjaTemplateCatalog,
  isInvoiceNinjaTemplateId,
  resolveInvoiceNinjaTemplateId,
} from "@/modules/finance/pdf/catalog";
export { compileFinanceDocumentHtml } from "@/modules/finance/pdf/template-compiler";
export type {
  CompiledFinanceDocument,
  FinancePdfDocumentType,
  FinancePdfInput,
  FinancePdfLine,
  FinancePdfParty,
  FinancePdfStyle,
  InvoiceNinjaTemplateId,
  RenderedFinancePdf,
} from "@/modules/finance/pdf/types";

export async function renderFinanceDocumentPdf(
  input: FinancePdfInput,
): Promise<RenderedFinancePdf> {
  const compiled = await compileFinanceDocumentHtml(input);
  const bytes = await renderCompiledFinanceDocument(compiled);
  const baseName = safeFileStem(input.documentNumber) || "document";

  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    fileName: `${baseName}.pdf`,
    templateId: compiled.templateId,
  };
}
