// Use case: open the board (`gh-relay` with no command).
//
// Reads the config, fetches the project's fields and cards in parallel and
// groups the cards into columns. When the board changed after init (drift),
// the board still opens, read-only, and the UI explains what to fix.

import { buildBoard, type BoardColumn, type Card, type Comment } from "../domain/board.js";
import { detectConfigDrift, type ConfigDrift, type ConfigParseError, type GhRelayConfig } from "../domain/config.js";
import type { RepoFiles } from "../ports/files.js";
import type { GitHubPort } from "../ports/github.js";
import { loadConfig } from "./config-file.js";

export interface BoardDeps {
  github: GitHubPort;
  files: RepoFiles;
}

export type BoardResult =
  | { status: "no_config" }
  | { status: "invalid_config"; errors: ConfigParseError[] }
  | { status: "ok"; config: GhRelayConfig; columns: BoardColumn[]; drift: ConfigDrift[] };

export async function loadBoard(deps: BoardDeps): Promise<BoardResult> {
  const loaded = await loadConfig(deps.files);
  if (loaded.status === "missing") return { status: "no_config" };
  if (loaded.status === "invalid") return { status: "invalid_config", errors: loaded.errors };

  const { config } = loaded;
  const [fields, cards] = await Promise.all([
    deps.github.listColumnFields(config.project.id),
    deps.github.listCards(config.project.id, config.columnField.id),
  ]);

  const drift = detectConfigDrift(config, fields);
  const field = fields.find((f) => f.id === config.columnField.id);
  // Without the field there are no columns to group by.
  const columns = field ? buildBoard(field, config.roles, cards) : [];
  return { status: "ok", config, columns, drift };
}

// Comments of one card, loaded when the card is opened.
// Drafts are not issues yet, so they have no comments.
export async function loadComments(github: GitHubPort, card: Card): Promise<Comment[]> {
  return card.contentId ? github.listComments(card.contentId) : [];
}
