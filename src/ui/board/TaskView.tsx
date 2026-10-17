// Details of one card, opened with Enter on the board.
// The body is shown as plain markdown text, scrolled with ↑/↓.

import { Box, Text, useInput, useWindowSize } from "ink";
import { useState } from "react";
import type { Card } from "../../domain/board.js";

// Header, separators and help lines around the body.
const CHROME_ROWS = 10;

export interface TaskViewProps {
  card: Card;
  columnName: string;
  onClose: () => void;
  onQuit: () => void;
  isActive: boolean;
}

export function TaskView({ card, columnName, onClose, onQuit, isActive }: TaskViewProps) {
  const size = useWindowSize();
  // ponytail: scrolls by source lines; a very long line wraps and can push the footer down.
  const lines = card.body.trim() ? card.body.trimEnd().split(/\r?\n/) : [];
  const height = Math.max(3, size.rows - CHROME_ROWS);
  const maxOffset = Math.max(0, lines.length - height);
  const [offset, setOffset] = useState(0);

  useInput(
    (input, key) => {
      if (input === "q") onQuit();
      if (key.escape || key.return || key.backspace || key.leftArrow) onClose();
      if (key.upArrow) setOffset((o) => Math.max(0, o - 1));
      if (key.downArrow) setOffset((o) => Math.min(maxOffset, o + 1));
    },
    { isActive },
  );

  const ref = card.kind === "draft" ? "Draft" : `#${card.number ?? "?"}`;
  const state = card.closed ? "closed" : "open";
  const meta = [card.repo, columnName, card.kind === "pull_request" ? `PR ${state}` : state].filter(Boolean);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>
        {ref} {card.title}
      </Text>
      <Text dimColor>{meta.join(" · ")}</Text>
      <Text>
        <Text dimColor>labels </Text>
        {card.labels.length ? card.labels.join(", ") : "—"}
        <Text dimColor>   assignees </Text>
        {card.assignees.length ? card.assignees.map((a) => `@${a}`).join(", ") : "—"}
      </Text>
      {card.url && <Text color="cyan">{card.url}</Text>}

      <Box flexDirection="column" borderStyle="single" borderLeft={false} borderRight={false} borderDimColor>
        {lines.length === 0 && <Text dimColor>No description.</Text>}
        {offset > 0 && <Text dimColor>↑ {offset} more lines</Text>}
        {lines.slice(offset, offset + height).map((line, i) => (
          <Text key={offset + i} bold={line.startsWith("#")}>
            {line || " "}
          </Text>
        ))}
        {offset < maxOffset && <Text dimColor>↓ {maxOffset - offset} more lines</Text>}
      </Box>

      <Text dimColor>↑/↓ scroll · Esc/Enter back · q quit</Text>
    </Box>
  );
}
