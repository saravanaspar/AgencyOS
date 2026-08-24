const exactSelfAuthenticatedApiMethods = new Map<string, ReadonlySet<string>>([
  ["/api/internal/workers/run", new Set(["POST"])],
  ["/api/mcp", new Set(["GET", "POST", "DELETE"])],
  ["/api/metrics", new Set(["GET"])],
  ["/api/health/live", new Set(["GET"])],
  ["/api/health/ready", new Set(["GET"])],
  ["/api/health/status", new Set(["GET"])],
]);

const crmWebhookPath = /^\/api\/crm\/connectors\/[^/]+\/webhook$/;

export function handlesOwnApiAuthentication(pathname: string, method = "GET"): boolean {
  const normalizedMethod = method.toUpperCase();
  const methods = exactSelfAuthenticatedApiMethods.get(pathname);
  if (methods?.has(normalizedMethod)) return true;
  return crmWebhookPath.test(pathname) && ["GET", "POST"].includes(normalizedMethod);
}
