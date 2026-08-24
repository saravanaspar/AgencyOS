import type { JSONValue } from "postgres";

export function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}
