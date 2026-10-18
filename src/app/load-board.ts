// Use case: open the board (`tako` with no command).
//
// Reads the config, fetches the project's fields and cards (and checks which
// agents are installed) in parallel, and groups the cards into columns. When the board changed after init (drift),
// the board still opens, read-only, and the UI explains what to fix.

import { buildBoard, type BoardColumn, type Card, type Comment } from "../domain/board.js";
import { detectConfigDrift, type ConfigDrift, type ConfigParseError, type TakoConfig } from "../domain/config.js";
import type { AgentAdapter } from "../ports/agent.js";
import type { RepoFiles } from "../ports/files.js";
import type { GitHubPort } from "../ports/github.js";
import { installedAgents } from "./agents.js";
import { loadConfig } from "./config-file.js";

export interface BoardDeps {
  github: GitHubPort;
  files: RepoFiles;
  agents: readonly AgentAdapter[];
}

export type BoardResult =
  | { status: "no_config" }
  | { status: "invalid_config"; errors: ConfigParseError[] }
  | {
      status: "ok";
      config: TakoConfig;
      columns: BoardColumn[];
      drift: ConfigDrift[];
      agents: AgentAdapter[]; // installed ones, offered when starting a task
    };

export async function loadBoard(deps: BoardDeps): Promise<BoardResult> {
  const loaded = await loadConfig(deps.files);
  if (loaded.status === "missing") return { status: "no_config" };
  if (loaded.status === "invalid") return { status: "invalid_config", errors: loaded.errors };

  const { config } = loaded;
  const [fields, cards, agents] = await Promise.all([
    deps.github.listColumnFields(config.project.id),
    deps.github.listCards(config.project.id, config.columnField.id),
    installedAgents(deps.agents),
  ]);

  const drift = detectConfigDrift(config, fields);
  const field = fields.find((f) => f.id === config.columnField.id);
  // Without the field there are no columns to group by.
  const columns = field ? buildBoard(field, config.roles, cards) : [];
  return { status: "ok", config, columns, drift, agents };
}

// Comments of one card, loaded when the card is opened.
// Drafts are not issues yet, so they have no comments.
export async function loadComments(github: GitHubPort, card: Card): Promise<Comment[]> {
  return card.contentId ? github.listComments(card.contentId) : [];
}
