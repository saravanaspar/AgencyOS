"use server";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  formText as text,
  HrActionError,
  isUniqueViolation,
  stateError,
} from "@/modules/hr/actions/action-utils";
import { hrPermissionKeys } from "@/modules/hr/hr";
import { synchronizeHrOnboardingEvidence } from "@/modules/hr/server/onboarding";
import {
  designationCreateSchema,
  designationStatusSchema,
  designationUpdateSchema,
  employeeProfileSchema,
  ownEmployeeProfileSchema,
  type HrActionState,
} from "@/modules/hr/schemas/hr";
import { getMemberStructureAssignmentError } from "@/modules/organization-structure/server/member-structure-validation";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

function employeeInput(formData: FormData) {
  return {
    membershipId: text(formData, "membershipId"),
    employeeNumber: text(formData, "employeeNumber"),
    designationId: text(formData, "designationId"),
    departmentId: text(formData, "departmentId"),
    managerMembershipId: text(formData, "managerMembershipId"),
    legalName: text(formData, "legalName"),
    preferredName: text(formData, "preferredName"),
    personalEmail: text(formData, "personalEmail"),
    personalPhone: text(formData, "personalPhone"),
    dateOfBirth: text(formData, "dateOfBirth"),
    nationality: text(formData, "nationality"),
    joiningDate: text(formData, "joiningDate"),
    employmentType: text(formData, "employmentType"),
    workLocation: text(formData, "workLocation"),
    workMode: text(formData, "workMode"),
    lifecycleStatus: text(formData, "lifecycleStatus"),
    weeklyHours: text(formData, "weeklyHours"),
  };
}

export async function saveEmployeeProfileAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = employeeProfileSchema.safeParse(employeeInput(formData));
  if (!parsed.success) {
    return stateError(
      "Check the employee fields and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }

  const authorization = await authorizeCurrentUser([hrPermissionKeys.workspace]);
  if (!authorization.allowed) return stateError("Your HR access is no longer active.");

  const { context } = authorization;
  const canCreate = context.permissions.has(hrPermissionKeys.employeeCreate);
  const canUpdate = context.permissions.has(hrPermissionKeys.employeeUpdate);
  if (!canCreate && !canUpdate)
    return stateError("You do not have permission to manage employee records.");

  const organizationId = context.membership.organizationId;
  const actorMembershipId = context.membership.id;
  const actorUserId = context.user.id;
  const updateScope = context.permissionScopes.get(hrPermissionKeys.employeeUpdate) ?? "own";
  const createScope = context.permissionScopes.get(hrPermissionKeys.employeeCreate) ?? "own";
  const database = getDatabaseClient();

  try {
    const result = await database.begin(async (sql) => {
      const targets = await sql<
        Array<{ id: string; profile_id: string | null; designation_id: string | null }>
      >`
        select membership.id, employee.id as profile_id, employee.designation_id
        from public.memberships as membership
        left join public.hr_employee_profiles as employee
          on employee.membership_id = membership.id
         and employee.organization_id = membership.organization_id
        where membership.id = ${parsed.data.membershipId}::uuid
          and membership.organization_id = ${organizationId}::uuid
          and (
            (
              employee.id is null
              and ${canCreate}
              and private.crm_scope_allows_membership(
                ${actorMembershipId}::uuid,
                ${createScope},
                membership.id,
                membership.id
              )
            )
            or (
              employee.id is not null
              and ${canUpdate}
              and private.crm_scope_allows_membership(
                ${actorMembershipId}::uuid,
                ${updateScope},
                membership.id,
                membership.id
              )
            )
          )
        limit 1
        for update of membership
      `;
      const target = targets[0];
      if (!target) throw new HrActionError("The employee is outside your permitted scope.");
      if (target.profile_id && !canUpdate)
        throw new HrActionError("You cannot update this employee record.");
      if (!target.profile_id && !canCreate)
        throw new HrActionError("You cannot create this employee record.");
      const assignmentError = await getMemberStructureAssignmentError(sql, {
        organizationId,
        membershipId: parsed.data.membershipId,
        departmentId: parsed.data.departmentId,
        managerMembershipId: parsed.data.managerMembershipId,
      });
      if (assignmentError) throw new HrActionError(assignmentError);

      if (parsed.data.designationId && parsed.data.designationId !== target.designation_id) {
        const designations = await sql<{ id: string }[]>`
          select id from public.hr_designations
          where id = ${parsed.data.designationId}::uuid
            and organization_id = ${organizationId}::uuid
            and status = 'active'
        `;
        if (!designations[0]) {
          throw new HrActionError("Choose an active designation in this organization.");
        }
      }

      await sql`
        update public.memberships
        set employee_number = ${parsed.data.employeeNumber},
            department_id = ${parsed.data.departmentId}::uuid,
            manager_membership_id = ${parsed.data.managerMembershipId}::uuid,
            employment_status = ${parsed.data.lifecycleStatus}
        where id = ${parsed.data.membershipId}::uuid
          and organization_id = ${organizationId}::uuid
      `;

      await sql`
        insert into public.hr_employee_profiles (
          organization_id, membership_id, designation_id, legal_name, preferred_name,
          personal_email, personal_phone, date_of_birth, nationality, joining_date,
          employment_type, work_location, work_mode, lifecycle_status, weekly_hours,
          created_by_membership_id, updated_by_membership_id, created_by, updated_by
        ) values (
          ${organizationId}::uuid, ${parsed.data.membershipId}::uuid,
          ${parsed.data.designationId}::uuid, ${parsed.data.legalName}, ${parsed.data.preferredName},
          ${parsed.data.personalEmail}, ${parsed.data.personalPhone}, ${parsed.data.dateOfBirth}::date,
          ${parsed.data.nationality}, ${parsed.data.joiningDate}::date, ${parsed.data.employmentType},
          ${parsed.data.workLocation}, ${parsed.data.workMode}, ${parsed.data.lifecycleStatus},
          ${parsed.data.weeklyHours}, ${actorMembershipId}::uuid, ${actorMembershipId}::uuid,
          ${actorUserId}::uuid, ${actorUserId}::uuid
        )
        on conflict (organization_id, membership_id) do update set
          designation_id = excluded.designation_id,
          legal_name = excluded.legal_name,
          preferred_name = excluded.preferred_name,
          personal_email = excluded.personal_email,
          personal_phone = excluded.personal_phone,
          date_of_birth = excluded.date_of_birth,
          nationality = excluded.nationality,
          joining_date = excluded.joining_date,
          employment_type = excluded.employment_type,
          work_location = excluded.work_location,
          work_mode = excluded.work_mode,
          lifecycle_status = excluded.lifecycle_status,
          weekly_hours = excluded.weekly_hours,
          updated_by_membership_id = excluded.updated_by_membership_id,
          updated_by = excluded.updated_by
      `;

      await synchronizeHrOnboardingEvidence(sql, {
        organizationId,
        membershipId: parsed.data.membershipId,
        actorMembershipId,
      });

      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id, source, metadata
        ) values (
          ${organizationId}::uuid, ${actorUserId}::uuid,
          ${target.profile_id ? "hr.employee_updated" : "hr.employee_created"},
          'hr_employee', ${parsed.data.membershipId}, 'web',
          ${sql.json({ actorMembershipId, targetMembershipId: parsed.data.membershipId })}
        )
      `;

      return target.profile_id ? "updated" : "created";
    });

    revalidatePath("/hr");
    return { status: "success", message: `Employee record ${result}.` };
  } catch (error) {
    if (isUniqueViolation(error))
      return stateError("Employee number already exists in this organization.");
    return stateError(
      error instanceof HrActionError ? error.message : "The employee record could not be saved.",
    );
  }
}

export async function updateOwnEmployeeProfileAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = ownEmployeeProfileSchema.safeParse({
    membershipId: text(formData, "membershipId"),
    preferredName: text(formData, "preferredName"),
    personalEmail: text(formData, "personalEmail"),
    personalPhone: text(formData, "personalPhone"),
  });
  if (!parsed.success)
    return stateError(
      "Check your contact details and try again.",
      parsed.error.flatten().fieldErrors,
    );

  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.employeeView,
    hrPermissionKeys.employeeUpdateSelf,
  ]);
  if (!authorization.allowed)
    return stateError("Your employee self-service access is no longer active.");
  if (parsed.data.membershipId !== authorization.context.membership.id) {
    return stateError("You can update only your own employee profile.");
  }

  const { context } = authorization;
  const database = getDatabaseClient();
  try {
    await database.begin(async (sql) => {
      await sql`
        insert into public.hr_employee_profiles (
          organization_id, membership_id, preferred_name, personal_email, personal_phone,
          created_by_membership_id, updated_by_membership_id, created_by, updated_by
        ) values (
          ${context.membership.organizationId}::uuid, ${context.membership.id}::uuid,
          ${parsed.data.preferredName}, ${parsed.data.personalEmail}, ${parsed.data.personalPhone},
          ${context.membership.id}::uuid, ${context.membership.id}::uuid,
          ${context.user.id}::uuid, ${context.user.id}::uuid
        )
        on conflict (organization_id, membership_id) do update set
          preferred_name = excluded.preferred_name,
          personal_email = excluded.personal_email,
          personal_phone = excluded.personal_phone,
          updated_by_membership_id = excluded.updated_by_membership_id,
          updated_by = excluded.updated_by
      `;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id, source, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'hr.employee_self_updated', 'hr_employee', ${context.membership.id}, 'web',
          ${sql.json({ actorMembershipId: context.membership.id })}
        )
      `;
    });
    revalidatePath("/hr");
    return { status: "success", message: "Your employee contact details were updated." };
  } catch {
    return stateError("Your employee profile could not be updated.");
  }
}

export async function createDesignationAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = designationCreateSchema.safeParse({
    name: text(formData, "name"),
    code: text(formData, "code"),
    description: text(formData, "description"),
  });
  if (!parsed.success)
    return stateError(
      "Check the designation fields and try again.",
      parsed.error.flatten().fieldErrors,
    );

  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.designationManage,
  ]);
  if (!authorization.allowed)
    return stateError("You do not have permission to manage designations.");

  const { context } = authorization;
  try {
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
        insert into public.hr_designations (
          organization_id, name, code, description, created_by_membership_id, created_by
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.name}, ${parsed.data.code},
          ${parsed.data.description}, ${context.membership.id}::uuid, ${context.user.id}::uuid
        )
        returning id
      `;
      const designation = rows[0];
      if (!designation) throw new HrActionError("The designation could not be created.");
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id, source, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'hr.designation_created', 'hr_designation', ${designation.id}, 'web',
          ${sql.json({ actorMembershipId: context.membership.id, code: parsed.data.code })}
        )
      `;
    });
    revalidatePath("/hr");
    return { status: "success", message: "Designation created." };
  } catch (error) {
    return stateError(
      isUniqueViolation(error)
        ? "A designation with this name or code already exists."
        : error instanceof HrActionError
          ? error.message
          : "The designation could not be created.",
    );
  }
}

export async function updateDesignationAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = designationUpdateSchema.safeParse({
    designationId: text(formData, "designationId"),
    name: text(formData, "name"),
    code: text(formData, "code"),
    description: text(formData, "description"),
  });
  if (!parsed.success)
    return stateError(
      "Check the designation fields and try again.",
      parsed.error.flatten().fieldErrors,
    );

  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.designationManage,
  ]);
  if (!authorization.allowed)
    return stateError("You do not have permission to manage designations.");

  const { context } = authorization;
  try {
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
        update public.hr_designations set
          name = ${parsed.data.name},
          code = ${parsed.data.code},
          description = ${parsed.data.description}
        where id = ${parsed.data.designationId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        returning id
      `;
      if (!rows[0]) throw new HrActionError("The designation is unavailable.");
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id, source, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'hr.designation_updated', 'hr_designation', ${parsed.data.designationId}, 'web',
          ${sql.json({ actorMembershipId: context.membership.id, code: parsed.data.code })}
        )
      `;
    });
    revalidatePath("/hr");
    return { status: "success", message: "Designation updated." };
  } catch (error) {
    return stateError(
      isUniqueViolation(error)
        ? "A designation with this name or code already exists."
        : error instanceof HrActionError
          ? error.message
          : "The designation could not be updated.",
    );
  }
}

export async function changeDesignationStatusAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = designationStatusSchema.safeParse({
    designationId: text(formData, "designationId"),
    status: text(formData, "status"),
  });
  if (!parsed.success) return stateError("Choose a valid designation state.");

  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.designationManage,
  ]);
  if (!authorization.allowed)
    return stateError("You do not have permission to manage designations.");

  const { context } = authorization;
  try {
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
        update public.hr_designations set status = ${parsed.data.status}
        where id = ${parsed.data.designationId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        returning id
      `;
      if (!rows[0]) throw new HrActionError("The designation is unavailable.");
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id, source, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'hr.designation_status_changed', 'hr_designation', ${parsed.data.designationId}, 'web',
          ${sql.json({ actorMembershipId: context.membership.id, status: parsed.data.status })}
        )
      `;
    });
    revalidatePath("/hr");
    return {
      status: "success",
      message: `Designation ${parsed.data.status === "active" ? "activated" : "deactivated"}.`,
    };
  } catch (error) {
    return stateError(
      error instanceof HrActionError
        ? error.message
        : "The designation state could not be changed.",
    );
  }
}
