import { Filter, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { crmLeadStatuses } from "@/modules/crm/crm";
import type { CrmWorkspaceData } from "@/modules/crm/server/crm";

type CrmFilterFormData = Pick<CrmWorkspaceData, "filters" | "stages" | "members">;

export function CrmFilterForm({ data }: { data: CrmFilterFormData }) {
  return (
    <form method="get" action="/crm" className="crm-filter-form">
      <label className="crm-search-field">
        <Search size={16} aria-hidden="true" />
        <input
          name="q"
          defaultValue={data.filters.q}
          placeholder="Search leads, companies, contacts"
        />
      </label>
      <label className="field">
        <span>Stage</span>
        <select name="stage" defaultValue={data.filters.stage ?? ""}>
          <option value="">All stages</option>
          {data.stages.map((stage) => (
            <option value={stage.id} key={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Owner</span>
        <select name="owner" defaultValue={data.filters.owner ?? ""}>
          <option value="">All owners</option>
          {data.members.map((member) => (
            <option value={member.membershipId} key={member.membershipId}>
              {member.displayName}
            </option>
          ))}
        </select>
      </label>
      {data.filters.currency ? (
        <label className="field">
          <span>Currency</span>
          <input name="currency" defaultValue={data.filters.currency} maxLength={3} />
        </label>
      ) : null}
      {data.filters.scope ? <input type="hidden" name="scope" value={data.filters.scope} /> : null}
      <label className="field">
        <span>Status</span>
        <select name="status" defaultValue={data.filters.status ?? ""}>
          <option value="">All statuses</option>
          {crmLeadStatuses.map((status) => (
            <option value={status} key={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="secondary">
        <Filter size={15} aria-hidden="true" /> Apply
      </Button>
    </form>
  );
}
