// In-memory implementations of the ports, shared by use-case tests.

import type { Card, Comment } from "../../src/domain/board.js";
import type { ColumnField } from "../../src/domain/roles.js";
import type { AgentAdapter, AgentSession, LaunchOptions } from "../../src/ports/agent.js";
import type { Files } from "../../src/ports/files.js";
import type { GitPort, LocalRepo } from "../../src/ports/git.js";
import type { CardMove, GitHubPort, ProjectSummary, PullRequestInput } from "../../src/ports/github.js";

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
  readonly moves: CardMove[] = [];
  readonly pullRequests: PullRequestInput[] = [];
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
  async moveCard(move: CardMove) {
    this.moves.push(move);
  }
  async findPullRequest(_repo: string, head: string) {
    const index = this.pullRequests.findIndex((pr) => pr.head === head);
    if (index === -1) return undefined;
    return { number: index + 1, url: `https://github.com/pull/${index + 1}`, state: "open" as const };
  }
  async openPullRequest(input: PullRequestInput) {
    this.pullRequests.push(input);
    return `https://github.com/${input.repo}/pull/${this.pullRequests.length}`;
  }
  async fixAuth() {
    return true;
  }
}

// An agent that records every launch and attach instead of running anything.
// Its background sessions are whatever the test puts in `sessionList`.
type FakeAgent = AgentAdapter & { launches: LaunchOptions[]; attached: string[]; stopped: string[]; sessionList: AgentSession[] };

export const fakeAgent = (id: string, installed: boolean): FakeAgent => {
  const launches: LaunchOptions[] = [];
  const attached: string[] = [];
  const stopped: string[] = [];
  const sessionList: AgentSession[] = [];
  return {
    id,
    displayName: id,
    models: [
      { id: "big", label: "Big" },
      { id: "small", label: "Small" },
    ],
    isInstalled: async () => installed,
    start: async (options) => {
      launches.push(options);
      return `s${launches.length}`;
    },
    sessions: async () => sessionList,
    attach: async (sessionId) => {
      attached.push(sessionId);
    },
    stop: async (sessionId) => {
      stopped.push(sessionId);
    },
    launches,
    attached,
    stopped,
    sessionList,
  };
};

// Local repositories by folder; any other folder is not a repository.
// `ahead` holds the commits of each branch over the base; pushes and
// worktrees are recorded. `dirty` worktrees refuse to be removed, like git.
export class FakeGit implements GitPort {
  readonly ahead: Record<string, number> = {};
  readonly pushed: string[] = [];
  readonly worktrees = new Map<string, string>(); // path -> branch
  readonly dirty = new Set<string>();

  constructor(private readonly repos: Record<string, LocalRepo> = {}) {}
  async inspect(dir: string) {
    return this.repos[dir];
  }
  async commitsAhead(_root: string, _base: string, branch: string) {
    return this.ahead[branch];
  }
  async push(_root: string, branch: string) {
    this.pushed.push(branch);
  }
  async addWorktree(_root: string, path: string, branch: string) {
    this.worktrees.set(path, branch);
  }
  async removeWorktree(_root: string, path: string) {
    if (this.dirty.has(path)) throw new Error("contains modified or untracked files");
    this.worktrees.delete(path);
  }
}
