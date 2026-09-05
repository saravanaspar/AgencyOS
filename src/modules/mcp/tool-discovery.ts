import type { AgencyOsMcpToolDescriptor } from "@/modules/mcp/tool-registry";

export interface AgencyOsMcpGatewayTool {
  descriptor: AgencyOsMcpToolDescriptor;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
  traceName: (input: Record<string, unknown>) => string;
}

const SEARCH_LIMIT_DEFAULT = 8;
const SEARCH_LIMIT_MAX = 12;
const DESCRIBE_LIMIT_MAX = 8;

function objectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function normalizedText(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[._/-]+/g, " ")
    .replaceAll(/[^a-z0-9\s]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function searchScore(tool: AgencyOsMcpToolDescriptor, query: string): number {
  const normalizedQuery = normalizedText(query);
  if (!normalizedQuery) return 1;

  const name = normalizedText(tool.name);
  const title = normalizedText(tool.title);
  const description = normalizedText(tool.description);
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  let score = 0;

  if (name === normalizedQuery) score += 1000;
  if (name.includes(normalizedQuery)) score += 500;
  if (title === normalizedQuery) score += 450;
  if (title.includes(normalizedQuery)) score += 300;
  if (description.includes(normalizedQuery)) score += 160;

  for (const token of tokens) {
    if (name.includes(token)) score += 80;
    if (title.includes(token)) score += 55;
    if (description.includes(token)) score += 20;
  }

  return score;
}

export function searchMcpToolCatalog(
  tools: readonly AgencyOsMcpToolDescriptor[],
  query: string,
  limit = SEARCH_LIMIT_DEFAULT,
) {
  const boundedQuery = query.trim().slice(0, 160);
  const boundedLimit = Math.max(
    1,
    Math.min(SEARCH_LIMIT_MAX, Math.trunc(limit) || SEARCH_LIMIT_DEFAULT),
  );

  const matches = tools
    .map((tool) => ({ tool, score: searchScore(tool, boundedQuery) }))
    .filter((match) => match.score > 0)
    .sort(
      (left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name),
    );

  return {
    query: boundedQuery,
    matchCount: matches.length,
    tools: matches.slice(0, boundedLimit).map(({ tool }) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      readOnly: tool.annotations?.readOnlyHint === true,
      destructive: tool.annotations?.destructiveHint === true,
      idempotent: tool.annotations?.idempotentHint === true,
    })),
  };
}

export function describeMcpTools(
  tools: readonly AgencyOsMcpToolDescriptor[],
  requestedNames: readonly string[],
) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const names = [...new Set(requestedNames.map((name) => name.trim()).filter(Boolean))].slice(
    0,
    DESCRIBE_LIMIT_MAX,
  );
  const descriptions = names.flatMap((name) => {
    const descriptor = byName.get(name);
    return descriptor ? [descriptor] : [];
  });

  return {
    tools: descriptions,
    unavailableNames: names.filter((name) => !byName.has(name)),
  };
}

function gatewayDescriptor(input: AgencyOsMcpToolDescriptor): AgencyOsMcpToolDescriptor {
  return input;
}

export function createLazyMcpToolGateway(
  tools: readonly AgencyOsMcpToolDescriptor[],
  invoke: (name: string, input: Record<string, unknown>) => Promise<unknown>,
): AgencyOsMcpGatewayTool[] {
  const allowedByName = new Map(tools.map((tool) => [tool.name, tool]));
  const searchedNames = new Set<string>();
  const describedNames = new Set<string>();

  return [
    {
      descriptor: gatewayDescriptor({
        name: "agencyos.tools.search_catalog",
        title: "Search AgencyOS tool catalog",
        description:
          "Searches only the AgencyOS tools authorized and allowed for this AI session. Returns concise names and descriptions without loading full input schemas.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              minLength: 1,
              maxLength: 160,
              description:
                "Capability or business task to find, such as document search or create invoice.",
            },
            limit: { type: "integer", minimum: 1, maximum: SEARCH_LIMIT_MAX, default: 8 },
          },
          required: ["query"],
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      }),
      async execute(input) {
        const query = typeof input.query === "string" ? input.query : "";
        if (!query.trim()) throw new Error("Catalog search requires a non-empty query.");
        const limit = typeof input.limit === "number" ? input.limit : SEARCH_LIMIT_DEFAULT;
        const result = searchMcpToolCatalog(tools, query, limit);
        for (const tool of result.tools) searchedNames.add(tool.name);
        return result;
      },
      traceName: () => "agencyos.tools.search_catalog",
    },
    {
      descriptor: gatewayDescriptor({
        name: "agencyos.tools.describe",
        title: "Describe AgencyOS tools",
        description:
          "Loads full descriptions and input schemas for a small set of exact tool names returned by catalog search.",
        inputSchema: {
          type: "object",
          properties: {
            names: {
              type: "array",
              minItems: 1,
              maxItems: DESCRIBE_LIMIT_MAX,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 160 },
            },
          },
          required: ["names"],
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      }),
      async execute(input) {
        const names = Array.isArray(input.names)
          ? input.names.filter((value): value is string => typeof value === "string")
          : [];
        if (!names.length) throw new Error("Tool description requires at least one tool name.");
        if (names.some((name) => !searchedNames.has(name.trim()))) {
          throw new Error("Search the AgencyOS tool catalog before describing a tool.");
        }
        const result = describeMcpTools(tools, names);
        for (const tool of result.tools) describedNames.add(tool.name);
        return result;
      },
      traceName: () => "agencyos.tools.describe",
    },
    {
      descriptor: gatewayDescriptor({
        name: "agencyos.tools.invoke",
        title: "Invoke an AgencyOS tool",
        description:
          "Invokes one exact AgencyOS tool that is authorized and allowed for this AI session. Use catalog search and describe first so the name and arguments match the selected schema.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              minLength: 1,
              maxLength: 160,
              description: "Exact AgencyOS tool name returned by catalog search.",
            },
            arguments: {
              type: "object",
              description:
                "Arguments that match the input schema returned by AgencyOS tool describe.",
            },
          },
          required: ["name", "arguments"],
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      }),
      async execute(input) {
        const name = typeof input.name === "string" ? input.name.trim() : "";
        if (!name || !allowedByName.has(name)) {
          throw new Error("That AgencyOS tool is not available in this AI session.");
        }
        if (!describedNames.has(name)) {
          throw new Error("Describe that AgencyOS tool before invoking it.");
        }
        return invoke(name, objectInput(input.arguments));
      },
      traceName: (input) =>
        typeof input.name === "string" && input.name.trim()
          ? input.name.trim().slice(0, 160)
          : "agencyos.tools.invoke",
    },
  ];
}
