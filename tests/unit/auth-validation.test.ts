import { describe, expect, it } from "vitest";

import {
  evaluatePasswordPolicy,
  isPasswordPolicySatisfied,
} from "@/modules/identity/password-policy";
import {
  getSafeNextPath,
  passwordResetRequestSchema,
  passwordResetSchema,
  signInSchema,
  signUpSchema,
} from "@/modules/identity/schemas/auth";

describe("sign-in validation", () => {
  it("normalizes email addresses without changing passwords", () => {
    const result = signInSchema.parse({
      email: "  USER@EXAMPLE.COM  ",
      password: "  keep-spaces  ",
      next: "/projects?view=mine",
    });

    expect(result.email).toBe("user@example.com");
    expect(result.password).toBe("  keep-spaces  ");
  });

  it("requires both a valid email and a non-empty password", () => {
    expect(() => signInSchema.parse({ email: "not-an-email", password: "" })).toThrow();
  });
});

describe("signup validation", () => {
  it("normalizes account-request fields without changing passwords", () => {
    const result = signUpSchema.parse({
      fullName: "  Alex Morgan  ",
      email: "  ALEX@EXAMPLE.COM  ",
      password: "  agencysecure1  ",
      confirmPassword: "  agencysecure1  ",
    });

    expect(result.fullName).toBe("Alex Morgan");
    expect(result.email).toBe("alex@example.com");
    expect(result.password).toBe("  agencysecure1  ");
  });

  it("rejects weak, mismatched, or incomplete account requests", () => {
    expect(() =>
      signUpSchema.parse({
        fullName: "A",
        email: "not-an-email",
        password: "short1",
        confirmPassword: "different1",
      }),
    ).toThrow();
  });
});

describe("live password policy", () => {
  it("reports each password requirement independently", () => {
    expect(evaluatePasswordPolicy("letters-only-password")).toEqual({
      hasLetter: true,
      hasNumber: false,
      hasMinimumLength: true,
      isWithinMaximumLength: true,
    });

    expect(evaluatePasswordPolicy("123456789012")).toEqual({
      hasLetter: false,
      hasNumber: true,
      hasMinimumLength: true,
      isWithinMaximumLength: true,
    });
  });

  it("matches the server-side minimum policy", () => {
    expect(isPasswordPolicySatisfied("agencysecure1")).toBe(true);
    expect(isPasswordPolicySatisfied("short1")).toBe(false);
  });
});

describe("password recovery validation", () => {
  it("normalizes reset-request email addresses", () => {
    const result = passwordResetRequestSchema.parse({
      email: "  USER@EXAMPLE.COM ",
    });

    expect(result.email).toBe("user@example.com");
  });

  it("accepts a matching password with the configured minimum policy", () => {
    const result = passwordResetSchema.parse({
      password: "agencysecure1",
      confirmPassword: "agencysecure1",
    });

    expect(result.password).toBe("agencysecure1");
  });

  it("rejects weak or mismatched passwords", () => {
    expect(() =>
      passwordResetSchema.parse({
        password: "short1",
        confirmPassword: "short1",
      }),
    ).toThrow();

    expect(() =>
      passwordResetSchema.parse({
        password: "agencysecure1",
        confirmPassword: "agencysecure2",
      }),
    ).toThrow();
  });
});

describe("post-authentication redirects", () => {
  it("accepts application-relative paths", () => {
    expect(getSafeNextPath("/projects?view=mine")).toBe("/projects?view=mine");
  });

  it("rejects external, protocol-relative, and auth-loop redirects", () => {
    expect(getSafeNextPath("https://example.com")).toBe("/dashboard");
    expect(getSafeNextPath("//example.com")).toBe("/dashboard");
    expect(getSafeNextPath("/\\example.com")).toBe("/dashboard");
    expect(getSafeNextPath("/login")).toBe("/dashboard");
    expect(getSafeNextPath("/access-denied")).toBe("/dashboard");
    expect(getSafeNextPath("/pending-access")).toBe("/dashboard");
    expect(getSafeNextPath("/signup")).toBe("/dashboard");
  });
});
