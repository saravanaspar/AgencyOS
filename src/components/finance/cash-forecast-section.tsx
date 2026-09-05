"use client";

import { useActionState } from "react";

import { formatMinorMoney } from "@/modules/finance/calculations";
import {
  deleteCashRecurringItemAction,
  saveCashForecastSettingsAction,
  saveCashRecurringItemAction,
} from "@/modules/finance/actions/cash-forecast";
import type { FinanceWorkspaceData } from "@/modules/finance/server/finance";
import type { FinanceActionState } from "@/modules/finance/schemas/finance";

const initialState: FinanceActionState = { status: "idle", message: "" };

function Message({ state }: { state: FinanceActionState }) {
  if (state.status === "idle") return null;
  return (
    <p
      role="status"
      className={
        state.status === "error"
          ? "form-message form-message--error"
          : "form-message form-message--success"
      }
    >
      {state.message}
    </p>
  );
}

export function CashForecastSection({ data }: { data: FinanceWorkspaceData }) {
  const forecast = data.cashForecast;
  const [settingsState, settingsAction, settingsPending] = useActionState(
    saveCashForecastSettingsAction,
    initialState,
  );
  const [itemState, itemAction, itemPending] = useActionState(
    saveCashRecurringItemAction,
    initialState,
  );
  if (!forecast) return null;
  return (
    <section className="finance-client-statement" aria-labelledby="cash-forecast-title">
      <header>
        <div>
          <h3 id="cash-forecast-title">30 / 60 / 90-day cash forecast</h3>
          <p>
            Forward cash movement by currency and scenario. This is not a bank-balance view;
            incompatible currencies are never combined.
          </p>
        </div>
      </header>
      {forecast.currencies.map((currency) => (
        <div className="finance-report-table-scroll" key={currency.currency}>
          <table className="finance-report-table">
            <caption>
              {currency.currency} forecast as of {forecast.asOf}
            </caption>
            <thead>
              <tr>
                <th>Scenario</th>
                <th>30 days</th>
                <th>60 days</th>
                <th>90 days</th>
              </tr>
            </thead>
            <tbody>
              {currency.scenarios.map((scenario) => (
                <tr key={scenario.scenario}>
                  <th>{scenario.scenario}</th>
                  {scenario.horizons.map((horizon) => (
                    <td key={horizon.days}>
                      <strong>
                        {formatMinorMoney(horizon.netMinor, currency.currency, data.locale)}
                      </strong>
                      <small>
                        {formatMinorMoney(horizon.inflowMinor, currency.currency, data.locale)} in ·{" "}
                        {formatMinorMoney(horizon.outflowMinor, currency.currency, data.locale)} out
                      </small>
                      <details>
                        <summary>Assumption provenance</summary>
                        <ul>
                          {horizon.sources.map((source) => (
                            <li key={source.source}>
                              <strong>{source.source.replaceAll("_", " ")}</strong>:{" "}
                              {source.inflowMinor
                                ? `${formatMinorMoney(source.inflowMinor, currency.currency, data.locale)} in`
                                : ""}
                              {source.inflowMinor && source.outflowMinor ? " · " : ""}
                              {source.outflowMinor
                                ? `${formatMinorMoney(source.outflowMinor, currency.currency, data.locale)} out`
                                : ""}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <ul className="finance-report-warning">
        {forecast.assumptions.map((assumption) => (
          <li key={assumption}>{assumption}</li>
        ))}
      </ul>
      {data.capabilities.canManageCashForecast ? (
        <>
          <form action={settingsAction} className="finance-form-grid">
            <h4>Scenario policy</h4>
            <label>
              Payroll day
              <input
                name="payrollDay"
                type="number"
                min={1}
                max={28}
                defaultValue={forecast.settings.payrollDay}
              />
            </label>
            <label>
              <input
                name="pipelineEnabled"
                type="checkbox"
                defaultChecked={forecast.settings.pipelineEnabled}
              />{" "}
              Include probability-weighted CRM pipeline
            </label>
            <label>
              <input
                name="historicalCollectionEnabled"
                type="checkbox"
                defaultChecked={forecast.settings.historicalCollectionEnabled}
              />{" "}
              Apply historical collection lag
            </label>
            <label>
              Base collection delay
              <input
                name="baseCollectionDelayDays"
                type="number"
                min={0}
                max={120}
                defaultValue={forecast.settings.baseCollectionDelayDays}
              />
            </label>
            <label>
              Conservative delay
              <input
                name="conservativeCollectionDelayDays"
                type="number"
                min={0}
                max={120}
                defaultValue={forecast.settings.conservativeCollectionDelayDays}
              />
            </label>
            <label>
              Optimistic delay
              <input
                name="optimisticCollectionDelayDays"
                type="number"
                min={0}
                max={120}
                defaultValue={forecast.settings.optimisticCollectionDelayDays}
              />
            </label>
            <label>
              Base pipeline multiplier (bps)
              <input
                name="basePipelineMultiplierBps"
                type="number"
                min={0}
                max={20000}
                defaultValue={forecast.settings.basePipelineMultiplierBps}
              />
            </label>
            <label>
              Conservative multiplier (bps)
              <input
                name="conservativePipelineMultiplierBps"
                type="number"
                min={0}
                max={20000}
                defaultValue={forecast.settings.conservativePipelineMultiplierBps}
              />
            </label>
            <label>
              Optimistic multiplier (bps)
              <input
                name="optimisticPipelineMultiplierBps"
                type="number"
                min={0}
                max={20000}
                defaultValue={forecast.settings.optimisticPipelineMultiplierBps}
              />
            </label>
            <button type="submit" className="button button--secondary" disabled={settingsPending}>
              Save forecast policy
            </button>
            <Message state={settingsState} />
          </form>
          <form action={itemAction} className="finance-form-grid">
            <h4>Add recurring cash assumption</h4>
            <label>
              Label
              <input name="label" required maxLength={160} />
            </label>
            <label>
              Direction
              <select name="direction" defaultValue="outflow">
                <option value="inflow">Inflow</option>
                <option value="outflow">Outflow</option>
              </select>
            </label>
            <label>
              Type
              <select name="itemKind" defaultValue="operating_obligation">
                <option value="retainer_income">Retainer income</option>
                <option value="recurring_income">Recurring income</option>
                <option value="operating_obligation">Operating obligation</option>
                <option value="tax_obligation">Tax obligation</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Amount
              <input name="amount" inputMode="decimal" required />
            </label>
            <label>
              Currency
              <input
                name="currency"
                defaultValue={data.defaultCurrency}
                pattern="[A-Z]{3}"
                required
              />
            </label>
            <label>
              Cadence
              <select name="cadence" defaultValue="monthly">
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </label>
            <label>
              Next due
              <input name="nextDueOn" type="date" required />
            </label>
            <label>
              End date
              <input name="endOn" type="date" />
            </label>
            <label>
              Probability (bps)
              <input name="probabilityBps" type="number" min={0} max={10000} defaultValue={10000} />
            </label>
            <label>
              Project
              <select name="projectId" defaultValue="">
                <option value="">None</option>
                {data.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.code} · {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input name="active" type="checkbox" defaultChecked /> Active
            </label>
            <button type="submit" className="button button--secondary" disabled={itemPending}>
              Add recurring item
            </button>
            <Message state={itemState} />
          </form>
          {forecast.recurringItems.length ? (
            <div className="finance-report-table-scroll">
              <table className="finance-report-table">
                <thead>
                  <tr>
                    <th>Recurring assumption</th>
                    <th>Amount</th>
                    <th>Next due</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {forecast.recurringItems.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.label}</strong>
                        <small>
                          {item.itemKind.replaceAll("_", " ")} · {item.cadence}
                        </small>
                      </td>
                      <td>
                        {item.direction === "outflow" ? "−" : "+"}
                        {formatMinorMoney(item.amountMinor, item.currency, data.locale)}
                      </td>
                      <td>{item.nextDueOn}</td>
                      <td>
                        <form action={deleteCashRecurringItemAction}>
                          <input type="hidden" name="recurringItemId" value={item.id} />
                          <button className="text-link" type="submit">
                            Delete
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
