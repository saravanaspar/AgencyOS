import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  CircleDollarSign,
  ContactRound,
  FileText,
  FolderKanban,
  Gauge,
  Headphones,
  Landmark,
  PackageSearch,
  Settings,
  ShieldCheck,
  UsersRound,
  Workflow,
} from "lucide-react";

import { hasRequiredPermissions, modulePermissionKeys } from "@/modules/permissions/module-access";

export interface NavigationItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  requiredPermissions: readonly string[];
}

export interface NavigationGroup {
  label: string;
  items: NavigationItem[];
}

export const navigationGroups: NavigationGroup[] = [
  {
    label: "Workspace",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: Gauge,
        requiredPermissions: [modulePermissionKeys.dashboard],
      },
      {
        label: "CRM",
        href: "/crm",
        icon: ContactRound,
        requiredPermissions: [modulePermissionKeys.crm],
      },
      {
        label: "Projects",
        href: "/projects",
        icon: FolderKanban,
        requiredPermissions: [modulePermissionKeys.projects],
      },
      {
        label: "Calendar",
        href: "/calendar",
        icon: CalendarDays,
        requiredPermissions: [modulePermissionKeys.calendar],
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        label: "Finance",
        href: "/finance",
        icon: CircleDollarSign,
        requiredPermissions: [modulePermissionKeys.finance],
      },
      {
        label: "People",
        href: "/hr",
        icon: UsersRound,
        requiredPermissions: [modulePermissionKeys.hr],
      },
      {
        label: "Support",
        href: "/support",
        icon: Headphones,
        requiredPermissions: [modulePermissionKeys.support],
      },
      {
        label: "Documents",
        href: "/documents",
        icon: FileText,
        requiredPermissions: [modulePermissionKeys.documents],
      },
      {
        label: "Legal",
        href: "/legal",
        icon: Landmark,
        requiredPermissions: [modulePermissionKeys.legal],
      },
      {
        label: "Assets",
        href: "/assets",
        icon: PackageSearch,
        requiredPermissions: [modulePermissionKeys.assets],
      },
      {
        label: "Vendors",
        href: "/vendors",
        icon: BriefcaseBusiness,
        requiredPermissions: [modulePermissionKeys.vendors],
      },
    ],
  },
  {
    label: "Control",
    items: [
      {
        label: "Approvals",
        href: "/approvals",
        icon: ShieldCheck,
        requiredPermissions: [modulePermissionKeys.approvals],
      },
      {
        label: "Reports",
        href: "/reports",
        icon: BarChart3,
        requiredPermissions: [modulePermissionKeys.reports],
      },
      {
        label: "Automation",
        href: "/automation",
        icon: Workflow,
        requiredPermissions: [modulePermissionKeys.automation],
      },
      {
        label: "AI tools",
        href: "/ai",
        icon: Bot,
        requiredPermissions: [modulePermissionKeys.ai],
      },
      {
        label: "Settings",
        href: "/settings",
        icon: Settings,
        requiredPermissions: [modulePermissionKeys.settings],
      },
    ],
  },
];

export function getAuthorizedNavigationGroups(permissions: ReadonlySet<string>): NavigationGroup[] {
  return navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        hasRequiredPermissions(permissions, item.requiredPermissions),
      ),
    }))
    .filter((group) => group.items.length > 0);
}
