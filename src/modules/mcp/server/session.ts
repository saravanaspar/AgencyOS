import "server-only";

import { randomUUID } from "node:crypto";

import { getRedisClient, reportRedisFailure } from "@/integrations/redis/client";
import { AGENCYOS_MCP_PROTOCOL_VERSION, McpToolError } from "@/modules/mcp/tool-registry";

const SESSION_TTL_SECONDS = 30 * 60;
const SESSION_ID_PATTERN = /^[0-9a-f-]{36}$/i;

interface McpSessionState {
  protocolVersion: string;
  membershipId: string;
  organizationId: string;
  initialized: boolean;
  createdAt: string;
}

function sessionKey(sessionId: string): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new McpToolError("MCP session identifier is invalid.", "INVALID_ARGUMENTS");
  }
  return `mcp:session:${sessionId}`;
}

async function redisOrThrow() {
  const client = await getRedisClient();
  if (!client) {
    throw new McpToolError(
      "MCP session storage is unavailable. Redis is required for lifecycle-safe MCP requests.",
      "UNAVAILABLE",
    );
  }
  return client;
}

export async function createMcpSession(input: {
  membershipId: string;
  organizationId: string;
}): Promise<string> {
  const client = await redisOrThrow();
  const sessionId = randomUUID();
  const state: McpSessionState = {
    protocolVersion: AGENCYOS_MCP_PROTOCOL_VERSION,
    membershipId: input.membershipId,
    organizationId: input.organizationId,
    initialized: false,
    createdAt: new Date().toISOString(),
  };
  try {
    await client.set(sessionKey(sessionId), JSON.stringify(state), { EX: SESSION_TTL_SECONDS });
    return sessionId;
  } catch (error) {
    reportRedisFailure(error);
    throw new McpToolError("MCP session could not be created.", "UNAVAILABLE");
  }
}

export async function readMcpSession(input: {
  sessionId: string;
  membershipId: string;
  organizationId: string;
}): Promise<McpSessionState> {
  const client = await redisOrThrow();
  try {
    const raw = await client.get(sessionKey(input.sessionId));
    if (!raw) throw new McpToolError("MCP session was not found or expired.", "UNAUTHORIZED");
    const state = JSON.parse(raw) as McpSessionState;
    if (
      state.protocolVersion !== AGENCYOS_MCP_PROTOCOL_VERSION ||
      state.membershipId !== input.membershipId ||
      state.organizationId !== input.organizationId
    ) {
      throw new McpToolError(
        "MCP session does not belong to the active membership.",
        "UNAUTHORIZED",
      );
    }
    await client.expire(sessionKey(input.sessionId), SESSION_TTL_SECONDS);
    return state;
  } catch (error) {
    if (error instanceof McpToolError) throw error;
    reportRedisFailure(error);
    throw new McpToolError("MCP session could not be verified.", "UNAVAILABLE");
  }
}

export async function markMcpSessionInitialized(sessionId: string): Promise<void> {
  const client = await redisOrThrow();
  try {
    const raw = await client.get(sessionKey(sessionId));
    if (!raw) throw new McpToolError("MCP session was not found or expired.", "UNAUTHORIZED");
    const state = JSON.parse(raw) as McpSessionState;
    state.initialized = true;
    await client.set(sessionKey(sessionId), JSON.stringify(state), { EX: SESSION_TTL_SECONDS });
  } catch (error) {
    if (error instanceof McpToolError) throw error;
    reportRedisFailure(error);
    throw new McpToolError("MCP session could not be initialized.", "UNAVAILABLE");
  }
}

export async function deleteMcpSession(sessionId: string): Promise<void> {
  const client = await redisOrThrow();
  try {
    await client.del(sessionKey(sessionId));
  } catch (error) {
    reportRedisFailure(error);
    throw new McpToolError("MCP session could not be terminated.", "UNAVAILABLE");
  }
}
