import { describe, expect, it } from "vitest";
import { TASKS_FILE } from "../../src/app/task-store.js";
import { attachTask, deliverCard, findPullRequest, syncTasks } from "../../src/app/track-tasks.js";
import type { Card } from "../../src/domain/board.js";
import { CONFIG_FILE, type ProjectConfig } from "../../src/domain/config.js";
import type { RunningTask } from "../../src/domain/task.js";
import { FakeGit, FakeGitHub, MemoryFiles, fakeAgent } from "../fakes/index.js";

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

const task = (itemId: string, sessionId: string, extra: Partial<RunningTask> = {}): RunningTask => ({
  itemId,
  projectId: "PVT_1",
  agentId: "claude-code",
  sessionId,
  repo: "octocat/webapp",
  root: "/code/webapp",
  worktree: `/code/webapp/.tako/worktrees/${itemId}`,
  branch: `tako/${itemId}`,
  number: 3,
  title: "Fix the login",
  ...extra,
});

function setup(tasks: RunningTask[]) {
  const files = new MemoryFiles({
    [CONFIG_FILE]: JSON.stringify({ version: 1, projects: [project], repos: { "octocat/webapp": "/code/webapp" } }),
    [TASKS_FILE]: JSON.stringify(tasks),
  });
  const github = new FakeGitHub([], {});
  const git = new FakeGit();
  const agent = fakeAgent("claude-code", true);
  const deps = { files, github, git, agents: [agent], sleep: async () => {} };
  const followed = (): RunningTask[] => JSON.parse(files.files.get(TASKS_FILE) ?? "[]");
  return { deps, github, git, agent, followed };
}

describe("syncTasks", () => {
  it("reports what each followed card's session is doing", async () => {
    const { deps, agent } = setup([task("I1", "a"), task("I2", "b")]);
    agent.sessionList.push({ id: "a", state: "working" }, { id: "b", state: "needs_input" });
    await expect(syncTasks(deps)).resolves.toEqual({
      states: { I1: { state: "working" }, I2: { state: "needs_input" } },
      delivered: [],
    });
  });

  it("delivers a finished task: push, pull request, then the card", async () => {
    const { deps, agent, github, git, followed } = setup([task("I1", "a"), task("I2", "b")]);
    agent.sessionList.push({ id: "a", state: "done" }, { id: "b", state: "working" });
    git.ahead["tako/I1"] = 2;

    git.worktrees.set("/code/webapp/.tako/worktrees/I1", "tako/I1");

    const result = await syncTasks(deps);
    expect(result).toEqual({
      states: { I2: { state: "working" } },
      delivered: [{ url: "https://github.com/octocat/webapp/pull/1", leftover: undefined }],
    });
    // Cleaned up: the session stopped, the worktree removed.
    expect(agent.stopped).toEqual(["a"]);
    expect(git.worktrees.size).toBe(0);
    expect(git.pushed).toEqual(["tako/I1"]);
    expect(github.pullRequests).toEqual([
      {
        repo: "octocat/webapp",
        base: "main",
        head: "tako/I1",
        title: "Fix the login",
        body: expect.stringMatching(/^Closes #3\n/),
      },
    ]);
    expect(github.moves).toEqual([{ projectId: "PVT_1", itemId: "I1", fieldId: "F1", optionId: "o-review" }]);
    expect(followed().map((t) => t.itemId)).toEqual(["I2"]);
  });

  it("moves the card back when a project workflow moves it after delivery", async () => {
    const { deps, agent, github, git } = setup([task("I1", "a")]);
    agent.sessionList.push({ id: "a", state: "done" });
    git.ahead["tako/I1"] = 1;
    // Like "Pull request linked to issue": the first check finds it moved away.
    let column = "o-doing";
    let checks = 0;
    github.moveCard = async (move) => {
      github.moves.push(move);
      column = move.optionId;
    };
    github.listCards = async () => {
      if (checks++ === 0) column = "o-doing";
      return [{ itemId: "I1", optionId: column } as Card];
    };

    await syncTasks(deps);
    expect(github.moves.map((m) => m.optionId)).toEqual(["o-review", "o-review"]);
    expect(column).toBe("o-review");
  });

  it("keeps a worktree git refuses to remove and says so", async () => {
    const { deps, agent, git } = setup([task("I1", "a")]);
    agent.sessionList.push({ id: "a", state: "done" });
    git.ahead["tako/I1"] = 1;
    git.dirty.add("/code/webapp/.tako/worktrees/I1");

    const { delivered } = await syncTasks(deps);
    expect(delivered[0]?.leftover).toContain("was kept: contains modified or untracked files");
  });

  it("does not deliver a branch without commits, and does not retry until the agent works again", async () => {
    const { deps, agent, github, git, followed } = setup([task("I1", "a")]);
    agent.sessionList.push({ id: "a", state: "done" });
    git.ahead["tako/I1"] = 0;

    const error = "The branch tako/I1 has no commits ahead of main.";
    await expect(syncTasks(deps)).resolves.toEqual({ states: { I1: { state: "done", error } }, delivered: [] });
    expect(followed()[0]?.error).toBe(error);

    // Still finished: no new attempt.
    git.ahead["tako/I1"] = 1;
    await syncTasks(deps);
    expect(git.pushed).toEqual([]);

    // The user asked the agent to fix it: it works, then finishes again.
    agent.sessionList[0] = { id: "a", state: "working" };
    await expect(syncTasks(deps)).resolves.toEqual({ states: { I1: { state: "working" } }, delivered: [] });
    agent.sessionList[0] = { id: "a", state: "done" };
    await expect(syncTasks(deps)).resolves.toMatchObject({ delivered: [{ url: expect.any(String) }] });
    expect(github.moves).toHaveLength(1);
  });

  it("reports a branch the agent never created", async () => {
    const { deps, agent } = setup([task("I1", "a")]);
    agent.sessionList.push({ id: "a", state: "done" });
    await expect(syncTasks(deps)).resolves.toMatchObject({
      states: { I1: { error: "The agent did not create the branch tako/I1." } },
    });
  });

  it("drops a task whose session was removed, but not when the agent cannot answer", async () => {
    const gone = setup([task("I1", "a")]);
    await syncTasks(gone.deps);
    expect(gone.followed()).toEqual([]);

    const down = setup([task("I1", "a")]);
    down.agent.sessions = async () => {
      throw new Error("not running");
    };
    await expect(syncTasks(down.deps)).resolves.toEqual({ states: { I1: { state: "working" } }, delivered: [] });
    expect(down.followed()).toHaveLength(1);
  });
});

describe("attachTask", () => {
  it("opens the session of the card", async () => {
    const { deps, agent } = setup([task("I1", "a")]);
    await attachTask(deps, "I1");
    await attachTask(deps, "unknown");
    expect(agent.attached).toEqual(["a"]);
  });
});

describe("deliverCard", () => {
  const card: Card = {
    itemId: "I1",
    optionId: "o-review",
    kind: "issue",
    title: "Fix the login",
    number: 3,
    repo: "octocat/webapp",
    closed: false,
    body: "",
    labels: [],
    assignees: [],
  };

  it("delivers a card that was not delivered automatically and stops following it", async () => {
    const { deps, git, github, followed } = setup([]);
    git.ahead["tako/3-fix-the-login"] = 1;

    await expect(findPullRequest(deps, card)).resolves.toBeUndefined();
    await expect(deliverCard(deps, card, project)).resolves.toMatchObject({ url: "https://github.com/octocat/webapp/pull/1" });
    expect(git.pushed).toEqual(["tako/3-fix-the-login"]);
    expect(github.moves).toHaveLength(1);
    await expect(findPullRequest(deps, card)).resolves.toMatchObject({ number: 1, state: "open" });
  });

  it("uses the followed task's branch and session, and stops following it", async () => {
    const { deps, git, agent, followed } = setup([task("I1", "a", { error: "push refused" })]);
    git.ahead["tako/I1"] = 1;
    await deliverCard(deps, card, project);
    expect(git.pushed).toEqual(["tako/I1"]);
    expect(agent.stopped).toEqual(["a"]);
    expect(followed()).toEqual([]);
  });

  it("explains a repository tako has no folder for", async () => {
    const { deps } = setup([]);
    await expect(deliverCard(deps, { ...card, repo: "octocat/other" }, project)).rejects.toThrow("does not know where");
  });
});
