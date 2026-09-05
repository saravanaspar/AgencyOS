import "server-only";

export type PrivateFileScannerProvider = "clamav" | "http";

export interface PrivateFileScanConfiguration {
  provider: PrivateFileScannerProvider | null;
  scannerUrl: string | null;
  scannerBearerToken: string | null;
  configured: boolean;
}

function stringValue(name: string): string | null {
  return process.env[name]?.trim() || null;
}

function validSecret(value: string | null, minimumLength = 32): string | null {
  return value && value.length >= minimumLength ? value : null;
}

function scannerEndpoint(value: string | null): {
  provider: PrivateFileScannerProvider;
  url: string;
} | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash || url.search) return null;

    if (url.protocol === "clamav:") {
      const hostname = url.hostname.toLowerCase();
      const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
      const trustedPrivateService =
        process.env.NODE_ENV === "production" &&
        process.env.AGENCYOS_TRUST_PRIVATE_SERVICE_NETWORK === "1" &&
        hostname === "clamav";
      const port = Number(url.port || 3310);
      if (
        (!localHosts.has(hostname) && !trustedPrivateService) ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65_535
      ) {
        return null;
      }
      if (url.pathname && url.pathname !== "/") return null;
      return { provider: "clamav", url: url.toString() };
    }

    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local)) {
      return null;
    }
    return { provider: "http", url: url.toString() };
  } catch {
    return null;
  }
}

export function getPrivateFileScanConfiguration(): PrivateFileScanConfiguration {
  const endpoint = scannerEndpoint(stringValue("PRIVATE_FILE_SCANNER_URL"));
  const token = validSecret(stringValue("PRIVATE_FILE_SCANNER_BEARER_TOKEN"), 16);
  const configured = Boolean(endpoint && (endpoint.provider === "clamav" || token));

  return {
    provider: endpoint?.provider ?? null,
    scannerUrl: endpoint?.url ?? null,
    scannerBearerToken: endpoint?.provider === "http" ? token : null,
    configured,
  };
}
