import { describe, expect, it } from "vitest";
import { createConfig, detectConfigDrift, parseConfig, type GhRelayConfig } from "../../src/domain/config.js";
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

const validConfig: GhRelayConfig = {
  version: 1,
  project: { id: "PVT_1", number: 3, title: "gh-relay", owner: "LuizKirsch", ownerType: "user" },
  columnField: { id: "F1", name: "Status" },
  roles: {
    ready: { optionId: "o-ready", name: "Pronto para IA" },
    in_progress: { optionId: "o-doing", name: "Em andamento" },
    delivery: { optionId: "o-review", name: "Para teste" },
  },
  agent: { default: "claude-code" },
  baseBranch: "main",
  rulesFile: ".gh-relay/rules.md",
};

describe("createConfig", () => {
  it("builds a config with defaults when the mapping is valid", () => {
    const result = createConfig({
      project: validConfig.project,
      field,
      roles: validConfig.roles,
      agentId: "claude-code",
      baseBranch: "main",
    });
    expect(result).toEqual({ ok: true, value: validConfig });
  });

  it("refuses an invalid mapping and returns the reasons", () => {
    const result = createConfig({
      project: validConfig.project,
      field,
      roles: { ready: validConfig.roles.ready },
      agentId: "claude-code",
      baseBranch: "main",
    });
    expect(result.ok).toBe(false);
  });
});

describe("parseConfig", () => {
  it("round-trips a valid config through JSON", () => {
    const raw: unknown = JSON.parse(JSON.stringify(validConfig));
    expect(parseConfig(raw)).toEqual({ ok: true, value: validConfig });
  });

  it("treats a null optional role as absent", () => {
    const raw = { ...validConfig, roles: { ...validConfig.roles, blocked: null } };
    expect(parseConfig(raw)).toEqual({ ok: true, value: validConfig });
  });

  it("points to the exact key that is wrong", () => {
    const raw = { ...validConfig, version: 2, roles: { ready: validConfig.roles.ready }, baseBranch: "" };
    const result = parseConfig(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.path)).toEqual([
      "version",
      "roles.in_progress",
      "roles.delivery",
      "baseBranch",
    ]);
  });

  it("rejects something that is not an object", () => {
    expect(parseConfig([])).toEqual({ ok: false, errors: [{ path: "$", message: "must be a JSON object" }] });
  });
});

describe("detectConfigDrift", () => {
  it("returns nothing when every option still exists", () => {
    expect(detectConfigDrift(validConfig, [field])).toEqual([]);
  });

  it("does not treat a renamed column as drift", () => {
    const renamed: ColumnField = {
      ...field,
      options: field.options.map((o) => (o.id === "o-ready" ? { ...o, name: "Ready for AI" } : o)),
    };
    expect(detectConfigDrift(validConfig, [renamed])).toEqual([]);
  });

  it("reports a removed column with the role it broke", () => {
    const removed: ColumnField = { ...field, options: field.options.filter((o) => o.id !== "o-doing") };
    expect(detectConfigDrift(validConfig, [removed])).toEqual([
      { kind: "role_option_missing", role: "in_progress", binding: validConfig.roles.in_progress },
    ]);
  });

  it("reports a removed field", () => {
    expect(detectConfigDrift(validConfig, [])).toEqual([{ kind: "field_missing", fieldName: "Status" }]);
  });
});
