import { z } from "zod";

import {
  projectArchiveFilters,
  projectBillingMethods,
  projectGroupOptions,
  projectSortOptions,
  projectMemberRoles,
  projectMilestoneStatuses,
  projectPhaseStatuses,
  projectPriorities,
  projectRecurrenceUnits,
  projectStatuses,
  projectTaskDependencyRelationships,
  projectVisibilities,
} from "@/modules/projects/projects";

function emptyToNull(value: unknown): unknown {
  return value === undefined || (typeof value === "string" && value.trim() === "") ? null : value;
}

const optionalText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable());
const optionalDate = z.preprocess(
  emptyToNull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
    .nullable(),
);
const optionalUuid = z.preprocess(emptyToNull, z.uuid().nullable());

export const projectFiltersSchema = z.object({
  q: z.string().trim().max(120).default(""),
  status: z.preprocess(emptyToNull, z.enum(projectStatuses).nullable()),
  owner: optionalUuid,
  project: optionalUuid,
  archive: z.enum(projectArchiveFilters).default("active"),
  mine: z
    .preprocess((value) => value === "true" || value === "on" || value === true, z.boolean())
    .default(false),
  sort: z.enum(projectSortOptions).default("updated"),
  group: z.enum(projectGroupOptions).default("none"),
});

export const projectCreateSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a project name.").max(180),
    description: optionalText(4_000),
    projectType: z.enum(["client", "internal"]).default("client"),
    companyId: optionalUuid,
    status: z.enum(projectStatuses).default("planned"),
    priority: z.enum(projectPriorities).default("normal"),
    visibility: z.enum(projectVisibilities).default("members"),
    ownerMembershipId: optionalUuid,
    startDate: optionalDate,
    dueDate: optionalDate,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Use a three-letter currency code.")
      .default("USD"),
    billingMethod: z.enum(projectBillingMethods).default("none"),
    budgetAmount: z.preprocess(
      emptyToNull,
      z.coerce.number().min(0).max(90_000_000_000).nullable(),
    ),
    hourlyRate: z.preprocess(emptyToNull, z.coerce.number().min(0).max(90_000_000_000).nullable()),
    fixedPrice: z.preprocess(emptyToNull, z.coerce.number().min(0).max(90_000_000_000).nullable()),
    retainerAmount: z.preprocess(
      emptyToNull,
      z.coerce.number().min(0).max(90_000_000_000).nullable(),
    ),
    estimatedCompletionDate: optionalDate,
  })
  .superRefine((value, context) => {
    if (value.projectType === "client" && !value.companyId) {
      context.addIssue({
        code: "custom",
        path: ["companyId"],
        message: "Choose a CRM company for a client project.",
      });
    }
    if (value.startDate && value.dueDate && value.dueDate < value.startDate) {
      context.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Due date cannot be before the start date.",
      });
    }
    if (value.status === "completed") {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Use the project closure workflow to complete a project.",
      });
    }
    if (
      value.estimatedCompletionDate &&
      value.startDate &&
      value.estimatedCompletionDate < value.startDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["estimatedCompletionDate"],
        message: "Estimated completion cannot be before the start date.",
      });
    }
    if (value.billingMethod === "hourly" && value.hourlyRate === null) {
      context.addIssue({
        code: "custom",
        path: ["hourlyRate"],
        message: "Enter an hourly billing rate.",
      });
    }
    if (value.billingMethod === "fixed" && value.fixedPrice === null) {
      context.addIssue({
        code: "custom",
        path: ["fixedPrice"],
        message: "Enter the fixed project price.",
      });
    }
    if (value.billingMethod === "retainer" && value.retainerAmount === null) {
      context.addIssue({
        code: "custom",
        path: ["retainerAmount"],
        message: "Enter the retainer amount.",
      });
    }
  });

export const projectUpdateSchema = projectCreateSchema.extend({
  projectId: z.uuid(),
});

export const projectMemberAddSchema = z.object({
  projectId: z.uuid(),
  membershipId: z.uuid(),
  role: z.enum(projectMemberRoles).default("member"),
  hourlyCostRate: z.preprocess(
    emptyToNull,
    z.coerce.number().min(0).max(90_000_000_000).nullable(),
  ),
});

export const projectTaskCreateSchema = z
  .object({
    projectId: z.uuid(),
    title: z.string().trim().min(2, "Enter a task title.").max(240),
    description: optionalText(10_000),
    statusId: z.uuid(),
    priority: z.enum(projectPriorities).default("normal"),
    assigneeMembershipId: optionalUuid,
    parentTaskId: optionalUuid,
    phaseId: optionalUuid,
    milestoneId: optionalUuid,
    startDate: optionalDate,
    dueDate: optionalDate,
    reminderAt: z.preprocess(
      emptyToNull,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/, "Choose a reminder date and time.")
        .nullable(),
    ),
    estimatedMinutes: z.preprocess(
      emptyToNull,
      z.coerce.number().int().min(1).max(100_000).nullable(),
    ),
  })
  .superRefine((value, context) => {
    if (value.startDate && value.dueDate && value.dueDate < value.startDate) {
      context.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Due date is before start date.",
      });
    }
  });

export const projectTaskMoveSchema = z.object({
  taskId: z.uuid(),
  statusId: z.uuid(),
});

export const projectCommentCreateSchema = z.object({
  taskId: z.uuid(),
  body: z.string().trim().min(1, "Enter a comment.").max(8_000),
  isInternal: z.preprocess((value) => value === "on" || value === true, z.boolean()).default(true),
});

export const projectTimeCreateSchema = z.object({
  projectId: z.uuid(),
  taskId: optionalUuid,
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minutes: z.coerce.number().int().min(1).max(1_440),
  notes: optionalText(1_000),
  submissionStatus: z.enum(["draft", "submitted"]).default("submitted"),
});

export const projectTaskAssigneeSchema = z.object({
  taskId: z.uuid(),
  membershipId: z.uuid(),
  operation: z.enum(["add", "remove"]).default("add"),
});

export const projectLabelCreateSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1, "Enter a label name.").max(60),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Choose a six-digit hex color."),
});

export const projectTaskLabelSchema = z.object({
  taskId: z.uuid(),
  labelId: z.uuid(),
  operation: z.enum(["add", "remove"]).default("add"),
});

export const projectTaskWatcherSchema = z.object({
  taskId: z.uuid(),
  membershipId: optionalUuid,
  operation: z.enum(["add", "remove"]).default("add"),
});

export const projectChecklistCreateSchema = z.object({
  taskId: z.uuid(),
  label: z.string().trim().min(1, "Enter a checklist item.").max(240),
  isRequired: z.preprocess((value) => value === "on" || value === true, z.boolean()).default(false),
});

export const projectChecklistToggleSchema = z.object({
  checklistItemId: z.uuid(),
  completed: z.preprocess(
    (value) => value === "true" || value === true || value === "on",
    z.boolean(),
  ),
});

export const projectDependencySchema = z
  .object({
    taskId: z.uuid(),
    relatedTaskId: z.uuid(),
    relationship: z.enum(projectTaskDependencyRelationships),
    operation: z.enum(["add", "remove"]).default("add"),
  })
  .superRefine((value, context) => {
    if (value.taskId === value.relatedTaskId) {
      context.addIssue({
        code: "custom",
        path: ["relatedTaskId"],
        message: "A task cannot depend on itself.",
      });
    }
  });

export const projectRecurrenceSchema = z
  .object({
    taskId: z.uuid(),
    intervalUnit: z.enum(projectRecurrenceUnits),
    intervalCount: z.coerce.number().int().min(1).max(365),
    nextRunOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endOn: optionalDate,
    active: z
      .preprocess((value) => value !== "false" && value !== false, z.boolean())
      .default(true),
  })
  .superRefine((value, context) => {
    if (value.endOn && value.endOn < value.nextRunOn) {
      context.addIssue({
        code: "custom",
        path: ["endOn"],
        message: "Recurrence end date cannot be before the next run date.",
      });
    }
  });

export const projectPhaseCreateSchema = z
  .object({
    projectId: z.uuid(),
    name: z.string().trim().min(1, "Enter a phase name.").max(120),
    description: optionalText(1_000),
    status: z.enum(projectPhaseStatuses).default("planned"),
    startDate: optionalDate,
    dueDate: optionalDate,
  })
  .superRefine((value, context) => {
    if (value.startDate && value.dueDate && value.dueDate < value.startDate) {
      context.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Due date cannot be before start date.",
      });
    }
  });

export const projectPhaseStatusSchema = z.object({
  phaseId: z.uuid(),
  status: z.enum(projectPhaseStatuses),
});

export const projectMilestoneCreateSchema = z.object({
  projectId: z.uuid(),
  phaseId: optionalUuid,
  name: z.string().trim().min(1, "Enter a milestone name.").max(160),
  description: optionalText(1_000),
  dueDate: optionalDate,
  status: z.enum(projectMilestoneStatuses).default("open"),
});

export const projectMilestoneStatusSchema = z.object({
  milestoneId: z.uuid(),
  status: z.enum(projectMilestoneStatuses),
});

export const projectClosureItemToggleSchema = z.object({
  closureItemId: z.uuid(),
  completed: z.preprocess(
    (value) => value === "true" || value === true || value === "on",
    z.boolean(),
  ),
});

export const projectClosureRequestSchema = z.object({
  projectId: z.uuid(),
  notes: optionalText(4_000),
});

export const projectClosureCompleteSchema = z.object({
  projectId: z.uuid(),
  notes: z.string().trim().min(2, "Add closure notes before final close.").max(4_000),
});

export const projectBulkTaskUpdateSchema = z
  .object({
    projectId: z.uuid(),
    taskIds: z.array(z.uuid()).min(1).max(200),
    statusId: optionalUuid,
    priority: z.preprocess(emptyToNull, z.enum(projectPriorities).nullable()),
    assigneeMembershipId: optionalUuid,
    dueDate: optionalDate,
  })
  .refine(
    (value) => value.statusId || value.priority || value.assigneeMembershipId || value.dueDate,
    {
      message: "Choose at least one bulk change.",
    },
  );

export const projectSavedFilterSchema = z.object({
  name: z.string().trim().min(1).max(100),
  q: z.string().trim().max(120).default(""),
  status: z.preprocess(emptyToNull, z.enum(projectStatuses).nullable()),
  owner: optionalUuid,
  archive: z.enum(projectArchiveFilters).default("active"),
  mine: z
    .preprocess((value) => value === "true" || value === "on" || value === true, z.boolean())
    .default(false),
  sort: z.enum(projectSortOptions).default("updated"),
  group: z.enum(projectGroupOptions).default("none"),
});

export const projectSavedFilterDeleteSchema = z.object({ filterId: z.uuid() });
export const projectTemplateSaveSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  description: optionalText(1_000),
});
export const projectTemplateCreateSchema = z.object({
  templateId: z.uuid(),
  name: z.string().trim().min(2).max(180),
  companyId: optionalUuid,
  ownerMembershipId: optionalUuid,
  startDate: optionalDate,
  dueDate: optionalDate,
});
export const projectDuplicateSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(2).max(180),
  includeMembers: z
    .preprocess((value) => value === "on" || value === "true" || value === true, z.boolean())
    .default(false),
});

export const projectArchiveSchema = z.object({
  projectId: z.uuid(),
  operation: z.enum(["archive", "restore"]),
});

export interface ProjectActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  projectId?: string;
}

export type ProjectFilters = z.infer<typeof projectFiltersSchema>;
