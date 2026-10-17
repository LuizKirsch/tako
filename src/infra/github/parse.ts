// Pure mapping from raw GraphQL `data` to domain/port types.
//
// The responses are treated as untrusted shapes: anything unexpected is
// skipped instead of crashing, because an org can deny access to its
// projects and GitHub then returns nulls inside otherwise valid data.

import type { Card } from "../../domain/board.js";
import type { ColumnField } from "../../domain/roles.js";
import type { ProjectSummary } from "../../ports/github.js";

type Raw = Record<string, unknown>;

export function parseProjects(data: unknown): ProjectSummary[] {
  const viewer = get(data, "viewer");
  const login = get(viewer, "login");
  if (typeof login !== "string") return [];

  const projects: ProjectSummary[] = [];

  for (const node of nodes(get(get(viewer, "projectsV2"), "nodes"))) {
    const project = toProject(node, login, "user");
    if (project) projects.push(project);
  }

  for (const org of nodes(get(get(viewer, "organizations"), "nodes"))) {
    const orgLogin = get(org, "login");
    if (typeof orgLogin !== "string") continue;
    for (const node of nodes(get(get(org, "projectsV2"), "nodes"))) {
      const project = toProject(node, orgLogin, "organization");
      if (project) projects.push(project);
    }
  }

  // Open projects first, then by owner and title, so the list is predictable.
  return projects.sort(
    (a, b) =>
      Number(a.closed) - Number(b.closed) || a.owner.localeCompare(b.owner) || a.title.localeCompare(b.title),
  );
}

export function parseColumnFields(data: unknown): ColumnField[] {
  const fields: ColumnField[] = [];
  for (const node of nodes(get(get(get(data, "node"), "fields"), "nodes"))) {
    if (node.__typename !== "ProjectV2SingleSelectField") continue;
    const { id, name } = node;
    if (typeof id !== "string" || typeof name !== "string") continue;

    const options = nodes(node.options).flatMap((o) =>
      typeof o.id === "string" && typeof o.name === "string" ? [{ id: o.id, name: o.name }] : [],
    );
    fields.push({ id, name, options });
  }
  return fields;
}

export function parseCards(data: unknown, fieldId: string): Card[] {
  const cards: Card[] = [];
  for (const node of nodes(get(get(get(data, "node"), "items"), "nodes"))) {
    if (node.isArchived === true || typeof node.id !== "string") continue;
    const content = get(node, "content");
    const kind = CONTENT_KINDS[String(get(content, "__typename"))];
    const title = get(content, "title");
    // Redacted items (no access to the repo) come back without content.
    if (!kind || typeof title !== "string") continue;

    const value = nodes(get(get(node, "fieldValues"), "nodes")).find(
      (v) => get(get(v, "field"), "id") === fieldId,
    );
    const number = get(content, "number");
    const url = get(content, "url");
    const repo = get(get(content, "repository"), "nameWithOwner");
    const state = get(content, "state");

    cards.push({
      itemId: node.id,
      optionId: typeof value?.optionId === "string" ? value.optionId : undefined,
      kind,
      title,
      ...(typeof number === "number" && { number }),
      ...(typeof url === "string" && { url }),
      ...(typeof repo === "string" && { repo }),
      closed: state === "CLOSED" || state === "MERGED",
    });
  }
  return cards;
}

const CONTENT_KINDS: Record<string, Card["kind"]> = {
  Issue: "issue",
  PullRequest: "pull_request",
  DraftIssue: "draft",
};

function toProject(node: Raw, owner: string, ownerType: ProjectSummary["ownerType"]): ProjectSummary | undefined {
  const { id, number, title, closed } = node;
  if (typeof id !== "string" || typeof number !== "number" || typeof title !== "string") return undefined;
  return { id, number, title, owner, ownerType, closed: closed === true };
}

function get(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Raw)[key] : undefined;
}

// Keeps only object entries of a list; nulls (denied access) are dropped.
function nodes(value: unknown): Raw[] {
  return Array.isArray(value) ? value.filter((v): v is Raw => typeof v === "object" && v !== null) : [];
}
