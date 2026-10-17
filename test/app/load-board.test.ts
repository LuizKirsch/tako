import { describe, expect, it } from "vitest";
import { loadBoard } from "../../src/app/load-board.js";
import type { Card } from "../../src/domain/board.js";
import { CONFIG_FILE, type GhRelayConfig } from "../../src/domain/config.js";
import type { ColumnField } from "../../src/domain/roles.js";
import { FakeGitHub, MemoryFiles } from "../fakes/index.js";

const status: ColumnField = {
  id: "F_status",
  name: "Status",
  options: [
    { id: "o-ready", name: "Pronto para IA" },
    { id: "o-doing", name: "Fazendo" },
    { id: "o-review", name: "Pronto para teste" },
  ],
};

const config: GhRelayConfig = {
  version: 1,
  project: { id: "PVT_1", number: 2, title: "Portfolio", owner: "LuizKirsch", ownerType: "user" },
  columnField: { id: "F_status", name: "Status" },
  roles: {
    ready: { optionId: "o-ready", name: "Pronto para IA" },
    in_progress: { optionId: "o-doing", name: "Fazendo" },
    delivery: { optionId: "o-review", name: "Pronto para teste" },
  },
  agent: { default: "claude-code" },
  baseBranch: "main",
  rulesFile: ".gh-relay/rules.md",
};

const cards: Card[] = [{ itemId: "I1", optionId: "o-ready", kind: "issue", title: "Do it", number: 3, closed: false }];

const configured = () => new MemoryFiles({ [CONFIG_FILE]: JSON.stringify(config) });

describe("loadBoard", () => {
  it("asks for init when there is no config", async () => {
    const result = await loadBoard({ github: new FakeGitHub([], {}), files: new MemoryFiles() });
    expect(result).toEqual({ status: "no_config" });
  });

  it("reports an invalid config", async () => {
    const files = new MemoryFiles({ [CONFIG_FILE]: "{" });
    const result = await loadBoard({ github: new FakeGitHub([], {}), files });
    expect(result.status).toBe("invalid_config");
  });

  it("groups the project cards into the configured columns", async () => {
    const github = new FakeGitHub([], { PVT_1: [status] }, { PVT_1: cards });
    const result = await loadBoard({ github, files: configured() });

    if (result.status !== "ok") throw new Error(result.status);
    expect(result.drift).toEqual([]);
    expect(result.columns.map((c) => [c.name, c.role, c.cards.length])).toEqual([
      ["Pronto para IA", "ready", 1],
      ["Fazendo", "in_progress", 0],
      ["Pronto para teste", "delivery", 0],
    ]);
  });

  it("still opens, with drift, when a mapped column was removed", async () => {
    const shrunk = { ...status, options: status.options.filter((o) => o.id !== "o-review") };
    const github = new FakeGitHub([], { PVT_1: [shrunk] }, { PVT_1: cards });
    const result = await loadBoard({ github, files: configured() });

    if (result.status !== "ok") throw new Error(result.status);
    expect(result.drift).toMatchObject([{ kind: "role_option_missing", role: "delivery" }]);
    expect(result.columns).toHaveLength(2);
  });

  it("has no columns when the column field itself is gone", async () => {
    const github = new FakeGitHub([], { PVT_1: [] }, { PVT_1: cards });
    const result = await loadBoard({ github, files: configured() });

    if (result.status !== "ok") throw new Error(result.status);
    expect(result.drift).toEqual([{ kind: "field_missing", fieldName: "Status" }]);
    expect(result.columns).toEqual([]);
  });
});
