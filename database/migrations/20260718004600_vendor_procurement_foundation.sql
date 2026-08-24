-- Vendor and procurement foundation. Reuses shared approvals, legal contracts,
-- Documents, notifications, permission scopes, and the central audit trail.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('vendors', 'vendor', 'view', 'View vendor profiles within the granted scope.', false),
  ('vendors', 'vendor', 'create', 'Create vendor profiles and contacts.', true),
  ('vendors', 'vendor', 'update', 'Update vendor lifecycle, ownership, terms, and risk metadata.', true),
  ('vendors', 'vendor', 'view_sensitive', 'View vendor tax and bank metadata.', true),
  ('vendors', 'vendor', 'note', 'Add immutable vendor performance and risk notes.', true),
  ('vendors', 'vendor', 'link_contract', 'Link accessible Legal contracts to vendors.', true),
  ('vendors', 'vendor', 'link_document', 'Link accessible Documents records to vendors.', true),
  ('vendors', 'category', 'manage', 'Manage vendor categories.', true),
  ('vendors', 'purchase_request', 'view', 'View purchase requests within the granted scope.', false),
  ('vendors', 'purchase_request', 'create', 'Create purchase requests and requested items.', false),
  ('vendors', 'purchase_request', 'submit', 'Submit purchase requests to the shared approval engine.', false),
  ('vendors', 'purchase_request', 'manage', 'Manage approved purchase requests and sourcing.', true),
  ('vendors', 'quotation', 'manage', 'Record quotations and select vendors for approved requests.', true),
  ('vendors', 'purchase_order', 'view', 'View purchase orders within the granted scope.', false),
  ('vendors', 'purchase_order', 'manage', 'Issue and manage purchase orders.', true),
  ('vendors', 'purchase_order', 'link_document', 'Link accessible Documents records to purchase orders.', true),
  ('vendors', 'receipt', 'record', 'Record goods or services received against purchase orders.', true),
  ('vendors', 'bill', 'view', 'View vendor bills within the granted scope.', true),
  ('vendors', 'bill', 'manage', 'Record and match vendor bills to purchase orders.', true),
  ('vendors', 'bill', 'payment', 'Approve, dispute, and record vendor bill payment state.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where permission.module = 'vendors'
  and role_template.key in ('owner', 'operations_administrator', 'finance_manager')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'system_administrator', permission.id, 'organization'
from public.permissions as permission
where permission.key in (
  'vendors.workspace.view', 'vendors.vendor.view', 'vendors.purchase_request.view',
  'vendors.purchase_order.view', 'vendors.bill.view'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'accountant', permission.id, 'organization'
from public.permissions as permission
where permission.key in (
  'vendors.workspace.view', 'vendors.vendor.view', 'vendors.vendor.view_sensitive',
  'vendors.purchase_request.view', 'vendors.purchase_order.view',
  'vendors.bill.view', 'vendors.bill.manage', 'vendors.bill.payment'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id,
  case when permission.key = 'vendors.purchase_request.view' then
    case when role_template.key = 'team_lead' then 'managed_employees' else 'selected_projects' end
  else 'organization' end
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('project_manager', 'team_lead')
  and permission.key in (
    'vendors.workspace.view', 'vendors.vendor.view', 'vendors.purchase_request.view',
    'vendors.purchase_request.create', 'vendors.purchase_request.submit',
    'vendors.purchase_order.view'
  )
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'employee', permission.id, 'own'
from public.permissions as permission
where permission.key in (
  'vendors.workspace.view', 'vendors.vendor.view', 'vendors.purchase_request.view',
  'vendors.purchase_request.create', 'vendors.purchase_request.submit'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'legal_manager', permission.id, 'organization'
from public.permissions as permission
where permission.key in (
  'vendors.workspace.view', 'vendors.vendor.view', 'vendors.vendor.link_contract'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key in (
  'vendors.workspace.view', 'vendors.vendor.view', 'vendors.purchase_request.view',
  'vendors.purchase_order.view', 'vendors.bill.view'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'vendors'
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.procurement_counters (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  next_vendor_number bigint not null default 1,
  next_request_number bigint not null default 1,
  next_purchase_order_number bigint not null default 1,
  next_receipt_number bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint procurement_counters_positive check (
    next_vendor_number > 0 and next_request_number > 0
    and next_purchase_order_number > 0 and next_receipt_number > 0
  )
);

create table public.vendor_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active',
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_categories_name_valid check (char_length(btrim(name)) between 2 and 80),
  constraint vendor_categories_description_valid check (
    description is null or char_length(btrim(description)) between 2 and 500
  ),
  constraint vendor_categories_status_valid check (status in ('active', 'inactive')),
  unique (organization_id, name)
);

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_number bigint not null,
  legal_name text not null,
  display_name text not null,
  primary_category_id uuid references public.vendor_categories(id) on delete set null,
  status text not null default 'active',
  risk_classification text not null default 'low',
  owner_membership_id uuid references public.memberships(id) on delete set null,
  website text,
  email text,
  phone text,
  address text,
  country_code text,
  default_currency text not null default 'USD',
  payment_terms_days integer not null default 30,
  onboarding_date date,
  next_review_date date,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendors_number_positive check (vendor_number > 0),
  constraint vendors_legal_name_valid check (char_length(btrim(legal_name)) between 2 and 180),
  constraint vendors_display_name_valid check (char_length(btrim(display_name)) between 2 and 160),
  constraint vendors_status_valid check (status in ('prospect', 'active', 'on_hold', 'inactive', 'blocked')),
  constraint vendors_risk_valid check (risk_classification in ('low', 'medium', 'high', 'critical')),
  constraint vendors_website_valid check (website is null or char_length(btrim(website)) between 4 and 500),
  constraint vendors_email_valid check (email is null or char_length(btrim(email)) between 3 and 320),
  constraint vendors_phone_valid check (phone is null or char_length(btrim(phone)) between 3 and 80),
  constraint vendors_address_valid check (address is null or char_length(btrim(address)) between 3 and 1000),
  constraint vendors_country_valid check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint vendors_currency_valid check (default_currency ~ '^[A-Z]{3}$'),
  constraint vendors_payment_terms_valid check (payment_terms_days between 0 and 365),
  unique (organization_id, vendor_number)
);
create index vendors_workspace_idx on public.vendors (organization_id, status, updated_at desc);
create index vendors_category_idx on public.vendors (organization_id, primary_category_id, display_name);

create table public.vendor_financial_profiles (
  vendor_id uuid primary key references public.vendors(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tax_country_code text,
  tax_identifier text,
  tax_registration_name text,
  bank_name text,
  bank_account_name text,
  bank_account_last_four text,
  bank_routing_reference text,
  payment_instructions text,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_financial_tax_country_valid check (
    tax_country_code is null or tax_country_code ~ '^[A-Z]{2}$'
  ),
  constraint vendor_financial_tax_identifier_valid check (
    tax_identifier is null or char_length(btrim(tax_identifier)) between 2 and 120
  ),
  constraint vendor_financial_tax_name_valid check (
    tax_registration_name is null or char_length(btrim(tax_registration_name)) between 2 and 180
  ),
  constraint vendor_financial_bank_name_valid check (
    bank_name is null or char_length(btrim(bank_name)) between 2 and 160
  ),
  constraint vendor_financial_account_name_valid check (
    bank_account_name is null or char_length(btrim(bank_account_name)) between 2 and 160
  ),
  constraint vendor_financial_last_four_valid check (
    bank_account_last_four is null or bank_account_last_four ~ '^[A-Za-z0-9]{2,8}$'
  ),
  constraint vendor_financial_routing_valid check (
    bank_routing_reference is null or char_length(btrim(bank_routing_reference)) between 2 and 120
  ),
  constraint vendor_financial_instructions_valid check (
    payment_instructions is null or char_length(btrim(payment_instructions)) between 2 and 2000
  )
);

create table public.vendor_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  name text not null,
  role_title text,
  email text,
  phone text,
  is_primary boolean not null default false,
  status text not null default 'active',
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_contacts_name_valid check (char_length(btrim(name)) between 2 and 160),
  constraint vendor_contacts_role_valid check (role_title is null or char_length(btrim(role_title)) between 2 and 120),
  constraint vendor_contacts_email_valid check (email is null or char_length(btrim(email)) between 3 and 320),
  constraint vendor_contacts_phone_valid check (phone is null or char_length(btrim(phone)) between 3 and 80),
  constraint vendor_contacts_status_valid check (status in ('active', 'inactive'))
);
create unique index vendor_contacts_primary_idx on public.vendor_contacts (vendor_id) where is_primary and status = 'active';

create table public.vendor_category_links (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  category_id uuid not null references public.vendor_categories(id) on delete cascade,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (vendor_id, category_id)
);

create table public.vendor_contract_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  contract_id uuid not null references public.legal_contracts(id) on delete restrict,
  relationship_type text not null default 'master_agreement',
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint vendor_contract_links_type_valid check (
    relationship_type in ('master_agreement', 'statement_of_work', 'data_processing', 'service_level', 'other')
  ),
  unique (vendor_id, contract_id)
);

create table public.vendor_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  note_type text not null,
  rating smallint,
  content text not null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint vendor_notes_type_valid check (note_type in ('performance', 'risk', 'compliance', 'general')),
  constraint vendor_notes_rating_valid check (rating is null or rating between 1 and 5),
  constraint vendor_notes_content_valid check (char_length(btrim(content)) between 3 and 4000)
);

create table public.procurement_purchase_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_number bigint not null,
  title text not null,
  business_justification text not null,
  requester_membership_id uuid not null references public.memberships(id) on delete restrict,
  department_id uuid references public.departments(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  budget_minor bigint not null,
  currency text not null,
  required_by_date date,
  status text not null default 'draft',
  approval_request_id uuid unique references public.approval_requests(id) on delete set null,
  selected_vendor_id uuid references public.vendors(id) on delete set null,
  selected_quotation_id uuid,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_requests_number_positive check (request_number > 0),
  constraint procurement_requests_title_valid check (char_length(btrim(title)) between 3 and 180),
  constraint procurement_requests_justification_valid check (
    char_length(btrim(business_justification)) between 10 and 4000
  ),
  constraint procurement_requests_budget_valid check (budget_minor >= 0),
  constraint procurement_requests_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint procurement_requests_status_valid check (
    status in ('draft', 'pending_approval', 'approved', 'revision_requested', 'rejected',
      'cancelled', 'sourcing', 'ordered', 'partially_received', 'received', 'closed')
  ),
  unique (organization_id, request_number)
);
create index procurement_requests_workspace_idx
  on public.procurement_purchase_requests (organization_id, status, updated_at desc);
create index procurement_requests_requester_idx
  on public.procurement_purchase_requests (organization_id, requester_membership_id, created_at desc);

create table public.procurement_purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_request_id uuid not null references public.procurement_purchase_requests(id) on delete cascade,
  description text not null,
  specifications text,
  quantity numeric(14,3) not null,
  unit text not null,
  estimated_unit_price_minor bigint not null,
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  constraint procurement_request_items_description_valid check (char_length(btrim(description)) between 2 and 500),
  constraint procurement_request_items_specifications_valid check (
    specifications is null or char_length(btrim(specifications)) between 2 and 2000
  ),
  constraint procurement_request_items_quantity_valid check (quantity > 0 and quantity <= 1000000),
  constraint procurement_request_items_unit_valid check (char_length(btrim(unit)) between 1 and 40),
  constraint procurement_request_items_price_valid check (estimated_unit_price_minor >= 0),
  constraint procurement_request_items_sort_valid check (sort_order between 1 and 500)
);

create table public.procurement_vendor_quotations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_request_id uuid not null references public.procurement_purchase_requests(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  quotation_reference text not null,
  quoted_on date not null,
  valid_until date,
  subtotal_minor bigint not null,
  tax_minor bigint not null default 0,
  shipping_minor bigint not null default 0,
  total_minor bigint generated always as (subtotal_minor + tax_minor + shipping_minor) stored,
  currency text not null,
  lead_time_days integer,
  payment_terms text,
  notes text,
  source_document_id uuid references public.documents(id) on delete set null,
  status text not null default 'submitted',
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_quotations_reference_valid check (char_length(btrim(quotation_reference)) between 1 and 120),
  constraint procurement_quotations_dates_valid check (valid_until is null or valid_until >= quoted_on),
  constraint procurement_quotations_money_valid check (subtotal_minor >= 0 and tax_minor >= 0 and shipping_minor >= 0),
  constraint procurement_quotations_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint procurement_quotations_lead_valid check (lead_time_days is null or lead_time_days between 0 and 3650),
  constraint procurement_quotations_terms_valid check (payment_terms is null or char_length(btrim(payment_terms)) between 2 and 1000),
  constraint procurement_quotations_notes_valid check (notes is null or char_length(btrim(notes)) between 2 and 4000),
  constraint procurement_quotations_status_valid check (status in ('submitted', 'selected', 'rejected', 'expired', 'withdrawn')),
  unique (purchase_request_id, vendor_id, quotation_reference)
);
create unique index procurement_selected_quotation_idx
  on public.procurement_vendor_quotations (purchase_request_id) where status = 'selected';

alter table public.procurement_purchase_requests
  add constraint procurement_requests_selected_quotation_fk
  foreign key (selected_quotation_id) references public.procurement_vendor_quotations(id) on delete set null;

create table public.procurement_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_order_number bigint not null,
  purchase_request_id uuid not null references public.procurement_purchase_requests(id) on delete restrict,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  selected_quotation_id uuid references public.procurement_vendor_quotations(id) on delete set null,
  contract_id uuid references public.legal_contracts(id) on delete set null,
  issue_date date not null,
  expected_delivery_date date,
  subtotal_minor bigint not null,
  tax_minor bigint not null default 0,
  shipping_minor bigint not null default 0,
  total_minor bigint generated always as (subtotal_minor + tax_minor + shipping_minor) stored,
  currency text not null,
  payment_terms text,
  delivery_address text,
  status text not null default 'issued',
  issued_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_orders_number_positive check (purchase_order_number > 0),
  constraint procurement_orders_dates_valid check (
    expected_delivery_date is null or expected_delivery_date >= issue_date
  ),
  constraint procurement_orders_money_valid check (subtotal_minor >= 0 and tax_minor >= 0 and shipping_minor >= 0),
  constraint procurement_orders_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint procurement_orders_terms_valid check (payment_terms is null or char_length(btrim(payment_terms)) between 2 and 1000),
  constraint procurement_orders_address_valid check (delivery_address is null or char_length(btrim(delivery_address)) between 3 and 2000),
  constraint procurement_orders_status_valid check (
    status in ('issued', 'acknowledged', 'partially_received', 'received', 'cancelled', 'closed')
  ),
  unique (organization_id, purchase_order_number),
  unique (purchase_request_id)
);
create index procurement_orders_workspace_idx
  on public.procurement_purchase_orders (organization_id, status, expected_delivery_date, updated_at desc);

create table public.procurement_purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id uuid not null references public.procurement_purchase_orders(id) on delete cascade,
  purchase_request_item_id uuid references public.procurement_purchase_request_items(id) on delete set null,
  description text not null,
  quantity numeric(14,3) not null,
  unit text not null,
  unit_price_minor bigint not null,
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  constraint procurement_order_items_description_valid check (char_length(btrim(description)) between 2 and 500),
  constraint procurement_order_items_quantity_valid check (quantity > 0 and quantity <= 1000000),
  constraint procurement_order_items_unit_valid check (char_length(btrim(unit)) between 1 and 40),
  constraint procurement_order_items_price_valid check (unit_price_minor >= 0),
  constraint procurement_order_items_sort_valid check (sort_order between 1 and 500)
);

create table public.procurement_goods_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  receipt_number bigint not null,
  purchase_order_id uuid not null references public.procurement_purchase_orders(id) on delete restrict,
  received_at timestamptz not null,
  delivery_reference text,
  status text not null,
  notes text,
  received_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint procurement_receipts_number_positive check (receipt_number > 0),
  constraint procurement_receipts_reference_valid check (
    delivery_reference is null or char_length(btrim(delivery_reference)) between 1 and 160
  ),
  constraint procurement_receipts_status_valid check (status in ('partial', 'complete', 'rejected')),
  constraint procurement_receipts_notes_valid check (notes is null or char_length(btrim(notes)) between 2 and 4000),
  unique (organization_id, receipt_number)
);

create table public.procurement_goods_receipt_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  goods_receipt_id uuid not null references public.procurement_goods_receipts(id) on delete cascade,
  purchase_order_item_id uuid not null references public.procurement_purchase_order_items(id) on delete restrict,
  quantity_received numeric(14,3) not null,
  condition text not null default 'accepted',
  notes text,
  created_at timestamptz not null default now(),
  constraint procurement_receipt_items_quantity_valid check (quantity_received > 0 and quantity_received <= 1000000),
  constraint procurement_receipt_items_condition_valid check (condition in ('accepted', 'damaged', 'rejected')),
  constraint procurement_receipt_items_notes_valid check (notes is null or char_length(btrim(notes)) between 2 and 1000),
  unique (goods_receipt_id, purchase_order_item_id)
);

create table public.procurement_vendor_bills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id uuid not null references public.procurement_purchase_orders(id) on delete restrict,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  bill_reference text not null,
  invoice_date date not null,
  due_date date,
  subtotal_minor bigint not null,
  tax_minor bigint not null default 0,
  total_minor bigint generated always as (subtotal_minor + tax_minor) stored,
  currency text not null,
  match_status text not null default 'pending',
  status text not null default 'received',
  source_document_id uuid references public.documents(id) on delete set null,
  payment_reference text,
  approved_at timestamptz,
  paid_at timestamptz,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_bills_reference_valid check (char_length(btrim(bill_reference)) between 1 and 160),
  constraint procurement_bills_dates_valid check (due_date is null or due_date >= invoice_date),
  constraint procurement_bills_money_valid check (subtotal_minor >= 0 and tax_minor >= 0),
  constraint procurement_bills_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint procurement_bills_match_valid check (match_status in ('pending', 'matched', 'exception')),
  constraint procurement_bills_status_valid check (
    status in ('received', 'matched', 'approved', 'disputed', 'partially_paid', 'paid', 'void')
  ),
  constraint procurement_bills_payment_reference_valid check (
    payment_reference is null or char_length(btrim(payment_reference)) between 2 and 200
  ),
  unique (organization_id, vendor_id, bill_reference)
);
create index procurement_bills_workspace_idx
  on public.procurement_vendor_bills (organization_id, status, due_date, updated_at desc);

create table public.vendor_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  event_type text not null,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint vendor_events_type_valid check (char_length(btrim(event_type)) between 3 and 120),
  constraint vendor_events_details_object check (jsonb_typeof(details) = 'object')
);

create table public.procurement_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_request_id uuid references public.procurement_purchase_requests(id) on delete cascade,
  purchase_order_id uuid references public.procurement_purchase_orders(id) on delete cascade,
  vendor_bill_id uuid references public.procurement_vendor_bills(id) on delete cascade,
  event_type text not null,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint procurement_events_target_valid check (
    num_nonnulls(purchase_request_id, purchase_order_id, vendor_bill_id) = 1
  ),
  constraint procurement_events_type_valid check (char_length(btrim(event_type)) between 3 and 120),
  constraint procurement_events_details_object check (jsonb_typeof(details) = 'object')
);

-- Complete the asset register's vendor relationship now that Vendors exists.
alter table public.assets add column vendor_id uuid references public.vendors(id) on delete set null;
create index assets_vendor_idx on public.assets (organization_id, vendor_id) where vendor_id is not null;

create or replace function private.validate_vendor_category_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.memberships where id = new.created_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Vendor category creator must belong to its organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_vendor_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.memberships where id = new.created_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Vendor creator must belong to its organization';
  end if;
  if new.owner_membership_id is not null and not exists (
    select 1 from public.memberships where id = new.owner_membership_id
      and organization_id = new.organization_id and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Vendor owner must be active in its organization';
  end if;
  if new.primary_category_id is not null and not exists (
    select 1 from public.vendor_categories where id = new.primary_category_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Vendor category must belong to its organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_vendor_child_tenant()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_actor uuid;
  v_category uuid;
  v_contract uuid;
begin
  if not exists (
    select 1 from public.vendors where id = new.vendor_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Vendor child record must match its organization';
  end if;
  if tg_table_name = 'vendor_financial_profiles' then
    v_actor := new.updated_by_membership_id;
  else
    v_actor := new.created_by_membership_id;
  end if;
  if not exists (
    select 1 from public.memberships where id = v_actor and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Vendor child actor must match its organization';
  end if;
  if tg_table_name = 'vendor_category_links' then
    v_category := new.category_id;
    if not exists (
      select 1 from public.vendor_categories where id = v_category and organization_id = new.organization_id
    ) then
      raise exception using errcode = '23514', message = 'Vendor category link must remain inside one organization';
    end if;
  end if;
  if tg_table_name = 'vendor_contract_links' then
    v_contract := new.contract_id;
    if not exists (
      select 1 from public.legal_contracts where id = v_contract and organization_id = new.organization_id
    ) then
      raise exception using errcode = '23514', message = 'Vendor contract link must remain inside one organization';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.validate_purchase_request_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.memberships where id = new.requester_membership_id
      and organization_id = new.organization_id and status = 'active'
  ) or not exists (
    select 1 from public.memberships where id = new.created_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Purchase request membership references must match its organization';
  end if;
  if new.department_id is not null and not exists (
    select 1 from public.departments where id = new.department_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Purchase request department must match its organization';
  end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects where id = new.project_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Purchase request project must match its organization';
  end if;
  if new.selected_vendor_id is not null and not exists (
    select 1 from public.vendors where id = new.selected_vendor_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Selected vendor must match the purchase request organization';
  end if;
  if new.approval_request_id is not null and not exists (
    select 1 from public.approval_requests where id = new.approval_request_id
      and organization_id = new.organization_id and source_module = 'vendors'
      and entity_type = 'purchase_request' and entity_id = new.id::text
  ) then
    raise exception using errcode = '23514', message = 'Purchase approval must match the purchase request';
  end if;
  if new.selected_quotation_id is not null and not exists (
    select 1 from public.procurement_vendor_quotations quotation
    where quotation.id = new.selected_quotation_id
      and quotation.purchase_request_id = new.id
      and quotation.organization_id = new.organization_id
      and quotation.vendor_id = new.selected_vendor_id
  ) then
    raise exception using errcode = '23514', message = 'Selected quotation must match the purchase request and vendor';
  end if;
  return new;
end;
$$;

create or replace function private.validate_purchase_request_item_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.procurement_purchase_requests request
    where request.id = new.purchase_request_id and request.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Purchase request item must match its organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_vendor_quotation_tenant()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_request_currency text;
begin
  select currency into v_request_currency from public.procurement_purchase_requests
  where id = new.purchase_request_id and organization_id = new.organization_id;
  if v_request_currency is null or v_request_currency <> new.currency then
    raise exception using errcode = '23514', message = 'Quotation must match the request organization and currency';
  end if;
  if not exists (
    select 1 from public.vendors where id = new.vendor_id and organization_id = new.organization_id
  ) or not exists (
    select 1 from public.memberships where id = new.created_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Quotation vendor and actor must match its organization';
  end if;
  if new.source_document_id is not null and not exists (
    select 1 from public.documents where id = new.source_document_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Quotation document must match its organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_purchase_order_tenant()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_request public.procurement_purchase_requests%rowtype;
begin
  select * into v_request from public.procurement_purchase_requests
  where id = new.purchase_request_id and organization_id = new.organization_id;
  if v_request.id is null or v_request.selected_vendor_id <> new.vendor_id then
    raise exception using errcode = '23514', message = 'Purchase order must match the approved request and selected vendor';
  end if;
  if new.selected_quotation_id is not null and not exists (
    select 1 from public.procurement_vendor_quotations quotation
    where quotation.id = new.selected_quotation_id
      and quotation.purchase_request_id = new.purchase_request_id
      and quotation.vendor_id = new.vendor_id
      and quotation.organization_id = new.organization_id
      and quotation.status = 'selected'
  ) then
    raise exception using errcode = '23514', message = 'Purchase order quotation must be selected for its request';
  end if;
  if new.contract_id is not null and not exists (
    select 1 from public.vendor_contract_links link
    where link.vendor_id = new.vendor_id and link.contract_id = new.contract_id
      and link.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Purchase order contract must be linked to the selected vendor';
  end if;
  if not exists (
    select 1 from public.memberships where id = new.issued_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Purchase order issuer must match its organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_purchase_order_item_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.procurement_purchase_orders purchase_order
    where purchase_order.id = new.purchase_order_id and purchase_order.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Purchase order item must match its organization';
  end if;
  if new.purchase_request_item_id is not null and not exists (
    select 1 from public.procurement_purchase_request_items request_item
    join public.procurement_purchase_orders purchase_order
      on purchase_order.purchase_request_id = request_item.purchase_request_id
    where request_item.id = new.purchase_request_item_id
      and purchase_order.id = new.purchase_order_id
      and request_item.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Purchase order item must originate from the linked request';
  end if;
  return new;
end;
$$;

create or replace function private.validate_goods_receipt_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.procurement_purchase_orders purchase_order
    where purchase_order.id = new.purchase_order_id and purchase_order.organization_id = new.organization_id
  ) or not exists (
    select 1 from public.memberships membership
    where membership.id = new.received_by_membership_id and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Goods receipt must remain inside one organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_goods_receipt_item_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.procurement_goods_receipts receipt
    join public.procurement_purchase_order_items item
      on item.purchase_order_id = receipt.purchase_order_id
    where receipt.id = new.goods_receipt_id
      and item.id = new.purchase_order_item_id
      and receipt.organization_id = new.organization_id
      and item.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Goods receipt item must match its purchase order';
  end if;
  return new;
end;
$$;

create or replace function private.validate_vendor_bill_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.procurement_purchase_orders purchase_order
    where purchase_order.id = new.purchase_order_id
      and purchase_order.organization_id = new.organization_id
      and purchase_order.vendor_id = new.vendor_id
      and purchase_order.currency = new.currency
  ) then
    raise exception using errcode = '23514', message = 'Vendor bill must match its purchase order, vendor, and currency';
  end if;
  if not exists (
    select 1 from public.memberships where id = new.created_by_membership_id
      and organization_id = new.organization_id
  ) or not exists (
    select 1 from public.memberships where id = new.updated_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Vendor bill actors must match its organization';
  end if;
  if new.source_document_id is not null and not exists (
    select 1 from public.documents where id = new.source_document_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Vendor bill document must match its organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_vendor_event_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.vendors where id = new.vendor_id and organization_id = new.organization_id
  ) or (new.actor_membership_id is not null and not exists (
    select 1 from public.memberships where id = new.actor_membership_id
      and organization_id = new.organization_id
  )) then
    raise exception using errcode = '23514', message = 'Vendor event must match its organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_procurement_event_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.purchase_request_id is not null and not exists (
    select 1 from public.procurement_purchase_requests request
    where request.id = new.purchase_request_id and request.organization_id = new.organization_id
  ) then raise exception using errcode = '23514', message = 'Procurement request event must match its organization'; end if;
  if new.purchase_order_id is not null and not exists (
    select 1 from public.procurement_purchase_orders purchase_order
    where purchase_order.id = new.purchase_order_id and purchase_order.organization_id = new.organization_id
  ) then raise exception using errcode = '23514', message = 'Procurement order event must match its organization'; end if;
  if new.vendor_bill_id is not null and not exists (
    select 1 from public.procurement_vendor_bills bill
    where bill.id = new.vendor_bill_id and bill.organization_id = new.organization_id
  ) then raise exception using errcode = '23514', message = 'Procurement bill event must match its organization'; end if;
  if new.actor_membership_id is not null and not exists (
    select 1 from public.memberships where id = new.actor_membership_id and organization_id = new.organization_id
  ) then raise exception using errcode = '23514', message = 'Procurement event actor must match its organization'; end if;
  return new;
end;
$$;

create or replace function private.prevent_vendor_history_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514', message = 'Vendor and procurement history is append-only';
end;
$$;

create or replace function private.vendor_membership_access_allowed(
  p_vendor_id uuid, p_membership_id uuid, p_permission_key text
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_vendor public.vendors%rowtype;
  v_scope text;
begin
  select * into v_vendor from public.vendors where id = p_vendor_id;
  if v_vendor.id is null then return false; end if;
  v_scope := private.membership_effective_permission_scope(p_membership_id, p_permission_key);
  if v_scope is null then return false; end if;
  if v_scope = 'organization' then return true; end if;
  if p_membership_id in (v_vendor.owner_membership_id, v_vendor.created_by_membership_id) then return true; end if;
  return private.crm_scope_allows_membership(
    p_membership_id, v_scope, v_vendor.owner_membership_id, v_vendor.created_by_membership_id
  );
end;
$$;

create or replace function private.purchase_request_membership_access_allowed(
  p_request_id uuid, p_membership_id uuid, p_permission_key text
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_request public.procurement_purchase_requests%rowtype;
  v_scope text;
begin
  select * into v_request from public.procurement_purchase_requests where id = p_request_id;
  if v_request.id is null then return false; end if;
  v_scope := private.membership_effective_permission_scope(p_membership_id, p_permission_key);
  if v_scope is null then return false; end if;
  if v_scope = 'organization' then return true; end if;
  if p_membership_id in (v_request.requester_membership_id, v_request.created_by_membership_id) then return true; end if;
  if v_scope = 'selected_projects' and v_request.project_id is not null then
    return exists (
      select 1 from public.project_members project_member
      where project_member.project_id = v_request.project_id
        and project_member.membership_id = p_membership_id
    );
  end if;
  return private.crm_scope_allows_membership(
    p_membership_id, v_scope, v_request.requester_membership_id, v_request.created_by_membership_id
  );
end;
$$;

create or replace function private.purchase_order_membership_access_allowed(
  p_purchase_order_id uuid, p_membership_id uuid, p_permission_key text
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_request_id uuid;
  v_scope text;
  v_requester uuid;
  v_creator uuid;
begin
  select purchase_order.purchase_request_id, request.requester_membership_id, request.created_by_membership_id
  into v_request_id, v_requester, v_creator
  from public.procurement_purchase_orders purchase_order
  join public.procurement_purchase_requests request on request.id = purchase_order.purchase_request_id
  where purchase_order.id = p_purchase_order_id;
  if v_request_id is null then return false; end if;
  v_scope := private.membership_effective_permission_scope(p_membership_id, p_permission_key);
  if v_scope is null then return false; end if;
  if v_scope = 'organization' then return true; end if;
  if p_membership_id in (v_requester, v_creator) then return true; end if;
  return private.crm_scope_allows_membership(p_membership_id, v_scope, v_requester, v_creator);
end;
$$;

create or replace function private.vendor_access_allowed(p_vendor_id uuid, p_permission_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.vendor_membership_access_allowed(
    p_vendor_id,
    private.current_membership_id((select organization_id from public.vendors where id = p_vendor_id)),
    p_permission_key
  )
$$;

create or replace function private.purchase_request_access_allowed(p_request_id uuid, p_permission_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.purchase_request_membership_access_allowed(
    p_request_id,
    private.current_membership_id((select organization_id from public.procurement_purchase_requests where id = p_request_id)),
    p_permission_key
  )
$$;

create or replace function private.purchase_order_access_allowed(p_purchase_order_id uuid, p_permission_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.purchase_order_membership_access_allowed(
    p_purchase_order_id,
    private.current_membership_id((select organization_id from public.procurement_purchase_orders where id = p_purchase_order_id)),
    p_permission_key
  )
$$;

create or replace function private.apply_procurement_approval_result()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source_module <> 'vendors' or new.entity_type <> 'purchase_request'
    or new.entity_id is null or old.status = new.status then return new; end if;
  if new.status = 'approved' then
    update public.procurement_purchase_requests
    set status = 'approved', approval_request_id = new.id, updated_at = now()
    where id = new.entity_id::uuid and organization_id = new.organization_id
      and status = 'pending_approval';
  elsif new.status = 'revision_requested' then
    update public.procurement_purchase_requests
    set status = 'revision_requested', approval_request_id = new.id, updated_at = now()
    where id = new.entity_id::uuid and organization_id = new.organization_id
      and status = 'pending_approval';
  elsif new.status = 'rejected' then
    update public.procurement_purchase_requests
    set status = 'rejected', approval_request_id = new.id, updated_at = now()
    where id = new.entity_id::uuid and organization_id = new.organization_id
      and status = 'pending_approval';
  elsif new.status in ('cancelled', 'expired', 'invalidated') then
    update public.procurement_purchase_requests
    set status = 'draft', approval_request_id = new.id, updated_at = now()
    where id = new.entity_id::uuid and organization_id = new.organization_id
      and status = 'pending_approval';
  end if;
  insert into public.procurement_events (
    organization_id, purchase_request_id, event_type, details
  ) values (
    new.organization_id, new.entity_id::uuid,
    'procurement.approval_' || new.status,
    jsonb_build_object('approvalRequestId', new.id, 'status', new.status)
  );
  return new;
end;
$$;

create trigger vendor_categories_set_updated_at before update on public.vendor_categories
for each row execute function private.set_updated_at();
create trigger vendor_categories_validate_tenant before insert or update on public.vendor_categories
for each row execute function private.validate_vendor_category_tenant();
create trigger vendors_set_updated_at before update on public.vendors
for each row execute function private.set_updated_at();
create trigger vendors_validate_tenant before insert or update on public.vendors
for each row execute function private.validate_vendor_tenant();
create trigger vendor_financial_profiles_set_updated_at before update on public.vendor_financial_profiles
for each row execute function private.set_updated_at();
create trigger vendor_financial_profiles_validate_tenant before insert or update on public.vendor_financial_profiles
for each row execute function private.validate_vendor_child_tenant();
create trigger vendor_contacts_set_updated_at before update on public.vendor_contacts
for each row execute function private.set_updated_at();
create trigger vendor_contacts_validate_tenant before insert or update on public.vendor_contacts
for each row execute function private.validate_vendor_child_tenant();
create trigger vendor_category_links_validate_tenant before insert or update on public.vendor_category_links
for each row execute function private.validate_vendor_child_tenant();
create trigger vendor_contract_links_validate_tenant before insert or update on public.vendor_contract_links
for each row execute function private.validate_vendor_child_tenant();
create trigger vendor_notes_validate_tenant before insert or update on public.vendor_notes
for each row execute function private.validate_vendor_child_tenant();
create trigger vendor_notes_immutable before update or delete on public.vendor_notes
for each row execute function private.prevent_vendor_history_mutation();
create trigger vendor_events_validate_tenant before insert or update on public.vendor_events
for each row execute function private.validate_vendor_event_tenant();
create trigger vendor_events_immutable before update or delete on public.vendor_events
for each row execute function private.prevent_vendor_history_mutation();

create trigger procurement_requests_set_updated_at before update on public.procurement_purchase_requests
for each row execute function private.set_updated_at();
create trigger procurement_requests_validate_tenant before insert or update on public.procurement_purchase_requests
for each row execute function private.validate_purchase_request_tenant();
create trigger procurement_request_items_validate_tenant before insert or update on public.procurement_purchase_request_items
for each row execute function private.validate_purchase_request_item_tenant();
create trigger procurement_quotations_set_updated_at before update on public.procurement_vendor_quotations
for each row execute function private.set_updated_at();
create trigger procurement_quotations_validate_tenant before insert or update on public.procurement_vendor_quotations
for each row execute function private.validate_vendor_quotation_tenant();
create trigger procurement_orders_set_updated_at before update on public.procurement_purchase_orders
for each row execute function private.set_updated_at();
create trigger procurement_orders_validate_tenant before insert or update on public.procurement_purchase_orders
for each row execute function private.validate_purchase_order_tenant();
create trigger procurement_order_items_validate_tenant before insert or update on public.procurement_purchase_order_items
for each row execute function private.validate_purchase_order_item_tenant();
create trigger procurement_receipts_validate_tenant before insert or update on public.procurement_goods_receipts
for each row execute function private.validate_goods_receipt_tenant();
create trigger procurement_receipt_items_validate_tenant before insert or update on public.procurement_goods_receipt_items
for each row execute function private.validate_goods_receipt_item_tenant();
create trigger procurement_bills_set_updated_at before update on public.procurement_vendor_bills
for each row execute function private.set_updated_at();
create trigger procurement_bills_validate_tenant before insert or update on public.procurement_vendor_bills
for each row execute function private.validate_vendor_bill_tenant();
create trigger procurement_events_validate_tenant before insert or update on public.procurement_events
for each row execute function private.validate_procurement_event_tenant();
create trigger procurement_events_immutable before update or delete on public.procurement_events
for each row execute function private.prevent_vendor_history_mutation();
create trigger approval_requests_apply_procurement after update of status on public.approval_requests
for each row execute function private.apply_procurement_approval_result();

-- Add Vendors and Purchase orders to the Documents relationship catalogue.
alter table public.document_entity_links drop constraint document_entity_links_type_valid;
alter table public.document_entity_links add constraint document_entity_links_type_valid check (
  entity_type in (
    'client', 'contact', 'lead', 'project', 'task', 'invoice', 'estimate', 'employee',
    'ticket', 'asset', 'vendor', 'purchase_order'
  )
);

create or replace function private.validate_document_entity_link()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_exists boolean := false;
begin
  if not exists (select 1 from public.documents where id = new.document_id and organization_id = new.organization_id)
     or not exists (select 1 from public.memberships where id = new.created_by_membership_id and organization_id = new.organization_id) then
    raise exception using errcode = '23514', message = 'Document entity link must remain inside one organization';
  end if;
  case new.entity_type
    when 'client' then select exists(select 1 from public.crm_companies where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'contact' then select exists(select 1 from public.crm_contacts where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'lead' then select exists(select 1 from public.crm_leads where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'project' then select exists(select 1 from public.projects where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'task' then select exists(select 1 from public.project_tasks where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'invoice' then select exists(select 1 from public.finance_invoices where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'estimate' then select exists(select 1 from public.finance_estimates where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'employee' then select exists(select 1 from public.memberships where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'ticket' then select exists(select 1 from public.support_tickets where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'asset' then select exists(select 1 from public.assets where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'vendor' then select exists(select 1 from public.vendors where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'purchase_order' then select exists(select 1 from public.procurement_purchase_orders where id = new.entity_id and organization_id = new.organization_id) into v_exists;
  end case;
  if not v_exists then
    raise exception using errcode = '23514', message = 'Linked entity was not found in this organization';
  end if;
  return new;
end;
$$;

-- Extend the existing asset tenant validator with vendor isolation.
create or replace function private.validate_asset_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.asset_categories where id = new.category_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Asset category must belong to its organization';
  end if;
  if not exists (
    select 1 from public.memberships where id = new.created_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Asset creator must belong to its organization';
  end if;
  if new.owner_membership_id is not null and not exists (
    select 1 from public.memberships where id = new.owner_membership_id
      and organization_id = new.organization_id and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Asset owner must be active in its organization';
  end if;
  if new.vendor_id is not null and not exists (
    select 1 from public.vendors where id = new.vendor_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Asset vendor must belong to its organization';
  end if;
  if new.disposed_by_membership_id is not null and not exists (
    select 1 from public.memberships where id = new.disposed_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Asset disposer must belong to its organization';
  end if;
  return new;
end;
$$;

alter table public.procurement_counters enable row level security;
alter table public.vendor_categories enable row level security;
alter table public.vendors enable row level security;
alter table public.vendor_financial_profiles enable row level security;
alter table public.vendor_contacts enable row level security;
alter table public.vendor_category_links enable row level security;
alter table public.vendor_contract_links enable row level security;
alter table public.vendor_notes enable row level security;
alter table public.procurement_purchase_requests enable row level security;
alter table public.procurement_purchase_request_items enable row level security;
alter table public.procurement_vendor_quotations enable row level security;
alter table public.procurement_purchase_orders enable row level security;
alter table public.procurement_purchase_order_items enable row level security;
alter table public.procurement_goods_receipts enable row level security;
alter table public.procurement_goods_receipt_items enable row level security;
alter table public.procurement_vendor_bills enable row level security;
alter table public.vendor_events enable row level security;
alter table public.procurement_events enable row level security;

revoke all on public.procurement_counters, public.vendor_categories, public.vendors,
  public.vendor_financial_profiles, public.vendor_contacts, public.vendor_category_links,
  public.vendor_contract_links, public.vendor_notes, public.procurement_purchase_requests,
  public.procurement_purchase_request_items, public.procurement_vendor_quotations,
  public.procurement_purchase_orders, public.procurement_purchase_order_items,
  public.procurement_goods_receipts, public.procurement_goods_receipt_items,
  public.procurement_vendor_bills, public.vendor_events, public.procurement_events
from public, anon, authenticated;

grant select on public.vendor_categories, public.vendors, public.vendor_contacts,
  public.vendor_category_links, public.vendor_contract_links,
  public.procurement_purchase_requests, public.procurement_purchase_request_items,
  public.procurement_vendor_quotations, public.procurement_purchase_orders,
  public.procurement_purchase_order_items, public.procurement_goods_receipts,
  public.procurement_goods_receipt_items, public.procurement_vendor_bills to authenticated;
grant select on public.vendor_financial_profiles to authenticated;
grant select (id, organization_id, vendor_id, note_type, rating, created_by_membership_id, created_at)
  on public.vendor_notes to authenticated;
grant select (id, organization_id, vendor_id, event_type, actor_membership_id, created_at)
  on public.vendor_events to authenticated;
grant select (id, organization_id, purchase_request_id, purchase_order_id, vendor_bill_id,
  event_type, actor_membership_id, created_at) on public.procurement_events to authenticated;
grant all on public.procurement_counters, public.vendor_categories, public.vendors,
  public.vendor_financial_profiles, public.vendor_contacts, public.vendor_category_links,
  public.vendor_contract_links, public.vendor_notes, public.procurement_purchase_requests,
  public.procurement_purchase_request_items, public.procurement_vendor_quotations,
  public.procurement_purchase_orders, public.procurement_purchase_order_items,
  public.procurement_goods_receipts, public.procurement_goods_receipt_items,
  public.procurement_vendor_bills, public.vendor_events, public.procurement_events to service_role;

create policy vendor_categories_select on public.vendor_categories
for select to authenticated using (private.has_permission(organization_id, 'vendors.workspace.view'));
create policy vendors_select on public.vendors
for select to authenticated using (private.vendor_access_allowed(id, 'vendors.vendor.view'));
create policy vendor_financial_profiles_select on public.vendor_financial_profiles
for select to authenticated using (private.vendor_access_allowed(vendor_id, 'vendors.vendor.view_sensitive'));
create policy vendor_contacts_select on public.vendor_contacts
for select to authenticated using (private.vendor_access_allowed(vendor_id, 'vendors.vendor.view'));
create policy vendor_category_links_select on public.vendor_category_links
for select to authenticated using (private.vendor_access_allowed(vendor_id, 'vendors.vendor.view'));
create policy vendor_contract_links_select on public.vendor_contract_links
for select to authenticated using (private.vendor_access_allowed(vendor_id, 'vendors.vendor.view'));
create policy vendor_notes_select on public.vendor_notes
for select to authenticated using (private.vendor_access_allowed(vendor_id, 'vendors.vendor.note'));
create policy vendor_events_select on public.vendor_events
for select to authenticated using (private.vendor_access_allowed(vendor_id, 'vendors.vendor.view'));
create policy procurement_requests_select on public.procurement_purchase_requests
for select to authenticated using (private.purchase_request_access_allowed(id, 'vendors.purchase_request.view'));
create policy procurement_request_items_select on public.procurement_purchase_request_items
for select to authenticated using (private.purchase_request_access_allowed(purchase_request_id, 'vendors.purchase_request.view'));
create policy procurement_quotations_select on public.procurement_vendor_quotations
for select to authenticated using (private.purchase_request_access_allowed(purchase_request_id, 'vendors.purchase_request.view'));
create policy procurement_orders_select on public.procurement_purchase_orders
for select to authenticated using (private.purchase_order_access_allowed(id, 'vendors.purchase_order.view'));
create policy procurement_order_items_select on public.procurement_purchase_order_items
for select to authenticated using (private.purchase_order_access_allowed(purchase_order_id, 'vendors.purchase_order.view'));
create policy procurement_receipts_select on public.procurement_goods_receipts
for select to authenticated using (private.purchase_order_access_allowed(purchase_order_id, 'vendors.purchase_order.view'));
create policy procurement_receipt_items_select on public.procurement_goods_receipt_items
for select to authenticated using (
  private.purchase_order_access_allowed(
    (select receipt.purchase_order_id from public.procurement_goods_receipts receipt where receipt.id = goods_receipt_id),
    'vendors.purchase_order.view'
  )
);
create policy procurement_bills_select on public.procurement_vendor_bills
for select to authenticated using (private.purchase_order_access_allowed(purchase_order_id, 'vendors.bill.view'));
create policy procurement_events_select on public.procurement_events
for select to authenticated using (
  (purchase_request_id is not null and private.purchase_request_access_allowed(purchase_request_id, 'vendors.purchase_request.view'))
  or (purchase_order_id is not null and private.purchase_order_access_allowed(purchase_order_id, 'vendors.purchase_order.view'))
  or (vendor_bill_id is not null and exists (
    select 1 from public.procurement_vendor_bills bill
    where bill.id = vendor_bill_id
      and private.purchase_order_access_allowed(bill.purchase_order_id, 'vendors.bill.view')
  ))
);

revoke all on function private.validate_vendor_category_tenant() from public, anon, authenticated;
revoke all on function private.validate_vendor_tenant() from public, anon, authenticated;
revoke all on function private.validate_vendor_child_tenant() from public, anon, authenticated;
revoke all on function private.validate_purchase_request_tenant() from public, anon, authenticated;
revoke all on function private.validate_purchase_request_item_tenant() from public, anon, authenticated;
revoke all on function private.validate_vendor_quotation_tenant() from public, anon, authenticated;
revoke all on function private.validate_purchase_order_tenant() from public, anon, authenticated;
revoke all on function private.validate_purchase_order_item_tenant() from public, anon, authenticated;
revoke all on function private.validate_goods_receipt_tenant() from public, anon, authenticated;
revoke all on function private.validate_goods_receipt_item_tenant() from public, anon, authenticated;
revoke all on function private.validate_vendor_bill_tenant() from public, anon, authenticated;
revoke all on function private.validate_vendor_event_tenant() from public, anon, authenticated;
revoke all on function private.validate_procurement_event_tenant() from public, anon, authenticated;
revoke all on function private.prevent_vendor_history_mutation() from public, anon, authenticated;
revoke all on function private.apply_procurement_approval_result() from public, anon, authenticated;
revoke all on function private.vendor_membership_access_allowed(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.purchase_request_membership_access_allowed(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.purchase_order_membership_access_allowed(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.vendor_access_allowed(uuid, text) from public, anon;
revoke all on function private.purchase_request_access_allowed(uuid, text) from public, anon;
revoke all on function private.purchase_order_access_allowed(uuid, text) from public, anon;
grant execute on function private.vendor_membership_access_allowed(uuid, uuid, text) to service_role;
grant execute on function private.purchase_request_membership_access_allowed(uuid, uuid, text) to service_role;
grant execute on function private.purchase_order_membership_access_allowed(uuid, uuid, text) to service_role;
grant execute on function private.vendor_access_allowed(uuid, text) to authenticated, service_role;
grant execute on function private.purchase_request_access_allowed(uuid, text) to authenticated, service_role;
grant execute on function private.purchase_order_access_allowed(uuid, text) to authenticated, service_role;

insert into public.vendor_categories (
  organization_id, name, description, created_by_membership_id
)
select organization.id, seed.name, seed.description,
  (select membership.id from public.memberships membership
   where membership.organization_id = organization.id and membership.status = 'active'
   order by membership.created_at, membership.id limit 1)
from public.organizations organization
cross join (values
  ('Technology', 'Hardware, software, hosting, and technical services.'),
  ('Professional services', 'Consulting, legal, accounting, and specialist services.'),
  ('Marketing and media', 'Advertising, production, media, and campaign suppliers.'),
  ('Facilities', 'Office, utilities, maintenance, and workplace services.'),
  ('Travel and logistics', 'Travel, courier, freight, and transport providers.'),
  ('People and benefits', 'Recruiting, training, benefits, and employee services.'),
  ('Other', 'Vendors that do not fit another category.')
) as seed(name, description)
where exists (
  select 1 from public.memberships membership
  where membership.organization_id = organization.id and membership.status = 'active'
)
on conflict (organization_id, name) do nothing;
