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

describe("GhCliGitHub.listCards", () => {
  // ponytail: hand-written shape; the full parser tests return with an anonymized fixture.
  it("keeps the issue id so its comments can be fetched later", async () => {
    const stdout = JSON.stringify({
      data: {
        node: {
          items: {
            nodes: [
              {
                id: "PVTI_1",
                isArchived: false,
                fieldValues: { nodes: [] },
                content: { __typename: "Issue", id: "I_1", number: 1, title: "Issue", body: "" },
              },
              {
                id: "PVTI_2",
                isArchived: false,
                fieldValues: { nodes: [] },
                content: { __typename: "DraftIssue", title: "Idea", body: "" },
              },
            ],
          },
        },
      },
    });
    const cards = await new GhCliGitHub(fakeRunner({ stdout })).listCards("PVT_1", "F_status");
    expect(cards.map((c) => c.contentId)).toEqual(["I_1", undefined]);
  });
});

describe("GhCliGitHub.listComments", () => {
  it("reads author, body and date, and passes the issue id as a variable", async () => {
    const stdout = JSON.stringify({
      data: {
        node: {
          comments: {
            nodes: [
              { author: { login: "alice" }, body: "First", createdAt: "2026-01-02T10:00:00Z" },
              { author: null, body: "From a deleted account", createdAt: "2026-01-03T10:00:00Z" },
            ],
          },
        },
      },
    });
    const runner = fakeRunner({ stdout });
    const comments = await new GhCliGitHub(runner).listComments("I_1");

    expect(comments).toEqual([
      { author: "alice", body: "First", createdAt: "2026-01-02T10:00:00Z" },
      { author: "ghost", body: "From a deleted account", createdAt: "2026-01-03T10:00:00Z" },
    ]);
    expect(runner.calls[0]).toContain("id=I_1");
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

describe("GhCliGitHub.moveCard", () => {
  it("sends the mutation with every id as a variable", async () => {
    const runner = fakeRunner({ stdout: JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_1" } } } }) });
    await new GhCliGitHub(runner).moveCard({ projectId: "PVT_1", itemId: "PVTI_1", fieldId: "F1", optionId: "o-doing" });

    const args = runner.calls[0] ?? [];
    expect(args.some((a) => a.includes("updateProjectV2ItemFieldValue"))).toBe(true);
    expect(args).toEqual(expect.arrayContaining(["projectId=PVT_1", "itemId=PVTI_1", "fieldId=F1", "optionId=o-doing"]));
  });
});

describe("GhCliGitHub.openPullRequest", () => {
  const input = { repo: "LuizKirsch/portfolio", base: "main", head: "tako/3-fix", title: "Fix", body: "Closes #3" };

  // Answers the lookup first, then the creation.
  const runner = (...stdouts: unknown[]) => {
    const calls: string[][] = [];
    const run = async (args: string[]) => {
      calls.push(args);
      return { exitCode: 0, stdout: JSON.stringify(stdouts[calls.length - 1]), stderr: "" };
    };
    return Object.assign(run, { calls });
  };

  it("creates the pull request in the repository", async () => {
    const run = runner(
      { data: { repository: { id: "R_1", pullRequests: { nodes: [] } } } },
      { data: { createPullRequest: { pullRequest: { url: "https://github.com/LuizKirsch/portfolio/pull/7" } } } },
    );
    await expect(new GhCliGitHub(run).openPullRequest(input)).resolves.toBe("https://github.com/LuizKirsch/portfolio/pull/7");
    expect(run.calls[0]).toEqual(expect.arrayContaining(["owner=LuizKirsch", "name=portfolio", "head=tako/3-fix"]));
    expect(run.calls[1]).toEqual(expect.arrayContaining(["repositoryId=R_1", "base=main", "title=Fix", "body=Closes #3"]));
  });

  it("returns the open pull request of the branch instead of creating another", async () => {
    const run = runner({ data: { repository: { id: "R_1", pullRequests: { nodes: [{ number: 5, url: "https://x/pull/5", state: "OPEN" }] } } } });
    await expect(new GhCliGitHub(run).openPullRequest(input)).resolves.toBe("https://x/pull/5");
    expect(run.calls).toHaveLength(1);
  });

  it("finds the newest pull request of the branch in any state", async () => {
    const run = runner({ data: { repository: { id: "R_1", pullRequests: { nodes: [{ number: 4, url: "https://x/pull/4", state: "MERGED" }] } } } });
    await expect(new GhCliGitHub(run).findPullRequest("LuizKirsch/portfolio", "tako/3-fix")).resolves.toEqual({
      number: 4,
      url: "https://x/pull/4",
      state: "merged",
    });
  });
});
