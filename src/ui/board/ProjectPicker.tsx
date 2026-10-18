// Opened with `p` on the board: switch to another project added to tako.
// New projects are added with `tako init`, which asks questions in the normal
// terminal, so this screen only points to it.

import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { ProjectRef } from "../../domain/config.js";
import { OptionList } from "./OptionList.js";

export interface ProjectPickerProps {
  projects: readonly ProjectRef[];
  currentId: string;
  onConfirm: (projectId: string) => void;
  onCancel: () => void;
  isActive: boolean;
}

export function ProjectPicker({ projects, currentId, onConfirm, onCancel, isActive }: ProjectPickerProps) {
  const [selected, setSelected] = useState(() => Math.max(0, projects.findIndex((p) => p.id === currentId)));

  useInput(
    (_input, key) => {
      if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      if (key.downArrow) setSelected((i) => Math.min(projects.length - 1, i + 1));
      if (key.escape) onCancel();
      if (key.return) {
        const project = projects[selected];
        if (!project || project.id === currentId) onCancel();
        else onConfirm(project.id);
      }
    },
    { isActive },
  );

  const options = projects.map((p) => ({
    key: p.id,
    label: p.title,
    hint: `${p.owner} #${p.number}${p.id === currentId ? ", open now" : ""}`,
  }));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Projects</Text>
      <Box marginTop={1}>
        <OptionList options={options} selected={selected} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>To add another project, quit and run `tako init`.</Text>
        <Text dimColor>↑/↓ choose · Enter open · Esc back</Text>
      </Box>
    </Box>
  );
}
