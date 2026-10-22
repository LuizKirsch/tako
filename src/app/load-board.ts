// Use case: open the board (`tako` with no command).
//
// Reads the config and picks the project: the requested one, else the last
// opened, else the first. Then fetches its fields and cards (and checks which
// agents are installed) in parallel, and groups the cards into columns.
// When the board changed after the project was added (drift), the board still
// opens, read-only, and the UI explains what to fix.

import { buildBoard, type BoardColumn } from "../domain/board.js";
import {
  chooseProject,
  detectConfigDrift,
  type ConfigDrift,
  type ConfigParseError,
  type ProjectConfig,
  type ProjectRef,
} from "../domain/config.js";
import type { AgentAdapter } from "../ports/agent.js";
import type { Files } from "../ports/files.js";
import type { BoardSource } from "../ports/board-source.js";
import { installedAgents } from "./agents.js";
import { loadConfig, saveConfig } from "./config-file.js";

export interface BoardDeps {
  board: BoardSource;
  files: Files; // rooted at the tako config directory
  agents: readonly AgentAdapter[];
}

export type BoardResult =
  | { status: "no_config" } // no project added yet
  | { status: "invalid_config"; errors: ConfigParseError[] }
  | {
      status: "ok";
      project: ProjectConfig; // the one on screen
      projects: ProjectRef[]; // every project added, to switch between them
      columns: BoardColumn[];
      drift: ConfigDrift[];
      agents: AgentAdapter[]; // installed ones, offered when starting a task
    };

export async function loadBoard(deps: BoardDeps, projectId?: string): Promise<BoardResult> {
  const loaded = await loadConfig(deps.files);
  if (loaded.status === "missing") return { status: "no_config" };
  if (loaded.status === "invalid") return { status: "invalid_config", errors: loaded.errors };

  const { config } = loaded;
  // A project removed from the config falls back to the default choice.
  const project = chooseProject(config, projectId) ?? chooseProject(config);
  if (!project) return { status: "no_config" };

  // Remember it, so the next `tako` opens the same project.
  if (config.lastProjectId !== project.project.id) {
    await saveConfig(deps.files, { ...config, lastProjectId: project.project.id });
  }

  const [fields, cards, agents] = await Promise.all([
    deps.board.listColumnFields(project.project.id),
    deps.board.listCards(project.project.id, project.columnField.id),
    installedAgents(deps.agents),
  ]);

  const drift = detectConfigDrift(project, fields);
  const field = fields.find((f) => f.id === project.columnField.id);
  // Without the field there are no columns to group by.
  const columns = field ? buildBoard(field, project.roles, cards) : [];
  const projects = config.projects.map((p) => p.project);
  return { status: "ok", project, projects, columns, drift, agents };
}
