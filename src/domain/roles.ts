// Column roles: what each column of the user's board MEANS to tako.
//
// Every board names its columns differently ("Ready for AI", "Ready", "Todo"...).
// tako never relies on names. The user maps each role to one option of a
// single-select field (usually "Status"), and we store the option ID.
//
// This module is pure: no I/O, only types and rules.

export const ROLES = ["ready", "in_progress", "delivery", "blocked"] as const;
export type Role = (typeof ROLES)[number];

// Without these three the main flow (start -> work -> deliver) cannot run.
// "blocked" is optional: without it, "block" only comments on the issue.
export const REQUIRED_ROLES: readonly Role[] = ["ready", "in_progress", "delivery"];

export function isRequiredRole(role: Role): boolean {
  return REQUIRED_ROLES.includes(role);
}

// Human-readable description, shared by the init wizard and error messages.
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ready: "cards the AI is allowed to pick up",
  in_progress: "work in progress",
  delivery: "delivered, waiting for human review",
  blocked: "missing information",
};

// One option of a single-select field, as read from GitHub.
export interface ColumnOption {
  id: string;
  name: string;
}

// The single-select field whose options are the board columns.
export interface ColumnField {
  id: string;
  name: string;
  options: ColumnOption[];
}

// What is persisted for each role: the option ID is the source of truth,
// the name is kept only to write friendly messages.
export interface RoleBinding {
  optionId: string;
  name: string;
}

export type RoleMapping = Partial<Record<Role, RoleBinding>>;

export type RoleMappingError =
  | { kind: "missing_required"; role: Role }
  | { kind: "unknown_option"; role: Role; optionId: string }
  | { kind: "duplicate_option"; optionId: string; name: string; roles: Role[] };

// Validates a mapping against the field it was built from.
// Returns every problem at once so the UI can show them together.
export function validateRoleMapping(field: ColumnField, mapping: RoleMapping): RoleMappingError[] {
  const errors: RoleMappingError[] = [];
  const optionIds = new Set(field.options.map((o) => o.id));

  for (const role of REQUIRED_ROLES) {
    if (!mapping[role]) errors.push({ kind: "missing_required", role });
  }

  // Group roles by option to detect one column used for two roles.
  // Two roles in one column would leave the card without a clear state.
  const rolesByOption = new Map<string, { name: string; roles: Role[] }>();
  for (const role of ROLES) {
    const binding = mapping[role];
    if (!binding) continue;

    if (!optionIds.has(binding.optionId)) {
      errors.push({ kind: "unknown_option", role, optionId: binding.optionId });
      continue;
    }

    const entry = rolesByOption.get(binding.optionId) ?? { name: binding.name, roles: [] };
    entry.roles.push(role);
    rolesByOption.set(binding.optionId, entry);
  }

  for (const [optionId, { name, roles }] of rolesByOption) {
    if (roles.length > 1) errors.push({ kind: "duplicate_option", optionId, name, roles });
  }

  return errors;
}

// Builds a binding from an option, so callers never copy fields by hand.
export function bindOption(option: ColumnOption): RoleBinding {
  return { optionId: option.id, name: option.name };
}

// The field init suggests first. GitHub creates "Status" on every new
// project, so it is the usual answer, but it is only a suggestion.
export function suggestColumnField(fields: ColumnField[]): ColumnField | undefined {
  return fields.find((f) => f.name.toLowerCase() === "status") ?? fields[0];
}
