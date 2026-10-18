// The tako config: every GitHub Project the user added, and the last one
// opened. Shape, parsing, choosing a project and drift detection.
//
// The file lives in the user's config directory, never inside a repository:
// it identifies the user's projects (IDs, titles) and must not be committed.
// IDs are the source of truth; names are kept only for messages
// ("column 'Ready for AI' was removed").
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

export const CONFIG_FILE = "config.json"; // inside the tako config directory
export const CONFIG_VERSION = 1;

export type OwnerType = "user" | "organization";

export interface ProjectRef {
  id: string;
  number: number;
  title: string;
  owner: string;
  ownerType: OwnerType;
}

// How tako reads one project: which field holds the columns and what each
// column means.
export interface ProjectConfig {
  project: ProjectRef;
  columnField: { id: string; name: string };
  roles: RoleMapping;
  agent: { default: string };
  baseBranch: string;
}

export interface TakoConfig {
  version: typeof CONFIG_VERSION;
  lastProjectId?: string; // opened by default
  projects: ProjectConfig[];
  // Where each repository is cloned on this computer, by "owner/name"
  // (lowercase). Per repository, not per project: a project can hold
  // issues from several repositories.
  repos?: Record<string, string>;
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; errors: E[] };

// ---------------------------------------------------------------------------
// Adding and choosing projects
// ---------------------------------------------------------------------------

export interface ProjectInput {
  project: ProjectRef;
  field: ColumnField;
  roles: RoleMapping;
  agentId: string;
  baseBranch: string;
}

// Builds a project config only if the role mapping is valid for the field.
export function createProjectConfig(input: ProjectInput): Result<ProjectConfig, RoleMappingError> {
  const errors = validateRoleMapping(input.field, input.roles);
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      project: input.project,
      columnField: { id: input.field.id, name: input.field.name },
      roles: input.roles,
      agent: { default: input.agentId },
      baseBranch: input.baseBranch,
    },
  };
}

// Adds a project, or replaces it when it was already added (same ID, same
// position), and makes it the one opened next.
export function addProject(config: TakoConfig | undefined, project: ProjectConfig): TakoConfig {
  const projects = config?.projects ?? [];
  const index = projects.findIndex((p) => p.project.id === project.project.id);
  const next = index === -1 ? [...projects, project] : projects.map((p, i) => (i === index ? project : p));
  return { ...config, version: CONFIG_VERSION, lastProjectId: project.project.id, projects: next };
}

// Remembers where a repository is cloned, replacing an older path.
export function rememberRepo(config: TakoConfig, repo: string, path: string): TakoConfig {
  return { ...config, repos: { ...config.repos, [repo.toLowerCase()]: path } };
}

export function repoPath(config: TakoConfig, repo: string): string | undefined {
  return config.repos?.[repo.toLowerCase()];
}

// The project to open: the requested one, else the last opened, else the
// first. Undefined when there are no projects or the requested one is unknown.
export function chooseProject(config: TakoConfig, projectId?: string): ProjectConfig | undefined {
  const find = (id: string | undefined) => config.projects.find((p) => p.project.id === id);
  if (projectId !== undefined) return find(projectId);
  return find(config.lastProjectId) ?? config.projects[0];
}

// ---------------------------------------------------------------------------
// Parsing the file (used every time the CLI opens)
// ---------------------------------------------------------------------------

// Errors carry the JSON path so the message points to the exact key.
export interface ConfigParseError {
  path: string;
  message: string;
}

type Fail = (path: string, message: string) => void;

export function parseConfig(raw: unknown): Result<TakoConfig, ConfigParseError> {
  const errors: ConfigParseError[] = [];
  const fail: Fail = (path, message) => errors.push({ path, message });

  if (!isObject(raw)) return { ok: false, errors: [{ path: "$", message: "must be a JSON object" }] };

  if (raw.version !== CONFIG_VERSION) {
    fail("version", `unsupported version ${JSON.stringify(raw.version)}, expected ${CONFIG_VERSION}`);
  }
  if (raw.lastProjectId !== undefined && typeof raw.lastProjectId !== "string") {
    fail("lastProjectId", "must be a string");
  }

  const projects: ProjectConfig[] = [];
  if (!Array.isArray(raw.projects)) {
    fail("projects", "must be a list");
  } else {
    raw.projects.forEach((item: unknown, i) => {
      const project = parseProjectConfig(item, `projects[${i}]`, fail);
      if (project) projects.push(project);
    });
  }

  const repos: Record<string, string> = {};
  if (raw.repos !== undefined) {
    if (!isObject(raw.repos)) fail("repos", "must be an object");
    else {
      for (const [repo, path] of Object.entries(raw.repos)) {
        if (typeof path === "string" && path.trim()) repos[repo.toLowerCase()] = path;
        else fail(`repos.${repo}`, "must be a non-empty string");
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  const lastProjectId = raw.lastProjectId as string | undefined;
  return {
    ok: true,
    value: {
      version: CONFIG_VERSION,
      ...(lastProjectId && { lastProjectId }),
      projects,
      ...(Object.keys(repos).length > 0 && { repos }),
    },
  };
}

// Returns the project config, or undefined after reporting what is wrong.
function parseProjectConfig(raw: unknown, at: string, fail: Fail): ProjectConfig | undefined {
  if (!isObject(raw)) {
    fail(at, "must be an object");
    return undefined;
  }
  let valid = true;
  const check: Fail = (path, message) => {
    valid = false;
    fail(`${at}.${path}`, message);
  };

  const project = raw.project;
  if (!isObject(project)) {
    check("project", "must be an object");
  } else {
    requireString(project, "id", "project", check);
    requireString(project, "title", "project", check);
    requireString(project, "owner", "project", check);
    if (typeof project.number !== "number") check("project.number", "must be a number");
    if (project.ownerType !== "user" && project.ownerType !== "organization") {
      check("project.ownerType", 'must be "user" or "organization"');
    }
  }

  const columnField = raw.columnField;
  if (!isObject(columnField)) {
    check("columnField", "must be an object");
  } else {
    requireString(columnField, "id", "columnField", check);
    requireString(columnField, "name", "columnField", check);
  }

  const roles = raw.roles;
  if (!isObject(roles)) {
    check("roles", "must be an object");
  } else {
    for (const role of ROLES) {
      const binding = roles[role];
      // Optional roles may be absent or null.
      if (binding === undefined || binding === null) {
        if (REQUIRED_ROLES.includes(role)) check(`roles.${role}`, "is required");
        continue;
      }
      if (!isObject(binding)) {
        check(`roles.${role}`, "must be an object");
        continue;
      }
      requireString(binding, "optionId", `roles.${role}`, check);
      requireString(binding, "name", `roles.${role}`, check);
    }
  }

  const agent = raw.agent;
  if (!isObject(agent)) check("agent", "must be an object");
  else requireString(agent, "default", "agent", check);

  requireString(raw, "baseBranch", "", check);

  if (!valid) return undefined;

  // Safe after the checks above; keep only known keys and normalize optional
  // roles (null -> absent).
  const config = raw as unknown as ProjectConfig;
  const normalizedRoles: RoleMapping = {};
  for (const role of ROLES) {
    const binding = config.roles[role];
    if (binding) normalizedRoles[role] = { optionId: binding.optionId, name: binding.name };
  }
  return {
    project: config.project,
    columnField: config.columnField,
    roles: normalizedRoles,
    agent: config.agent,
    baseBranch: config.baseBranch,
  };
}

// ---------------------------------------------------------------------------
// Drift: the board changed after the project was added (column removed)
// ---------------------------------------------------------------------------

export type ConfigDrift =
  | { kind: "field_missing"; fieldName: string }
  | { kind: "role_option_missing"; role: Role; binding: RoleBinding };

// A renamed column keeps its option ID, so renaming alone is NOT drift:
// only a removed option (or a removed field) breaks the config.
// The caller opens the board read-only when this returns anything.
export function detectConfigDrift(config: ProjectConfig, fields: ColumnField[]): ConfigDrift[] {
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

function requireString(obj: Record<string, unknown>, key: string, parent: string, fail: Fail): void {
  const value = obj[key];
  if (typeof value !== "string" || value.trim() === "") {
    fail(parent ? `${parent}.${key}` : key, "must be a non-empty string");
  }
}
