import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GhCliGitHub } from "../../src/infra/github/gh-cli-github.js";
import type { GhResult, GhRunner } from "../../src/infra/github/gh-runner.js";
import { GitHubError } from "../../src/ports/github.js";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/github/${name}`, import.meta.url), "utf8");

// A runner that records the args and answers with a canned result.
function fakeRunner(result: Partial<GhResult>): GhRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    return { exitCode: 0, stdout: "", stderr: "", ...result };
  };
  return Object.assign(run, { calls });
}

describe("GhCliGitHub.listProjects", () => {
  it("returns user and org projects, open ones first, skipping denied nodes", async () => {
    const github = new GhCliGitHub(fakeRunner({ stdout: fixture("list-projects.sample.json") }));
    const projects = await github.listProjects();
    expect(projects.map((p) => `${p.owner}/${p.number} ${p.ownerType}${p.closed ? " closed" : ""}`)).toEqual([
      "acme/7 organization",
      "LuizKirsch/3 user",
      "LuizKirsch/1 user closed",
    ]);
  });
});

describe("GhCliGitHub.listColumnFields", () => {
  it("keeps only single-select fields and passes the project id as a variable", async () => {
    const runner = fakeRunner({ stdout: fixture("list-column-fields.sample.json") });
    const fields = await new GhCliGitHub(runner).listColumnFields("PVT_user_relay");

    expect(fields.map((f) => f.name)).toEqual(["Status", "Priority"]);
    expect(fields[0]?.options).toHaveLength(6);
    expect(runner.calls[0]).toContain("projectId=PVT_user_relay");
  });
});

describe("GhCliGitHub.fixAuth", () => {
  const withExit = (exitCode: number) => {
    const calls: string[][] = [];
    const github = new GhCliGitHub(fakeRunner({}), async (args) => {
      calls.push(args);
      return exitCode;
    });
    return { github, calls };
  };

  it("logs in with the project scope when not authenticated", async () => {
    const { github, calls } = withExit(0);
    await expect(github.fixAuth("not_authenticated")).resolves.toBe(true);
    expect(calls).toEqual([["auth", "login", "--hostname", "github.com", "--scopes", "project"]]);
  });

  it("refreshes the token when only the project scope is missing", async () => {
    const { github, calls } = withExit(0);
    await github.fixAuth("missing_project_scope");
    expect(calls).toEqual([["auth", "refresh", "--hostname", "github.com", "--scopes", "project"]]);
  });

  it("reports failure when gh exits non-zero", async () => {
    await expect(withExit(1).github.fixAuth("not_authenticated")).resolves.toBe(false);
  });
});

describe("GhCliGitHub errors", () => {
  const failWith = (result: Partial<GhResult>) => new GhCliGitHub(fakeRunner({ exitCode: 1, ...result })).listProjects();

  it("explains a missing project scope", async () => {
    const stdout = JSON.stringify({
      errors: [{ type: "INSUFFICIENT_SCOPES", message: "Your token has not been granted the required scopes" }],
    });
    await expect(failWith({ stdout })).rejects.toMatchObject({ kind: "missing_project_scope" });
  });

  it("explains a missing login", async () => {
    // Real gh 2.97 output with no credentials (exit code 4).
    const stderr =
      "To get started with GitHub CLI, please run:  gh auth login\n" +
      "Alternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.";
    await expect(failWith({ exitCode: 4, stderr })).rejects.toMatchObject({ kind: "not_authenticated" });
  });

  it("keeps the original message for unknown failures", async () => {
    const error = await failWith({ stderr: "HTTP 502: Bad Gateway" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe("unknown");
    expect((error as GitHubError).message).toContain("HTTP 502");
  });

  it("accepts partial data even when GitHub also reports errors", async () => {
    const stdout = JSON.stringify({
      data: { viewer: { login: "me", projectsV2: { nodes: [] }, organizations: { nodes: [null] } } },
      errors: [{ type: "FORBIDDEN", message: "org denied" }],
    });
    await expect(failWith({ stdout })).resolves.toEqual([]);
  });
});
