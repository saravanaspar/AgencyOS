"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Bell, ChevronsLeft, ChevronsRight, LogOut, Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";

import { NotificationRealtimeRefresh } from "@/components/notifications/notification-realtime-refresh";
import { CommandPalette } from "@/components/shell/command-palette";
import { cn } from "@/lib/cn";
import { getAuthorizedNavigationGroups } from "@/lib/navigation";
import { signOutAction } from "@/modules/identity/actions/auth";

interface WorkspaceShellProps {
  children: ReactNode;
  permissions: string[];
  user: {
    displayName: string;
    email: string;
  };
  unreadNotificationCount: number;
  pendingApprovalCount: number;
  membershipId: string;
}

function getInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "AO";
  }

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function SignOutButton({ collapsed }: { collapsed: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      className="sidebar-signout"
      type="submit"
      aria-label={collapsed ? "Sign out" : undefined}
      title={collapsed ? "Sign out" : undefined}
      disabled={pending}
    >
      <LogOut size={18} aria-hidden="true" />
      <span>{pending ? "Signing out" : "Sign out"}</span>
    </button>
  );
}

export function WorkspaceShell({
  children,
  permissions,
  user,
  unreadNotificationCount,
  pendingApprovalCount,
  membershipId,
}: WorkspaceShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [liveCounters, setLiveCounters] = useState(() => ({
    membershipId,
    sourceUnreadNotificationCount: unreadNotificationCount,
    sourcePendingApprovalCount: pendingApprovalCount,
    unreadNotificationCount,
    pendingApprovalCount,
  }));
  const counters =
    liveCounters.membershipId === membershipId &&
    liveCounters.sourceUnreadNotificationCount === unreadNotificationCount &&
    liveCounters.sourcePendingApprovalCount === pendingApprovalCount
      ? liveCounters
      : { unreadNotificationCount, pendingApprovalCount };
  const initials = getInitials(user.displayName);
  const authorizedGroups = useMemo(
    () => getAuthorizedNavigationGroups(new Set(permissions)),
    [permissions],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const updateWorkspaceCounters = useCallback(
    (counters: { unreadNotificationCount: number; pendingApprovalCount: number }) => {
      setLiveCounters({
        membershipId,
        sourceUnreadNotificationCount: unreadNotificationCount,
        sourcePendingApprovalCount: pendingApprovalCount,
        ...counters,
      });
    },
    [membershipId, pendingApprovalCount, unreadNotificationCount],
  );

  const breadcrumbs = useMemo(() => {
    const segments = pathname.split("/").filter(Boolean);
    const labels = new Map(
      authorizedGroups.flatMap((group) =>
        group.items.map((item) => [item.href, item.label] as const),
      ),
    );
    const settingsLabels: Record<string, string> = {
      audit: "Audit log",
      permissions: "Effective permissions",
      roles: "Role editor",
      organization: "Organization profile",
      structure: "Departments and teams",
      users: "User access",
    };

    if (segments[0] === "settings" && segments[1]) {
      return [
        { href: "/settings", label: "Settings" },
        { href: pathname, label: settingsLabels[segments[1]] ?? segments[1].replaceAll("-", " ") },
      ];
    }

    const href = segments.length ? `/${segments[0]}` : "/dashboard";
    const standaloneLabels: Record<string, string> = {
      "/notifications": "Notifications",
    };
    return [{ href, label: labels.get(href) ?? standaloneLabels[href] ?? "Dashboard" }];
  }, [authorizedGroups, pathname]);

  return (
    <div className={cn("workspace", collapsed && "workspace--collapsed")}>
      {permissions.includes("notifications.notification.view") ? (
        <NotificationRealtimeRefresh
          membershipId={membershipId}
          onCountersChange={updateWorkspaceCounters}
        />
      ) : null}
      {mobileOpen && (
        <button
          className="mobile-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn("sidebar", mobileOpen && "sidebar--mobile-open")}
        aria-label="Primary navigation"
      >
        <div className="sidebar__brand">
          <span className="brand-mark" aria-hidden="true">
            AO
          </span>
          <span className="brand-name">AgencyOS</span>
          <button
            className="icon-button sidebar__mobile-close"
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar__nav">
          {authorizedGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-group__label">{group.label}</p>
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    className={cn("nav-item", active && "nav-item--active")}
                    href={item.href}
                    prefetch={false}
                    key={item.href}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    onClick={() => setMobileOpen(false)}
                  >
                    <Icon className="nav-item__icon" aria-hidden="true" size={18} />
                    <span className="nav-item__label">{item.label}</span>
                    {item.href === "/approvals" && counters.pendingApprovalCount > 0 ? (
                      <span
                        className="nav-item__badge"
                        aria-label={`${counters.pendingApprovalCount} pending approvals`}
                      >
                        {counters.pendingApprovalCount > 99 ? "99+" : counters.pendingApprovalCount}
                      </span>
                    ) : item.badge ? (
                      <span className="nav-item__badge">{item.badge}</span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar-user">
            <span className="avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="sidebar-user__copy">
              <strong>{user.displayName}</strong>
              <small title={user.email}>{user.email}</small>
            </span>
          </div>
          <form action={signOutAction}>
            <SignOutButton collapsed={collapsed} />
          </form>
          <button
            className="sidebar-collapse"
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
            <span>{collapsed ? "Expand" : "Collapse"}</span>
          </button>
        </div>
      </aside>

      <div className="workspace__body">
        <header className="topbar">
          <div className="topbar__leading">
            <button
              className="icon-button topbar__menu"
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={19} />
            </button>
            <nav className="breadcrumbs" aria-label="Breadcrumb">
              <Link href="/dashboard" prefetch={false}>
                AgencyOS
              </Link>
              {breadcrumbs.map((item, index) => (
                <span className="breadcrumbs__item" key={item.href}>
                  <span aria-hidden="true">/</span>
                  {index === breadcrumbs.length - 1 ? (
                    <strong aria-current="page">{item.label}</strong>
                  ) : (
                    <Link href={item.href} prefetch={false}>
                      {item.label}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
          </div>

          <button
            className="global-search"
            type="button"
            aria-label="Search records and modules"
            onClick={() => setCommandOpen(true)}
          >
            <Search aria-hidden="true" size={17} />
            <span>Search records and modules</span>
            <kbd>⌘ K</kbd>
          </button>

          <div className="topbar__actions">
            {permissions.includes("notifications.notification.view") ? (
              <Link
                className="icon-button notification-button"
                href="/notifications"
                prefetch={false}
                aria-label={
                  counters.unreadNotificationCount > 0
                    ? `Open notifications, ${counters.unreadNotificationCount} unread`
                    : "Open notifications"
                }
              >
                <Bell size={18} />
                {counters.unreadNotificationCount > 0 ? (
                  <span className="notification-count" aria-hidden="true">
                    {counters.unreadNotificationCount > 99
                      ? "99+"
                      : counters.unreadNotificationCount}
                  </span>
                ) : null}
              </Link>
            ) : null}
            <div className="profile-summary" aria-label={`Signed in as ${user.displayName}`}>
              <span className="avatar">{initials}</span>
              <span className="profile-button__copy">
                <strong>{user.displayName}</strong>
                <small>Signed in</small>
              </span>
            </div>
          </div>
        </header>

        <main className="workspace__content">{children}</main>
      </div>

      <CommandPalette
        groups={authorizedGroups}
        permissions={permissions}
        open={commandOpen}
        onOpenChange={setCommandOpen}
      />
    </div>
  );
}
