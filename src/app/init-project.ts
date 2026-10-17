// Use case: `gh-relay init`.
//
// It does not ask questions itself. The UI drives the wizard and calls these
// steps in order, so the same use case works with any UI (and in tests):
//
//   prepare()       -> projects, installed agents, existing config
//   fixAuth()       -> lets gh log in / add the project scope, then retry prepare()
//   columnFields()  -> single-select fields of the chosen project
//   validateRoles() -> live feedback while the user maps roles
//   finish()        -> builds, saves the config and creates the rules file

import { createConfig, type GhRelayConfig } from "../domain/config.js";
import { validateRoleMapping, type ColumnField, type RoleMapping, type RoleMappingError } from "../domain/roles.js";
import type { AgentAdapter } from "../ports/agent.js";
import type { RepoFiles } from "../ports/files.js";
import type { AuthFixKind, GitHubPort, ProjectSummary } from "../ports/github.js";
import { RECOMMENDED_RULES } from "../templates/recommended-rules.js";
import { loadConfig, saveConfig, type LoadConfigResult } from "./config-file.js";

export interface InitDeps {
  github: GitHubPort;
  files: RepoFiles;
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
  | { ok: true; config: GhRelayConfig; rulesFileCreated: boolean }
  | { ok: false; errors: RoleMappingError[] };

export class InitProject {
  constructor(private readonly deps: InitDeps) {}

  async prepare(): Promise<InitContext> {
    // Independent calls run in parallel: the GitHub request is the slow one.
    const [projects, installedAgents, existingConfig] = await Promise.all([
      this.deps.github.listProjects(),
      this.installedAgents(),
      loadConfig(this.deps.files),
    ]);
    return { projects, installedAgents, existingConfig };
  }

  fixAuth(kind: AuthFixKind): Promise<boolean> {
    return this.deps.github.fixAuth(kind);
  }

  columnFields(projectId: string): Promise<ColumnField[]> {
    return this.deps.github.listColumnFields(projectId);
  }

  validateRoles(field: ColumnField, roles: RoleMapping): RoleMappingError[] {
    return validateRoleMapping(field, roles);
  }

  async finish(choices: InitChoices): Promise<InitOutcome> {
    const { project } = choices;
    const created = createConfig({
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
    if (!created.ok) return { ok: false, errors: created.errors };

    const config = created.value;
    await saveConfig(this.deps.files, config);

    // Never overwrite rules the user already wrote (re-running init is common).
    const rulesFileCreated = !(await this.deps.files.exists(config.rulesFile));
    if (rulesFileCreated) await this.deps.files.writeText(config.rulesFile, RECOMMENDED_RULES);

    return { ok: true, config, rulesFileCreated };
  }

  private async installedAgents(): Promise<AgentAdapter[]> {
    const checks = await Promise.all(this.deps.agents.map(async (a) => ((await a.isInstalled()) ? a : undefined)));
    return checks.filter((a): a is AgentAdapter => a !== undefined);
  }
}
