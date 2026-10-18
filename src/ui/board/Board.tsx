// The board screen: kanban columns side by side, ←/→ between columns,
// ↑/↓ between cards.
//
// Boards often have more columns than fit the terminal, so only as many as
// fit are shown (each at least MIN_COLUMN_WIDTH wide) and the view scrolls
// sideways to keep the selected column visible.
// Enter opens the card's details (TaskView). `s` starts a ready card: it asks
// for the agent and model (StartPicker); launching the agent comes next.

import { Box, Text, useApp, useInput, useStdin, useWindowSize } from "ink";
import { useEffect, useState } from "react";
import { canStart, type BoardColumn, type Card, type Comment } from "../../domain/board.js";
import type { ConfigDrift } from "../../domain/config.js";
import { ROLE_DESCRIPTIONS } from "../../domain/roles.js";
import { StartPicker, type AgentChoice, type StartChoice } from "./StartPicker.js";
import { TaskView } from "./TaskView.js";

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
}

export function Board({ title, columns, drift, loadComments, agents, defaultAgentId }: BoardProps) {
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
    } else if (agents.length === 0) {
      setNotice("No supported AI agent is installed. Install Claude Code and try again.");
      setOpen(false);
    } else {
      setStarting(true);
    }
  };

  const confirmStart = ({ agentId, model }: StartChoice) => {
    const agent = agents.find((a) => a.id === agentId);
    const modelLabel = agent?.models.find((m) => m.id === model)?.label ?? "default model";
    setStarting(false);
    setOpen(false);
    // ponytail: placeholder until the agent launch lands (StartTask issue).
    setNotice(`Ready to start ${cardRef(selected)} with ${agent?.displayName ?? agentId} (${modelLabel}). Launching the agent comes next.`);
  };

  useInput(
    (input, key) => {
      setNotice(undefined);
      if (input === "q" || key.escape) exit();
      if (input === "s") requestStart();
      if (key.return && selected) setOpen(true);
      if (key.leftArrow) setCol((c) => Math.max(0, c - 1));
      if (key.rightArrow) setCol((c) => Math.min(columns.length - 1, c + 1));
      if (key.upArrow) setRow(Math.max(0, selectedRow - 1));
      if (key.downArrow) setRow(Math.min(Math.max(0, cards.length - 1), selectedRow + 1));
    },
    { isActive: isRawModeSupported && !open && !starting },
  );

  const size = useWindowSize();
  const width = Math.max(MIN_COLUMN_WIDTH, size.columns - 2);
  const fit = Math.max(1, Math.min(columns.length, Math.floor(width / MIN_COLUMN_WIDTH)));
  const columnWidth = Math.floor(width / fit);
  const visibleCards = Math.max(3, Math.floor((size.rows - CHROME_ROWS) / CARD_ROWS));
  // Keep the selected column roughly centered among the visible ones.
  const first = Math.min(Math.max(0, col - Math.floor(fit / 2)), columns.length - fit);
  const shown = columns.slice(first, first + fit);

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
          />
        ))}
      </Box>

      {notice ? (
        <Text color="yellow" wrap="truncate-end">
          {notice}
        </Text>
      ) : (
        <Text dimColor wrap="truncate-end">
          {selected?.url ?? " "}
        </Text>
      )}
      <Text dimColor>←/→ column · ↑/↓ card · Enter open · s start · q quit</Text>
    </Box>
  );
}

function ColumnView(props: { column: BoardColumn; width: number; height: number; selectedRow: number | undefined }) {
  const { column, width, height, selectedRow } = props;
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
        <CardView key={card.itemId} card={card} selected={start + i === selectedRow} />
      ))}
      {below > 0 && <Text dimColor>↓ {below} more</Text>}
    </Box>
  );
}

function cardRef(card: Card | undefined): string {
  return card?.kind === "draft" ? "the draft" : `#${card?.number ?? "?"}`;
}

function CardView({ card, selected }: { card: Card; selected: boolean }) {
  const ref = card.kind === "draft" ? "draft" : `#${card.number ?? "?"}`;
  const tags = `${card.kind === "pull_request" ? " PR" : ""}${card.closed ? " closed" : ""}`;
  return (
    <Box flexDirection="column">
      <Text color={selected ? "cyan" : undefined} bold={selected} dimColor={card.closed && !selected} wrap="truncate-end">
        {selected ? "› " : "  "}
        {ref}
        <Text dimColor>{tags}</Text>
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
