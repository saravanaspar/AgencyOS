import { z } from "zod";

import {
  supportMessageTypes,
  supportTicketPriorities,
  supportTicketStatuses,
} from "@/modules/support/support";

const optionalUuid = z.preprocess((value) => (value === "" ? null : value), z.uuid().nullable());
const optionalDateTime = z.preprocess(
  (value) => (value === "" ? null : value),
  z.iso.datetime({ local: true }).nullable(),
);

export const supportTicketCreateSchema = z.object({
  subject: z.string().trim().min(2).max(180),
  description: z.string().trim().min(2).max(10000),
  clientCompanyId: optionalUuid,
  contactId: optionalUuid,
  projectId: optionalUuid,
  categoryId: optionalUuid,
  priority: z.enum(supportTicketPriorities),
  dueAt: optionalDateTime,
});

export const supportTicketUpdateSchema = z.object({
  ticketId: z.uuid(),
  categoryId: optionalUuid,
  priority: z.enum(supportTicketPriorities),
  assignedAgentMembershipId: optionalUuid,
  assignedTeamId: optionalUuid,
  dueAt: optionalDateTime,
  status: z.enum(supportTicketStatuses),
});

export const supportTicketMessageSchema = z.object({
  ticketId: z.uuid(),
  messageType: z.enum(supportMessageTypes),
  body: z.string().trim().min(1).max(10000),
});

export const supportTicketResolutionSchema = z.object({
  ticketId: z.uuid(),
  action: z.enum(["resolve", "close", "reopen"]),
  resolutionSummary: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().min(2).max(4000).nullable(),
  ),
});

export const supportTicketWatcherSchema = z.object({
  ticketId: z.uuid(),
  membershipId: z.uuid(),
  operation: z.enum(["add", "remove"]),
});

export const supportTicketDocumentSchema = z.object({
  ticketId: z.uuid(),
  documentId: z.uuid(),
});

export const supportTicketSatisfactionSchema = z.object({
  ticketId: z.uuid(),
  score: z.coerce.number().int().min(1).max(5),
  comment: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().min(2).max(1000).nullable(),
  ),
});

export const supportRoutingRuleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  position: z.coerce.number().int().min(1).max(10000),
  keywords: z
    .string()
    .trim()
    .min(2)
    .max(1000)
    .transform((value) => [
      ...new Set(
        value
          .split(",")
          .map((keyword) => keyword.trim().toLowerCase())
          .filter(Boolean),
      ),
    ])
    .pipe(z.array(z.string().min(2).max(60)).min(1).max(30)),
  categoryId: z.uuid(),
  priority: z.enum(supportTicketPriorities),
});

export const supportCategorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().min(2).max(500).nullable(),
  ),
  defaultPriority: z.enum(supportTicketPriorities),
});

export type SupportActionState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
};
