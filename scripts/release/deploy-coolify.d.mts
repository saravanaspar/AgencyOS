export function assertImmutableImage(value: string, label: string): string;
export function deploymentUuid(payload: unknown): string;
export function deploymentState(payload: unknown): "succeeded" | "failed" | "pending";
export function deployCoolify(options?: {
  environment?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>>;
