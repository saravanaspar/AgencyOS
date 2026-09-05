export const cashForecastScenarios = ["conservative", "base", "optimistic"] as const;
export type CashForecastScenario = (typeof cashForecastScenarios)[number];

export const cashForecastHorizons = [30, 60, 90] as const;
export type CashForecastHorizon = (typeof cashForecastHorizons)[number];

export interface CashForecastSourceAmount {
  source:
    | "receivables"
    | "recurring_income"
    | "pipeline"
    | "approved_expenses"
    | "vendor_bills"
    | "purchase_commitments"
    | "payroll"
    | "recurring_obligations";
  inflowMinor: number;
  outflowMinor: number;
}

export interface CashForecastHorizonResult {
  days: CashForecastHorizon;
  inflowMinor: number;
  outflowMinor: number;
  netMinor: number;
  sources: CashForecastSourceAmount[];
}

export interface CashForecastScenarioResult {
  scenario: CashForecastScenario;
  horizons: CashForecastHorizonResult[];
}

export interface CashForecastCurrencyResult {
  currency: string;
  scenarios: CashForecastScenarioResult[];
}

export interface CashForecastSettings {
  payrollDay: number;
  pipelineEnabled: boolean;
  historicalCollectionEnabled: boolean;
  baseCollectionDelayDays: number;
  conservativeCollectionDelayDays: number;
  optimisticCollectionDelayDays: number;
  basePipelineMultiplierBps: number;
  conservativePipelineMultiplierBps: number;
  optimisticPipelineMultiplierBps: number;
  historicalMedianCollectionDays: number | null;
}

export interface CashForecastRecurringItem {
  id: string;
  label: string;
  direction: "inflow" | "outflow";
  itemKind:
    "retainer_income" | "recurring_income" | "operating_obligation" | "tax_obligation" | "other";
  amountMinor: number;
  currency: string;
  cadence: "weekly" | "monthly" | "quarterly" | "annual";
  nextDueOn: string;
  endOn: string | null;
  probabilityBps: number;
  projectId: string | null;
  active: boolean;
}

export interface CashForecastData {
  asOf: string;
  settings: CashForecastSettings;
  currencies: CashForecastCurrencyResult[];
  recurringItems: CashForecastRecurringItem[];
  assumptions: string[];
}
