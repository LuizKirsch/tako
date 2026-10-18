import { describe, expect, it } from "vitest";
import { buildBoard, canStart, NO_STATUS, type Card } from "../../src/domain/board.js";
import type { ColumnField } from "../../src/domain/roles.js";

const status: ColumnField = {
  id: "F_status",
  name: "Status",
  options: [
    { id: "o-todo", name: "To do" },
    { id: "o-ready", name: "Pronto para IA" },
    { id: "o-done", name: "Finalizado" },
  ],
};

const card = (itemId: string, optionId: string | undefined): Card => ({
  itemId,
  optionId,
  kind: "issue",
  title: itemId,
  closed: false,
  body: "",
  labels: [],
  assignees: [],
});

describe("buildBoard", () => {
  it("keeps the field's option order and tags the mapped roles", () => {
    const columns = buildBoard(status, { ready: { optionId: "o-ready", name: "Pronto para IA" } }, []);
    expect(columns.map((c) => [c.name, c.role])).toEqual([
      ["To do", undefined],
      ["Pronto para IA", "ready"],
      ["Finalizado", undefined],
    ]);
  });

  it("puts each card in its column, preserving order", () => {
    const columns = buildBoard(status, {}, [card("a", "o-ready"), card("b", "o-todo"), card("c", "o-ready")]);
    expect(columns.map((c) => c.cards.map((x) => x.itemId))).toEqual([["b"], ["a", "c"], []]);
  });

  it("sends cards without status or with a removed option to a trailing column", () => {
    const columns = buildBoard(status, {}, [card("a", undefined), card("b", "o-gone")]);
    expect(columns.at(-1)).toMatchObject({ name: NO_STATUS, optionId: undefined });
    expect(columns.at(-1)?.cards.map((c) => c.itemId)).toEqual(["a", "b"]);
  });

  it("omits the trailing column when every card has a status", () => {
    expect(buildBoard(status, {}, [card("a", "o-done")]).map((c) => c.name)).not.toContain(NO_STATUS);
  });
});

describe("canStart", () => {
  const columns = buildBoard(status, { ready: { optionId: "o-ready", name: "Pronto para IA" } }, []);

  it("allows only the column mapped to the ready role", () => {
    expect(columns.map((c) => canStart(c))).toEqual([false, true, false]);
  });

  it("refuses when there is no column", () => {
    expect(canStart(undefined)).toBe(false);
  });
});
