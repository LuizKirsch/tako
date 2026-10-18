// Details of one card, opened with Enter on the board.
// The body and the comments are shown as plain markdown text, scrolled
// together with ↑/↓. Comments load when the view opens.

import { Box, Text, useInput, useWindowSize } from "ink";
import { useEffect, useState } from "react";
import type { Card, Comment } from "../../domain/board.js";

// Header, separators and help lines around the body.
const CHROME_ROWS = 10;

export interface TaskViewProps {
  card: Card;
  columnName: string;
  loadComments: (card: Card) => Promise<Comment[]>;
  onClose: () => void;
  onStart: () => void;
  onQuit: () => void;
  isActive: boolean;
}

type CommentsState =
  | { status: "loading" }
  | { status: "ok"; comments: Comment[] }
  | { status: "error"; message: string };

interface Line {
  text: string;
  bold?: boolean;
  dim?: boolean;
  color?: string;
}

export function TaskView({ card, columnName, loadComments, onClose, onStart, onQuit, isActive }: TaskViewProps) {
  const size = useWindowSize();
  const [comments, setComments] = useState<CommentsState>({ status: "loading" });
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    // Ignore a late answer if the view was closed meanwhile.
    let current = true;
    loadComments(card).then(
      (list) => current && setComments({ status: "ok", comments: list }),
      (error: unknown) =>
        current && setComments({ status: "error", message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      current = false;
    };
  }, [card, loadComments]);

  // ponytail: scrolls by source lines; a very long line wraps and can push the footer down.
  const lines = [...bodyLines(card.body), ...commentLines(comments)];
  const height = Math.max(3, size.rows - CHROME_ROWS);
  const maxOffset = Math.max(0, lines.length - height);

  useInput(
    (input, key) => {
      if (input === "q") onQuit();
      if (input === "s") onStart();
      if (key.escape || key.return || key.backspace || key.leftArrow) onClose();
      if (key.upArrow) setOffset((o) => Math.max(0, o - 1));
      if (key.downArrow) setOffset((o) => Math.min(maxOffset, o + 1));
    },
    { isActive },
  );

  const ref = card.kind === "draft" ? "Draft" : `#${card.number ?? "?"}`;
  const state = card.closed ? "closed" : "open";
  const meta = [card.repo, columnName, card.kind === "pull_request" ? `PR ${state}` : state].filter(Boolean);
  const start = Math.min(offset, maxOffset);

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
        {start > 0 && <Text dimColor>↑ {start} more lines</Text>}
        {lines.slice(start, start + height).map((line, i) => (
          <Text key={start + i} bold={line.bold} dimColor={line.dim} color={line.color}>
            {line.text || " "}
          </Text>
        ))}
        {start < maxOffset && <Text dimColor>↓ {maxOffset - start} more lines</Text>}
      </Box>

      <Text dimColor>↑/↓ scroll · s start · Esc/Enter back · q quit</Text>
    </Box>
  );
}

function bodyLines(body: string): Line[] {
  if (!body.trim()) return [{ text: "No description.", dim: true }];
  return markdownLines(body);
}

function commentLines(state: CommentsState): Line[] {
  const title = (text: string): Line => ({ text, bold: true, color: "cyan" });
  if (state.status === "loading") return [{ text: "" }, { text: "Loading comments…", dim: true }];
  if (state.status === "error") {
    return [{ text: "" }, title("Comments"), { text: `Could not load comments: ${state.message}`, color: "red" }];
  }
  if (state.comments.length === 0) return [{ text: "" }, { text: "No comments.", dim: true }];

  const lines: Line[] = [{ text: "" }, title(`Comments (${state.comments.length})`)];
  for (const comment of state.comments) {
    lines.push({ text: "" }, { text: `@${comment.author} · ${comment.createdAt.slice(0, 10)}`, bold: true });
    lines.push(...markdownLines(comment.body));
  }
  return lines;
}

// Plain text, with markdown headings in bold.
function markdownLines(text: string): Line[] {
  return text
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => ({ text: line, bold: line.startsWith("#") }));
}
