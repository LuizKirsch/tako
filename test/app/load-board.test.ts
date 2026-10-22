import { describe, expect, it } from "vitest";
import { loadBoard } from "../../src/app/load-board.js";
import type { Card } from "../../src/domain/board.js";
import { CONFIG_FILE, type ProjectConfig, type TakoConfig } from "../../src/domain/config.js";
import type { ColumnField } from "../../src/domain/roles.js";
import { FakeGitHub, MemoryFiles, fakeAgent } from "../fakes/index.js";

const status: ColumnField = {
  id: "F_status",
  name: "Status",
  options: [
    { id: "o-ready", name: "Ready for AI" },
    { id: "o-doing", name: "Doing" },
    { id: "o-review", name: "Ready for review" },
  ],
};

const project = (id: string, title: string): ProjectConfig => ({
  project: { id, number: 2, title, owner: "octocat", ownerType: "user" },
  columnField: { id: "F_status", name: "Status" },
  roles: {
    ready: { optionId: "o-ready", name: "Ready for AI" },
    in_progress: { optionId: "o-doing", name: "Doing" },
    delivery: { optionId: "o-review", name: "Ready for review" },
  },
  agent: { default: "claude-code" },
  baseBranch: "main",
});

const config: TakoConfig = { version: 1, lastProjectId: "PVT_1", projects: [project("PVT_1", "Website")] };

const cards: Card[] = [
  {
    itemId: "I1",
    optionId: "o-ready",
    kind: "issue",
    title: "Do it",
    number: 3,
    closed: false,
    body: "",
    labels: [],
    assignees: [],
  },
];

const configured = (value: TakoConfig = config) => new MemoryFiles({ [CONFIG_FILE]: JSON.stringify(value) });

describe("loadBoard", () => {
  it("asks for init when there is no config or no project in it", async () => {
    const github = new FakeGitHub([], {});
    await expect(loadBoard({ board: github, files: new MemoryFiles(), agents: [] })).resolves.toEqual({ status: "no_config" });
    const empty = configured({ version: 1, projects: [] });
    await expect(loadBoard({ board: github, files: empty, agents: [] })).resolves.toEqual({ status: "no_config" });
  });

  describe("with several projects", () => {
    const two: TakoConfig = {
      version: 1,
      lastProjectId: "PVT_2",
      projects: [project("PVT_1", "Website"), project("PVT_2", "Side project")],
    };
    const github = new FakeGitHub([], { PVT_1: [status], PVT_2: [status] }, { PVT_1: cards, PVT_2: [] });
    const lastOpened = (files: MemoryFiles) => JSON.parse(files.files.get(CONFIG_FILE) ?? "{}").lastProjectId;

    it("opens the last project used and lists all of them", async () => {
      const result = await loadBoard({ board: github, files: configured(two), agents: [] });

      if (result.status !== "ok") throw new Error(result.status);
      expect(result.project.project.title).toBe("Side project");
      expect(result.projects.map((p) => p.title)).toEqual(["Website", "Side project"]);
    });

    it("opens the requested project and remembers it for next time", async () => {
      const files = configured(two);
      const result = await loadBoard({ board: github, files, agents: [] }, "PVT_1");

      if (result.status !== "ok") throw new Error(result.status);
      expect(result.project.project.id).toBe("PVT_1");
      expect(result.columns[0]?.cards).toHaveLength(1);
      expect(lastOpened(files)).toBe("PVT_1");
    });

    it("falls back to the default when the requested project is gone", async () => {
      const result = await loadBoard({ board: github, files: configured(two), agents: [] }, "PVT_gone");

      if (result.status !== "ok") throw new Error(result.status);
      expect(result.project.project.id).toBe("PVT_2");
    });

    it("does not rewrite the config when the last project is opened again", async () => {
      const files = configured(two);
      const before = files.files.get(CONFIG_FILE);
      await loadBoard({ board: github, files, agents: [] });
      expect(files.files.get(CONFIG_FILE)).toBe(before);
    });
  });

  it("reports an invalid config", async () => {
    const files = new MemoryFiles({ [CONFIG_FILE]: "{" });
    const result = await loadBoard({ board: new FakeGitHub([], {}), files, agents: [] });
    expect(result.status).toBe("invalid_config");
  });

  it("groups the project cards into the configured columns", async () => {
    const github = new FakeGitHub([], { PVT_1: [status] }, { PVT_1: cards });
    const result = await loadBoard({ board: github, files: configured(), agents: [] });

    if (result.status !== "ok") throw new Error(result.status);
    expect(result.drift).toEqual([]);
    expect(result.columns.map((c) => [c.name, c.role, c.cards.length])).toEqual([
      ["Ready for AI", "ready", 1],
      ["Doing", "in_progress", 0],
      ["Ready for review", "delivery", 0],
    ]);
  });

  it("still opens, with drift, when a mapped column was removed", async () => {
    const shrunk = { ...status, options: status.options.filter((o) => o.id !== "o-review") };
    const github = new FakeGitHub([], { PVT_1: [shrunk] }, { PVT_1: cards });
    const result = await loadBoard({ board: github, files: configured(), agents: [] });

    if (result.status !== "ok") throw new Error(result.status);
    expect(result.drift).toMatchObject([{ kind: "role_option_missing", role: "delivery" }]);
    expect(result.columns).toHaveLength(2);
  });

  it("offers only the agents installed on this machine", async () => {
    const github = new FakeGitHub([], { PVT_1: [status] }, { PVT_1: cards });
    const agents = [fakeAgent("claude-code", true), fakeAgent("codex", false)];
    const result = await loadBoard({ board: github, files: configured(), agents });

    if (result.status !== "ok") throw new Error(result.status);
    expect(result.agents.map((a) => a.id)).toEqual(["claude-code"]);
  });

  it("has no columns when the column field itself is gone", async () => {
    const github = new FakeGitHub([], { PVT_1: [] }, { PVT_1: cards });
    const result = await loadBoard({ board: github, files: configured(), agents: [] });

    if (result.status !== "ok") throw new Error(result.status);
    expect(result.drift).toEqual([{ kind: "field_missing", fieldName: "Status" }]);
    expect(result.columns).toEqual([]);
  });
});
