export const hrPermissionKeys = {
  workspace: "hr.workspace.view",
  employeeView: "hr.employee.view",
  employeeCreate: "hr.employee.create",
  employeeUpdate: "hr.employee.update",
  employeeUpdateSelf: "hr.employee.update_self",
  designationView: "hr.designation.view",
  designationManage: "hr.designation.manage",
  attendanceView: "hr.attendance.view",
  attendanceCheck: "hr.attendance.check",
  attendanceManage: "hr.attendance.manage",
  attendanceCorrectionCreate: "hr.attendance_correction.create",
  leaveTypeView: "hr.leave_type.view",
  leaveTypeManage: "hr.leave_type.manage",
  leaveBalanceView: "hr.leave_balance.view",
  leaveBalanceAdjust: "hr.leave_balance.adjust",
  leaveRequestView: "hr.leave_request.view",
  leaveRequestCreate: "hr.leave_request.create",
  leaveRequestCancel: "hr.leave_request.cancel",
  salaryView: "hr.salary.view",
  salaryManage: "hr.salary.manage",
  salarySlipView: "hr.salary_slip.view",
  salarySlipManage: "hr.salary_slip.manage",
  salarySlipAcknowledge: "hr.salary_slip.acknowledge",
  documentTemplateView: "hr.document_template.view",
  documentTemplateManage: "hr.document_template.manage",
  employeeDocumentView: "hr.employee_document.view",
  employeeDocumentManage: "hr.employee_document.manage",
  employeeDocumentAcknowledge: "hr.employee_document.acknowledge",
  supportingDocumentView: "hr.employee_supporting_document.view",
  supportingDocumentManage: "hr.employee_supporting_document.manage",
  supportingDocumentUploadOwn: "hr.employee_supporting_document.upload_own",
  onboardingView: "hr.onboarding.view",
  onboardingManage: "hr.onboarding.manage",
  onboardingUpdateOwn: "hr.onboarding.update_own",
  offboardingView: "hr.offboarding.view",
  offboardingManage: "hr.offboarding.manage",
  offboardingCreateOwn: "hr.offboarding.create_own",
} as const;

export const employeeLifecycleStatuses = [
  "preboarding",
  "active",
  "probation",
  "confirmed",
  "notice_period",
  "exited",
  "archived",
] as const;

export const employmentTypes = [
  "full_time",
  "part_time",
  "contract",
  "intern",
  "temporary",
] as const;

export const workModes = ["office", "remote", "hybrid", "field"] as const;

export type EmployeeLifecycleStatus = (typeof employeeLifecycleStatuses)[number];
export type EmploymentType = (typeof employmentTypes)[number];
export type WorkMode = (typeof workModes)[number];

export function humanizeHrValue(value: string | null): string {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
