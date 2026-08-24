export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 1024;

export interface PasswordPolicyResult {
  hasLetter: boolean;
  hasNumber: boolean;
  hasMinimumLength: boolean;
  isWithinMaximumLength: boolean;
}

export function evaluatePasswordPolicy(password: string): PasswordPolicyResult {
  return {
    hasLetter: /[A-Za-z]/.test(password),
    hasNumber: /\d/.test(password),
    hasMinimumLength: password.length >= PASSWORD_MIN_LENGTH,
    isWithinMaximumLength: password.length <= PASSWORD_MAX_LENGTH,
  };
}

export function isPasswordPolicySatisfied(password: string): boolean {
  const result = evaluatePasswordPolicy(password);

  return (
    result.hasLetter && result.hasNumber && result.hasMinimumLength && result.isWithinMaximumLength
  );
}
