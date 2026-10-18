// The .tako.json config: shape, parsing and drift detection.
//
// The file identifies the user's project (IDs, titles), so it stays on the
// machine: init adds it to .gitignore and it must never be committed.
// IDs are the source of truth; names are kept only for messages
// ("column 'Pronto para IA' was removed").
//
// Parsing is hand-written instead of using a schema library: the shape is
// small, and this keeps the dependency list short. If the config grows,
// switching to a schema library is a local change in this file.

import {
  ROLES,
  REQUIRED_ROLES,
  validateRoleMapping,
  type ColumnField,
  type Role,
  type RoleBinding,
  type RoleMapping,
  type RoleMappingError,
} from "./roles.js";

export const CONFIG_FILE = ".tako.json";
export const CONFIG_VERSION = 1;
export const DEFAULT_RULES_FILE = ".tako/rules.md";

// Returns the .gitignore content with CONFIG_FILE added, or undefined when it
// is already listed. Keeps the file's line endings.
// ponytail: exact entries only; a wildcard that happens to match is not detected.
export function ignoreConfigFile(gitignore: string | undefined): string | undefined {
  const current = gitignore ?? "";
  const lines = current.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(CONFIG_FILE) || lines.includes(`/${CONFIG_FILE}`)) return undefined;

  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const separator = current === "" || current.endsWith("\n") ? "" : eol;
  return `${current}${separator}${CONFIG_FILE}${eol}`;
}

export type OwnerType = "user" | "organization";

export interface ProjectRef {
  id: string;
  number: number;
  title: string;
  owner: string;
  ownerType: OwnerType;
}

export interface TakoConfig {
  version: typeof CONFIG_VERSION;
  project: ProjectRef;
  columnField: { id: string; name: string };
  roles: RoleMapping;
  agent: { default: string };
  baseBranch: string;
  rulesFile: string;
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; errors: E[] };

// ---------------------------------------------------------------------------
// Creating a config (used by init)
// ---------------------------------------------------------------------------

export interface ConfigInput {
  project: ProjectRef;
  field: ColumnField;
  roles: RoleMapping;
  agentId: string;
  baseBranch: string;
  rulesFile?: string;
}

// Builds a config only if the role mapping is valid for the chosen field.
export function createConfig(input: ConfigInput): Result<TakoConfig, RoleMappingError> {
  const errors = validateRoleMapping(input.field, input.roles);
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      version: CONFIG_VERSION,
      project: input.project,
      columnField: { id: input.field.id, name: input.field.name },
      roles: input.roles,
      agent: { default: input.agentId },
      baseBranch: input.baseBranch,
      rulesFile: input.rulesFile ?? DEFAULT_RULES_FILE,
    },
  };
}

// ---------------------------------------------------------------------------
// Parsing the file (used every time the CLI opens)
// ---------------------------------------------------------------------------

// Errors carry the JSON path so the message points to the exact key.
export interface ConfigParseError {
  path: string;
  message: string;
}

export function parseConfig(raw: unknown): Result<TakoConfig, ConfigParseError> {
  const errors: ConfigParseError[] = [];
  const fail = (path: string, message: string) => errors.push({ path, message });

  if (!isObject(raw)) return { ok: false, errors: [{ path: "$", message: "must be a JSON object" }] };

  if (raw.version !== CONFIG_VERSION) {
    fail("version", `unsupported version ${JSON.stringify(raw.version)}, expected ${CONFIG_VERSION}`);
  }

  const project = raw.project;
  if (!isObject(project)) {
    fail("project", "must be an object");
  } else {
    requireString(project, "id", "project", fail);
    requireString(project, "title", "project", fail);
    requireString(project, "owner", "project", fail);
    if (typeof project.number !== "number") fail("project.number", "must be a number");
    if (project.ownerType !== "user" && project.ownerType !== "organization") {
      fail("project.ownerType", 'must be "user" or "organization"');
    }
  }

  const columnField = raw.columnField;
  if (!isObject(columnField)) {
    fail("columnField", "must be an object");
  } else {
    requireString(columnField, "id", "columnField", fail);
    requireString(columnField, "name", "columnField", fail);
  }

  const roles = raw.roles;
  if (!isObject(roles)) {
    fail("roles", "must be an object");
  } else {
    for (const role of ROLES) {
      const binding = roles[role];
      // Optional roles may be absent or null.
      if (binding === undefined || binding === null) {
        if (REQUIRED_ROLES.includes(role)) fail(`roles.${role}`, "is required");
        continue;
      }
      if (!isObject(binding)) {
        fail(`roles.${role}`, "must be an object");
        continue;
      }
      requireString(binding, "optionId", `roles.${role}`, fail);
      requireString(binding, "name", `roles.${role}`, fail);
    }
  }

  const agent = raw.agent;
  if (!isObject(agent)) fail("agent", "must be an object");
  else requireString(agent, "default", "agent", fail);

  requireString(raw, "baseBranch", "", fail);
  requireString(raw, "rulesFile", "", fail);

  if (errors.length > 0) return { ok: false, errors };

  // Safe after the checks above; normalize optional roles (null -> absent).
  const config = raw as unknown as TakoConfig;
  const normalizedRoles: RoleMapping = {};
  for (const role of ROLES) {
    const binding = config.roles[role];
    if (binding) normalizedRoles[role] = { optionId: binding.optionId, name: binding.name };
  }
  return { ok: true, value: { ...config, roles: normalizedRoles } };
}

// ---------------------------------------------------------------------------
// Drift: the board changed after init (column renamed or removed)
// ---------------------------------------------------------------------------

export type ConfigDrift =
  | { kind: "field_missing"; fieldName: string }
  | { kind: "role_option_missing"; role: Role; binding: RoleBinding };

// A renamed column keeps its option ID, so renaming alone is NOT drift:
// only a removed option (or a removed field) breaks the config.
// The caller opens the board read-only when this returns anything.
export function detectConfigDrift(config: TakoConfig, fields: ColumnField[]): ConfigDrift[] {
  const field = fields.find((f) => f.id === config.columnField.id);
  if (!field) return [{ kind: "field_missing", fieldName: config.columnField.name }];

  const optionIds = new Set(field.options.map((o) => o.id));
  const drift: ConfigDrift[] = [];
  for (const role of ROLES) {
    const binding = config.roles[role];
    if (binding && !optionIds.has(binding.optionId)) {
      drift.push({ kind: "role_option_missing", role, binding });
    }
  }
  return drift;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  parent: string,
  fail: (path: string, message: string) => void,
): void {
  const value = obj[key];
  if (typeof value !== "string" || value.trim() === "") {
    fail(parent ? `${parent}.${key}` : key, "must be a non-empty string");
  }
}
