// Opened with `p` on the board: switch to another project added to tako, or
// add a new one. Adding leaves the board to ask the `tako init` questions in
// the normal terminal (onAdd).

import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { ProjectRef } from "../../domain/config.js";
import { OptionList } from "./OptionList.js";

export interface ProjectPickerProps {
  projects: readonly ProjectRef[];
  currentId: string;
  onConfirm: (projectId: string) => void;
  onAdd: () => void;
  onCancel: () => void;
  isActive: boolean;
}

// The last entry of the list, after the projects.
const ADD = { key: "+add", label: "+ Add a project", hint: "asks the tako init questions" };

export function ProjectPicker({ projects, currentId, onConfirm, onAdd, onCancel, isActive }: ProjectPickerProps) {
  const [selected, setSelected] = useState(() => Math.max(0, projects.findIndex((p) => p.id === currentId)));

  useInput(
    (_input, key) => {
      if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      if (key.downArrow) setSelected((i) => Math.min(projects.length, i + 1));
      if (key.escape) onCancel();
      if (key.return) {
        const project = projects[selected];
        if (selected === projects.length) onAdd();
        else if (!project || project.id === currentId) onCancel();
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
  options.push(ADD);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Projects</Text>
      <Box marginTop={1}>
        <OptionList options={options} selected={selected} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>↑/↓ choose · Enter open · Esc back</Text>
      </Box>
    </Box>
  );
}
