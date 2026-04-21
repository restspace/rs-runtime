export interface PasswordPolicyConfig {
  minLength?: number;
  requiredNumbers?: number;
  requiredSymbols?: number;
}

export interface PasswordPolicyResult {
  ok: boolean;
  message?: string;
}

export const defaultPasswordPolicy: Required<PasswordPolicyConfig> = {
  minLength: 8,
  requiredNumbers: 0,
  requiredSymbols: 0,
};

function policyNumber(value: unknown, defaultValue: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return defaultValue;
  }
  return Math.floor(value);
}

export function passwordPolicyWithDefaults(
  policy?: PasswordPolicyConfig,
): Required<PasswordPolicyConfig> {
  return {
    minLength: policyNumber(policy?.minLength, defaultPasswordPolicy.minLength),
    requiredNumbers: policyNumber(
      policy?.requiredNumbers,
      defaultPasswordPolicy.requiredNumbers,
    ),
    requiredSymbols: policyNumber(
      policy?.requiredSymbols,
      defaultPasswordPolicy.requiredSymbols,
    ),
  };
}

export function validatePasswordStrength(
  password: unknown,
  policy?: PasswordPolicyConfig,
): PasswordPolicyResult {
  if (typeof password !== "string") {
    return { ok: false, message: "Password is required" };
  }

  const resolved = passwordPolicyWithDefaults(policy);
  if (password.length < resolved.minLength) {
    return {
      ok: false,
      message: `Password must be at least ${resolved.minLength} characters`,
    };
  }

  const numberCount = (password.match(/[0-9]/g) || []).length;
  if (numberCount < resolved.requiredNumbers) {
    return {
      ok: false,
      message:
        `Password must contain at least ${resolved.requiredNumbers} number${
          resolved.requiredNumbers === 1 ? "" : "s"
        }`,
    };
  }

  const symbolCount = (password.match(/[^A-Za-z0-9]/g) || []).length;
  if (symbolCount < resolved.requiredSymbols) {
    return {
      ok: false,
      message:
        `Password must contain at least ${resolved.requiredSymbols} symbol${
          resolved.requiredSymbols === 1 ? "" : "s"
        }`,
    };
  }

  return { ok: true };
}

export const passwordPolicyConfigSchema = {
  type: "object",
  properties: {
    minLength: {
      type: "number",
      description: "Minimum password length (default 8)",
    },
    requiredNumbers: {
      type: "number",
      description: "Minimum number of ASCII digits 0-9 (default 0)",
    },
    requiredSymbols: {
      type: "number",
      description:
        "Minimum number of non-alphanumeric ASCII symbols (default 0)",
    },
  },
};
