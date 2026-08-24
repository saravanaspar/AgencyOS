import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { crmPermissionKeys } from "@/modules/crm/crm";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import type { PermissionScope } from "@/modules/permissions/permission-scopes";

export interface CrmForecastCurrencySummary {
  currency: string;
  openOpportunities: number;
  unweightedPipeline: number;
  weightedPipeline: number;
  forecastThisMonth: number;
  forecastNext30Days: number;
  forecastNext60Days: number;
  forecastNext90Days: number;
  monthlyTarget: number | null;
  pipelineCoverageRatio: number | null;
}

export interface CrmStageConversionMetric {
  stageId: string;
  stageName: string;
  entered: number;
  advanced: number;
  conversionRate: number | null;
}

export interface CrmForecastRiskOpportunity {
  leadId: string;
  name: string;
  ownerName: string | null;
  currency: string;
  estimatedValue: number | null;
  expectedRevenue: number;
  expectedCloseDate: string | null;
  followUpAt: string | null;
  daysStale: number;
  riskScore: number;
  reasons: string[];
}

export interface CrmLostReasonMetric {
  reason: string;
  opportunities: number;
  estimatedValue: number;
}

export interface CrmForecastData {
  currencies: CrmForecastCurrencySummary[];
  averageSalesCycleDays: number | null;
  stageConversions: CrmStageConversionMetric[];
  staleOpportunities: CrmForecastRiskOpportunity[];
  overdueFollowUps: CrmForecastRiskOpportunity[];
  topRisks: CrmForecastRiskOpportunity[];
  lostReasons: CrmLostReasonMetric[];
}

interface CurrencyRow {
  currency: string;
  open_opportunities: number;
  unweighted_pipeline: string | number;
  weighted_pipeline: string | number;
  forecast_this_month: string | number;
  forecast_next_30_days: string | number;
  forecast_next_60_days: string | number;
  forecast_next_90_days: string | number;
  monthly_target: string | number | null;
}

interface StageConversionRow {
  stage_id: string;
  stage_name: string;
  entered: number;
  advanced: number;
}

interface RiskRow {
  lead_id: string;
  name: string;
  owner_name: string | null;
  currency: string;
  estimated_value: string | number | null;
  probability: number;
  expected_close_date: string | null;
  follow_up_at: Date | null;
  days_stale: number;
  risk_score: number;
  reasons: string[];
}

interface LostReasonRow {
  reason: string;
  opportunities: number;
  estimated_value: string | number;
}

function scopeFor(context: CurrentPermissionContext): PermissionScope {
  return context.permissionScopes.get(crmPermissionKeys.leadView) ?? "own";
}

function mapRisk(row: RiskRow): CrmForecastRiskOpportunity {
  const estimatedValue = row.estimated_value === null ? null : Number(row.estimated_value);
  return {
    leadId: row.lead_id,
    name: row.name,
    ownerName: row.owner_name,
    currency: row.currency,
    estimatedValue,
    expectedRevenue: ((estimatedValue ?? 0) * row.probability) / 100,
    expectedCloseDate: row.expected_close_date,
    followUpAt: row.follow_up_at?.toISOString() ?? null,
    daysStale: row.days_stale,
    riskScore: row.risk_score,
    reasons: row.reasons ?? [],
  };
}

export async function getCrmForecastDataForContext(
  context: CurrentPermissionContext,
): Promise<CrmForecastData> {
  if (!context.permissions.has(crmPermissionKeys.leadView)) {
    return {
      currencies: [],
      averageSalesCycleDays: null,
      stageConversions: [],
      staleOpportunities: [],
      overdueFollowUps: [],
      topRisks: [],
      lostReasons: [],
    };
  }

  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const leadScope = scopeFor(context);
  const visibleLead = database`
    private.crm_scope_allows_membership(
      ${membershipId}::uuid, ${leadScope}, lead.owner_membership_id, lead.created_by_membership_id
    )
  `;

  const [currencyRows, salesCycleRows, stageRows, riskRows, lostRows] = await Promise.all([
    database<CurrencyRow[]>`
      select lead.currency,
        count(*) filter (where lead.status in ('new', 'qualified') and stage.state = 'open')::int as open_opportunities,
        coalesce(sum(lead.estimated_value) filter (
          where lead.status in ('new', 'qualified') and stage.state = 'open'
        ), 0) as unweighted_pipeline,
        coalesce(sum(lead.estimated_value * lead.probability / 100.0) filter (
          where lead.status in ('new', 'qualified') and stage.state = 'open'
        ), 0) as weighted_pipeline,
        coalesce(sum(lead.estimated_value * lead.probability / 100.0) filter (
          where lead.status in ('new', 'qualified') and stage.state = 'open'
            and lead.expected_close_date >= date_trunc('month', current_date)::date
            and lead.expected_close_date < (date_trunc('month', current_date) + interval '1 month')::date
        ), 0) as forecast_this_month,
        coalesce(sum(lead.estimated_value * lead.probability / 100.0) filter (
          where lead.status in ('new', 'qualified') and stage.state = 'open'
            and lead.expected_close_date between current_date and current_date + 30
        ), 0) as forecast_next_30_days,
        coalesce(sum(lead.estimated_value * lead.probability / 100.0) filter (
          where lead.status in ('new', 'qualified') and stage.state = 'open'
            and lead.expected_close_date between current_date and current_date + 60
        ), 0) as forecast_next_60_days,
        coalesce(sum(lead.estimated_value * lead.probability / 100.0) filter (
          where lead.status in ('new', 'qualified') and stage.state = 'open'
            and lead.expected_close_date between current_date and current_date + 90
        ), 0) as forecast_next_90_days,
        max(target.target_value) as monthly_target
      from public.crm_leads lead
      join public.crm_pipeline_stages stage on stage.id = lead.stage_id
      left join public.crm_forecast_targets target
        on target.organization_id = lead.organization_id
       and target.currency = lead.currency
       and target.month = date_trunc('month', current_date)::date
      where lead.organization_id = ${organizationId}::uuid
        and ${visibleLead}
      group by lead.currency
      order by lead.currency
    `,
    database<Array<{ average_sales_cycle_days: string | number | null }>>`
      select avg(coalesce(conversion.sales_cycle_days,
        extract(epoch from (conversion.converted_at - lead.created_at)) / 86400.0
      )) as average_sales_cycle_days
      from public.crm_lead_conversions conversion
      join public.crm_leads lead on lead.id = conversion.lead_id
      where conversion.organization_id = ${organizationId}::uuid
        and conversion.converted_at >= now() - interval '365 days'
        and ${visibleLead}
    `,
    database<StageConversionRow[]>`
      select stage.id as stage_id, stage.name as stage_name,
        count(distinct history.lead_id)::int as entered,
        count(distinct history.lead_id) filter (
          where exists (
            select 1
            from public.crm_lead_stage_history later_history
            join public.crm_pipeline_stages later_stage on later_stage.id = later_history.to_stage_id
            where later_history.lead_id = history.lead_id
              and later_history.entered_at > history.entered_at
              and (later_stage.position > stage.position or later_stage.state = 'won')
          )
          or lead.status = 'converted'
        )::int as advanced
      from public.crm_pipeline_stages stage
      left join public.crm_lead_stage_history history
        on history.to_stage_id = stage.id and history.entered_at >= now() - interval '180 days'
      left join public.crm_leads lead on lead.id = history.lead_id
        and lead.organization_id = ${organizationId}::uuid
      where stage.organization_id = ${organizationId}::uuid
        and stage.state = 'open'
        and (lead.id is null or ${visibleLead})
      group by stage.id, stage.name, stage.position
      order by stage.position
    `,
    database<RiskRow[]>`
      select lead.id as lead_id, lead.name,
        coalesce(owner_profile.display_name, owner_user.email) as owner_name,
        lead.currency, lead.estimated_value, lead.probability,
        lead.expected_close_date::text, lead.follow_up_at,
        greatest(0, floor(extract(epoch from (now() - lead.updated_at)) / 86400))::int as days_stale,
        ((case when lead.follow_up_at is not null and lead.follow_up_at < now() then 40 else 0 end)
          + (case when lead.expected_close_date is not null and lead.expected_close_date < current_date then 30 else 0 end)
          + (case when lead.updated_at < now() - interval '7 days' then 20 else 0 end)
          + (case when lead.owner_membership_id is null then 10 else 0 end))::int as risk_score,
        array_remove(array[
          case when lead.follow_up_at is not null and lead.follow_up_at < now() then 'follow-up overdue' end,
          case when lead.expected_close_date is not null and lead.expected_close_date < current_date then 'close date overdue' end,
          case when lead.updated_at < now() - interval '7 days' then 'stale opportunity' end,
          case when lead.owner_membership_id is null then 'unassigned' end
        ], null)::text[] as reasons
      from public.crm_leads lead
      join public.crm_pipeline_stages stage on stage.id = lead.stage_id
      left join public.memberships owner on owner.id = lead.owner_membership_id
      left join public.identity_accounts owner_user on owner_user.id = owner.user_id
      left join public.profiles owner_profile on owner_profile.id = owner.user_id
      where lead.organization_id = ${organizationId}::uuid
        and lead.status in ('new', 'qualified') and stage.state = 'open'
        and ${visibleLead}
        and (
          lead.follow_up_at < now()
          or lead.expected_close_date < current_date
          or lead.updated_at < now() - interval '7 days'
          or lead.owner_membership_id is null
        )
      order by risk_score desc, coalesce(lead.estimated_value, 0) desc, lead.updated_at
      limit 40
    `,
    database<LostReasonRow[]>`
      select coalesce(nullif(btrim(lead.lost_reason), ''), 'Unspecified') as reason,
        count(*)::int as opportunities,
        coalesce(sum(lead.estimated_value), 0) as estimated_value
      from public.crm_leads lead
      where lead.organization_id = ${organizationId}::uuid
        and lead.status = 'lost'
        and coalesce(lead.closed_at, lead.updated_at) >= now() - interval '365 days'
        and ${visibleLead}
      group by coalesce(nullif(btrim(lead.lost_reason), ''), 'Unspecified')
      order by opportunities desc, estimated_value desc
      limit 20
    `,
  ]);

  const risks = riskRows.map(mapRisk);
  return {
    currencies: currencyRows.map((row) => {
      const target = row.monthly_target === null ? null : Number(row.monthly_target);
      const unweightedPipeline = Number(row.unweighted_pipeline);
      return {
        currency: row.currency,
        openOpportunities: row.open_opportunities,
        unweightedPipeline,
        weightedPipeline: Number(row.weighted_pipeline),
        forecastThisMonth: Number(row.forecast_this_month),
        forecastNext30Days: Number(row.forecast_next_30_days),
        forecastNext60Days: Number(row.forecast_next_60_days),
        forecastNext90Days: Number(row.forecast_next_90_days),
        monthlyTarget: target,
        pipelineCoverageRatio: target && target > 0 ? unweightedPipeline / target : null,
      };
    }),
    averageSalesCycleDays:
      salesCycleRows[0]?.average_sales_cycle_days == null
        ? null
        : Number(salesCycleRows[0].average_sales_cycle_days),
    stageConversions: stageRows.map((row) => ({
      stageId: row.stage_id,
      stageName: row.stage_name,
      entered: row.entered,
      advanced: row.advanced,
      conversionRate: row.entered > 0 ? row.advanced / row.entered : null,
    })),
    staleOpportunities: risks.filter((risk) => risk.daysStale >= 7),
    overdueFollowUps: risks.filter((risk) => risk.reasons.includes("follow-up overdue")),
    topRisks: risks.slice(0, 10),
    lostReasons: lostRows.map((row) => ({
      reason: row.reason,
      opportunities: row.opportunities,
      estimatedValue: Number(row.estimated_value),
    })),
  };
}
