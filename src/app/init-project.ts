// Use case: `tako init`, which adds a GitHub Project to tako.
//
// It does not ask questions itself. The UI drives the wizard and calls these
// steps in order, so the same use case works with any UI (and in tests):
//
//   prepare()       -> projects, installed agents, existing config
//   fixAuth()       -> lets gh log in / add the project scope, then retry prepare()
//   columnFields()  -> single-select fields of the chosen project
//   validateRoles() -> live feedback while the user maps roles
//   finish()        -> adds (or replaces) the project in the config and saves it
//
// Projects are saved in the user's config directory, so init can run from
// any folder and nothing is written inside a repository.

import {
  addProject,
  createProjectConfig,
  type ConfigParseError,
  type ProjectConfig,
  type TakoConfig,
} from "../domain/config.js";
import { validateRoleMapping, type ColumnField, type RoleMapping, type RoleMappingError } from "../domain/roles.js";
import type { AgentAdapter } from "../ports/agent.js";
import type { Files } from "../ports/files.js";
import type { AuthFixKind, BoardSource, ProjectSummary } from "../ports/board-source.js";
import { installedAgents } from "./agents.js";
import { loadConfig, saveConfig, type LoadConfigResult } from "./config-file.js";

export interface InitDeps {
  board: BoardSource;
  files: Files; // rooted at the tako config directory
  agents: readonly AgentAdapter[];
}

export interface InitContext {
  projects: ProjectSummary[];
  installedAgents: AgentAdapter[];
  existingConfig: LoadConfigResult;
}

export interface InitChoices {
  project: ProjectSummary;
  field: ColumnField;
  roles: RoleMapping;
  agentId: string;
  baseBranch: string;
}

export type InitOutcome =
  | { ok: true; config: TakoConfig; project: ProjectConfig; replaced: boolean }
  | { ok: false; kind: "invalid_mapping"; errors: RoleMappingError[] }
  // Never overwrite a config that cannot be read: it may hold other projects.
  | { ok: false; kind: "invalid_config"; errors: ConfigParseError[] };

export class InitProject {
  constructor(private readonly deps: InitDeps) {}

  async prepare(): Promise<InitContext> {
    // Independent calls run in parallel: the GitHub request is the slow one.
    const [projects, agents, existingConfig] = await Promise.all([
      this.deps.board.listProjects(),
      installedAgents(this.deps.agents),
      loadConfig(this.deps.files),
    ]);
    return { projects, installedAgents: agents, existingConfig };
  }

  fixAuth(kind: AuthFixKind): Promise<boolean> {
    return this.deps.board.fixAuth(kind);
  }

  columnFields(projectId: string): Promise<ColumnField[]> {
    return this.deps.board.listColumnFields(projectId);
  }

  validateRoles(field: ColumnField, roles: RoleMapping): RoleMappingError[] {
    return validateRoleMapping(field, roles);
  }

  async finish(choices: InitChoices): Promise<InitOutcome> {
    const { project } = choices;
    const created = createProjectConfig({
      project: {
        id: project.id,
        number: project.number,
        title: project.title,
        owner: project.owner,
        ownerType: project.ownerType,
      },
      field: choices.field,
      roles: choices.roles,
      agentId: choices.agentId,
      baseBranch: choices.baseBranch,
    });
    if (!created.ok) return { ok: false, kind: "invalid_mapping", errors: created.errors };

    // Read again right before writing, so projects added meanwhile are kept.
    const loaded = await loadConfig(this.deps.files);
    if (loaded.status === "invalid") return { ok: false, kind: "invalid_config", errors: loaded.errors };
    const current = loaded.status === "ok" ? loaded.config : undefined;

    const replaced = current?.projects.some((p) => p.project.id === project.id) ?? false;
    const config = addProject(current, created.value);
    await saveConfig(this.deps.files, config);
    return { ok: true, config, project: created.value, replaced };
  }
}
