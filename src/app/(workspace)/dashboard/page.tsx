import { RoleDashboard } from "@/components/dashboard/role-dashboard";
import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { getDashboardWorkspaceData } from "@/modules/dashboard/server/dashboard";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const result = await getDashboardWorkspaceData();
  if (!result.allowed) {
    return <PageAccessFailure reason={result.reason} nextPath="/dashboard" />;
  }
  return <RoleDashboard data={result.data} />;
}
