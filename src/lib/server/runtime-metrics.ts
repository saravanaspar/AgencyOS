import "server-only";

type Labels = Record<string, string | number | boolean | null | undefined>;
interface MetricPoint {
  name: string;
  labels: Record<string, string>;
  value: number;
}
interface MetricsStore {
  counters: Map<string, MetricPoint>;
}

declare global {
  var __agencyOsMetricsStore: MetricsStore | undefined;
}

const store: MetricsStore = globalThis.__agencyOsMetricsStore ?? { counters: new Map() };
globalThis.__agencyOsMetricsStore = store;

function safeMetricName(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_:]/g, "_");
  return normalized.startsWith("agencyos_") ? normalized : `agencyos_${normalized}`;
}

function safeLabels(labels: Labels): Record<string, string> {
  return Object.fromEntries(
    Object.entries(labels)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key.replace(/[^a-zA-Z0-9_]/g, "_"), String(value).slice(0, 100)])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function metricKey(name: string, labels: Record<string, string>): string {
  return `${name}|${JSON.stringify(labels)}`;
}

export function incrementMetric(name: string, labels: Labels = {}, value = 1): void {
  if (!Number.isFinite(value)) return;
  const metricName = safeMetricName(name);
  const normalizedLabels = safeLabels(labels);
  const key = metricKey(metricName, normalizedLabels);
  const point = store.counters.get(key) ?? { name: metricName, labels: normalizedLabels, value: 0 };
  point.value += value;
  store.counters.set(key, point);
}

export function observeMetric(name: string, value: number, labels: Labels = {}): void {
  if (!Number.isFinite(value) || value < 0) return;
  incrementMetric(`${name}_count`, labels, 1);
  incrementMetric(`${name}_sum`, labels, value);
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

export function renderPrometheusMetrics(): string {
  const lines = [...store.counters.values()]
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        JSON.stringify(left.labels).localeCompare(JSON.stringify(right.labels)),
    )
    .map((point) => {
      const labels = Object.entries(point.labels)
        .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
        .join(",");
      return `${point.name}${labels ? `{${labels}}` : ""} ${point.value}`;
    });
  return `${lines.join("\n")}\n`;
}
