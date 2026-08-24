export const IDENTITY_SESSION_COOKIE = "agencyos_session";

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_SECRET_PATTERN = /^[A-Za-z0-9_-]{40,96}$/;

export interface ParsedIdentitySessionToken {
  id: string;
  secret: string;
}

export function parseIdentitySessionToken(
  value: string | undefined | null,
): ParsedIdentitySessionToken | null {
  if (!value) return null;
  const separator = value.indexOf(".");
  if (separator < 0) return null;
  const id = value.slice(0, separator);
  const secret = value.slice(separator + 1);
  if (!SESSION_ID_PATTERN.test(id) || !SESSION_SECRET_PATTERN.test(secret)) return null;
  return { id, secret };
}
