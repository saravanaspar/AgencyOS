import "server-only";

import { createHash } from "node:crypto";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { automationRetryDelaySeconds } from "@/modules/automation/automation";
import {
  AutomationHandlerError,
  executeAutomationHandler,
} from "@/modules/automation/server/handler-registry";

const ROUTE_BATCH_SIZE = 80;
const DISPATCH_BATCH_SIZE = 24;
const RESULT_LIMIT_BYTES = 32 * 1024;

interface ClaimedDispatchRow {
  id: string;
  lock_token: string;
  organization_id: string;
  event_id: string;
  event_key: string;
  source_module: string;
  entity_type: string;
  entity_id: string;
  actor_membership_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: Date;
  automation_id: string;
  automation_name: string;
  owner_membership_id: string;
  handler_key: string;
  attempt_count: number;
  max_attempts: number;
}

interface ExecutionResult {
  outcome: "delivered" | "retry" | "dead_letter";
  errorCode: string | null;
  errorSummary: string | null;
  resultSummary: string | null;
  responseHash: string | null;
  retryAfterSeconds: number | null;
  metadata: Record<string, unknown>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedResultHash(value: Record<string, unknown>): string {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > RESULT_LIMIT_BYTES) {
    throw new AutomationHandlerError(
      "handler_result_too_large",
      "The automation handler result exceeded the allowed size.",
    );
  }
  return sha256(serialized);
}

async function enqueueDueContractEvents(): Promise<number> {
  const database = getDatabaseClient();
  const result = await database<{ inserted: number }[]>`
    with inserted as (
      insert into public.automation_domain_events (
        organization_id, event_key, source_module, entity_type, entity_id,
        actor_membership_id, payload, idempotency_key, occurred_at
      )
      select
        reminder.organization_id,
        'legal.contract_expiring',
        'legal',
        'contract',
        contract.id,
        contract.responsible_owner_membership_id,
        jsonb_build_object(
          'contractId', contract.id,
          'internalReference', contract.internal_reference,
          'reminderId', reminder.id,
          'reminderType', reminder.reminder_type,
          'remindOn', reminder.remind_on,
          'ownerMembershipId', contract.responsible_owner_membership_id,
          'renewalDate', contract.renewal_date,
          'endDate', contract.end_date,
          'deepLink', '/legal'
        ),
        'legal.contract_expiring:' || reminder.id::text,
        reminder.remind_on::timestamptz
      from public.legal_contract_reminders as reminder
      join public.legal_contracts as contract on contract.id = reminder.contract_id
      where reminder.status = 'pending'
        and reminder.reminder_type in ('renewal', 'expiry')
        and reminder.remind_on <= current_date
        and contract.status in ('approved', 'awaiting_signature', 'active')
      on conflict (organization_id, idempotency_key) do nothing
      returning 1
    )
    select count(*)::integer as inserted from inserted
  `;
  return result[0]?.inserted ?? 0;
}

async function routeDomainEvents(): Promise<{ events: number; dispatches: number }> {
  const database = getDatabaseClient();
  return database.begin(async (sql) => {
    const events = await sql<{ id: string }[]>`
      select event.id
      from public.automation_domain_events as event
      where event.routed_at is null
      order by event.created_at, event.id
      for update skip locked
      limit ${ROUTE_BATCH_SIZE}
    `;
    if (events.length === 0) return { events: 0, dispatches: 0 };
    const eventIds = events.map((event) => event.id);
    const dispatches = await sql<{ id: string }[]>`
      insert into public.automation_dispatches (
        organization_id, event_id, automation_id, status, available_at
      )
      select event.organization_id, event.id, definition.id, 'pending', now()
      from public.automation_domain_events as event
      join public.automation_definitions as definition
        on definition.organization_id = event.organization_id
       and definition.enabled
       and definition.trigger_key = event.event_key
       and event.source_module = any(definition.allowed_modules)
      where event.id = any(${eventIds}::uuid[])
        and (
          not (definition.conditions ? 'entityType')
          or definition.conditions->>'entityType' = event.entity_type
        )
        and (
          not (definition.conditions ? 'payloadEquals')
          or (
            jsonb_typeof(definition.conditions->'payloadEquals') = 'object'
            and not exists (
              select 1
              from jsonb_each_text(definition.conditions->'payloadEquals') as expected(key, value)
              where event.payload->>expected.key is distinct from expected.value
            )
          )
        )
      on conflict (event_id, automation_id) do nothing
      returning id
    `;
    await sql`
      update public.automation_domain_events
      set routed_at = now()
      where id = any(${eventIds}::uuid[])
        and routed_at is null
    `;
    return { events: events.length, dispatches: dispatches.length };
  });
}

async function claimDispatches(routingBarrier: {
  events: number;
  dispatches: number;
}): Promise<ClaimedDispatchRow[]> {
  if (routingBarrier.events < 0 || routingBarrier.dispatches < 0) {
    throw new Error("Automation routing returned an invalid count.");
  }
  const database = getDatabaseClient();
  return database<ClaimedDispatchRow[]>`
    with candidates as (
      select dispatch.id
      from public.automation_dispatches as dispatch
      join public.automation_definitions as definition on definition.id = dispatch.automation_id
      where definition.enabled
        and dispatch.attempt_count < dispatch.max_attempts
        and (
          (dispatch.status in ('pending', 'retry') and dispatch.available_at <= now())
          or (dispatch.status = 'processing' and dispatch.locked_at < now() - interval '15 minutes')
        )
      order by dispatch.available_at, dispatch.created_at, dispatch.id
      for update of dispatch skip locked
      limit ${DISPATCH_BATCH_SIZE}
    ), claimed as (
      update public.automation_dispatches as dispatch
      set status = 'processing',
          attempt_count = dispatch.attempt_count + 1,
          locked_at = now(),
          lock_token = gen_random_uuid(),
          updated_at = now()
      from candidates
      where dispatch.id = candidates.id
      returning dispatch.*
    )
    select
      claimed.id, claimed.lock_token, claimed.organization_id, claimed.event_id,
      event.event_key, event.source_module, event.entity_type, event.entity_id,
      event.actor_membership_id, event.payload, event.occurred_at,
      definition.id as automation_id, definition.name as automation_name,
      definition.owner_membership_id, definition.handler_key,
      claimed.attempt_count, claimed.max_attempts
    from claimed
    join public.automation_domain_events as event on event.id = claimed.event_id
    join public.automation_definitions as definition on definition.id = claimed.automation_id
    order by claimed.created_at, claimed.id
  `;
}

async function executeDispatch(
  row: ClaimedDispatchRow,
): Promise<{ result: ExecutionResult; requestHash: string }> {
  const request = {
    version: 1,
    dispatchId: row.id,
    automationId: row.automation_id,
    handlerKey: row.handler_key,
    eventId: row.event_id,
    eventKey: row.event_key,
    sourceModule: row.source_module,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: row.payload,
  };
  const requestHash = sha256(JSON.stringify(request));

  try {
    const handled = await executeAutomationHandler(row.handler_key, {
      dispatchId: row.id,
      organizationId: row.organization_id,
      automationId: row.automation_id,
      automationName: row.automation_name,
      ownerMembershipId: row.owner_membership_id,
      event: {
        id: row.event_id,
        key: row.event_key,
        sourceModule: row.source_module,
        entityType: row.entity_type,
        entityId: row.entity_id,
        actorMembershipId: row.actor_membership_id,
        occurredAt: row.occurred_at,
        payload: row.payload,
      },
    });
    const responseHash = boundedResultHash({
      summary: handled.summary,
      metadata: handled.metadata,
    });
    return {
      requestHash,
      result: {
        outcome: "delivered",
        errorCode: null,
        errorSummary: null,
        resultSummary: handled.summary.slice(0, 2_000),
        responseHash,
        retryAfterSeconds: null,
        metadata: handled.metadata,
      },
    };
  } catch (error) {
    if (error instanceof AutomationHandlerError) {
      return {
        requestHash,
        result: {
          outcome: error.retryable ? "retry" : "dead_letter",
          errorCode: error.code.slice(0, 80),
          errorSummary: error.message.slice(0, 1_000),
          resultSummary: null,
          responseHash: null,
          retryAfterSeconds: error.retryable
            ? (error.retryAfterSeconds ?? automationRetryDelaySeconds(row.attempt_count))
            : null,
          metadata: {},
        },
      };
    }
    return {
      requestHash,
      result: {
        outcome: "retry",
        errorCode: "handler_unavailable",
        errorSummary: "The AgencyOS automation handler could not complete.",
        resultSummary: null,
        responseHash: null,
        retryAfterSeconds: automationRetryDelaySeconds(row.attempt_count),
        metadata: {},
      },
    };
  }
}

async function completeDispatch(
  row: ClaimedDispatchRow,
  requestHash: string,
  result: ExecutionResult,
  startedAt: Date,
): Promise<"delivered" | "retry" | "dead_letter" | "stale"> {
  const database = getDatabaseClient();
  return database.begin(async (sql) => {
    const finalOutcome =
      result.outcome === "retry" && row.attempt_count >= row.max_attempts
        ? "dead_letter"
        : result.outcome;
    const completedAt = new Date();
    const updated = await sql<{ id: string }[]>`
      update public.automation_dispatches
      set status = ${finalOutcome},
          available_at = case
            when ${finalOutcome} = 'retry'
              then now() + (${result.retryAfterSeconds ?? automationRetryDelaySeconds(row.attempt_count)} * interval '1 second')
            else available_at
          end,
          delivered_at = case when ${finalOutcome} = 'delivered' then now() else null end,
          locked_at = null,
          lock_token = null,
          last_error_code = ${finalOutcome === "delivered" ? null : result.errorCode},
          last_error_summary = ${finalOutcome === "delivered" ? null : result.errorSummary},
          updated_at = now()
      where id = ${row.id}::uuid
        and lock_token = ${row.lock_token}::uuid
        and status = 'processing'
      returning id
    `;
    if (!updated[0]) return "stale";

    await sql`
      insert into public.automation_dispatch_attempts (
        organization_id, dispatch_id, attempt_number, outcome,
        request_hash, response_hash, error_code, error_summary,
        started_at, completed_at
      ) values (
        ${row.organization_id}::uuid, ${row.id}::uuid, ${row.attempt_count}, ${finalOutcome},
        ${requestHash}, ${result.responseHash},
        ${finalOutcome === "delivered" ? null : result.errorCode},
        ${finalOutcome === "delivered" ? null : result.errorSummary},
        ${startedAt.toISOString()}::timestamptz, ${completedAt.toISOString()}::timestamptz
      )
    `;

    if (finalOutcome === "delivered" || finalOutcome === "dead_letter") {
      const executionStatus = finalOutcome === "delivered" ? "succeeded" : "failed";
      await sql`
        insert into public.automation_execution_events (
          organization_id, automation_id, execution_id, handler_key, source_module,
          status, result_summary, metadata, occurred_at, completed_at
        ) values (
          ${row.organization_id}::uuid,
          ${row.automation_id}::uuid,
          ${row.id},
          ${row.handler_key},
          ${row.source_module},
          ${executionStatus},
          ${finalOutcome === "delivered" ? result.resultSummary : result.errorSummary},
          ${sql.json({
            eventId: row.event_id,
            eventKey: row.event_key,
            entityType: row.entity_type,
            entityId: row.entity_id,
            attemptCount: row.attempt_count,
            responseHash: result.responseHash,
            errorCode: finalOutcome === "delivered" ? null : result.errorCode,
            ...result.metadata,
          })},
          ${row.occurred_at.toISOString()}::timestamptz,
          ${completedAt.toISOString()}::timestamptz
        )
        on conflict (automation_id, execution_id) do nothing
      `;

      await sql`
        update public.automation_definitions
        set last_execution_at = ${completedAt.toISOString()}::timestamptz,
            last_result = ${executionStatus},
            error_count = case when ${executionStatus} = 'failed' then error_count + 1 else 0 end,
            updated_at = now()
        where id = ${row.automation_id}::uuid
      `;
    }

    if (finalOutcome === "dead_letter") {
      await sql`
        insert into public.audit_events (
          organization_id, actor_type, action, entity_type, entity_id,
          source, after_state, metadata
        ) values (
          ${row.organization_id}::uuid,
          'system',
          'automation.dispatch.dead_lettered',
          'automation_dispatch',
          ${row.id},
          'automation_worker',
          ${sql.json({ status: finalOutcome, attemptCount: row.attempt_count })},
          ${sql.json({
            eventKey: row.event_key,
            automationId: row.automation_id,
            handlerKey: row.handler_key,
            errorCode: result.errorCode,
          })}
        )
      `;
    }
    return finalOutcome;
  });
}

async function routeAndClaimDispatches(contractSeedCount: number): Promise<{
  routed: { events: number; dispatches: number };
  claimed: ClaimedDispatchRow[];
}> {
  if (contractSeedCount < 0) {
    throw new Error("Contract event seeding returned an invalid count.");
  }
  const routed = await routeDomainEvents();
  const claimed = await claimDispatches(routed);
  return { routed, claimed };
}

export async function runAutomationDispatchWorker(): Promise<{
  contractEvents: number;
  routedEvents: number;
  createdDispatches: number;
  claimed: number;
  delivered: number;
  retried: number;
  deadLettered: number;
  stale: number;
}> {
  const contractEvents = await enqueueDueContractEvents();
  const { routed, claimed } = await routeAndClaimDispatches(contractEvents);
  const outcomes = await Promise.all(
    claimed.map(async (row) => {
      const startedAt = new Date();
      const execution = await executeDispatch(row);
      return completeDispatch(row, execution.requestHash, execution.result, startedAt);
    }),
  );

  let delivered = 0;
  let retried = 0;
  let deadLettered = 0;
  let stale = 0;
  for (const outcome of outcomes) {
    if (outcome === "delivered") delivered += 1;
    else if (outcome === "retry") retried += 1;
    else if (outcome === "dead_letter") deadLettered += 1;
    else stale += 1;
  }

  return {
    contractEvents,
    routedEvents: routed.events,
    createdDispatches: routed.dispatches,
    claimed: claimed.length,
    delivered,
    retried,
    deadLettered,
    stale,
  };
}
