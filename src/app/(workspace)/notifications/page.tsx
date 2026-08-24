import { Bell } from "lucide-react";
import { redirect } from "next/navigation";

import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { notificationFiltersSchema } from "@/modules/notifications/schemas/notifications";
import { getNotificationCenterData } from "@/modules/notifications/server/notifications";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

interface NotificationsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NotificationsPage({ searchParams }: NotificationsPageProps) {
  const parsed = notificationFiltersSchema.safeParse(await searchParams);
  if (!parsed.success) redirect("/notifications");

  const result = await getNotificationCenterData(parsed.data);
  if (!result.allowed) {
    return <PageAccessFailure reason={result.reason} nextPath="/notifications" />;
  }

  const { data } = result;
  if (data.filters.page !== data.pagination.page) {
    const params = new URLSearchParams();
    if (data.filters.status !== "all") params.set("status", data.filters.status);
    if (data.filters.category) params.set("category", data.filters.category);
    if (data.pagination.page > 1) params.set("page", String(data.pagination.page));
    redirect(params.size ? `/notifications?${params.toString()}` : "/notifications");
  }

  return (
    <div className="module-page">
      <section className="page-heading module-page__heading">
        <div>
          <span className="page-heading__eyebrow">
            <Bell size={16} aria-hidden="true" /> Shared platform
          </span>
          <h1>Notifications</h1>
          <p>
            Review private alerts, follow safe record links, and control in-app, email, browser-push
            delivery preferences.
          </p>
        </div>
      </section>

      <NotificationCenter data={data} />
    </div>
  );
}
