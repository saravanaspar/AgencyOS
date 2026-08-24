-- Extend the existing private HR document-template platform with additional employment letters.
-- This migration widens only the document-type allowlists; storage, RLS, permissions,
-- audit behavior, template versioning, and private-file lifecycle remain unchanged.

alter table public.hr_document_templates
  drop constraint hr_document_templates_type_valid,
  add constraint hr_document_templates_type_valid check (
    document_type in (
      'offer_letter',
      'appointment_letter',
      'employment_agreement',
      'nda',
      'experience_letter',
      'relieving_letter',
      'promotion_letter',
      'salary_revision_letter',
      'warning_letter',
      'performance_letter'
    )
  );

alter table public.hr_document_template_defaults
  drop constraint hr_document_template_defaults_type_valid,
  drop constraint hr_document_template_defaults_builtin_valid,
  add constraint hr_document_template_defaults_type_valid check (
    document_type in (
      'offer_letter',
      'appointment_letter',
      'employment_agreement',
      'nda',
      'experience_letter',
      'relieving_letter',
      'promotion_letter',
      'salary_revision_letter',
      'warning_letter',
      'performance_letter'
    )
  ),
  add constraint hr_document_template_defaults_builtin_valid check (
    builtin_key is null
    or builtin_key in (
      'offer_letter',
      'appointment_letter',
      'employment_agreement',
      'nda',
      'experience_letter',
      'relieving_letter',
      'promotion_letter',
      'salary_revision_letter',
      'warning_letter',
      'performance_letter'
    )
  );

alter table public.hr_employee_documents
  drop constraint hr_employee_documents_type_valid,
  add constraint hr_employee_documents_type_valid check (
    document_type in (
      'offer_letter',
      'appointment_letter',
      'employment_agreement',
      'nda',
      'experience_letter',
      'relieving_letter',
      'promotion_letter',
      'salary_revision_letter',
      'warning_letter',
      'performance_letter'
    )
  );

comment on table public.hr_employee_documents is
  'Immutable scanner-gated private HR document versions, including employment, separation, promotion, compensation, warning, and performance letters.';
