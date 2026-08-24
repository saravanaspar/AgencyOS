import { z } from "zod";

import { legalAccessReviewDecisions } from "@/modules/legal/access-review";

const checkbox = z.preprocess(
  (value) => value === "on" || value === "true" || value === true,
  z.boolean(),
);

export const legalAccessReviewAttestationSchema = z.object({
  campaignId: z.uuid(),
  itemId: z.uuid(),
  snapshotDigest: z.string().regex(/^[0-9a-f]{64}$/),
  decision: z.enum(legalAccessReviewDecisions),
  rationale: z.string().trim().min(10).max(1000),
  selfReviewAcknowledged: checkbox,
});

export const legalAccessReviewCompletionSchema = z.object({ campaignId: z.uuid() });

export interface LegalAccessReviewActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
}
