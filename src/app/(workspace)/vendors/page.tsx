import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { VendorsWorkspace } from "@/components/vendors/vendors-workspace";
import { getVendorWorkspaceData } from "@/modules/vendors/server/vendors";
import {
  purchaseOrderStatusLabels,
  purchaseOrderStatuses,
  purchaseRequestStatusLabels,
  purchaseRequestStatuses,
  vendorStatusLabels,
  vendorStatuses,
} from "@/modules/vendors/vendors";

export const metadata = { title: "Vendors & procurement" };

type VendorsPageProps = {
  searchParams: Promise<{
    q?: string;
    vendorStatus?: string;
    requestStatus?: string;
    purchaseOrderStatus?: string;
  }>;
};

export default async function VendorsPage({ searchParams }: VendorsPageProps) {
  const filters = await searchParams;
  const result = await getVendorWorkspaceData(filters);
  if (!result.allowed) {
    return <PageAccessFailure reason={result.reason} nextPath="/vendors" />;
  }

  return (
    <div className="module-page">
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Supplier governance and controlled purchasing</p>
          <h1>Vendors & procurement</h1>
          <p>
            Govern supplier records, contracts, risk and performance; route purchase requests
            through shared approvals; compare quotations; issue purchase orders; record receipts,
            bills, payment status, and scanner-gated supporting documents.
          </p>
        </div>
      </section>
      <form className="vendor-filter-bar" method="get">
        <label>
          Search
          <input name="q" defaultValue={filters.q ?? ""} placeholder="Vendor, request, or PO" />
        </label>
        <label>
          Vendor status
          <select name="vendorStatus" defaultValue={filters.vendorStatus ?? "all"}>
            <option value="all">All vendors</option>
            {vendorStatuses.map((status) => (
              <option key={status} value={status}>
                {vendorStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Request status
          <select name="requestStatus" defaultValue={filters.requestStatus ?? "all"}>
            <option value="all">All requests</option>
            {purchaseRequestStatuses.map((status) => (
              <option key={status} value={status}>
                {purchaseRequestStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          PO status
          <select name="purchaseOrderStatus" defaultValue={filters.purchaseOrderStatus ?? "all"}>
            <option value="all">All purchase orders</option>
            {purchaseOrderStatuses.map((status) => (
              <option key={status} value={status}>
                {purchaseOrderStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="button button--secondary">
          Apply filters
        </button>
      </form>
      <VendorsWorkspace data={result.data} />
    </div>
  );
}
