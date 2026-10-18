import { describe, expect, it } from "vitest";
import { InitProject, type InitChoices } from "../../src/app/init-project.js";
import type { ColumnField } from "../../src/domain/roles.js";
import type { ProjectSummary } from "../../src/ports/github.js";
import { RECOMMENDED_RULES } from "../../src/templates/recommended-rules.js";
import { FakeGitHub, MemoryFiles, fakeAgent } from "../fakes/index.js";

const project: ProjectSummary = {
  id: "PVT_1",
  number: 3,
  title: "tako",
  owner: "LuizKirsch",
  ownerType: "user",
  closed: false,
};

const status: ColumnField = {
  id: "F_status",
  name: "Status",
  options: [
    { id: "o-ready", name: "Pronto para IA" },
    { id: "o-doing", name: "Em andamento" },
    { id: "o-review", name: "Para teste" },
  ],
};

const choices: InitChoices = {
  project,
  field: status,
  roles: {
    ready: { optionId: "o-ready", name: "Pronto para IA" },
    in_progress: { optionId: "o-doing", name: "Em andamento" },
    delivery: { optionId: "o-review", name: "Para teste" },
  },
  agentId: "claude-code",
  baseBranch: "main",
};

function setup(files = new MemoryFiles()) {
  const init = new InitProject({
    github: new FakeGitHub([project], { PVT_1: [status] }),
    files,
    agents: [fakeAgent("claude-code", true), fakeAgent("codex", false)],
  });
  return { init, files };
}

describe("InitProject.prepare", () => {
  it("returns projects, only the installed agents and the config state", async () => {
    const { init } = setup();
    const context = await init.prepare();
    expect(context.projects).toEqual([project]);
    expect(context.installedAgents.map((a) => a.id)).toEqual(["claude-code"]);
    expect(context.existingConfig).toEqual({ status: "missing" });
  });

  it("reports an existing but broken config instead of crashing", async () => {
    const { init } = setup(new MemoryFiles({ ".tako.json": "{ not json" }));
    const context = await init.prepare();
    expect(context.existingConfig.status).toBe("invalid");
  });
});

describe("InitProject.finish", () => {
  it("saves the config and creates the recommended rules file", async () => {
    const { init, files } = setup();
    const outcome = await init.finish(choices);

    expect(outcome).toMatchObject({ ok: true, rulesFileCreated: true });
    const saved = JSON.parse(files.files.get(".tako.json") ?? "{}");
    expect(saved.roles.ready.optionId).toBe("o-ready");
    expect(saved.project).not.toHaveProperty("closed");
    expect(files.files.get(".tako/rules.md")).toBe(RECOMMENDED_RULES);
  });

  it("adds the config to .gitignore so it is never committed", async () => {
    const { init, files } = setup(new MemoryFiles({ ".gitignore": "node_modules/\n" }));
    const outcome = await init.finish(choices);

    expect(outcome).toMatchObject({ ok: true, gitignoreUpdated: true });
    expect(files.files.get(".gitignore")).toBe("node_modules/\n.tako.json\n");
  });

  it("leaves .gitignore alone when the config is already ignored", async () => {
    const { init, files } = setup(new MemoryFiles({ ".gitignore": "/.tako.json\n" }));
    const outcome = await init.finish(choices);

    expect(outcome).toMatchObject({ ok: true, gitignoreUpdated: false });
    expect(files.files.get(".gitignore")).toBe("/.tako.json\n");
  });

  it("never overwrites rules the user already has", async () => {
    const { init, files } = setup(new MemoryFiles({ ".tako/rules.md": "my rules" }));
    const outcome = await init.finish(choices);

    expect(outcome).toMatchObject({ ok: true, rulesFileCreated: false });
    expect(files.files.get(".tako/rules.md")).toBe("my rules");
  });

  it("writes nothing when the role mapping is invalid", async () => {
    const { init, files } = setup();
    const outcome = await init.finish({ ...choices, roles: { ready: choices.roles.ready } });

    expect(outcome.ok).toBe(false);
    expect(files.files.size).toBe(0);
  });
});
