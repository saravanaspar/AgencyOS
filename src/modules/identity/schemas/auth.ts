import { z } from "zod";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/modules/identity/password-policy";

export interface SignInActionState {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: {
    email?: string[];
    password?: string[];
  };
}

export interface SignUpActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: {
    fullName?: string[];
    email?: string[];
    password?: string[];
    confirmPassword?: string[];
  };
}

export interface PasswordResetRequestActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: {
    email?: string[];
  };
}

export interface PasswordResetActionState {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: {
    password?: string[];
    confirmPassword?: string[];
  };
}

const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, "Password is too long.")
  .regex(/[A-Za-z]/, "Include at least one letter.")
  .regex(/\d/, "Include at least one number.");

export const signInSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, "Enter your password.")
    .max(PASSWORD_MAX_LENGTH, "Password is too long."),
  next: z.string().max(2048).optional(),
});

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter your full name.").max(120, "Full name is too long."),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .superRefine((value, context) => {
    if (value.password !== value.confirmPassword) {
      context.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Passwords do not match.",
      });
    }
  });

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});

export const passwordResetSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .superRefine((value, context) => {
    if (value.password !== value.confirmPassword) {
      context.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Passwords do not match.",
      });
    }
  });

const safeNextPathSchema = z
  .string()
  .max(2048)
  .refine((value) => value.startsWith("/"), "Redirect path must be relative.")
  .refine((value) => !value.startsWith("//"), "Protocol-relative redirects are not allowed.")
  .refine((value) => !value.includes("\\"), "Backslashes are not allowed in redirect paths.")
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Control characters are not allowed.");

const publicAuthPaths = new Set([
  "/access-denied",
  "/forgot-password",
  "/login",
  "/pending-access",
  "/reset-password",
  "/signup",
]);

export function getSafeNextPath(value: unknown): string {
  const result = safeNextPathSchema.safeParse(value);

  if (!result.success) {
    return "/dashboard";
  }

  const pathname = result.data.split("?", 1)[0];
  return publicAuthPaths.has(pathname) ? "/dashboard" : result.data;
}
