import { NextResponse } from "next/server";

import { structuredLog } from "@/lib/server/observability";
import { incrementMetric, observeMetric } from "@/lib/server/runtime-metrics";

import { readBoundedRequestJson } from "@/lib/server/bounded-request";
import { isAllowedApplicationOrigin } from "@/lib/server/request-origin";
import { getRequestSecurityContextFromRequest } from "@/lib/server/request-context";
import {
  authorizeCurrentUser,
  authorizationStatus,
} from "@/modules/permissions/server/authorization";
import { authorizedRateLimitAllows } from "@/modules/security/server/security";
import {
  AGENCYOS_MCP_PROTOCOL_VERSION,
  callMcpTool,
  listAvailableMcpTools,
  McpToolError,
} from "@/modules/mcp/tool-registry";
import {
  createMcpSession,
  deleteMcpSession,
  markMcpSessionInitialized,
  readMcpSession,
} from "@/modules/mcp/server/session";

export const dynamic = "force-dynamic";

const privateNoStoreHeaders = { "Cache-Control": "private, no-store" };
const SESSION_HEADER = "Mcp-Session-Id";
const VERSION_HEADER = "MCP-Protocol-Version";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

function jsonRpcResult(
  id: JsonRpcRequest["id"],
  result: unknown,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, result },
    { headers: { ...privateNoStoreHeaders, ...headers } },
  );
}

function jsonRpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  data?: unknown,
  status = 200,
) {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    },
    { status, headers: privateNoStoreHeaders },
  );
}

function toolErrorResult(id: JsonRpcRequest["id"], error: McpToolError) {
  if (error.code === "NOT_FOUND") return jsonRpcError(id, -32601, error.message);
  if (error.code === "INVALID_ARGUMENTS")
    return jsonRpcError(id, -32602, error.message, undefined, 400);
  if (error.code === "UNAUTHORIZED") return jsonRpcError(id, -32001, error.message, undefined, 403);
  if (error.code === "UNAVAILABLE") return jsonRpcError(id, -32002, error.message, undefined, 503);

  return jsonRpcResult(id, {
    content: [{ type: "text", text: error.message }],
    isError: true,
  });
}

function acceptsStreamableHttp(request: Request): boolean {
  const accept = (request.headers.get("accept") ?? "").toLowerCase();
  return accept.includes("application/json") && accept.includes("text/event-stream");
}

function requestedProtocolVersion(message: JsonRpcRequest): string | null {
  if (!message.params || typeof message.params !== "object" || Array.isArray(message.params)) {
    return null;
  }
  const value = Reflect.get(message.params, "protocolVersion");
  return typeof value === "string" ? value : null;
}

async function authorizedRequest(request: Request) {
  if (!isAllowedApplicationOrigin(request, { requireOrigin: true })) {
    return {
      response: jsonRpcError(
        null,
        -32003,
        "A same-origin Origin header is required for MCP requests.",
        undefined,
        403,
      ),
    } as const;
  }
  const authorization = await authorizeCurrentUser([]);
  if (!authorization.allowed) {
    return {
      response: jsonRpcError(
        null,
        -32001,
        authorization.reason,
        undefined,
        authorizationStatus(authorization.reason),
      ),
    } as const;
  }
  const rateAllowed = await authorizedRateLimitAllows({
    kind: "mcp",
    context: authorization.context,
    request: getRequestSecurityContextFromRequest(request),
  });
  if (!rateAllowed) {
    return {
      response: jsonRpcError(
        null,
        -32004,
        "MCP rate limit exceeded or unavailable.",
        undefined,
        429,
      ),
    } as const;
  }
  return { context: authorization.context } as const;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const access = await authorizedRequest(request);
  if ("response" in access) return access.response;

  if (!acceptsStreamableHttp(request)) {
    return jsonRpcError(
      null,
      -32600,
      "MCP Accept must include application/json and text/event-stream.",
      undefined,
      406,
    );
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return jsonRpcError(null, -32600, "MCP requests must use application/json.", undefined, 415);
  }

  const bounded = await readBoundedRequestJson(request, 262_144);
  if (!bounded.ok) {
    if (bounded.status === 413) {
      return jsonRpcError(null, -32600, "MCP request body is too large.", undefined, 413);
    }
    if (bounded.status === 411) {
      return jsonRpcError(null, -32600, "MCP Content-Length header is invalid.", undefined, 400);
    }
    return jsonRpcError(null, -32700, "Invalid JSON payload.", undefined, 400);
  }

  const message = bounded.value as JsonRpcRequest;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return jsonRpcError(message.id, -32600, "Invalid JSON-RPC request.", undefined, 400);
  }

  try {
    if (message.method === "initialize") {
      const requested = requestedProtocolVersion(message);
      if (requested !== AGENCYOS_MCP_PROTOCOL_VERSION) {
        return jsonRpcError(
          message.id,
          -32602,
          `Unsupported MCP protocol version. Supported version: ${AGENCYOS_MCP_PROTOCOL_VERSION}.`,
          undefined,
          400,
        );
      }
      await listAvailableMcpTools();
      const sessionId = await createMcpSession({
        membershipId: access.context.membership.id,
        organizationId: access.context.membership.organizationId,
      });
      return jsonRpcResult(
        message.id,
        {
          protocolVersion: AGENCYOS_MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "agencyos", version: "0.1.0" },
          instructions:
            "AgencyOS tools are permission-filtered and re-authorized for every call. Sensitive mutations require approval.",
        },
        { [SESSION_HEADER]: sessionId },
      );
    }

    const sessionId = request.headers.get(SESSION_HEADER);
    if (!sessionId) {
      return jsonRpcError(
        message.id,
        -32005,
        `${SESSION_HEADER} is required after initialization.`,
        undefined,
        400,
      );
    }
    const protocolVersion = request.headers.get(VERSION_HEADER);
    if (protocolVersion !== AGENCYOS_MCP_PROTOCOL_VERSION) {
      return jsonRpcError(
        message.id,
        -32006,
        `${VERSION_HEADER} must be ${AGENCYOS_MCP_PROTOCOL_VERSION}.`,
        undefined,
        400,
      );
    }
    const session = await readMcpSession({
      sessionId,
      membershipId: access.context.membership.id,
      organizationId: access.context.membership.organizationId,
    });

    if (message.method === "notifications/initialized") {
      await markMcpSessionInitialized(sessionId);
      return new NextResponse(null, { status: 202, headers: privateNoStoreHeaders });
    }
    if (!session.initialized) {
      return jsonRpcError(
        message.id,
        -32007,
        "Send notifications/initialized before other MCP methods.",
        undefined,
        409,
      );
    }
    if (message.method === "ping") return jsonRpcResult(message.id, {});
    if (message.method === "tools/list") {
      return jsonRpcResult(message.id, { tools: await listAvailableMcpTools() });
    }
    if (message.method === "tools/call") {
      const params = message.params;
      if (!params || typeof params !== "object" || Array.isArray(params)) {
        return jsonRpcError(message.id, -32602, "tools/call requires an object parameter.");
      }
      const name = Reflect.get(params, "name");
      const argumentsValue = Reflect.get(params, "arguments") ?? {};
      if (typeof name !== "string") {
        return jsonRpcError(message.id, -32602, "tools/call requires a tool name.");
      }
      const data = await callMcpTool(name, argumentsValue);
      incrementMetric("mcp_tool_calls_total", { tool: name, result: "success" });
      observeMetric("mcp_tool_call_duration_ms", Date.now() - startedAt, { tool: name });
      structuredLog("info", "mcp.tool_call.succeeded", {
        requestId,
        tool: name,
        durationMs: Date.now() - startedAt,
      });
      return jsonRpcResult(message.id, {
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
        isError: false,
      });
    }
    return jsonRpcError(message.id, -32601, `Unsupported MCP method: ${message.method}.`);
  } catch (error) {
    if (error instanceof McpToolError) {
      incrementMetric("mcp_requests_total", { result: error.code });
      structuredLog("warn", "mcp.request.rejected", {
        requestId,
        code: error.code,
        durationMs: Date.now() - startedAt,
      });
      return toolErrorResult(message.id, error);
    }
    incrementMetric("mcp_requests_total", { result: "error" });
    observeMetric("mcp_request_duration_ms", Date.now() - startedAt, { result: "error" });
    structuredLog("error", "mcp.request.failed", {
      requestId,
      durationMs: Date.now() - startedAt,
      error,
    });
    return jsonRpcError(message.id, -32603, "Internal MCP server error.", undefined, 500);
  }
}

export async function GET() {
  return new NextResponse(null, {
    status: 405,
    headers: { ...privateNoStoreHeaders, Allow: "POST, DELETE" },
  });
}

export async function DELETE(request: Request) {
  const access = await authorizedRequest(request);
  if ("response" in access) return access.response;
  const sessionId = request.headers.get(SESSION_HEADER);
  if (!sessionId) {
    return jsonRpcError(null, -32005, `${SESSION_HEADER} is required.`, undefined, 400);
  }
  try {
    await readMcpSession({
      sessionId,
      membershipId: access.context.membership.id,
      organizationId: access.context.membership.organizationId,
    });
    await deleteMcpSession(sessionId);
    return new NextResponse(null, { status: 204, headers: privateNoStoreHeaders });
  } catch (error) {
    if (error instanceof McpToolError) return toolErrorResult(null, error);
    return jsonRpcError(null, -32603, "Internal MCP server error.", undefined, 500);
  }
}
