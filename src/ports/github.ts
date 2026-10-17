// Port: everything gh-relay needs from GitHub.
//
// The app layer depends on this interface, never on `gh` or HTTP directly.
// Tests use an in-memory fake; production uses `gh api graphql` (infra/github).
// It grows issue by issue: for now only what `init` and the board need.

import type { Card } from "../domain/board.js";
import type { OwnerType } from "../domain/config.js";
import type { ColumnField } from "../domain/roles.js";

export interface ProjectSummary {
  id: string;
  number: number;
  title: string;
  owner: string;
  ownerType: OwnerType;
  closed: boolean;
}

export interface GitHubPort {
  // Projects of the authenticated user plus those of their organizations.
  listProjects(): Promise<ProjectSummary[]>;
  // Single-select fields of a project: the candidates for "board columns".
  listColumnFields(projectId: string): Promise<ColumnField[]>;
  // Non-archived items of a project, each with its value in `fieldId`.
  listCards(projectId: string, fieldId: string): Promise<Card[]>;
  // Hands the terminal to gh's own auth flow (login or scope refresh).
  // gh-relay never sees the token. Resolves true when gh succeeded.
  fixAuth(kind: AuthFixKind): Promise<boolean>;
}

// Failures the UI knows how to explain. Anything else is "unknown"
// and is shown with the raw message.
export type GitHubErrorKind = "gh_not_installed" | "not_authenticated" | "missing_project_scope" | "unknown";

// The failures gh itself can fix interactively.
export type AuthFixKind = Extract<GitHubErrorKind, "not_authenticated" | "missing_project_scope">;

export function isAuthFixable(kind: GitHubErrorKind): kind is AuthFixKind {
  return kind === "not_authenticated" || kind === "missing_project_scope";
}

export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}
