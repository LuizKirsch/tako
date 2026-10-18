// In-memory implementations of the ports, shared by use-case tests.

import type { Card, Comment } from "../../src/domain/board.js";
import type { ColumnField } from "../../src/domain/roles.js";
import type { AgentAdapter } from "../../src/ports/agent.js";
import type { Files } from "../../src/ports/files.js";
import type { GitHubPort, ProjectSummary } from "../../src/ports/github.js";

export class MemoryFiles implements Files {
  readonly files = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initial)) this.files.set(path, content);
  }
  async readText(path: string) {
    return this.files.get(path);
  }
  async writeText(path: string, content: string) {
    this.files.set(path, content);
  }
  async exists(path: string) {
    return this.files.has(path);
  }
}

export class FakeGitHub implements GitHubPort {
  constructor(
    private readonly projects: ProjectSummary[],
    private readonly fieldsByProject: Record<string, ColumnField[]>,
    private readonly cardsByProject: Record<string, Card[]> = {},
    private readonly commentsByContent: Record<string, Comment[]> = {},
  ) {}
  async listCards(projectId: string) {
    return this.cardsByProject[projectId] ?? [];
  }
  async listComments(contentId: string) {
    return this.commentsByContent[contentId] ?? [];
  }
  async listProjects() {
    return this.projects;
  }
  async listColumnFields(projectId: string) {
    return this.fieldsByProject[projectId] ?? [];
  }
  async fixAuth() {
    return true;
  }
}

export const fakeAgent = (id: string, installed: boolean): AgentAdapter => ({
  id,
  displayName: id,
  models: [
    { id: "big", label: "Big" },
    { id: "small", label: "Small" },
  ],
  isInstalled: async () => installed,
});
