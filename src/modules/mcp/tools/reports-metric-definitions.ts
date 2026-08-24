import { metricDefinitionCatalog } from "@/modules/reports/metric-definitions";
import { reportsPermissionKeys } from "@/modules/reports/reports";

export const reportsMetricDefinitionsMcpTool = {
  name: "agencyos.reports.get_metric_definitions",
  title: "Read executive metric definitions",
  description:
    "Returns the canonical meaning, formula, source entities, currency treatment, and caveats for AgencyOS executive metrics. Use this before explaining KPI semantics or comparing metrics.",
  inputSchema: {
    type: "object",
    properties: {
      keys: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 120 },
        maxItems: 60,
      },
    },
    required: [],
    additionalProperties: false,
  },
  requiredPermissions: [reportsPermissionKeys.workspace],
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input: Record<string, unknown>) {
    const requested = Array.isArray(input.keys)
      ? input.keys.filter((value): value is string => typeof value === "string").slice(0, 60)
      : [];
    const keys = requested.length
      ? Array.from(new Set(requested)).filter((key) => Boolean(metricDefinitionCatalog[key]))
      : Object.keys(metricDefinitionCatalog).sort();
    return {
      definitions: keys.map((key) => metricDefinitionCatalog[key]),
      unknownKeys: requested.filter((key) => !metricDefinitionCatalog[key]),
    };
  },
} as const;
