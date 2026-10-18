import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { claudeArgs } from "../../src/infra/agents/claude-code.js";
import { GitCli } from "../../src/infra/git/git-cli.js";

describe("claudeArgs", () => {
  it("passes the model only when one was chosen, and the prompt last", () => {
    expect(claudeArgs({ cwd: "/x", model: "opus", prompt: "Do it" })).toEqual(["--model", "opus", "Do it"]);
    expect(claudeArgs({ cwd: "/x", model: undefined, prompt: "Do it" })).toEqual(["Do it"]);
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
    const dir = repoWith("portfolio", "git@github.com:LuizKirsch/portfolio.git");
    await expect(new GitCli().inspect(join(dir, "src"))).resolves.toEqual({
      root: resolve(dir),
      repo: "luizkirsch/portfolio",
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
