import { describe, expect, it, vi } from "vitest";

import {
  createLazyMcpToolGateway,
  describeMcpTools,
  searchMcpToolCatalog,
} from "@/modules/mcp/tool-discovery";

const tools = [
  {
    name: "agencyos.documents.search_library",
    title: "Search document library",
    description: "Search folders, document metadata, and versions.",
    inputSchema: { type: "object", properties: { q: { type: "string" } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "agencyos.finance.create_invoice",
    title: "Create invoice",
    description: "Creates a draft customer invoice.",
    inputSchema: { type: "object", properties: { clientId: { type: "string" } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
] as const;

describe("lazy MCP tool discovery", () => {
  it("searches concise catalog metadata without returning full input schemas", () => {
    const result = searchMcpToolCatalog(tools, "document folder");

    expect(result.tools[0]?.name).toBe("agencyos.documents.search_library");
    expect(result.tools[0]).toMatchObject({
      title: "Search document library",
      readOnly: true,
    });
    expect(result.tools[0]).not.toHaveProperty("inputSchema");
  });

  it("describes only exact tools already allowed in this session", () => {
    const result = describeMcpTools(tools.slice(0, 1), [
      "agencyos.documents.search_library",
      "agencyos.finance.create_invoice",
    ]);

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]?.inputSchema).toEqual(tools[0].inputSchema);
    expect(result.unavailableNames).toEqual(["agencyos.finance.create_invoice"]);
  });

  it("exposes only three gateway schemas and refuses hidden tool invocation", async () => {
    const invoke = vi.fn(async (name: string, input: Record<string, unknown>) => ({ name, input }));
    const gateway = createLazyMcpToolGateway(tools.slice(0, 1), invoke);

    expect(gateway.map((tool) => tool.descriptor.name)).toEqual([
      "agencyos.tools.search_catalog",
      "agencyos.tools.describe",
      "agencyos.tools.invoke",
    ]);

    const invokeGateway = gateway[2];
    await expect(
      invokeGateway.execute({ name: "agencyos.finance.create_invoice", arguments: {} }),
    ).rejects.toThrow("not available in this AI session");
    expect(invoke).not.toHaveBeenCalled();

    await expect(
      invokeGateway.execute({ name: "agencyos.documents.search_library", arguments: {} }),
    ).rejects.toThrow("Describe that AgencyOS tool before invoking it");

    const searchGateway = gateway[0];
    const describeGateway = gateway[1];
    await expect(
      describeGateway.execute({ names: ["agencyos.documents.search_library"] }),
    ).rejects.toThrow("Search the AgencyOS tool catalog before describing a tool");
    await searchGateway.execute({ query: "document library" });
    await describeGateway.execute({ names: ["agencyos.documents.search_library"] });

    await expect(
      invokeGateway.execute({
        name: "agencyos.documents.search_library",
        arguments: { q: "board minutes" },
      }),
    ).resolves.toEqual({
      name: "agencyos.documents.search_library",
      input: { q: "board minutes" },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
