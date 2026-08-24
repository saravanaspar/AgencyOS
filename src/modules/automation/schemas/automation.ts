import { z } from "zod";

import { automationHandlerKeys, vaultwardenEntityTypes } from "@/modules/automation/automation";

const moduleName = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{1,39}$/);

export const createAutomationDefinitionSchema = z.object({
  name: z.string().trim().min(2).max(160),
  triggerKey: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9._-]{2,119}$/),
  handlerKey: z.enum(automationHandlerKeys),
  allowedModules: z.array(moduleName).min(1).max(32),
  conditions: z.strictObject({
    entityType: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_-]{1,79}$/)
      .optional(),
    payloadEquals: z
      .record(z.string().trim().min(1).max(80), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
  }),
});

export const setAutomationEnabledSchema = z.object({
  automationId: z.uuid(),
  enabled: z.boolean(),
});

export const createVaultwardenLinkSchema = z.object({
  entityType: z.enum(vaultwardenEntityTypes),
  entityId: z.uuid(),
  entityLabel: z.string().trim().min(1).max(180),
  itemReference: z.uuid(),
});

export const revokeVaultwardenLinkSchema = z.object({ linkId: z.uuid() });
export const retryAutomationDispatchSchema = z.object({ dispatchId: z.uuid() });

export type CreateAutomationDefinitionInput = z.infer<typeof createAutomationDefinitionSchema>;
export type CreateVaultwardenLinkInput = z.infer<typeof createVaultwardenLinkSchema>;

export interface AutomationActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
}
