import { describe, expect, it } from "vitest";
import {
  addProject,
  chooseProject,
  createProjectConfig,
  detectConfigDrift,
  parseConfig,
  rememberRepo,
  repoPath,
  type ProjectConfig,
  type TakoConfig,
} from "../../src/domain/config.js";
import type { ColumnField } from "../../src/domain/roles.js";

const field: ColumnField = {
  id: "F1",
  name: "Status",
  options: [
    { id: "o-ready", name: "Pronto para IA" },
    { id: "o-doing", name: "Em andamento" },
    { id: "o-review", name: "Para teste" },
  ],
};

const project = (id: string, title = id): ProjectConfig => ({
  project: { id, number: 3, title, owner: "LuizKirsch", ownerType: "user" },
  columnField: { id: "F1", name: "Status" },
  roles: {
    ready: { optionId: "o-ready", name: "Pronto para IA" },
    in_progress: { optionId: "o-doing", name: "Em andamento" },
    delivery: { optionId: "o-review", name: "Para teste" },
  },
  agent: { default: "claude-code" },
  baseBranch: "main",
});

const validProject = project("PVT_1", "tako");
const validConfig: TakoConfig = { version: 1, lastProjectId: "PVT_1", projects: [validProject] };

describe("createProjectConfig", () => {
  it("builds a project config when the mapping is valid", () => {
    const result = createProjectConfig({
      project: validProject.project,
      field,
      roles: validProject.roles,
      agentId: "claude-code",
      baseBranch: "main",
    });
    expect(result).toEqual({ ok: true, value: validProject });
  });

  it("refuses an invalid mapping and returns the reasons", () => {
    const result = createProjectConfig({
      project: validProject.project,
      field,
      roles: { ready: validProject.roles.ready },
      agentId: "claude-code",
      baseBranch: "main",
    });
    expect(result.ok).toBe(false);
  });
});

describe("addProject", () => {
  it("creates the config with the first project and opens it next", () => {
    expect(addProject(undefined, validProject)).toEqual(validConfig);
  });

  it("appends a new project and makes it the last opened", () => {
    const config = addProject(validConfig, project("PVT_2"));
    expect(config.projects.map((p) => p.project.id)).toEqual(["PVT_1", "PVT_2"]);
    expect(config.lastProjectId).toBe("PVT_2");
  });

  it("replaces a project added again, keeping its position", () => {
    const start = addProject(addProject(validConfig, project("PVT_2")), project("PVT_3"));
    const updated = { ...project("PVT_2"), baseBranch: "develop" };
    const config = addProject(start, updated);

    expect(config.projects.map((p) => p.project.id)).toEqual(["PVT_1", "PVT_2", "PVT_3"]);
    expect(config.projects[1]?.baseBranch).toBe("develop");
  });
});

describe("chooseProject", () => {
  const config: TakoConfig = { version: 1, lastProjectId: "PVT_2", projects: [project("PVT_1"), project("PVT_2")] };

  it("opens the requested project", () => {
    expect(chooseProject(config, "PVT_1")?.project.id).toBe("PVT_1");
  });

  it("opens the last project when none is requested", () => {
    expect(chooseProject(config)?.project.id).toBe("PVT_2");
  });

  it("falls back to the first project when the last one is gone", () => {
    expect(chooseProject({ ...config, lastProjectId: "PVT_gone" })?.project.id).toBe("PVT_1");
  });

  it("returns nothing for an unknown requested project or an empty config", () => {
    expect(chooseProject(config, "PVT_gone")).toBeUndefined();
    expect(chooseProject({ version: 1, projects: [] })).toBeUndefined();
  });
});

describe("parseConfig", () => {
  it("round-trips a valid config through JSON", () => {
    const raw: unknown = JSON.parse(JSON.stringify(validConfig));
    expect(parseConfig(raw)).toEqual({ ok: true, value: validConfig });
  });

  it("accepts a config without a last project", () => {
    const raw = { version: 1, projects: [validProject] };
    expect(parseConfig(raw)).toEqual({ ok: true, value: raw });
  });

  it("treats a null optional role as absent and drops unknown keys", () => {
    const raw = {
      ...validConfig,
      projects: [{ ...validProject, roles: { ...validProject.roles, blocked: null }, rulesFile: ".tako/rules.md" }],
    };
    expect(parseConfig(raw)).toEqual({ ok: true, value: validConfig });
  });

  it("points to the exact key that is wrong, project by project", () => {
    const broken = { ...validProject, roles: { ready: validProject.roles.ready }, baseBranch: "" };
    const result = parseConfig({ version: 2, projects: [validProject, broken] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.path)).toEqual([
      "version",
      "projects[1].roles.in_progress",
      "projects[1].roles.delivery",
      "projects[1].baseBranch",
    ]);
  });

  it("rejects a missing project list or something that is not an object", () => {
    expect(parseConfig({ version: 1 })).toMatchObject({ ok: false, errors: [{ path: "projects" }] });
    expect(parseConfig([])).toEqual({ ok: false, errors: [{ path: "$", message: "must be a JSON object" }] });
  });
});

describe("detectConfigDrift", () => {
  it("returns nothing when every option still exists", () => {
    expect(detectConfigDrift(validProject, [field])).toEqual([]);
  });

  it("does not treat a renamed column as drift", () => {
    const renamed: ColumnField = {
      ...field,
      options: field.options.map((o) => (o.id === "o-ready" ? { ...o, name: "Ready for AI" } : o)),
    };
    expect(detectConfigDrift(validProject, [renamed])).toEqual([]);
  });

  it("reports a removed column with the role it broke", () => {
    const removed: ColumnField = { ...field, options: field.options.filter((o) => o.id !== "o-doing") };
    expect(detectConfigDrift(validProject, [removed])).toEqual([
      { kind: "role_option_missing", role: "in_progress", binding: validProject.roles.in_progress },
    ]);
  });

  it("reports a removed field", () => {
    expect(detectConfigDrift(validProject, [])).toEqual([{ kind: "field_missing", fieldName: "Status" }]);
  });
});

describe("repository folders", () => {
  it("remembers a folder per repository, case-insensitively", () => {
    const config = rememberRepo(validConfig, "LuizKirsch/Portfolio", "C:/code/portfolio");
    expect(repoPath(config, "luizkirsch/portfolio")).toBe("C:/code/portfolio");
    expect(repoPath(config, "LuizKirsch/other")).toBeUndefined();
  });

  it("keeps the folders when a project is added", () => {
    const config = addProject(rememberRepo(validConfig, "a/b", "/code/b"), project("PVT_2"));
    expect(repoPath(config, "a/b")).toBe("/code/b");
  });

  it("parses the folders and reports a bad one", () => {
    const raw = { ...validConfig, repos: { "LuizKirsch/Portfolio": "/code/portfolio" } };
    expect(parseConfig(raw)).toEqual({
      ok: true,
      value: { ...validConfig, repos: { "luizkirsch/portfolio": "/code/portfolio" } },
    });
    expect(parseConfig({ ...validConfig, repos: { "a/b": "" } })).toMatchObject({ ok: false, errors: [{ path: "repos.a/b" }] });
  });
});
