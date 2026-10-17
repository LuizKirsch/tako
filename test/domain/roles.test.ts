import { describe, expect, it } from "vitest";
import { validateRoleMapping, type ColumnField } from "../../src/domain/roles.js";

const field: ColumnField = {
  id: "F1",
  name: "Status",
  options: [
    { id: "o-todo", name: "Todo" },
    { id: "o-ready", name: "Pronto para IA" },
    { id: "o-doing", name: "Em andamento" },
    { id: "o-review", name: "Para teste" },
    { id: "o-blocked", name: "Com problema" },
  ],
};

const bind = (id: string, name: string) => ({ optionId: id, name });

describe("validateRoleMapping", () => {
  it("accepts a complete mapping", () => {
    const errors = validateRoleMapping(field, {
      ready: bind("o-ready", "Pronto para IA"),
      in_progress: bind("o-doing", "Em andamento"),
      delivery: bind("o-review", "Para teste"),
      blocked: bind("o-blocked", "Com problema"),
    });
    expect(errors).toEqual([]);
  });

  it("accepts a mapping without the optional blocked role", () => {
    const errors = validateRoleMapping(field, {
      ready: bind("o-ready", "Pronto para IA"),
      in_progress: bind("o-doing", "Em andamento"),
      delivery: bind("o-review", "Para teste"),
    });
    expect(errors).toEqual([]);
  });

  it("reports every missing required role", () => {
    const errors = validateRoleMapping(field, { ready: bind("o-ready", "Pronto para IA") });
    expect(errors).toEqual([
      { kind: "missing_required", role: "in_progress" },
      { kind: "missing_required", role: "delivery" },
    ]);
  });

  it("rejects one column used for two roles", () => {
    const errors = validateRoleMapping(field, {
      ready: bind("o-ready", "Pronto para IA"),
      in_progress: bind("o-doing", "Em andamento"),
      delivery: bind("o-review", "Para teste"),
      blocked: bind("o-review", "Para teste"),
    });
    expect(errors).toEqual([
      { kind: "duplicate_option", optionId: "o-review", name: "Para teste", roles: ["delivery", "blocked"] },
    ]);
  });

  it("rejects an option that does not belong to the field", () => {
    const errors = validateRoleMapping(field, {
      ready: bind("o-gone", "Old column"),
      in_progress: bind("o-doing", "Em andamento"),
      delivery: bind("o-review", "Para teste"),
    });
    expect(errors).toEqual([{ kind: "unknown_option", role: "ready", optionId: "o-gone" }]);
  });
});
