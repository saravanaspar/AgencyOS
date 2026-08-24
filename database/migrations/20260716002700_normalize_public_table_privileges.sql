set lock_timeout = '10s';
set statement_timeout = '60s';

-- Supabase projects can carry default table ACLs that grant every table privilege
-- to API roles. AgencyOS relies on explicit least-privilege grants plus RLS, so
-- normalize both existing tables and future tables created by the migration role.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;

revoke all privileges on all tables in schema public from anon, authenticated;

-- Restore only the application privileges declared by the AgencyOS migrations.
grant select, update on public.profiles to authenticated;
grant select, update on public.organizations to authenticated;
grant select, insert, update, delete on public.departments to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, update, delete on public.team_members to authenticated;
grant select on public.permissions to authenticated;
grant select on public.role_templates to authenticated;
grant select, insert, update, delete on public.roles to authenticated;
grant select, insert, update, delete on public.role_permissions to authenticated;
grant select on public.role_template_permissions to authenticated;
grant select, insert, delete on public.membership_roles to authenticated;
grant select, insert, update, delete on public.membership_permission_overrides to authenticated;
grant select, insert, update, delete on public.organization_invitations to authenticated;
grant select, insert, update on public.user_preferences to authenticated;
grant select on public.audit_events to authenticated;
grant select, insert, update, delete on public.crm_pipeline_stages to authenticated;
grant select, insert, update on public.crm_companies to authenticated;
grant select, insert, update on public.crm_contacts to authenticated;
grant select, insert, update, delete on public.crm_leads to authenticated;
grant select, insert on public.crm_activities to authenticated;
grant select (id, organization_id, provider, name, mode, status, account_reference, configuration, last_sync_at, last_success_at, last_error, created_by_membership_id, created_by, created_at, updated_at) on public.crm_import_connections to authenticated;
grant select on public.crm_import_runs to authenticated;
grant select on public.crm_import_errors to authenticated;
grant select on public.crm_external_records to authenticated;
grant select on public.crm_webhook_deliveries to authenticated;
grant select, insert, update on public.projects to authenticated;
grant select, insert, update, delete on public.project_members to authenticated;
grant select, insert, update on public.project_task_statuses to authenticated;
grant select, insert, update on public.project_tasks to authenticated;
grant select, insert, delete on public.project_task_assignees to authenticated;
grant select, insert, update on public.project_task_comments to authenticated;
grant select, insert, delete on public.project_task_dependencies to authenticated;
grant select, insert, update on public.project_time_entries to authenticated;
grant select, insert, update, delete on public.project_phases to authenticated;
grant select, insert, update, delete on public.project_milestones to authenticated;
grant select, insert, delete on public.project_labels to authenticated;
grant select, insert, delete on public.project_task_labels to authenticated;
grant select, insert, delete on public.project_task_watchers to authenticated;
grant select, insert, update, delete on public.project_task_checklist_items to authenticated;
grant select on public.project_task_attachments to authenticated;
grant select, insert, update, delete on public.project_task_recurrences to authenticated;
grant select, insert, update on public.project_closure_items to authenticated;
grant select on public.crm_connection_notifications to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at, archived_at) on public.notifications to authenticated;
grant select on public.notification_deliveries to authenticated;
grant select on public.approval_definitions to authenticated;
grant select on public.approval_definition_steps to authenticated;
grant select on public.approval_requests to authenticated;
grant select on public.approval_request_steps to authenticated;
grant select on public.approval_actions to authenticated;
grant select on public.approval_delegations to authenticated;
grant select, insert, update on public.automation_definitions to authenticated;
grant select, insert, update on public.vaultwarden_item_links to authenticated;
grant select, insert, update on public.finance_catalog_items to authenticated;
grant select, insert, update on public.finance_estimates to authenticated;
grant select, insert, update, delete on public.finance_estimate_lines to authenticated;
grant select, insert on public.finance_estimate_versions to authenticated;
grant select, insert, update on public.finance_invoices to authenticated;
grant select, insert, update, delete on public.finance_invoice_lines to authenticated;
grant select, insert on public.finance_invoice_events to authenticated;
grant select, insert, update on public.finance_payments to authenticated;
grant select, insert, update, delete on public.finance_payment_allocations to authenticated;
grant select on public.finance_document_snapshots to authenticated;
grant select on public.finance_email_deliveries to authenticated;
grant select, insert, update on public.finance_credit_notes to authenticated;
grant select, insert, update, delete on public.finance_credit_note_lines to authenticated;
grant select on public.finance_credit_note_events to authenticated;
grant select, insert, delete on public.finance_invoice_attachments to authenticated;
grant select, insert on public.finance_payment_refunds to authenticated;
