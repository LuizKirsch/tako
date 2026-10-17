import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { BoardColumn, Card } from "../../src/domain/board.js";
import { Board } from "../../src/ui/board/Board.js";

// ink-testing-library renders into a 100-column terminal: three columns fit.

const card = (n: number, title: string): Card => ({
  itemId: `I${n}`,
  optionId: undefined,
  kind: "issue",
  title,
  number: n,
  repo: "LuizKirsch/portfolio",
  url: `https://github.com/LuizKirsch/portfolio/issues/${n}`,
  closed: false,
  body: `## Checklist\n- [ ] Body of ${title}`,
  labels: ["conteúdo"],
  assignees: [],
});

const column = (name: string, cards: Card[] = [], role?: BoardColumn["role"]): BoardColumn => ({
  optionId: `o-${name}`,
  name,
  role,
  cards,
});

const columns: BoardColumn[] = [
  column("To do", [card(9, "Later task")]),
  column("Pronto para IA", [card(3, "First task"), card(4, "Second task")], "ready"),
];

const RIGHT = "\u001B[C";
const LEFT = "\u001B[D";
const DOWN = "\u001B[B";
const ENTER = "\r";
const ESC = "\u001B";
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("Board", () => {
  it("shows the columns side by side, starting on the ready column", () => {
    const { lastFrame } = render(<Board title="Portfolio / Status" columns={columns} drift={[]} />);
    const frame = lastFrame() ?? "";

    // Both headers on the same line: columns are side by side.
    const headerLine = frame.split("\n").find((line) => line.includes("To do")) ?? "";
    expect(headerLine).toContain("Pronto para IA");
    expect(frame).toContain("› #3");
    expect(frame).toContain("Later task");
    expect(frame).toContain("ready: cards the AI");
  });

  it("moves between cards and columns with the arrow keys", async () => {
    const { lastFrame, stdin } = render(<Board title="Portfolio / Status" columns={columns} drift={[]} />);
    await tick();

    stdin.write(DOWN);
    await tick();
    expect(lastFrame()).toContain("› #4");

    stdin.write(LEFT);
    await tick();
    expect(lastFrame()).toContain("› #9");

    stdin.write(RIGHT);
    await tick();
    // Back on the ready column, the selection stays on the second card.
    expect(lastFrame()).toContain("› #4");
  });

  it("scrolls sideways when the columns do not fit", async () => {
    const many = ["A", "B", "C", "D", "E", "F"].map((name) => column(`Col ${name}`));
    const { lastFrame, stdin } = render(<Board title="Board" columns={many} drift={[]} />);
    await tick();

    expect(lastFrame()).toContain("3 more ▶");
    expect(lastFrame()).not.toContain("Col D");

    for (let i = 0; i < 5; i++) stdin.write(RIGHT);
    await tick();
    expect(lastFrame()).toContain("Col F");
    expect(lastFrame()).toContain("◀ 3 more");
    expect(lastFrame()).not.toContain("Col A");
  });

  it("opens the selected card with Enter and goes back with Esc", async () => {
    const { lastFrame, stdin } = render(<Board title="Portfolio / Status" columns={columns} drift={[]} />);
    await tick();

    stdin.write(DOWN);
    await tick();
    stdin.write(ENTER);
    await tick();
    const detail = lastFrame() ?? "";
    expect(detail).toContain("#4 Second task");
    expect(detail).toContain("LuizKirsch/portfolio · Pronto para IA · open");
    expect(detail).toContain("conteúdo");
    expect(detail).toContain("- [ ] Body of Second task");
    expect(detail).not.toContain("To do");

    stdin.write(ESC);
    await tick();
    expect(lastFrame()).toContain("To do");
    expect(lastFrame()).toContain("› #4");
  });

  it("does nothing on Enter in an empty column", async () => {
    const { lastFrame, stdin } = render(<Board title="Board" columns={[column("Empty", [], "ready")]} drift={[]} />);
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(lastFrame()).toContain("Empty (0)");
  });

  it("shows drift warnings", () => {
    const drift = [{ kind: "field_missing" as const, fieldName: "Status" }];
    const { lastFrame } = render(<Board title="Portfolio / Status" columns={[]} drift={drift} />);
    expect(lastFrame()).toContain('The "Status" field no longer exists');
  });
});
