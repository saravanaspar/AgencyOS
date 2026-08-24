import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { isAutomationHandlerKey, type AutomationHandlerKey } from "@/modules/automation/automation";
import { enqueueNotification } from "@/modules/notifications/server/notifications";

export interface AutomationHandlerInput {
  dispatchId: string;
  organizationId: string;
  automationId: string;
  automationName: string;
  ownerMembershipId: string;
  event: {
    id: string;
    key: string;
    sourceModule: string;
    entityType: string;
    entityId: string;
    actorMembershipId: string | null;
    occurredAt: Date;
    payload: Record<string, unknown>;
  };
}

export interface AutomationHandlerResult {
  summary: string;
  metadata: Record<string, unknown>;
}

export class AutomationHandlerError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: string,
    message: string,
    options: { retryable?: boolean; retryAfterSeconds?: number | null } = {},
  ) {
    super(message);
    this.name = "AutomationHandlerError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

function payloadText(
  payload: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string | null {
  const value = payload[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximumLength) : null;
}

async function requireActiveRecipient(
  organizationId: string,
  membershipId: string | null,
): Promise<string> {
  if (!membershipId) {
    throw new AutomationHandlerError(
      "recipient_missing",
      "The automation event does not have an eligible recipient.",
    );
  }
  const database = getDatabaseClient();
  const rows = await database<{ id: string }[]>`
    select id
    from public.memberships
    where id = ${membershipId}::uuid
      and organization_id = ${organizationId}::uuid
      and status = 'active'
    limit 1
  `;
  if (!rows[0]) {
    throw new AutomationHandlerError(
      "recipient_inactive",
      "The automation recipient is not active in this organization.",
    );
  }
  return rows[0].id;
}

async function createEventNotification(
  input: AutomationHandlerInput,
  recipientMembershipId: string | null,
): Promise<AutomationHandlerResult> {
  const recipientId = await requireActiveRecipient(input.organizationId, recipientMembershipId);
  const title =
    payloadText(input.event.payload, "notificationTitle", 160) ??
    `${input.automationName}: ${input.event.key}`.slice(0, 160);
  const message =
    payloadText(input.event.payload, "notificationMessage", 1_000) ??
    `${input.event.entityType} ${input.event.entityId} triggered ${input.event.key}.`.slice(
      0,
      1_000,
    );
  const deepLink = payloadText(input.event.payload, "deepLink", 500);

  const notificationId = await enqueueNotification({
    organizationId: input.organizationId,
    recipientMembershipId: recipientId,
    category: "automation",
    severity: "info",
    title,
    message,
    deepLink,
    sourceModule: "automation",
    sourceEntityType: input.event.entityType,
    sourceEntityId: input.event.entityId,
    dedupeKey: `automation:${input.dispatchId}`,
    metadata: {
      automationId: input.automationId,
      dispatchId: input.dispatchId,
      eventId: input.event.id,
      eventKey: input.event.key,
    },
  });

  if (!notificationId) {
    throw new AutomationHandlerError(
      "notification_not_created",
      "The automation notification was not created.",
      { retryable: true },
    );
  }

  return {
    summary: "Automation notification queued.",
    metadata: { notificationId, recipientMembershipId: recipientId },
  };
}

const handlers: Record<
  AutomationHandlerKey,
  (input: AutomationHandlerInput) => Promise<AutomationHandlerResult>
> = {
  "notification.owner": (input) => createEventNotification(input, input.ownerMembershipId),
  "notification.event_actor": (input) =>
    createEventNotification(input, input.event.actorMembershipId),
};

export async function executeAutomationHandler(
  handlerKey: string,
  input: AutomationHandlerInput,
): Promise<AutomationHandlerResult> {
  if (!isAutomationHandlerKey(handlerKey)) {
    throw new AutomationHandlerError(
      "handler_unknown",
      "The configured AgencyOS automation handler is not registered.",
    );
  }
  return handlers[handlerKey](input);
}
