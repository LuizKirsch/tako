import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StartTask, type StartRequest } from "../../src/app/start-task.js";
import type { Card } from "../../src/domain/board.js";
import { CONFIG_FILE, type ProjectConfig, type TakoConfig } from "../../src/domain/config.js";
import { TASKS_FILE } from "../../src/app/task-store.js";
import { RECOMMENDED_RULES, RULES_FILE } from "../../src/templates/recommended-rules.js";
import { FakeGit, FakeGitHub, MemoryFiles, fakeAgent } from "../fakes/index.js";

const REPO = "octocat/webapp";

const card: Card = {
  itemId: "PVTI_1",
  contentId: "I_1",
  optionId: "o-ready",
  kind: "issue",
  title: "Fix the login",
  number: 3,
  repo: REPO,
  closed: false,
  body: "Make it work.",
  labels: [],
  assignees: [],
};

const project: ProjectConfig = {
  project: { id: "PVT_1", number: 1, title: "Board", owner: "octocat", ownerType: "user" },
  columnField: { id: "F1", name: "Status" },
  roles: {
    ready: { optionId: "o-ready", name: "Ready" },
    in_progress: { optionId: "o-doing", name: "Doing" },
    delivery: { optionId: "o-review", name: "Review" },
  },
  agent: { default: "claude-code" },
  baseBranch: "main",
};

const config: TakoConfig = { version: 1, projects: [] };

function setup(options: { repos?: Record<string, string>; cwd?: string; git?: FakeGit } = {}) {
  const files = new MemoryFiles({ [CONFIG_FILE]: JSON.stringify({ ...config, repos: options.repos }) });
  const repoFiles = new Map<string, MemoryFiles>();
  const agent = fakeAgent("claude-code", true);
  const github = new FakeGitHub([], {}, {}, {
    I_1: [{ author: "alice", body: "Check mobile too.", createdAt: "2026-01-02T10:00:00Z" }],
  });
  const git =
    options.git ??
    new FakeGit({
      "/code/webapp": { root: "/code/webapp", repo: "octocat/webapp" },
      "/code/webapp/src": { root: "/code/webapp", repo: "octocat/webapp" },
      "/code/other": { root: "/code/other", repo: "octocat/other" },
    });
  const start = new StartTask({
    files,
    git,
    github,
    agents: [agent],
    repoFiles: (root) => repoFiles.get(root) ?? repoFiles.set(root, new MemoryFiles()).get(root)!,
    cwd: options.cwd ?? "/somewhere/else",
  });
  const savedRepos = () => JSON.parse(files.files.get(CONFIG_FILE) ?? "{}").repos;
  return { start, agent, github, git, files, repoFiles, savedRepos };
}

describe("StartTask.findRepo", () => {
  it("uses the folder remembered for the repository", async () => {
    const { start } = setup({ repos: { "octocat/webapp": "/code/webapp" } });
    await expect(start.findRepo(REPO)).resolves.toBe("/code/webapp");
  });

  it("uses and remembers the current folder when it is that repository", async () => {
    const { start, savedRepos } = setup({ cwd: "/code/webapp/src" });
    await expect(start.findRepo(REPO)).resolves.toBe("/code/webapp");
    expect(savedRepos()).toEqual({ "octocat/webapp": "/code/webapp" });
  });

  it("asks again when the remembered folder no longer holds the repository", async () => {
    const { start } = setup({ repos: { "octocat/webapp": "/code/moved" } });
    await expect(start.findRepo(REPO)).resolves.toBeUndefined();
  });

  it("returns nothing when the current folder is another repository", async () => {
    const { start } = setup({ cwd: "/code/other" });
    await expect(start.findRepo(REPO)).resolves.toBeUndefined();
  });
});

describe("StartTask.useRepoAt", () => {
  it("accepts a folder of the repository, keeps its root and remembers it", async () => {
    const { start, savedRepos } = setup();
    await expect(start.useRepoAt(REPO, "/code/webapp/src")).resolves.toEqual({ ok: true, root: "/code/webapp" });
    expect(savedRepos()).toEqual({ "octocat/webapp": "/code/webapp" });
  });

  it("refuses a folder that is not a git repository", async () => {
    const { start, savedRepos } = setup();
    await expect(start.useRepoAt(REPO, "/nowhere")).resolves.toEqual({ ok: false, reason: "not_a_repo" });
    expect(savedRepos()).toBeUndefined();
  });

  it("refuses another repository and says which one it is", async () => {
    const { start } = setup();
    await expect(start.useRepoAt(REPO, "/code/other")).resolves.toEqual({
      ok: false,
      reason: "other_repo",
      found: "octocat/other",
    });
  });
});

describe("StartTask.prepareRepo", () => {
  it("creates the rules file once and never overwrites it", async () => {
    const { start, repoFiles } = setup();
    await expect(start.prepareRepo("/code/webapp")).resolves.toBe(true);
    expect(repoFiles.get("/code/webapp")?.files.get(RULES_FILE)).toBe(RECOMMENDED_RULES);

    await repoFiles.get("/code/webapp")?.writeText(RULES_FILE, "my rules");
    await expect(start.prepareRepo("/code/webapp")).resolves.toBe(false);
    expect(repoFiles.get("/code/webapp")?.files.get(RULES_FILE)).toBe("my rules");
  });
});

const request: StartRequest = { card, agentId: "claude-code", model: "opus", project };

describe("StartTask.moveToInProgress", () => {
  it("sets the card's column to the in_progress option", async () => {
    const { start, github } = setup();
    await expect(start.moveToInProgress(request)).resolves.toBe("Doing");
    expect(github.moves).toEqual([{ projectId: "PVT_1", itemId: "PVTI_1", fieldId: "F1", optionId: "o-doing" }]);
  });
});

describe("StartTask.launch", () => {

  it("starts the agent in a worktree of its own, with the issue and its comments", async () => {
    const { start, agent, git } = setup();
    const worktree = join("/code/webapp", ".tako/worktrees/3-fix-the-login");
    await expect(start.launch(request, "/code/webapp")).resolves.toBe(worktree);
    expect(git.worktrees.get(worktree)).toBe("tako/3-fix-the-login");

    expect(agent.launches).toHaveLength(1);
    const [launch] = agent.launches;
    expect(launch).toMatchObject({ cwd: worktree, model: "opus" });
    // The rules may exist only in the user's checkout, not in the worktree.
    expect(launch?.prompt).toContain(join("/code/webapp", ".tako/rules.md"));
    expect(launch?.prompt).toContain("Work on GitHub issue #3 in octocat/webapp: Fix the login");
    expect(launch?.prompt).toContain("Make it work.");
    expect(launch?.prompt).toContain("Check mobile too.");
    expect(launch?.name).toBe("tako #3 Fix the login");
  });

  it("follows the task, replacing an older one for the same card", async () => {
    const { start, files } = setup();
    await start.launch(request, "/code/webapp");
    await start.launch(request, "/code/webapp");
    expect(JSON.parse(files.files.get(TASKS_FILE) ?? "[]")).toEqual([
      {
        itemId: "PVTI_1",
        projectId: "PVT_1",
        agentId: "claude-code",
        sessionId: "s2",
        repo: "octocat/webapp",
        root: "/code/webapp",
        worktree: join("/code/webapp", ".tako/worktrees/3-fix-the-login"),
        branch: "tako/3-fix-the-login",
        number: 3,
        title: "Fix the login",
      },
    ]);
  });

  it("fails clearly for an agent that is not installed", async () => {
    const { start } = setup();
    await expect(start.launch({ ...request, agentId: "codex" }, "/code/webapp")).rejects.toThrow('Unknown agent "codex"');
  });
});
