// The board screen: kanban columns side by side, ←/→ between columns,
// ↑/↓ between cards.
//
// Boards often have more columns than fit the terminal, so only as many as
// fit are shown (each at least MIN_COLUMN_WIDTH wide) and the view scrolls
// sideways to keep the selected column visible.
// Enter opens the card's details (TaskView). Starting the work on a card
// arrives with the StartTask issue.

import { Box, Text, useApp, useInput, useStdin, useWindowSize } from "ink";
import { useEffect, useState } from "react";
import type { BoardColumn, Card } from "../../domain/board.js";
import type { ConfigDrift } from "../../domain/config.js";
import { ROLE_DESCRIPTIONS } from "../../domain/roles.js";
import { TaskView } from "./TaskView.js";

const MIN_COLUMN_WIDTH = 26;
// Title, column tabs, borders, url and help lines around the cards.
const CHROME_ROWS = 12;
const CARD_ROWS = 2;

export interface BoardProps {
  title: string;
  columns: BoardColumn[];
  drift: ConfigDrift[];
}

export function Board({ title, columns, drift }: BoardProps) {
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
  const cards = columns[col]?.cards ?? [];
  const selectedRow = Math.min(row, Math.max(0, cards.length - 1));
  const selected = cards[selectedRow];

  useInput(
    (input, key) => {
      if (input === "q" || key.escape) exit();
      if (key.return && selected) setOpen(true);
      if (key.leftArrow) setCol((c) => Math.max(0, c - 1));
      if (key.rightArrow) setCol((c) => Math.min(columns.length - 1, c + 1));
      if (key.upArrow) setRow(Math.max(0, selectedRow - 1));
      if (key.downArrow) setRow(Math.min(Math.max(0, cards.length - 1), selectedRow + 1));
    },
    { isActive: isRawModeSupported && !open },
  );

  const size = useWindowSize();
  const width = Math.max(MIN_COLUMN_WIDTH, size.columns - 2);
  const fit = Math.max(1, Math.min(columns.length, Math.floor(width / MIN_COLUMN_WIDTH)));
  const columnWidth = Math.floor(width / fit);
  const visibleCards = Math.max(3, Math.floor((size.rows - CHROME_ROWS) / CARD_ROWS));
  // Keep the selected column roughly centered among the visible ones.
  const first = Math.min(Math.max(0, col - Math.floor(fit / 2)), columns.length - fit);
  const shown = columns.slice(first, first + fit);

  if (open && selected) {
    return (
      <TaskView
        card={selected}
        columnName={columns[col]?.name ?? ""}
        onClose={() => setOpen(false)}
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

      <Text dimColor wrap="truncate-end">
        {selected?.url ?? " "}
      </Text>
      <Text dimColor>←/→ column · ↑/↓ card · Enter open · q quit</Text>
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
    return `The "${drift.fieldName}" field no longer exists on the project. Run gh-relay init again.`;
  }
  return `Column "${drift.binding.name}" (${drift.role}) was removed from the board. Run gh-relay init again.`;
}
