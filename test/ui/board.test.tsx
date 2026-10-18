import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import type { BoardColumn, Card, Comment } from "../../src/domain/board.js";
import { Board, type BoardProps } from "../../src/ui/board/Board.js";
import { TaskView, type PullRequestActions } from "../../src/ui/board/TaskView.js";

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
const noComments = async (): Promise<Comment[]> => [];
const agents = [
  {
    id: "claude-code",
    displayName: "Claude Code",
    models: [
      { id: "opus", label: "Opus" },
      { id: "sonnet", label: "Sonnet" },
    ],
  },
];
const projects = [
  { id: "PVT_1", number: 2, title: "Portfolio", owner: "LuizKirsch", ownerType: "user" as const },
  { id: "PVT_2", number: 5, title: "Side project", owner: "acme", ownerType: "organization" as const },
];
const projectProps = {
  projects,
  currentProjectId: "PVT_1",
  tasks: {},
  pullRequests: { find: async () => undefined, create: async () => ({ url: "" }) },
  onSwitchProject: () => {},
  onAddProject: () => {},
  onStart: () => {},
  onAttach: () => {},
};

describe("Board", () => {
  it("shows the columns side by side, starting on the ready column", () => {
    const { lastFrame } = render(<Board title="Portfolio / Status" columns={columns} drift={[]} loadComments={noComments} agents={agents} defaultAgentId="claude-code" {...projectProps} />);
    const frame = lastFrame() ?? "";

    // Both headers on the same line: columns are side by side.
    const headerLine = frame.split("\n").find((line) => line.includes("To do")) ?? "";
    expect(headerLine).toContain("Pronto para IA");
    expect(frame).toContain("› #3");
    expect(frame).toContain("Later task");
    expect(frame).toContain("ready: cards the AI");
  });

  it("shows what a card's background agent is doing and opens it with a", async () => {
    const onAttach = vi.fn();
    const { lastFrame, stdin } = render(
      <Board title="Portfolio / Status" columns={columns} drift={[]} loadComments={noComments} agents={agents} defaultAgentId="claude-code" {...projectProps} tasks={{ I3: { state: "needs_input" }, I4: { state: "done", error: "No commits." } }} onAttach={onAttach} />,
    );
    expect(lastFrame()).toContain("agent needs you");

    stdin.write("a");
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));
    expect(onAttach.mock.calls[0]?.[0].itemId).toBe("I3");

    stdin.write(DOWN);
    await vi.waitFor(() => expect(lastFrame()).toContain("No commits. Press a to ask the agent to fix it."));
    expect(lastFrame()).toContain("delivery failed");

    stdin.write(LEFT);
    await vi.waitFor(() => expect(lastFrame()).toContain("› #9"));
    stdin.write("a");
    await vi.waitFor(() => expect(lastFrame()).toContain("No agent is running on this card."));
    expect(onAttach).toHaveBeenCalledTimes(1);
  });

  it("moves between cards and columns with the arrow keys", async () => {
    const { lastFrame, stdin } = render(<Board title="Portfolio / Status" columns={columns} drift={[]} loadComments={noComments} agents={agents} defaultAgentId="claude-code" {...projectProps} />);
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
    const { lastFrame, stdin } = render(<Board title="Board" columns={many} drift={[]} loadComments={noComments} agents={agents} defaultAgentId="claude-code" {...projectProps} />);
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
    const { lastFrame, stdin } = render(<Board title="Portfolio / Status" columns={columns} drift={[]} loadComments={noComments} agents={agents} defaultAgentId="claude-code" {...projectProps} />);
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
    const { lastFrame, stdin } = render(<Board title="Board" columns={[column("Empty", [], "ready")]} drift={[]} loadComments={noComments} agents={agents} defaultAgentId="claude-code" {...projectProps} />);
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(lastFrame()).toContain("Empty (0)");
  });

  it("shows drift warnings", () => {
    const drift = [{ kind: "field_missing" as const, fieldName: "Status" }];
    const { lastFrame } = render(<Board title="Portfolio / Status" columns={[]} drift={drift} loadComments={noComments} agents={agents} defaultAgentId="claude-code" {...projectProps} />);
    expect(lastFrame()).toContain('The "Status" field no longer exists');
  });
});

describe("TaskView comments", () => {
  const view = (loadComments: (c: Card) => Promise<Comment[]>) =>
    render(
      <TaskView
        card={card(4, "Second task")}
        columnName="Pronto para IA"
        loadComments={loadComments}
        pullRequests={{ find: async () => undefined, create: async () => ({ url: "" }) }}
        onClose={() => {}}
        onStart={() => {}}
        onQuit={() => {}}
        isActive={false}
      />,
    );

  it("shows a loading line, then the comments with author and date", async () => {
    let answer: (list: Comment[]) => void = () => {};
    const { lastFrame } = view(() => new Promise((resolve) => (answer = resolve)));
    expect(lastFrame()).toContain("Loading comments…");

    answer([
      { author: "alice", body: "## Note\nNeeds a test", createdAt: "2026-01-02T10:00:00Z" },
      { author: "bob", body: "Done", createdAt: "2026-01-03T10:00:00Z" },
    ]);
    await vi.waitFor(() => expect(lastFrame()).toContain("Comments (2)"));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("@alice · 2026-01-02");
    expect(frame).toContain("Needs a test");
    expect(frame).toContain("@bob · 2026-01-03");
    expect(frame).not.toContain("Loading comments…");
  });

  it("says when there are no comments", async () => {
    const { lastFrame } = view(noComments);
    await vi.waitFor(() => expect(lastFrame()).toContain("No comments."));
  });

  it("keeps the details visible when comments fail to load", async () => {
    const { lastFrame } = view(() => Promise.reject(new Error("HTTP 502")));
    await vi.waitFor(() => expect(lastFrame()).toContain("Could not load comments: HTTP 502"));
    expect(lastFrame()).toContain("- [ ] Body of Second task");
  });
});

describe("Starting a task", () => {
  const board = (agentList = agents, onStart: BoardProps["onStart"] = () => {}, cols = columns) =>
    render(
      <Board
        title="Portfolio / Status"
        columns={cols}
        drift={[]}
        loadComments={noComments}
        agents={agentList}
        defaultAgentId="claude-code"
        {...projectProps}
        onStart={onStart}
      />,
    );

  it("asks for the agent, then the model, and hands the card over", async () => {
    const onStart = vi.fn();
    const { lastFrame, stdin } = board(agents, onStart);
    await tick();

    stdin.write("s");
    await vi.waitFor(() => expect(lastFrame()).toContain("Start #3 First task"));
    expect(lastFrame()).toContain("1. Agent");
    expect(lastFrame()).toContain("› Claude Code");

    stdin.write(ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("1. Agent: Claude Code"));
    expect(lastFrame()).toContain("› Default (Claude Code decides)");

    stdin.write(DOWN);
    await vi.waitFor(() => expect(lastFrame()).toContain("› Opus"));
    stdin.write(ENTER);
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    const [card, choice] = onStart.mock.calls[0]!;
    expect(card).toMatchObject({ number: 3, repo: "LuizKirsch/portfolio" });
    expect(choice).toEqual({ agentId: "claude-code", model: "opus" });
  });

  it("passes no model when Default is chosen", async () => {
    const onStart = vi.fn();
    const { lastFrame, stdin } = board(agents, onStart);
    await tick();

    stdin.write("s");
    await vi.waitFor(() => expect(lastFrame()).toContain("1. Agent"));
    stdin.write(ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("› Default"));
    stdin.write(ENTER);
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect(onStart.mock.calls[0]![1]).toEqual({ agentId: "claude-code", model: undefined });
  });

  it("refuses drafts, which have no repository", async () => {
    const draft: Card = { ...card(1, "Idea"), kind: "draft", repo: undefined };
    const onStart = vi.fn();
    const { lastFrame, stdin } = board(agents, onStart, [column("Pronto para IA", [draft], "ready")]);
    await tick();

    stdin.write("s");
    await vi.waitFor(() => expect(lastFrame()).toContain("Drafts have no repository yet"));
    expect(onStart).not.toHaveBeenCalled();
  });

  it("goes back a step with Esc and cancels from the first step", async () => {
    const { lastFrame, stdin } = board();
    await tick();

    stdin.write("s");
    await vi.waitFor(() => expect(lastFrame()).toContain("1. Agent"));
    stdin.write(ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("1. Agent: Claude Code"));
    stdin.write(ESC);
    await vi.waitFor(() => expect(lastFrame()).toContain("› Claude Code"));
    stdin.write(ESC);
    await vi.waitFor(() => expect(lastFrame()).toContain("To do"));
    expect(lastFrame()).not.toContain("1. Agent");
  });

  it("can be started from the card details", async () => {
    const { lastFrame, stdin } = board();
    await tick();

    stdin.write(ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("s start · c create PR · Esc/Enter back"));
    stdin.write("s");
    await vi.waitFor(() => expect(lastFrame()).toContain("Start #3 First task"));
  });

  it("refuses cards outside the ready column", async () => {
    const { lastFrame, stdin } = board();
    await tick();

    stdin.write(LEFT);
    await vi.waitFor(() => expect(lastFrame()).toContain("› #9"));
    stdin.write("s");
    await vi.waitFor(() => expect(lastFrame()).toContain('Only cards in "Pronto para IA" can be started.'));
  });

  it("explains when no agent is installed", async () => {
    const { lastFrame, stdin } = board([]);
    await tick();

    stdin.write("s");
    await vi.waitFor(() => expect(lastFrame()).toContain("No supported AI agent is installed."));
  });
});

describe("Switching projects", () => {
  const board = (onSwitchProject: (id: string) => void) =>
    render(
      <Board
        title="Portfolio / Status"
        columns={columns}
        drift={[]}
        loadComments={noComments}
        agents={agents}
        defaultAgentId="claude-code"
        {...projectProps}
        onSwitchProject={onSwitchProject}
      />,
    );

  it("lists every project with `p`, marking the one on screen", async () => {
    const { lastFrame, stdin } = board(() => {});
    await tick();

    stdin.write("p");
    await vi.waitFor(() => expect(lastFrame()).toContain("Projects"));
    expect(lastFrame()).toContain("› Portfolio (LuizKirsch #2, open now)");
    expect(lastFrame()).toContain("Side project (acme #5)");
    expect(lastFrame()).toContain("+ Add a project");
  });

  it("adds a project from the last entry of the list", async () => {
    const onAddProject = vi.fn();
    const { lastFrame, stdin } = render(
      <Board title="Portfolio / Status" columns={columns} drift={[]} loadComments={noComments} agents={agents} defaultAgentId="claude-code" {...projectProps} onAddProject={onAddProject} />,
    );
    await tick();
    stdin.write("p");
    await vi.waitFor(() => expect(lastFrame()).toContain("Projects"));
    for (let i = 0; i < projects.length; i++) {
      stdin.write(DOWN);
      await tick();
    }
    await vi.waitFor(() => expect(lastFrame()).toContain("› + Add a project"));
    stdin.write(ENTER);
    await vi.waitFor(() => expect(onAddProject).toHaveBeenCalledTimes(1));
  });

  it("switches to the chosen project", async () => {
    const onSwitch = vi.fn();
    const { lastFrame, stdin } = board(onSwitch);
    await tick();

    stdin.write("p");
    await vi.waitFor(() => expect(lastFrame()).toContain("Projects"));
    stdin.write(DOWN);
    await vi.waitFor(() => expect(lastFrame()).toContain("› Side project"));
    stdin.write(ENTER);
    await vi.waitFor(() => expect(onSwitch).toHaveBeenCalledWith("PVT_2"));
  });

  it("goes back to the board when the current project is chosen or on Esc", async () => {
    const onSwitch = vi.fn();
    const { lastFrame, stdin } = board(onSwitch);
    await tick();

    stdin.write("p");
    await vi.waitFor(() => expect(lastFrame()).toContain("Projects"));
    stdin.write(ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("To do"));

    stdin.write("p");
    await vi.waitFor(() => expect(lastFrame()).toContain("Projects"));
    stdin.write(ESC);
    await vi.waitFor(() => expect(lastFrame()).toContain("To do"));
    expect(onSwitch).not.toHaveBeenCalled();
  });
});

describe("TaskView pull request", () => {
  const view = (pullRequests: PullRequestActions) =>
    render(
      <TaskView
        card={card(3, "First task")}
        columnName="Para teste"
        loadComments={noComments}
        pullRequests={pullRequests}
        onClose={() => {}}
        onStart={() => {}}
        onQuit={() => {}}
        isActive
      />,
    );

  it("shows the pull request of the branch", async () => {
    const { lastFrame } = view({
      find: async () => ({ number: 7, url: "https://github.com/LuizKirsch/portfolio/pull/7", state: "open" }),
      create: async () => ({ url: "" }),
    });
    await vi.waitFor(() => expect(lastFrame()).toContain("#7 open"));
  });

  it("creates it with c when there is none", async () => {
    const create = vi.fn(async () => ({ url: "https://github.com/LuizKirsch/portfolio/pull/8" }));
    const { lastFrame, stdin } = view({ find: async () => undefined, create });
    await vi.waitFor(() => expect(lastFrame()).toContain("none for tako/3-first-task"));

    stdin.write("c");
    await vi.waitFor(() => expect(lastFrame()).toContain("#8 open"));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("shows why the delivery failed", async () => {
    const { lastFrame, stdin } = view({
      find: async () => undefined,
      create: async () => {
        throw new Error("The branch tako/3-first-task has no commits ahead of main.");
      },
    });
    await vi.waitFor(() => expect(lastFrame()).toContain("press c"));
    stdin.write("c");
    await vi.waitFor(() => expect(lastFrame()).toContain("no commits ahead of main"));
  });
});
