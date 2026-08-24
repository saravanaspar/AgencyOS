export function createContentSecurityPolicy({
  nonce,
  environment = process.env.NODE_ENV,
}: {
  nonce: string;
  environment?: string;
}): string {
  if (!/^[A-Za-z0-9+/=_-]{16,256}$/.test(nonce)) {
    throw new Error("A valid CSP nonce is required.");
  }

  const development = environment === "development";
  const scriptSources = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (development) scriptSources.push("'unsafe-eval'");
  const styleSources = development ? ["'self'", "'unsafe-inline'"] : ["'self'", `'nonce-${nonce}'`];

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    `style-src ${styleSources.join(" ")}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "media-src 'self'",
    "manifest-src 'self'",
  ];
  if (environment === "production") directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
