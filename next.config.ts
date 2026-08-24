import type { NextConfig } from "next";

function applicationSecurityHeaders() {
  const headers = [
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "Origin-Agent-Cluster", value: "?1" },
  ];
  if (process.env.NODE_ENV === "production") {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  }
  return headers;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  experimental: {
    webpackBuildWorker: false,
    cpus: 2,
    staticGenerationMaxConcurrency: 4,
    staticGenerationMinPagesPerWorker: 10,
  },
  async headers() {
    return [{ source: "/(.*)", headers: applicationSecurityHeaders() }];
  },
  outputFileTracingIncludes: {
    "/finance": [
      "./src/modules/finance/pdf/templates/invoice-ninja/**/*",
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
    "/api/mcp": [
      "./src/modules/finance/pdf/templates/invoice-ninja/**/*",
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
  },
};

export default nextConfig;
