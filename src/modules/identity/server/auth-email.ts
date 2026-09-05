import "server-only";

import { createHash } from "node:crypto";

import { sendEmailWithResend } from "@/integrations/email/resend";
import { getApplicationEnv } from "@/lib/validation/env";
import { getNotificationDeliveryConfiguration } from "@/modules/notifications/server/delivery-config";

function htmlEscape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

async function sendAuthEmail(input: {
  to: string;
  subject: string;
  text: string;
  link: string;
  idempotencySeed: string;
}): Promise<boolean> {
  const configuration = await getNotificationDeliveryConfiguration();
  if (
    !configuration.email.configured ||
    !configuration.email.resendApiKey ||
    !configuration.email.from
  ) {
    return false;
  }
  const result = await sendEmailWithResend(
    { apiKey: configuration.email.resendApiKey, from: configuration.email.from },
    {
      to: input.to,
      subject: input.subject,
      text: `${input.text}\n\n${input.link}`,
      html: `<p>${htmlEscape(input.text)}</p><p><a href="${htmlEscape(input.link)}">Continue in AgencyOS</a></p>`,
      idempotencyKey: `auth-${createHash("sha256").update(input.idempotencySeed).digest("hex").slice(0, 48)}`,
    },
  );
  return result.delivered;
}

export async function sendIdentityVerificationEmail(
  email: string,
  token: string,
): Promise<boolean> {
  const { appUrl } = getApplicationEnv();
  const link = `${appUrl}/auth/confirm?purpose=email_verification&token=${encodeURIComponent(token)}&next=%2Fpending-access`;
  return sendAuthEmail({
    to: email,
    subject: "Confirm your AgencyOS account",
    text: "Confirm this email address to complete your AgencyOS account request.",
    link,
    idempotencySeed: `verify:${email}:${token}`,
  });
}

export async function sendIdentityPasswordResetEmail(
  email: string,
  token: string,
): Promise<boolean> {
  const { appUrl } = getApplicationEnv();
  const link = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return sendAuthEmail({
    to: email,
    subject: "Reset your AgencyOS password",
    text: "Use this link to choose a new AgencyOS password. If you did not request it, ignore this email.",
    link,
    idempotencySeed: `reset:${email}:${token}`,
  });
}
