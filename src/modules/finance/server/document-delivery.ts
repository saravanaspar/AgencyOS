import "server-only";

import { createHash } from "node:crypto";

import { sendEmailWithResend } from "@/integrations/email/resend";
import { formatMinorMoney } from "@/modules/finance/calculations";
import { getNotificationDeliveryConfiguration } from "@/modules/notifications/server/delivery-config";

export interface FinanceEmailDeliveryResult {
  delivered: boolean;
  providerReference?: string;
  errorCode?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export interface FinanceEmailTemplateInput {
  documentType: "Estimate" | "Invoice" | "Credit Note";
  documentNumber: string;
  clientName: string;
  currency: string;
  totalMinor: number;
  balanceMinor?: number | null;
  dueDate?: string | null;
}

export function buildFinanceDocumentEmailTemplate(input: FinanceEmailTemplateInput): {
  text: string;
  html: string;
} {
  const total = formatMinorMoney(input.totalMinor, input.currency, "en-US");
  const balance =
    input.balanceMinor === null || input.balanceMinor === undefined
      ? null
      : formatMinorMoney(input.balanceMinor, input.currency, "en-US");
  const due = input.dueDate ? ` Due date: ${input.dueDate}.` : "";
  const balanceText = balance ? ` Balance due: ${balance}.` : "";
  const text = `${input.clientName}, please find ${input.documentType.toLowerCase()} ${input.documentNumber} attached. Total: ${total}.${balanceText}${due}`;
  return {
    text,
    html: `<p>${escapeHtml(input.clientName)}, please find ${escapeHtml(input.documentType.toLowerCase())} <strong>${escapeHtml(input.documentNumber)}</strong> attached.</p><p>Total: <strong>${escapeHtml(total)}</strong>${balance ? `<br>Balance due: <strong>${escapeHtml(balance)}</strong>` : ""}${input.dueDate ? `<br>Due date: ${escapeHtml(input.dueDate)}` : ""}</p>`,
  };
}

export async function deliverFinanceDocumentEmail(input: {
  organizationId: string;
  deliveryId: string;
  recipientEmail: string;
  subject: string;
  documentNumber: string;
  fileName: string;
  pdfBytes: Buffer;
  messageText?: string;
  messageHtml?: string;
}): Promise<FinanceEmailDeliveryResult> {
  const configuration = (await getNotificationDeliveryConfiguration(input.organizationId)).email;
  if (!configuration.configured || !configuration.resendApiKey || !configuration.from) {
    return { delivered: false, errorCode: "email_not_configured" };
  }

  const message = input.messageText ?? `Please find ${input.documentNumber} attached.`;
  const result = await sendEmailWithResend(
    { apiKey: configuration.resendApiKey, from: configuration.from },
    {
      to: input.recipientEmail,
      subject: input.subject,
      text: message,
      html: input.messageHtml ?? `<p>${escapeHtml(message)}</p>`,
      idempotencyKey: createHash("sha256")
        .update(`finance-email:${input.deliveryId}`)
        .digest("hex"),
      attachments: [{ fileName: input.fileName, content: input.pdfBytes }],
    },
  );

  return result.delivered
    ? { delivered: true, providerReference: result.providerReference }
    : { delivered: false, errorCode: result.errorCode };
}
