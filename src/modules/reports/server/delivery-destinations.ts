import "server-only";

import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { decryptSecretObjectWithEnvironmentKey } from "@/lib/security/secret-envelope";
import type {
  ExternalReportDeliveryChannel,
  ReportDeliveryDestinationSummary,
} from "@/modules/reports/delivery-destinations";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

const KEY_ENV = "REPORT_DELIVERY_ENCRYPTION_KEY";
const PURPOSE = "report delivery destination";

interface DestinationRow {
  id: string;
  channel: ExternalReportDeliveryChannel;
  name: string;
  encrypted_config: string;
  status: "active" | "disabled";
  updated_at: Date;
}

const unsafeNetworks = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  unsafeNetworks.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0.0.0.0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  unsafeNetworks.addSubnet(network, prefix, "ipv6");

function unsafeAddress(address: string): boolean {
  const version = isIP(address);
  return version === 0 || unsafeNetworks.check(address, version === 4 ? "ipv4" : "ipv6");
}

export interface ResolvedExternalReportUrl {
  url: URL;
  hostname: string;
  address: string;
  family: 4 | 6;
}

export async function resolveSafeExternalReportUrl(
  raw: string,
  mode: "slack" | "webhook",
): Promise<ResolvedExternalReportUrl> {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error("Report destinations must use credential-free HTTPS URLs.");
  if (url.port && url.port !== "443")
    throw new Error("Report destination URLs must use HTTPS port 443.");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (mode === "slack") {
    if (hostname !== "hooks.slack.com" || !url.pathname.startsWith("/services/"))
      throw new Error("Slack delivery requires a hooks.slack.com incoming webhook URL.");
  }
  if (
    mode === "webhook" &&
    (hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal"))
  )
    throw new Error("Private/local webhook hosts are not allowed.");
  if (isIP(hostname) && unsafeAddress(hostname))
    throw new Error("Private/reserved webhook addresses are not allowed.");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => unsafeAddress(entry.address)))
    throw new Error("Webhook hostname resolves to a private or reserved address.");
  const selected = addresses[0];
  if (!selected || (selected.family !== 4 && selected.family !== 6))
    throw new Error("Webhook hostname did not resolve to a supported address.");
  return { url, hostname, address: selected.address, family: selected.family };
}

export async function assertSafeExternalReportUrl(
  raw: string,
  mode: "slack" | "webhook",
): Promise<URL> {
  return (await resolveSafeExternalReportUrl(raw, mode)).url;
}

export async function listReportDeliveryDestinations(
  context: CurrentPermissionContext,
): Promise<ReportDeliveryDestinationSummary[]> {
  const rows = await getDatabaseClient()<DestinationRow[]>`
    select id, channel, name, encrypted_config, status, updated_at
    from public.report_delivery_destinations
    where organization_id=${context.membership.organizationId}::uuid
      and membership_id=${context.membership.id}::uuid
    order by status, channel, lower(name)
  `;
  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    name: row.name,
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function activeReportDeliveryDestination(
  organizationId: string,
  membershipId: string,
  channel: ExternalReportDeliveryChannel,
): Promise<{ id: string; name: string; config: Record<string, string> } | null> {
  const rows = await getDatabaseClient()<DestinationRow[]>`
    select id, channel, name, encrypted_config, status, updated_at
    from public.report_delivery_destinations
    where organization_id=${organizationId}::uuid and membership_id=${membershipId}::uuid
      and channel=${channel} and status='active'
    order by updated_at desc limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    config: decryptSecretObjectWithEnvironmentKey(row.encrypted_config, KEY_ENV, PURPOSE),
  };
}

export const reportDeliveryDestinationEncryption = {
  environmentVariable: KEY_ENV,
  purpose: PURPOSE,
} as const;
