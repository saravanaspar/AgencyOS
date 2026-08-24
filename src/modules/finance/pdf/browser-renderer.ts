import { renderHtmlToPdf } from "@/lib/server/html-to-pdf";
import type { CompiledFinanceDocument } from "@/modules/finance/pdf/types";

export async function renderCompiledFinanceDocument(
  compiled: CompiledFinanceDocument,
): Promise<Buffer> {
  try {
    return await renderHtmlToPdf({
      html: compiled.html,
      pageSize: compiled.pageSize,
      landscape: compiled.landscape,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown renderer failure";
    throw new Error(`finance-pdf-render-failed: ${message}`);
  }
}
