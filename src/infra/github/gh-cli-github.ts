// BoardSource (GitHub Projects) and CodeHost (GitHub) implemented with
// `gh api graphql`.
//
// Why `gh` instead of an HTTP client: authentication is already solved
// (the user's `gh auth login`), and no token ever passes through tako.
// Testability comes from the GhRunner seam, not from owning the HTTP layer.

import { SourceError, type AuthFixKind, type BoardSource, type CardMove, type ProjectSummary } from "../../ports/board-source.js";
import type { CodeHost, PullRequestInfo, PullRequestInput } from "../../ports/code-host.js";
import type { ColumnField } from "../../domain/roles.js";
import {
  execaGhInteractive,
  execaGhRunner,
  type GhResult,
  type GhRunner,
  type InteractiveGhRunner,
} from "./gh-runner.js";
import { LIST_CARDS, LIST_COLUMN_FIELDS, LIST_COMMENTS, LIST_PROJECTS, MOVE_CARD, FIND_PULL_REQUEST, CREATE_PULL_REQUEST } from "./queries.js";
import { parseCards, parseColumnFields, parseComments, parseProjects } from "./parse.js";
import type { Card, Comment } from "../../domain/board.js";

interface GraphQLError {
  type?: string;
  message?: string;
}

export class GhCliGitHub implements BoardSource, CodeHost {
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

  // Drafts are not issues yet, so they have no comments.
  async listComments(card: Card): Promise<Comment[]> {
    if (!card.contentId) return [];
    return parseComments(await this.graphql(LIST_COMMENTS, { id: card.contentId }));
  }

  async moveCard(move: CardMove): Promise<void> {
    await this.graphql(MOVE_CARD, { ...move });
  }

  async findPullRequest(repo: string, head: string): Promise<PullRequestInfo | undefined> {
    return (await this.lookUpPullRequest(repo, head)).pullRequest;
  }

  async openPullRequest({ repo, base, head, title, body }: PullRequestInput): Promise<string> {
    const { repositoryId, pullRequest } = await this.lookUpPullRequest(repo, head);
    if (pullRequest?.state === "open") return pullRequest.url;

    const created = (await this.graphql(CREATE_PULL_REQUEST, { repositoryId, base, head, title, body })) as {
      createPullRequest?: { pullRequest?: { url?: string } };
    };
    const url = created.createPullRequest?.pullRequest?.url;
    if (!url) throw new SourceError("unknown", "GitHub did not return the new pull request.");
    return url;
  }

  private async lookUpPullRequest(repo: string, head: string) {
    const [owner = "", name = ""] = repo.split("/");
    const data = (await this.graphql(FIND_PULL_REQUEST, { owner, name, head })) as {
      repository?: { id?: string; pullRequests?: { nodes?: { number?: number; url?: string; state?: string }[] } } | null;
    };
    const repositoryId = data.repository?.id;
    if (!repositoryId) throw new SourceError("unknown", `Repository ${repo} was not found on GitHub.`);
    const node = data.repository?.pullRequests?.nodes?.[0];
    const pullRequest: PullRequestInfo | undefined =
      node?.url && node.number !== undefined
        ? { number: node.number, url: node.url, state: node.state === "MERGED" ? "merged" : node.state === "CLOSED" ? "closed" : "open" }
        : undefined;
    return { repositoryId, pullRequest };
  }

  // Runs a query and returns `data`. Partial data (some nodes denied) is
  // accepted; a response with no data at all becomes a typed SourceError.
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
export function classifyFailure(result: GhResult, errors: GraphQLError[]): SourceError {
  const text = `${result.stderr}\n${errors.map((e) => e.message ?? "").join("\n")}`;

  if (errors.some((e) => e.type === "INSUFFICIENT_SCOPES") || /read:project|'project'/.test(text)) {
    return new SourceError(
      "missing_project_scope",
      "Your gh token cannot read Projects. Run: gh auth refresh -h github.com -s project",
    );
  }
  if (/gh auth login|not logged in/i.test(text)) {
    return new SourceError("not_authenticated", "You are not logged in to gh. Run: gh auth login");
  }
  const detail = text.trim() || `gh exited with code ${result.exitCode}`;
  return new SourceError("unknown", `GitHub request failed: ${detail}`);
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
