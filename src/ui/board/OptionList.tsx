// A vertical list of choices with the selected one highlighted.
// Shared by the start picker and the project picker; the caller owns the
// selection and the keys.

import { Box, Text } from "ink";

export interface Option {
  key: string;
  label: string;
  hint?: string;
}

export function OptionList({ options, selected }: { options: readonly Option[]; selected: number }) {
  return (
    <Box flexDirection="column">
      {options.map((option, i) => (
        <Text key={option.key || "default"} color={i === selected ? "cyan" : undefined} bold={i === selected}>
          {i === selected ? "  › " : "    "}
          {option.label}
          {option.hint ? <Text dimColor> ({option.hint})</Text> : null}
        </Text>
      ))}
    </Box>
  );
}
