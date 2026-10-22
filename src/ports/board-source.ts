// Port: the kanban board tako reads tasks from and moves cards on.
//
// The app layer depends on this interface, never on `gh` or HTTP directly.
// Tests use an in-memory fake; production uses GitHub Projects through
// `gh api graphql` (infra/github). Another board (Jira, Linear...) would be
// another implementation of this interface.

import type { Card, Comment } from "../domain/board.js";
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

export interface CardMove {
  projectId: string;
  itemId: string;
  fieldId: string;
  optionId: string;
}

export interface BoardSource {
  // Projects of the authenticated user plus those of their organizations.
  listProjects(): Promise<ProjectSummary[]>;
  // Single-select fields of a project: the candidates for "board columns".
  listColumnFields(projectId: string): Promise<ColumnField[]>;
  // Non-archived items of a project, each with its value in `fieldId`.
  listCards(projectId: string, fieldId: string): Promise<Card[]>;
  // Comments of a card, oldest first. Drafts have none.
  listComments(card: Card): Promise<Comment[]>;
  // Puts an item in another column: sets its single-select `fieldId` to `optionId`.
  moveCard(move: CardMove): Promise<void>;
  // Hands the terminal to the source's own auth flow (e.g. gh login or scope
  // refresh). tako never sees the token. Resolves true when it succeeded.
  fixAuth(kind: AuthFixKind): Promise<boolean>;
}

// Failures the UI knows how to explain. Anything else is "unknown"
// and is shown with the raw message.
export type SourceErrorKind = "gh_not_installed" | "not_authenticated" | "missing_project_scope" | "unknown";

// The failures the source itself can fix interactively.
export type AuthFixKind = Extract<SourceErrorKind, "not_authenticated" | "missing_project_scope">;

export function isAuthFixable(kind: SourceErrorKind): kind is AuthFixKind {
  return kind === "not_authenticated" || kind === "missing_project_scope";
}

export class SourceError extends Error {
  constructor(
    readonly kind: SourceErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "SourceError";
  }
}
