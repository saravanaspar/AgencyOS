export type ExternalReportDeliveryChannel = "slack" | "telegram" | "webhook";

export interface ReportDeliveryDestinationSummary {
  id: string;
  channel: ExternalReportDeliveryChannel;
  name: string;
  status: "active" | "disabled";
  updatedAt: string;
}
