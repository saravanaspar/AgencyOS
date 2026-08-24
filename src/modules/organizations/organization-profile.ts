export interface OrganizationProfileValues {
  legalName: string;
  displayName: string | null;
  countryCode: string | null;
  timezone: string;
  defaultCurrency: string;
  financialYearStartMonth: number;
}

export const organizationProfileFieldLabels: Record<keyof OrganizationProfileValues, string> = {
  legalName: "Legal name",
  displayName: "Display name",
  countryCode: "Country",
  timezone: "Timezone",
  defaultCurrency: "Default currency",
  financialYearStartMonth: "Financial year start",
};

export function getChangedOrganizationProfileFields(
  before: OrganizationProfileValues,
  after: OrganizationProfileValues,
): (keyof OrganizationProfileValues)[] {
  return (
    Object.keys(organizationProfileFieldLabels) as (keyof OrganizationProfileValues)[]
  ).filter((field) => before[field] !== after[field]);
}

export function isOrganizationProfileVersionCurrent(
  expectedUpdatedAt: string,
  currentUpdatedAt: Date,
): boolean {
  return currentUpdatedAt.getTime() === new Date(expectedUpdatedAt).getTime();
}

export function organizationProfileAuditSnapshot(values: OrganizationProfileValues) {
  return {
    legalName: values.legalName,
    displayName: values.displayName,
    countryCode: values.countryCode,
    timezone: values.timezone,
    defaultCurrency: values.defaultCurrency,
    financialYearStartMonth: values.financialYearStartMonth,
  };
}
