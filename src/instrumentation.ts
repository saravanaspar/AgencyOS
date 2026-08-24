import { structuredLog } from "@/lib/server/observability";
import { getRuntimeDependencyPolicy, validateProductionEnvironment } from "@/lib/validation/env";
import { getPrivateFileScanConfiguration } from "@/modules/private-files/server/scan-config";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build")
    return;
  try {
    validateProductionEnvironment();
    const policy = getRuntimeDependencyPolicy();
    if (policy.privateFileScannerRequired && !getPrivateFileScanConfiguration().configured) {
      throw new Error(
        "PRIVATE_FILE_SCANNER_URL/token configuration is invalid for a required production scanner.",
      );
    }
    structuredLog("info", "runtime.configuration.validated", {
      environment: process.env.NODE_ENV,
      dependencies: policy,
    });
  } catch (error) {
    structuredLog("error", "runtime.configuration.invalid", { error });
    throw error;
  }
}
