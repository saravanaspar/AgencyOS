import "server-only";

import type { CashForecastData } from "@/modules/finance/cash-forecast";
import type { CollectionsData } from "@/modules/finance/collections";
import { financePermissionKeys } from "@/modules/finance/finance";
import { getCashForecastForContext } from "@/modules/finance/server/cash-forecast";
import { getCollectionsForContext } from "@/modules/finance/server/collections";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export interface FinanceDepthData {
  cashForecast: CashForecastData | null;
  collections: CollectionsData | null;
}

export function financeDepthCapabilities(context: CurrentPermissionContext) {
  return {
    canManageCashForecast: context.permissions.has(financePermissionKeys.cashForecastManage),
    canManageCollections: context.permissions.has(financePermissionKeys.collectionManage),
  };
}

export async function loadFinanceDepthData(
  context: CurrentPermissionContext,
  canViewReports: boolean,
): Promise<FinanceDepthData> {
  if (!canViewReports) return { cashForecast: null, collections: null };
  const [cashForecast, collections] = await Promise.all([
    getCashForecastForContext(context),
    getCollectionsForContext(context),
  ]);
  return { cashForecast, collections };
}
