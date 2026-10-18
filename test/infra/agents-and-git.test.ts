import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseSessions, sessionIdFrom, startArgs } from "../../src/infra/agents/claude-code.js";
import { GitCli } from "../../src/infra/git/git-cli.js";

describe("Claude Code background sessions", () => {
  const launch = { cwd: "/x", prompt: "Do it", name: "tako #3" };

  it("starts in the background, in auto mode, with the model only when chosen", () => {
    expect(startArgs({ ...launch, model: "opus" })).toEqual([
      "--bg", "--name", "tako #3", "--permission-mode", "auto", "--model", "opus", "Do it",
    ]);
    expect(startArgs({ ...launch, model: undefined })).not.toContain("--model");
  });

  it("adds a helper subagent on the cheaper model for a main+helper choice", () => {
    const args = startArgs({ ...launch, model: "opus+haiku" });
    expect(args.slice(5, 7)).toEqual(["--model", "opus"]);
    const agents = JSON.parse(args[args.indexOf("--agents") + 1] ?? "{}");
    expect(agents.helper.model).toBe("haiku");
    expect(args[args.indexOf("--append-system-prompt") + 1]).toContain("`helper` subagent");
    expect(args.at(-1)).toBe("Do it");
  });

  it("reads the session id from the output of --bg", () => {
    expect(sessionIdFrom(String.raw`Starting background service…
backgrounded · 8795f909 · tako #3`)).toBe("8795f909");
    expect(sessionIdFrom("Workspace not trusted.")).toBeUndefined();
  });

  it("maps background sessions to agent states and skips interactive ones", () => {
    const json = JSON.stringify([
      { id: "a1", kind: "background", state: "working" },
      { id: "a2", kind: "background", status: "waiting", waitingFor: "input needed", state: "blocked" },
      { id: "a3", kind: "background", status: "idle", state: "done" },
      { id: "a4", kind: "background", state: "failed" },
      { id: "a5", kind: "background", state: "something-new" },
      { pid: 1, kind: "interactive", status: "busy" },
    ]);
    expect(parseSessions(json)).toEqual([
      { id: "a1", state: "working" },
      { id: "a2", state: "needs_input" },
      { id: "a3", state: "done" },
      { id: "a4", state: "failed" },
      { id: "a5", state: "working" },
    ]);
  });
});

// Runs the real git against throwaway folders: nothing touches the network.
describe("GitCli.inspect", () => {
  const base = mkdtempSync(join(tmpdir(), "tako-git-"));
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  const repoWith = (name: string, origin?: string) => {
    const dir = join(base, name);
    mkdirSync(join(dir, "src"), { recursive: true });
    execFileSync("git", ["init", "-q", dir]);
    if (origin) execFileSync("git", ["-C", dir, "remote", "add", "origin", origin]);
    return dir;
  };

  it("finds the root and the GitHub repository, even from a subfolder", async () => {
    const dir = repoWith("webapp", "git@github.com:octocat/webapp.git");
    await expect(new GitCli().inspect(join(dir, "src"))).resolves.toEqual({
      root: resolve(dir),
      repo: "octocat/webapp",
    });
  });

  it("has no repository when there is no origin", async () => {
    const dir = repoWith("local-only");
    await expect(new GitCli().inspect(dir)).resolves.toEqual({ root: resolve(dir), repo: undefined });
  });

  it("returns nothing for a folder outside any repository or a missing one", async () => {
    const plain = join(base, "plain");
    mkdirSync(plain);
    await expect(new GitCli().inspect(plain)).resolves.toBeUndefined();
    await expect(new GitCli().inspect(join(base, "missing"))).resolves.toBeUndefined();
  });
});

// Delivery against a local bare repository standing in for GitHub.
describe("GitCli delivery", () => {
  const base = mkdtempSync(join(tmpdir(), "tako-push-"));
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  const run = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });

  const setup = (name: string) => {
    const remote = join(base, `${name}.git`);
    const dir = join(base, name);
    execFileSync("git", ["init", "-q", "--bare", remote]);
    execFileSync("git", ["init", "-q", "-b", "main", dir]);
    run(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "base");
    run(dir, "remote", "add", "origin", remote);
    run(dir, "switch", "-q", "-c", "tako/3-fix");
    run(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "fix (#3)");
    return { dir, remote };
  };

  it("counts the branch's commits, pushes it, and knows a missing branch", async () => {
    const { dir, remote } = setup("push");
    const git = new GitCli();
    await expect(git.commitsAhead(dir, "main", "tako/3-fix")).resolves.toBe(1);
    await expect(git.commitsAhead(dir, "main", "tako/9-none")).resolves.toBeUndefined();

    await git.push(dir, "tako/3-fix");
    expect(String(run(remote, "branch", "--list", "tako/3-fix"))).toContain("tako/3-fix");
    await expect(git.push(dir, "tako/9-none")).rejects.toThrow("git push failed");
  });

  it("works in a worktree inside the repository, hidden from git status, and removes it", async () => {
    const { dir } = setup("worktree");
    run(dir, "push", "-q", "origin", "main");
    run(dir, "switch", "-q", "main");
    const git = new GitCli();
    const path = join(dir, ".tako", "worktrees", "5-new");

    await git.addWorktree(dir, path, "tako/5-new", "main");
    expect(String(run(path, "rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("tako/5-new");
    // Again: reused, not an error. The user's checkout stays on main and clean.
    await git.addWorktree(dir, path, "tako/5-new", "main");
    expect(String(run(dir, "rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("main");
    expect(String(run(dir, "status", "--porcelain"))).toBe("");

    writeFileSync(join(path, "draft.txt"), "not committed");
    await expect(git.removeWorktree(dir, path)).rejects.toThrow("git worktree remove failed");
    rmSync(join(path, "draft.txt"));
    await git.removeWorktree(dir, path);
    expect(existsSync(path)).toBe(false);
  });
});
