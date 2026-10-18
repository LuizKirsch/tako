// GitHubPort implemented with `gh api graphql`.
//
// Why `gh` instead of an HTTP client: authentication is already solved
// (the user's `gh auth login`), and no token ever passes through tako.
// Testability comes from the GhRunner seam, not from owning the HTTP layer.

import { GitHubError, type AuthFixKind, type GitHubPort, type ProjectSummary } from "../../ports/github.js";
import type { ColumnField } from "../../domain/roles.js";
import {
  execaGhInteractive,
  execaGhRunner,
  type GhResult,
  type GhRunner,
  type InteractiveGhRunner,
} from "./gh-runner.js";
import { LIST_CARDS, LIST_COLUMN_FIELDS, LIST_COMMENTS, LIST_PROJECTS } from "./queries.js";
import { parseCards, parseColumnFields, parseComments, parseProjects } from "./parse.js";
import type { Card, Comment } from "../../domain/board.js";

interface GraphQLError {
  type?: string;
  message?: string;
}

export class GhCliGitHub implements GitHubPort {
  constructor(
    private readonly run: GhRunner = execaGhRunner,
    private readonly runInteractive: InteractiveGhRunner = execaGhInteractive,
  ) {}

  // Flags checked against `gh auth login --help` / `gh auth refresh --help` (gh 2.97).
  // gh asks its own questions and stores the token itself.
  async fixAuth(kind: AuthFixKind): Promise<boolean> {
    const args =
      kind === "not_authenticated"
        ? ["auth", "login", "--hostname", "github.com", "--scopes", "project"]
        : ["auth", "refresh", "--hostname", "github.com", "--scopes", "project"];
    return (await this.runInteractive(args)) === 0;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return parseProjects(await this.graphql(LIST_PROJECTS));
  }

  async listColumnFields(projectId: string): Promise<ColumnField[]> {
    return parseColumnFields(await this.graphql(LIST_COLUMN_FIELDS, { projectId }));
  }

  // ponytail: first 100 items only; paginate with pageInfo/endCursor when a board outgrows it.
  async listCards(projectId: string, fieldId: string): Promise<Card[]> {
    return parseCards(await this.graphql(LIST_CARDS, { projectId }), fieldId);
  }

  async listComments(contentId: string): Promise<Comment[]> {
    return parseComments(await this.graphql(LIST_COMMENTS, { id: contentId }));
  }

  // Runs a query and returns `data`. Partial data (some nodes denied) is
  // accepted; a response with no data at all becomes a typed GitHubError.
  private async graphql(query: string, variables: Record<string, string> = {}): Promise<unknown> {
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const [key, value] of Object.entries(variables)) args.push("-f", `${key}=${value}`);

    const result = await this.run(args);
    const body = parseJson(result.stdout);
    const errors = readErrors(body);

    const data = typeof body === "object" && body !== null ? (body as { data?: unknown }).data : undefined;
    if (data !== undefined && data !== null) return data;

    throw classifyFailure(result, errors);
  }
}

// Maps a failed call to something the UI can explain.
// The matched strings come from gh/GitHub messages; unmatched cases fall back
// to "unknown" with the original text, so nothing is hidden from the user.
export function classifyFailure(result: GhResult, errors: GraphQLError[]): GitHubError {
  const text = `${result.stderr}\n${errors.map((e) => e.message ?? "").join("\n")}`;

  if (errors.some((e) => e.type === "INSUFFICIENT_SCOPES") || /read:project|'project'/.test(text)) {
    return new GitHubError(
      "missing_project_scope",
      "Your gh token cannot read Projects. Run: gh auth refresh -h github.com -s project",
    );
  }
  if (/gh auth login|not logged in/i.test(text)) {
    return new GitHubError("not_authenticated", "You are not logged in to gh. Run: gh auth login");
  }
  const detail = text.trim() || `gh exited with code ${result.exitCode}`;
  return new GitHubError("unknown", `GitHub request failed: ${detail}`);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readErrors(body: unknown): GraphQLError[] {
  const errors = typeof body === "object" && body !== null ? (body as { errors?: unknown }).errors : undefined;
  return Array.isArray(errors) ? (errors as GraphQLError[]) : [];
}
