// Loading and saving .tako.json through the RepoFiles port.
// Parsing rules live in the domain; this file only adds the I/O around them.

import { CONFIG_FILE, parseConfig, type ConfigParseError, type TakoConfig } from "../domain/config.js";
import type { RepoFiles } from "../ports/files.js";

export type LoadConfigResult =
  | { status: "missing" }
  | { status: "invalid"; errors: ConfigParseError[] }
  | { status: "ok"; config: TakoConfig };

export async function loadConfig(files: RepoFiles): Promise<LoadConfigResult> {
  const text = await files.readText(CONFIG_FILE);
  if (text === undefined) return { status: "missing" };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: "invalid", errors: [{ path: "$", message: `${CONFIG_FILE} is not valid JSON` }] };
  }

  const parsed = parseConfig(raw);
  return parsed.ok ? { status: "ok", config: parsed.value } : { status: "invalid", errors: parsed.errors };
}

export async function saveConfig(files: RepoFiles, config: TakoConfig): Promise<void> {
  // Two-space JSON with a trailing newline: friendly to diffs and editors.
  await files.writeText(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}
