// The board: project cards grouped into the columns of the chosen field.
//
// This module is pure: no I/O, only types and rules.

import type { ColumnField, Role, RoleMapping } from "./roles.js";
import { ROLES } from "./roles.js";

export interface Card {
  itemId: string; // the project item, used later to move the card
  optionId: string | undefined; // column option; undefined when the card has no status
  kind: "issue" | "pull_request" | "draft";
  title: string;
  number?: number;
  url?: string;
  repo?: string; // "owner/name"
  closed: boolean;
  body: string; // markdown, "" when empty
  labels: string[];
  assignees: string[]; // logins
}

export interface BoardColumn {
  optionId: string | undefined; // undefined for the "No status" column
  name: string;
  role: Role | undefined;
  cards: Card[];
}

export const NO_STATUS = "No status";

// Columns follow the field's option order (the order the user sees on GitHub).
// Cards without a status, or with an option that no longer exists, go to a
// trailing "No status" column, shown only when it has cards.
export function buildBoard(field: ColumnField, roles: RoleMapping, cards: Card[]): BoardColumn[] {
  const columns: BoardColumn[] = field.options.map((option) => ({
    optionId: option.id,
    name: option.name,
    role: ROLES.find((role) => roles[role]?.optionId === option.id),
    cards: [],
  }));
  const byOption = new Map(columns.map((column) => [column.optionId, column]));
  const noStatus: BoardColumn = { optionId: undefined, name: NO_STATUS, role: undefined, cards: [] };

  for (const card of cards) {
    const column = card.optionId === undefined ? undefined : byOption.get(card.optionId);
    (column ?? noStatus).cards.push(card);
  }

  return noStatus.cards.length > 0 ? [...columns, noStatus] : columns;
}
