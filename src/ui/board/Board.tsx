// The board screen: kanban columns side by side, ←/→ between columns,
// ↑/↓ between cards.
//
// Boards often have more columns than fit the terminal, so only as many as
// fit are shown (each at least MIN_COLUMN_WIDTH wide) and the view scrolls
// sideways to keep the selected column visible.
// Enter opens the card's details (TaskView). `s` starts a ready card: it asks
// for the agent and model (StartPicker), then hands the card to onStart,
// which leaves the board to start the agent in the background. Cards with a
// background agent show what it is doing; `a` opens its session (onAttach).
// `p` switches to another project (ProjectPicker). `r` refreshes now
// (onRefresh): syncs the agents and reloads the board.

import { Box, Text, useApp, useInput, useStdin, useWindowSize } from "ink";
import { useEffect, useState } from "react";
import { canStart, type BoardColumn, type Card, type Comment } from "../../domain/board.js";
import type { ConfigDrift } from "../../domain/config.js";
import type { ProjectRef } from "../../domain/config.js";
import { ROLE_DESCRIPTIONS } from "../../domain/roles.js";
import type { AgentState, TaskStatus } from "../../domain/task.js";
import { ProjectPicker } from "./ProjectPicker.js";
import { StartPicker, type AgentChoice, type StartChoice } from "./StartPicker.js";
import { TaskView, type PullRequestActions } from "./TaskView.js";

const MIN_COLUMN_WIDTH = 26;
// Title, column tabs, borders, url and help lines around the cards.
const CHROME_ROWS = 12;
const CARD_ROWS = 2;

export interface BoardProps {
  title: string;
  columns: BoardColumn[];
  drift: ConfigDrift[];
  loadComments: (card: Card) => Promise<Comment[]>;
  agents: readonly AgentChoice[]; // installed agents
  defaultAgentId: string; // preselected in the start picker
  projects: readonly ProjectRef[]; // every project added to tako
  currentProjectId: string;
  tasks: Readonly<Record<string, TaskStatus>>; // background agents, by card (itemId)
  pullRequests: PullRequestActions;
  onSwitchProject: (projectId: string) => void;
  onAddProject: () => void;
  onStart: (card: Card, choice: StartChoice) => void;
  onAttach: (card: Card) => void;
  onRefresh: () => Promise<void>;
}

const AGENT_BADGES: Record<AgentState, { text: string; color: string }> = {
  working: { text: "● agent working", color: "yellow" },
  needs_input: { text: "? agent needs you", color: "magenta" },
  done: { text: "✓ agent done", color: "green" },
  failed: { text: "✗ agent failed", color: "red" },
};
const DELIVERY_FAILED = { text: "✗ delivery failed", color: "red" };

export function Board(props: BoardProps) {
  const { title, columns, drift, loadComments, agents, defaultAgentId, tasks } = props;
  const { exit } = useApp();
  // Without a keyboard (piped or non-interactive terminal) print once and quit.
  const { isRawModeSupported } = useStdin();
  useEffect(() => {
    if (!isRawModeSupported) exit();
  }, [isRawModeSupported, exit]);

  // Start on the "ready" column: it is where the work begins.
  const [col, setCol] = useState(() => Math.max(0, columns.findIndex((c) => c.role === "ready")));
  const [row, setRow] = useState(0);
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [choosingProject, setChoosingProject] = useState(false);
  const [notice, setNotice] = useState<string>();
  const column = columns[col];
  const cards = column?.cards ?? [];
  const selectedRow = Math.min(row, Math.max(0, cards.length - 1));
  const selected = cards[selectedRow];

  // From the board or the details. When the card cannot be started, go back
  // to the board, where the reason is shown.
  const requestStart = () => {
    if (!selected) return;
    if (!canStart(column)) {
      const ready = columns.find((c) => c.role === "ready")?.name ?? "the ready column";
      setNotice(`Only cards in "${ready}" can be started.`);
      setOpen(false);
    } else if (!selected.repo) {
      // The agent runs inside the issue's repository; a draft has none.
      setNotice("Drafts have no repository yet: convert it to an issue to start it.");
      setOpen(false);
    } else if (agents.length === 0) {
      setNotice("No supported AI agent is installed. Install Claude Code and try again.");
      setOpen(false);
    } else {
      setStarting(true);
    }
  };

  const confirmStart = (choice: StartChoice) => {
    setStarting(false);
    if (selected) props.onStart(selected, choice);
  };

  useInput(
    (input, key) => {
      setNotice(undefined);
      if (input === "q" || key.escape) exit();
      if (input === "s") requestStart();
      if (input === "p") setChoosingProject(true);
      if (input === "r") {
        setNotice("Refreshing…");
        void props.onRefresh().finally(() => setNotice((n) => (n === "Refreshing…" ? undefined : n)));
      }
      if (input === "a" && selected) {
        if (tasks[selected.itemId]) props.onAttach(selected);
        else setNotice("No agent is running on this card.");
      }
      if (key.return && selected) setOpen(true);
      if (key.leftArrow) setCol((c) => Math.max(0, c - 1));
      if (key.rightArrow) setCol((c) => Math.min(columns.length - 1, c + 1));
      if (key.upArrow) setRow(Math.max(0, selectedRow - 1));
      if (key.downArrow) setRow(Math.min(Math.max(0, cards.length - 1), selectedRow + 1));
    },
    { isActive: isRawModeSupported && !open && !starting && !choosingProject },
  );

  const size = useWindowSize();
  const width = Math.max(MIN_COLUMN_WIDTH, size.columns - 2);
  const fit = Math.max(1, Math.min(columns.length, Math.floor(width / MIN_COLUMN_WIDTH)));
  const columnWidth = Math.floor(width / fit);
  const visibleCards = Math.max(3, Math.floor((size.rows - CHROME_ROWS) / CARD_ROWS));
  // Keep the selected column roughly centered among the visible ones.
  const first = Math.min(Math.max(0, col - Math.floor(fit / 2)), columns.length - fit);
  const shown = columns.slice(first, first + fit);

  if (choosingProject) {
    return (
      <ProjectPicker
        projects={props.projects}
        currentId={props.currentProjectId}
        onConfirm={props.onSwitchProject}
        onAdd={props.onAddProject}
        onCancel={() => setChoosingProject(false)}
        isActive={isRawModeSupported}
      />
    );
  }

  if (starting && selected) {
    return (
      <StartPicker
        card={selected}
        agents={agents}
        defaultAgentId={defaultAgentId}
        onConfirm={confirmStart}
        onCancel={() => setStarting(false)}
        isActive={isRawModeSupported}
      />
    );
  }

  if (open && selected) {
    return (
      <TaskView
        card={selected}
        columnName={column?.name ?? ""}
        loadComments={loadComments}
        pullRequests={props.pullRequests}
        onClose={() => setOpen(false)}
        onStart={requestStart}
        onQuit={exit}
        isActive={isRawModeSupported}
      />
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold>{title}</Text>
        <Text dimColor>
          {first > 0 ? `◀ ${first} more  ` : ""}
          {first + fit < columns.length ? `${columns.length - first - fit} more ▶` : ""}
        </Text>
      </Box>

      {drift.map((d) => (
        <Text key={d.kind === "field_missing" ? d.kind : d.role} color="yellow">
          ⚠ {describeDrift(d)}
        </Text>
      ))}

      <Box marginTop={1}>
        {shown.map((column, i) => (
          <ColumnView
            key={column.optionId ?? "none"}
            column={column}
            width={columnWidth}
            height={visibleCards}
            selectedRow={first + i === col ? selectedRow : undefined}
            tasks={tasks}
          />
        ))}
      </Box>

      {notice ? (
        <Text color="yellow" wrap="truncate-end">
          {notice}
        </Text>
      ) : selected && tasks[selected.itemId]?.error ? (
        <Text color="red" wrap="truncate-end">
          {tasks[selected.itemId]?.error} Press a to ask the agent to fix it.
        </Text>
      ) : (
        <Text dimColor wrap="truncate-end">
          {selected?.url ?? " "}
        </Text>
      )}
      <Text dimColor>←/→ column · ↑/↓ card · Enter open · s start · a agent · r refresh · p projects · q quit</Text>
    </Box>
  );
}

interface ColumnViewProps {
  column: BoardColumn;
  width: number;
  height: number;
  selectedRow: number | undefined;
  tasks: Readonly<Record<string, TaskStatus>>;
}

function ColumnView(props: ColumnViewProps) {
  const { column, width, height, selectedRow, tasks } = props;
  const active = selectedRow !== undefined;
  const { cards } = column;
  // Only the active column scrolls; the others show their first cards.
  const start = active ? Math.max(0, Math.min(selectedRow - Math.floor(height / 2), cards.length - height)) : 0;
  const visible = cards.slice(start, start + height);
  const below = cards.length - start - visible.length;

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle={active ? "bold" : "round"}
      borderColor={active ? "cyan" : "gray"}
      paddingX={1}
    >
      <Text bold wrap="truncate-end">
        {column.name} <Text dimColor>({cards.length})</Text>
      </Text>
      <Text dimColor wrap="truncate-end">
        {column.role ? `${column.role}: ${ROLE_DESCRIPTIONS[column.role]}` : " "}
      </Text>

      {cards.length === 0 && <Text dimColor>—</Text>}
      {start > 0 && <Text dimColor>↑ {start} more</Text>}
      {visible.map((card, i) => (
        <CardView key={card.itemId} card={card} selected={start + i === selectedRow} status={tasks[card.itemId]} />
      ))}
      {below > 0 && <Text dimColor>↓ {below} more</Text>}
    </Box>
  );
}

function CardView({ card, selected, status }: { card: Card; selected: boolean; status: TaskStatus | undefined }) {
  const ref = card.kind === "draft" ? "draft" : `#${card.number ?? "?"}`;
  const tags = `${card.kind === "pull_request" ? " PR" : ""}${card.closed ? " closed" : ""}`;
  const badge = status?.error ? DELIVERY_FAILED : status ? AGENT_BADGES[status.state] : undefined;
  return (
    <Box flexDirection="column">
      <Text color={selected ? "cyan" : undefined} bold={selected} dimColor={card.closed && !selected} wrap="truncate-end">
        {selected ? "› " : "  "}
        {ref}
        <Text dimColor>{tags}</Text>
        {badge && <Text color={badge.color}> {badge.text}</Text>}
      </Text>
      <Text inverse={selected} dimColor={card.closed && !selected} wrap="truncate-end">
        {"  "}
        {card.title}
      </Text>
    </Box>
  );
}

export function describeDrift(drift: ConfigDrift): string {
  if (drift.kind === "field_missing") {
    return `The "${drift.fieldName}" field no longer exists on the project. Run tako init again.`;
  }
  return `Column "${drift.binding.name}" (${drift.role}) was removed from the board. Run tako init again.`;
}
