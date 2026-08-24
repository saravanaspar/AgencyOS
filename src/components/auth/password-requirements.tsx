"use client";

import { CheckCircle2, Circle, XCircle } from "lucide-react";

import { cn } from "@/lib/cn";
import { evaluatePasswordPolicy, PASSWORD_MIN_LENGTH } from "@/modules/identity/password-policy";

interface PasswordRequirementsProps {
  password: string;
  confirmation?: string;
  showConfirmation?: boolean;
}

interface RequirementProps {
  label: string;
  met: boolean;
  invalid?: boolean;
}

function Requirement({ label, met, invalid = false }: RequirementProps) {
  const Icon = met ? CheckCircle2 : invalid ? XCircle : Circle;

  return (
    <li
      className={cn(
        "password-requirement",
        met && "password-requirement--met",
        invalid && "password-requirement--invalid",
      )}
    >
      <Icon size={15} aria-hidden="true" />
      <span>{label}</span>
      <span className="sr-only">{met ? "Requirement met" : "Requirement not met"}</span>
    </li>
  );
}

export function PasswordRequirements({
  password,
  confirmation = "",
  showConfirmation = false,
}: PasswordRequirementsProps) {
  const result = evaluatePasswordPolicy(password);
  const confirmationStarted = confirmation.length > 0;
  const passwordsMatch = confirmationStarted && password === confirmation;

  return (
    <div className="password-requirements" aria-live="polite">
      <p>Password requirements</p>
      <ul>
        <Requirement
          label={`At least ${PASSWORD_MIN_LENGTH} characters`}
          met={result.hasMinimumLength}
        />
        <Requirement label="Contains at least one letter" met={result.hasLetter} />
        <Requirement label="Contains at least one number" met={result.hasNumber} />
        {showConfirmation ? (
          <Requirement
            label="Passwords match"
            met={passwordsMatch}
            invalid={confirmationStarted && !passwordsMatch}
          />
        ) : null}
      </ul>
    </div>
  );
}
