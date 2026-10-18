// Asked when a task is started: which agent, then which model.
//
// The agent step is shown even with a single agent installed, so the flow
// stays the same when more agents are supported. "Default" passes no model
// and lets the agent use its own default.

import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { Card } from "../../domain/board.js";
import type { AgentAdapter } from "../../ports/agent.js";

export type AgentChoice = Pick<AgentAdapter, "id" | "displayName" | "models">;

export interface StartChoice {
  agentId: string;
  model: string | undefined; // undefined = the agent's default
}

export interface StartPickerProps {
  card: Card;
  agents: readonly AgentChoice[]; // never empty: the board checks before opening
  defaultAgentId: string;
  onConfirm: (choice: StartChoice) => void;
  onCancel: () => void;
  isActive: boolean;
}

interface Option {
  key: string;
  label: string;
  hint?: string;
}

export function StartPicker({ card, agents, defaultAgentId, onConfirm, onCancel, isActive }: StartPickerProps) {
  const [step, setStep] = useState<"agent" | "model">("agent");
  const [agentIndex, setAgentIndex] = useState(() => Math.max(0, agents.findIndex((a) => a.id === defaultAgentId)));
  const [modelIndex, setModelIndex] = useState(0);

  const agent = agents[agentIndex] ?? agents[0];
  const modelOptions: Option[] = [
    { key: "", label: "Default", hint: `${agent?.displayName ?? "the agent"} decides` },
    ...(agent?.models ?? []).map((m) => ({ key: m.id, label: m.label })),
  ];
  const agentOptions: Option[] = agents.map((a) => ({ key: a.id, label: a.displayName }));

  useInput(
    (_input, key) => {
      const options = step === "agent" ? agentOptions : modelOptions;
      const setIndex = step === "agent" ? setAgentIndex : setModelIndex;
      if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) setIndex((i) => Math.min(options.length - 1, i + 1));
      if (key.escape) {
        if (step === "model") setStep("agent");
        else onCancel();
      }
      if (key.return && agent) {
        if (step === "agent") {
          setStep("model");
          setModelIndex(0);
        } else {
          onConfirm({ agentId: agent.id, model: modelOptions[modelIndex]?.key || undefined });
        }
      }
    },
    { isActive },
  );

  const ref = card.kind === "draft" ? "Draft" : `#${card.number ?? "?"}`;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>
        Start {ref} {card.title}
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text bold={step === "agent"} dimColor={step !== "agent"}>
          1. Agent{step === "model" && agent ? `: ${agent.displayName}` : ""}
        </Text>
        {step === "agent" && <OptionList options={agentOptions} selected={agentIndex} />}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold={step === "model"} dimColor={step !== "model"}>
          2. Model
        </Text>
        {step === "model" && <OptionList options={modelOptions} selected={modelIndex} />}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>↑/↓ choose · Enter {step === "agent" ? "next" : "start"} · Esc back</Text>
      </Box>
    </Box>
  );
}

function OptionList({ options, selected }: { options: Option[]; selected: number }) {
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
