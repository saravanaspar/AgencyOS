import { assetPermissionKeys } from "@/modules/assets/assets";
import { crmPermissionKeys } from "@/modules/crm/crm";
import { documentPermissionKeys } from "@/modules/documents/documents";
import { financePermissionKeys } from "@/modules/finance/finance";
import { legalPermissionKeys } from "@/modules/legal/legal";
import { hasRequiredPermissions, modulePermissionKeys } from "@/modules/permissions/module-access";
import { projectPermissionKeys } from "@/modules/projects/projects";
import { reportsPermissionKeys } from "@/modules/reports/reports";
import { supportPermissionKeys } from "@/modules/support/support";
import { vendorPermissionKeys } from "@/modules/vendors/vendors";

export interface ModuleDefinition {
  label: string;
  stage: string;
  summary: string;
  firstCapabilities: string[];
  primaryAction: string;
  requiredPermissions: readonly string[];
}

export const moduleRegistry: Record<string, ModuleDefinition> = {
  crm: {
    requiredPermissions: [modulePermissionKeys.crm],
    label: "CRM",
    stage: "Stage 2",
    summary: "Leads, companies, contacts, pipeline stages, and relationship activity.",
    firstCapabilities: [
      "Create and qualify leads",
      "Manage companies and contacts",
      "Convert qualified leads into projects",
    ],
    primaryAction: "Create lead",
  },
  projects: {
    requiredPermissions: [modulePermissionKeys.projects],
    label: "Projects",
    stage: "Stage 2",
    summary: "Project delivery, tasks, comments, attachments, time tracking, and reporting.",
    firstCapabilities: [
      "Create project workspaces",
      "Assign and sequence tasks",
      "Track delivery risk and time",
    ],
    primaryAction: "Create project",
  },
  calendar: {
    requiredPermissions: [modulePermissionKeys.calendar],
    label: "Calendar",
    stage: "Stage 7",
    summary: "One schedule for project milestones, meetings, leave, renewals, and due dates.",
    firstCapabilities: [
      "View cross-module events",
      "Create agency events",
      "Filter by team and event type",
    ],
    primaryAction: "Create event",
  },
  finance: {
    requiredPermissions: [modulePermissionKeys.finance],
    label: "Finance",
    stage: "Stage 3",
    summary: "Products, estimates, invoices, payments, expenses, approvals, and financial reports.",
    firstCapabilities: [
      "Create estimates",
      "Issue immutable invoices",
      "Record payments and expenses",
    ],
    primaryAction: "Create estimate",
  },
  hr: {
    requiredPermissions: [modulePermissionKeys.hr],
    label: "People",
    stage: "Stage 4",
    summary: "Employee records, attendance, leave, salary slips, onboarding, and offboarding.",
    firstCapabilities: [
      "Manage employee records",
      "Review attendance and leave",
      "Run onboarding checklists",
    ],
    primaryAction: "Add employee",
  },
  support: {
    requiredPermissions: [modulePermissionKeys.support],
    label: "Support",
    stage: "Stage 6",
    summary: "Customer tickets, ownership, service history, priorities, and resolution workflow.",
    firstCapabilities: [
      "Create and assign tickets",
      "Track response and resolution status",
      "Link tickets to clients and projects",
    ],
    primaryAction: "Create ticket",
  },
  documents: {
    requiredPermissions: [modulePermissionKeys.documents],
    label: "Documents",
    stage: "Stage 5",
    summary: "Private files with versions, tags, entity links, retention, and access rules.",
    firstCapabilities: [
      "Upload private documents",
      "Link files to business records",
      "Review version history",
    ],
    primaryAction: "Upload document",
  },
  legal: {
    requiredPermissions: [modulePermissionKeys.legal],
    label: "Legal",
    stage: "Stage 5",
    summary: "Contracts, renewals, signatures, confidentiality, holds, and restricted access.",
    firstCapabilities: [
      "Store contract records",
      "Track renewals and signatures",
      "Apply legal holds",
    ],
    primaryAction: "Add contract",
  },
  assets: {
    requiredPermissions: [modulePermissionKeys.assets],
    label: "Assets",
    stage: "Stage 6",
    summary: "Inventory, assignment, condition, maintenance, and complete asset history.",
    firstCapabilities: [
      "Register agency assets",
      "Assign assets to employees",
      "Track returns and maintenance",
    ],
    primaryAction: "Add asset",
  },
  vendors: {
    requiredPermissions: [modulePermissionKeys.vendors],
    label: "Vendors",
    stage: "Stage 6",
    summary: "Vendor records, purchase requests, purchase orders, bills, and approvals.",
    firstCapabilities: [
      "Manage vendor records",
      "Raise purchase requests",
      "Issue approved purchase orders",
    ],
    primaryAction: "Add vendor",
  },
  approvals: {
    requiredPermissions: [modulePermissionKeys.approvals],
    label: "Approvals",
    stage: "Stage 1",
    summary: "A shared approval engine for finance, leave, procurement, legal, and operations.",
    firstCapabilities: [
      "Review assigned requests",
      "Approve, reject, or return requests",
      "Inspect decision history",
    ],
    primaryAction: "Create approval policy",
  },
  reports: {
    requiredPermissions: [modulePermissionKeys.reports],
    label: "Reports",
    stage: "Stage 7",
    summary: "Permission-aware operational and management reports across every module.",
    firstCapabilities: [
      "Run standard reports",
      "Filter by team and period",
      "Export within permission limits",
    ],
    primaryAction: "Run report",
  },
  automation: {
    requiredPermissions: [modulePermissionKeys.automation],
    label: "Automation",
    stage: "Stage 8",
    summary:
      "AgencyOS triggers, internal handlers, execution history, retries, and dead-letter recovery.",
    firstCapabilities: [
      "Define automation triggers",
      "Run registered internal handlers",
      "Review execution failures",
    ],
    primaryAction: "Create automation",
  },
  ai: {
    requiredPermissions: [modulePermissionKeys.ai],
    label: "AI tools",
    stage: "Stage 8",
    summary: "Permission-aware writing and retrieval tools with complete AI audit records.",
    firstCapabilities: ["Draft agency emails", "Draft proposals", "Search authorized documents"],
    primaryAction: "Open AI workspace",
  },
  settings: {
    requiredPermissions: [modulePermissionKeys.settings],
    label: "Settings",
    stage: "Stage 1",
    summary: "Organization profile, users, memberships, roles, permissions, and integrations.",
    firstCapabilities: [
      "Configure the organization",
      "Manage users and roles",
      "Connect infrastructure adapters",
    ],
    primaryAction: "Open organization settings",
  },
};

export interface GlobalCommandAction {
  id: string;
  label: string;
  module: string;
  href: string;
  keywords: readonly string[];
  requiredPermissions: readonly string[];
}

export const globalCommandActions: readonly GlobalCommandAction[] = [
  {
    id: "crm.create-lead",
    label: "Create lead",
    module: "CRM",
    href: "/crm?create=lead",
    keywords: ["new lead", "opportunity", "sales"],
    requiredPermissions: [modulePermissionKeys.crm, crmPermissionKeys.leadCreate],
  },
  {
    id: "crm.create-client",
    label: "Create client",
    module: "CRM",
    href: "/crm?create=company",
    keywords: ["new client", "company", "customer"],
    requiredPermissions: [modulePermissionKeys.crm, crmPermissionKeys.companyCreate],
  },
  {
    id: "projects.create-project",
    label: "Create project",
    module: "Projects",
    href: "/projects?create=project",
    keywords: ["new project", "delivery"],
    requiredPermissions: [modulePermissionKeys.projects, projectPermissionKeys.projectCreate],
  },
  {
    id: "projects.create-task",
    label: "Create task",
    module: "Projects",
    href: "/projects?create=task",
    keywords: ["new task", "work item"],
    requiredPermissions: [modulePermissionKeys.projects, projectPermissionKeys.taskCreate],
  },
  {
    id: "finance.create-estimate",
    label: "Create estimate",
    module: "Finance",
    href: "/finance?tab=estimates&create=estimate",
    keywords: ["quote", "proposal", "estimate"],
    requiredPermissions: [modulePermissionKeys.finance, financePermissionKeys.estimateCreate],
  },
  {
    id: "finance.create-invoice",
    label: "Create invoice",
    module: "Finance",
    href: "/finance?tab=invoices&create=invoice",
    keywords: ["invoice draft", "bill client"],
    requiredPermissions: [modulePermissionKeys.finance, financePermissionKeys.invoiceCreate],
  },
  {
    id: "finance.record-payment",
    label: "Record payment",
    module: "Finance",
    href: "/finance?tab=payments&create=payment",
    keywords: ["payment", "cash received"],
    requiredPermissions: [modulePermissionKeys.finance, financePermissionKeys.paymentCreate],
  },
  {
    id: "finance.record-expense",
    label: "Record expense",
    module: "Finance",
    href: "/finance?tab=expenses&create=expense",
    keywords: ["expense", "cost", "reimbursement"],
    requiredPermissions: [modulePermissionKeys.finance, financePermissionKeys.expenseCreate],
  },
  {
    id: "vendors.create-vendor",
    label: "Add vendor",
    module: "Vendors",
    href: "/vendors?create=vendor",
    keywords: ["supplier", "vendor"],
    requiredPermissions: [modulePermissionKeys.vendors, vendorPermissionKeys.create],
  },
  {
    id: "documents.upload",
    label: "Upload document",
    module: "Documents",
    href: "/documents?create=document",
    keywords: ["file", "document", "upload"],
    requiredPermissions: [modulePermissionKeys.documents, documentPermissionKeys.create],
  },
  {
    id: "support.create-ticket",
    label: "Create ticket",
    module: "Support",
    href: "/support#create-ticket",
    keywords: ["support", "issue", "ticket"],
    requiredPermissions: [modulePermissionKeys.support, supportPermissionKeys.create],
  },
  {
    id: "legal.create-contract",
    label: "Add contract",
    module: "Legal",
    href: "/legal?create=contract",
    keywords: ["contract", "agreement", "legal"],
    requiredPermissions: [modulePermissionKeys.legal, legalPermissionKeys.create],
  },
  {
    id: "assets.create-asset",
    label: "Add asset",
    module: "Assets",
    href: "/assets?create=asset",
    keywords: ["asset", "equipment", "inventory"],
    requiredPermissions: [modulePermissionKeys.assets, assetPermissionKeys.create],
  },
  {
    id: "finance.overdue",
    label: "Open overdue invoices",
    module: "Finance",
    href: "/finance?tab=invoices&status=overdue",
    keywords: ["collections", "receivables", "overdue"],
    requiredPermissions: [modulePermissionKeys.finance, financePermissionKeys.invoiceView],
  },
  {
    id: "projects.risk",
    label: "Review projects at risk",
    module: "Projects",
    href: "/projects?group=health&sort=due",
    keywords: ["risk", "late", "delivery"],
    requiredPermissions: [modulePermissionKeys.projects, projectPermissionKeys.projectView],
  },
  {
    id: "reports.open",
    label: "Generate or review reports",
    module: "Reports",
    href: "/reports",
    keywords: ["report", "founder daily", "weekly review", "export"],
    requiredPermissions: [modulePermissionKeys.reports, reportsPermissionKeys.workspace],
  },
] as const;

export function getAuthorizedGlobalCommandActions(
  permissions: ReadonlySet<string>,
): GlobalCommandAction[] {
  return globalCommandActions.filter((action) =>
    hasRequiredPermissions(permissions, action.requiredPermissions),
  );
}
