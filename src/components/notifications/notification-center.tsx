"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import {
  Bell,
  BellRing,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Mail,
  Radio,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
  updateNotificationPreferencesAction,
} from "@/modules/notifications/actions/notifications";
import {
  notificationCategories,
  notificationCategoryLabels,
  type NotificationCenterData,
  type NotificationDeliverySummary,
  type NotificationListItem,
} from "@/modules/notifications/notifications";
import type { NotificationActionState } from "@/modules/notifications/schemas/notifications";
import { getDateTimeFormatter } from "@/lib/intl-formatters";

const initialState: NotificationActionState = { status: "idle" };
const subscribeBrowserCapabilities = () => () => undefined;

function browserPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function formatTimestamp(value: string): string {
  return getDateTimeFormatter("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function buildNotificationHref(
  filters: NotificationCenterData["filters"],
  changes: Partial<NotificationCenterData["filters"]>,
): string {
  const next = { ...filters, ...changes };
  const params = new URLSearchParams();
  if (next.status !== "all") params.set("status", next.status);
  if (next.category) params.set("category", next.category);
  if (next.page > 1) params.set("page", String(next.page));
  const query = params.toString();
  return query ? `/notifications?${query}` : "/notifications";
}

function ActionMessage({ state }: { state: NotificationActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      className={`notification-action-message is-${state.status}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

function MarkNotificationReadForm({ item }: { item: NotificationListItem }) {
  const [state, action, pending] = useActionState(markNotificationReadAction, initialState);
  if (item.readAt) return null;

  return (
    <form action={action} className="notification-item__read-form">
      <input type="hidden" name="notificationId" value={item.id} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        <Check size={14} aria-hidden="true" /> {pending ? "Saving" : "Mark read"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

function deliveryLabel(delivery: NotificationDeliverySummary): string {
  return `${delivery.channel.replaceAll("_", " ")} · ${delivery.status}`;
}

function NotificationItem({ item }: { item: NotificationListItem }) {
  return (
    <article className={`notification-item${item.readAt ? " is-read" : " is-unread"}`}>
      <div className="notification-item__marker" aria-hidden="true" />
      <div className="notification-item__content">
        <header>
          <div>
            <span className="notification-item__category">
              {notificationCategoryLabels[item.category]}
            </span>
            <h2>{item.title}</h2>
          </div>
          <StatusBadge
            tone={
              item.severity === "error" ? "error" : item.severity === "warning" ? "warning" : "info"
            }
          >
            {item.readAt ? "Read" : "Unread"}
          </StatusBadge>
        </header>
        <p>{item.message}</p>
        <dl className="notification-item__meta">
          <div>
            <dt>Occurred</dt>
            <dd>{formatTimestamp(item.lastOccurredAt)}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{item.sourceModule.replaceAll("_", " ")}</dd>
          </div>
          {item.occurrenceCount > 1 ? (
            <div>
              <dt>Occurrences</dt>
              <dd>{item.occurrenceCount}</dd>
            </div>
          ) : null}
        </dl>
        <div className="notification-delivery-chips" aria-label="Delivery status">
          {item.deliveries.map((delivery) => (
            <span
              className={`notification-delivery-chip is-${delivery.status}`}
              key={delivery.channel}
              title={delivery.lastErrorCode ?? undefined}
            >
              {deliveryLabel(delivery)}
            </span>
          ))}
        </div>
        <div className="notification-item__actions">
          {item.deepLink ? (
            <Link className="button button--primary button--sm" href={item.deepLink}>
              Open record <ExternalLink size={14} aria-hidden="true" />
            </Link>
          ) : null}
          <MarkNotificationReadForm item={item} />
        </div>
      </div>
    </article>
  );
}

function MarkAllRead({ unreadCount }: { unreadCount: number }) {
  const [state, action, pending] = useActionState(markAllNotificationsReadAction, initialState);

  return (
    <div className="notification-mark-all">
      <form action={action}>
        <Button type="submit" variant="secondary" disabled={pending || unreadCount === 0}>
          <CheckCheck size={16} aria-hidden="true" /> {pending ? "Updating" : "Mark all read"}
        </Button>
      </form>
      <ActionMessage state={state} />
    </div>
  );
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function BrowserPushControl({ data }: { data: NotificationCenterData }) {
  const router = useRouter();
  const supported = useSyncExternalStore(
    subscribeBrowserCapabilities,
    browserPushSupported,
    () => false,
  );
  const [status, setStatus] = useState<"idle" | "working" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const configuration = data.deliveryConfiguration;

  async function enablePush() {
    if (!configuration.browserPushPublicKey) return;
    setStatus("working");
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Browser permission was not granted.");
      const registration = await navigator.serviceWorker.register("/notification-sw.js", {
        scope: "/",
      });
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(
            configuration.browserPushPublicKey,
          ) as BufferSource,
        }));
      const response = await fetch("/api/notifications/push/subscription", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) throw new Error("The subscription could not be stored.");
      setStatus("success");
      setMessage("Browser notifications are enabled on this device.");
      router.refresh();
    } catch {
      setStatus("error");
      setMessage("Browser notifications could not be enabled on this device.");
    }
  }

  async function disablePush() {
    setStatus("working");
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      const response = await fetch("/api/notifications/push/subscription", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: null }),
      });
      if (!response.ok) throw new Error("The subscription could not be revoked.");
      await subscription?.unsubscribe();
      setStatus("success");
      setMessage("Browser notifications are disabled for all registered devices.");
      router.refresh();
    } catch {
      setStatus("error");
      setMessage("Browser notifications could not be disabled on this device.");
    }
  }

  return (
    <div className="notification-push-control">
      <div>
        <strong>Browser push on this device</strong>
        <p>
          Notification text is fetched after the push arrives, so private details are not sent
          through the push provider.
        </p>
      </div>
      {!configuration.browserPushConfigured ? (
        <StatusBadge tone="neutral">Server setup required</StatusBadge>
      ) : !supported ? (
        <StatusBadge tone="warning">Not supported</StatusBadge>
      ) : configuration.hasActivePushSubscription ? (
        <Button
          type="button"
          variant="secondary"
          onClick={disablePush}
          disabled={status === "working"}
        >
          <BellRing size={15} aria-hidden="true" />
          {status === "working" ? "Updating" : "Disable browser push"}
        </Button>
      ) : (
        <Button type="button" onClick={enablePush} disabled={status === "working"}>
          <BellRing size={15} aria-hidden="true" />
          {status === "working" ? "Enabling" : "Enable on device"}
        </Button>
      )}
      {message ? (
        <p
          className={`notification-action-message is-${status}`}
          role={status === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

function NotificationPreferencesForm({ data }: { data: NotificationCenterData }) {
  const [state, action, pending] = useActionState(
    updateNotificationPreferencesAction,
    initialState,
  );

  return (
    <details className="notification-preferences">
      <summary>
        <Settings2 size={16} aria-hidden="true" /> Notification preferences
      </summary>
      <form action={action} className="notification-preferences__form">
        <fieldset>
          <legend>Categories shown and delivered</legend>
          <div className="notification-preferences__categories">
            {notificationCategories.map((category) => (
              <label className="notification-preference-check" key={category}>
                <input
                  type="checkbox"
                  name="enabledCategories"
                  value={category}
                  defaultChecked={data.preferences.categories[category]}
                />
                <span>{notificationCategoryLabels[category]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="notification-channel-grid">
          <label className="notification-channel-card">
            <span className="notification-channel-card__heading">
              <Mail size={17} aria-hidden="true" /> Email
            </span>
            <span className="notification-channel-card__control">
              <input
                type="checkbox"
                name="emailEnabled"
                defaultChecked={data.preferences.emailEnabled}
                disabled={!data.deliveryConfiguration.emailConfigured}
              />
              Enable email delivery
            </span>
            <small>
              {data.deliveryConfiguration.emailConfigured
                ? "Immediate or digest delivery through Resend."
                : "An administrator must configure Resend email delivery."}
            </small>
          </label>

          <label className="notification-channel-card">
            <span className="notification-channel-card__heading">
              <Radio size={17} aria-hidden="true" /> Browser push
            </span>
            <span className="notification-channel-card__control">
              <input
                type="checkbox"
                name="browserPushEnabled"
                defaultChecked={data.preferences.browserPushEnabled}
                disabled={!data.deliveryConfiguration.browserPushConfigured}
              />
              Enable browser delivery
            </span>
            <small>Requires at least one device subscription below.</small>
          </label>
        </div>

        <div className="notification-preferences__delivery">
          <label className="field">
            <span>Email digest preference</span>
            <select name="digest" defaultValue={data.preferences.digest}>
              <option value="none">Send individually</option>
              <option value="daily">Daily delivery window</option>
              <option value="weekly">Weekly delivery window</option>
            </select>
          </label>
        </div>

        <div className="notification-preferences__quiet-hours">
          <label className="notification-preference-check">
            <input
              type="checkbox"
              name="quietHoursEnabled"
              defaultChecked={data.preferences.quietHours.enabled}
            />
            <span>Defer external delivery during quiet hours (UTC)</span>
          </label>
          <label className="field">
            <span>Quiet hours start</span>
            <input
              type="time"
              name="quietHoursStart"
              defaultValue={data.preferences.quietHours.start}
            />
          </label>
          <label className="field">
            <span>Quiet hours end</span>
            <input
              type="time"
              name="quietHoursEnd"
              defaultValue={data.preferences.quietHours.end}
            />
          </label>
        </div>

        <BrowserPushControl data={data} />

        <div className="notification-preferences__actions">
          <Button type="submit" disabled={pending}>
            <Settings2 size={15} aria-hidden="true" /> {pending ? "Saving" : "Save preferences"}
          </Button>
          <ActionMessage state={state} />
        </div>
      </form>
    </details>
  );
}

export function NotificationCenter({ data }: { data: NotificationCenterData }) {
  const firstItem = data.pagination.totalItems
    ? (data.pagination.page - 1) * data.pagination.pageSize + 1
    : 0;
  const lastItem = Math.min(
    data.pagination.page * data.pagination.pageSize,
    data.pagination.totalItems,
  );

  return (
    <div className="notification-center">
      <section className="notification-summary" aria-label="Notification summary">
        <div>
          <Bell size={20} aria-hidden="true" />
          <span>Unread</span>
          <strong>{data.summary.unreadCount}</strong>
        </div>
        <div>
          <CheckCheck size={20} aria-hidden="true" />
          <span>All notifications</span>
          <strong>{data.summary.totalCount}</strong>
        </div>
        <div>
          <Clock3 size={20} aria-hidden="true" />
          <span>Today</span>
          <strong>{data.summary.occurredToday}</strong>
        </div>
      </section>

      <section className="settings-panel notification-controls">
        <form className="notification-filter-form" method="get">
          <label className="field">
            <span>Status</span>
            <select name="status" defaultValue={data.filters.status}>
              <option value="all">All</option>
              <option value="unread">Unread</option>
              <option value="read">Read</option>
            </select>
          </label>
          <label className="field">
            <span>Category</span>
            <select name="category" defaultValue={data.filters.category}>
              <option value="">All enabled categories</option>
              {notificationCategories.map((category) => (
                <option value={category} key={category}>
                  {notificationCategoryLabels[category]}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary">
            Apply filters
          </Button>
          <Link className="button button--ghost button--md" href="/notifications">
            Clear
          </Link>
        </form>
        <MarkAllRead unreadCount={data.summary.unreadCount} />
      </section>

      <NotificationPreferencesForm data={data} />

      <section className="notification-list-section">
        <header>
          <div>
            <h2>Notification center</h2>
            <p>
              {data.pagination.totalItems === 0
                ? "No notifications match the current filters."
                : `Showing ${firstItem}–${lastItem} of ${data.pagination.totalItems}.`}
            </p>
          </div>
          <StatusBadge tone="neutral">Private to you</StatusBadge>
        </header>

        {data.items.length ? (
          <div className="notification-list">
            {data.items.map((item) => (
              <NotificationItem item={item} key={item.id} />
            ))}
          </div>
        ) : (
          <div className="notification-empty-state">
            <Mail size={24} aria-hidden="true" />
            <strong>You are caught up</strong>
            <p>New assignments, approvals, due dates, and integration alerts will appear here.</p>
          </div>
        )}

        {data.pagination.totalPages > 1 ? (
          <nav className="notification-pagination" aria-label="Notification pages">
            <Link
              className={`button button--secondary button--sm${data.pagination.page <= 1 ? " is-disabled" : ""}`}
              href={buildNotificationHref(data.filters, {
                page: Math.max(1, data.pagination.page - 1),
              })}
              aria-disabled={data.pagination.page <= 1}
            >
              <ChevronLeft size={14} aria-hidden="true" /> Previous
            </Link>
            <span>
              Page {data.pagination.page} of {data.pagination.totalPages}
            </span>
            <Link
              className={`button button--secondary button--sm${data.pagination.page >= data.pagination.totalPages ? " is-disabled" : ""}`}
              href={buildNotificationHref(data.filters, {
                page: Math.min(data.pagination.totalPages, data.pagination.page + 1),
              })}
              aria-disabled={data.pagination.page >= data.pagination.totalPages}
            >
              Next <ChevronRight size={14} aria-hidden="true" />
            </Link>
          </nav>
        ) : null}
      </section>
    </div>
  );
}
