import { describe, expect, it } from "vitest";
import { InitProject, type InitChoices } from "../../src/app/init-project.js";
import type { ColumnField } from "../../src/domain/roles.js";
import type { ProjectSummary } from "../../src/ports/board-source.js";
import { FakeGitHub, MemoryFiles, fakeAgent } from "../fakes/index.js";

const project: ProjectSummary = {
  id: "PVT_1",
  number: 3,
  title: "tako",
  owner: "octocat",
  ownerType: "user",
  closed: false,
};

const status: ColumnField = {
  id: "F_status",
  name: "Status",
  options: [
    { id: "o-ready", name: "Ready for AI" },
    { id: "o-doing", name: "Em andamento" },
    { id: "o-review", name: "Para teste" },
  ],
};

const choices: InitChoices = {
  project,
  field: status,
  roles: {
    ready: { optionId: "o-ready", name: "Ready for AI" },
    in_progress: { optionId: "o-doing", name: "Em andamento" },
    delivery: { optionId: "o-review", name: "Para teste" },
  },
  agentId: "claude-code",
  baseBranch: "main",
};

function setup(files = new MemoryFiles()) {
  const init = new InitProject({
    board: new FakeGitHub([project], { PVT_1: [status] }),
    files,
    agents: [fakeAgent("claude-code", true), fakeAgent("codex", false)],
  });
  return { init, files };
}

const saved = (files: MemoryFiles) => JSON.parse(files.files.get("config.json") ?? "{}");

describe("InitProject.prepare", () => {
  it("returns projects, only the installed agents and the config state", async () => {
    const { init } = setup();
    const context = await init.prepare();
    expect(context.projects).toEqual([project]);
    expect(context.installedAgents.map((a) => a.id)).toEqual(["claude-code"]);
    expect(context.existingConfig).toEqual({ status: "missing" });
  });

  it("reports an existing but broken config instead of crashing", async () => {
    const { init } = setup(new MemoryFiles({ "config.json": "{ not json" }));
    const context = await init.prepare();
    expect(context.existingConfig.status).toBe("invalid");
  });
});

describe("InitProject.finish", () => {
  it("creates the config with the project and nothing else", async () => {
    const { init, files } = setup();
    const outcome = await init.finish(choices);

    expect(outcome).toMatchObject({ ok: true, replaced: false });
    const config = saved(files);
    expect(config.lastProjectId).toBe("PVT_1");
    expect(config.projects).toHaveLength(1);
    expect(config.projects[0].roles.ready.optionId).toBe("o-ready");
    expect(config.projects[0].project).not.toHaveProperty("closed");
    // Nothing written in the folder tako runs from: no rules, no .gitignore.
    expect([...files.files.keys()]).toEqual(["config.json"]);
  });

  it("keeps the projects added before", async () => {
    const { init, files } = setup();
    await init.finish(choices);
    await init.finish({ ...choices, project: { ...project, id: "PVT_2", title: "Other" } });

    expect(saved(files).projects.map((p: { project: { id: string } }) => p.project.id)).toEqual(["PVT_1", "PVT_2"]);
    expect(saved(files).lastProjectId).toBe("PVT_2");
  });

  it("replaces the setup of a project added again", async () => {
    const { init, files } = setup();
    await init.finish(choices);
    const outcome = await init.finish({ ...choices, baseBranch: "develop" });

    expect(outcome).toMatchObject({ ok: true, replaced: true });
    expect(saved(files).projects).toHaveLength(1);
    expect(saved(files).projects[0].baseBranch).toBe("develop");
  });

  it("never overwrites a config it cannot read", async () => {
    const { init, files } = setup(new MemoryFiles({ "config.json": "{ not json" }));
    const outcome = await init.finish(choices);

    expect(outcome).toMatchObject({ ok: false, kind: "invalid_config" });
    expect(files.files.get("config.json")).toBe("{ not json");
  });

  it("writes nothing when the role mapping is invalid", async () => {
    const { init, files } = setup();
    const outcome = await init.finish({ ...choices, roles: { ready: choices.roles.ready } });

    expect(outcome).toMatchObject({ ok: false, kind: "invalid_mapping" });
    expect(files.files.size).toBe(0);
  });
});
