// The `tako init` wizard: adds a GitHub Project to tako. Runs from any folder.
//
// Built with @clack/prompts instead of Ink: init is a straight sequence of
// questions, which is exactly what clack does, with far less code than
// building selects and inputs in Ink. Ink stays for the board, where the
// screen is interactive and long-lived.
//
// All decisions live in the InitProject use case; this file only asks,
// shows progress and explains failures.

import * as p from "@clack/prompts";
import type { InitProject } from "../../app/init-project.js";
import {
  ROLES,
  ROLE_DESCRIPTIONS,
  bindOption,
  isRequiredRole,
  suggestColumnField,
  type ColumnField,
  type RoleMapping,
} from "../../domain/roles.js";
import { GitHubError, isAuthFixable } from "../../ports/github.js";

// Thrown when the user presses Ctrl+C / Esc in any prompt.
class Cancelled extends Error {}

// Sentinel option values; real option IDs from GitHub never look like this.
const SKIP = "__skip__";
const MISSING = "__missing__";

// Returns the process exit code. `configPath` is only used in messages.
export async function runInitWizard(init: InitProject, configPath: string, fromBoard = false): Promise<number> {
  p.intro(fromBoard ? "tako · add a project" : "tako init");
  try {
    return await wizard(init, configPath, fromBoard);
  } catch (error) {
    if (error instanceof Cancelled) {
      p.cancel("Init cancelled. Nothing was written.");
      return 1;
    }
    if (error instanceof GitHubError) {
      p.log.error(error.message);
      p.outro("Fix the problem above and run tako init again.");
      return 1;
    }
    throw error;
  }
}

async function wizard(init: InitProject, configPath: string, fromBoard: boolean): Promise<number> {
  // 1. Load everything that does not depend on the user's answers.
  const context = await prepareWithAuthFix(init);

  if (context.installedAgents.length === 0) {
    p.log.error("No supported AI agent was found on this machine.");
    p.outro("Install Claude Code (https://docs.claude.com/en/docs/claude-code) and run tako init again.");
    return 1;
  }

  // Never replace a config that cannot be read: it may hold other projects.
  if (context.existingConfig.status === "invalid") {
    return invalidConfig(configPath, context.existingConfig.errors);
  }
  const added = new Set(
    context.existingConfig.status === "ok" ? context.existingConfig.config.projects.map((p) => p.project.id) : [],
  );

  // 2. Project.
  const openProjects = context.projects.filter((project) => !project.closed);
  if (openProjects.length === 0) {
    p.log.error("No open GitHub Projects found for your account or your organizations.");
    p.outro("Create a project at https://github.com/users/<you>/projects and run tako init again.");
    return 1;
  }

  const projectId = await ask(
    p.select({
      message: "Which GitHub Project do you want to add?",
      options: openProjects.map((project) => ({
        value: project.id,
        label: project.title,
        hint: [
          `${project.owner} #${project.number}`,
          project.ownerType === "organization" ? "org" : "",
          added.has(project.id) ? "already added" : "",
        ]
          .filter(Boolean)
          .join(", "),
      })),
      maxItems: 10,
    }),
  );
  const project = openProjects.find((candidate) => candidate.id === projectId)!;

  if (added.has(project.id)) {
    const replace = await ask(
      p.confirm({ message: `"${project.title}" was already added. Set it up again?`, initialValue: false }),
    );
    if (!replace) {
      p.outro("Kept the existing setup.");
      return 0;
    }
  }

  // 3. The field whose options are the board columns.
  const fields = await withSpinner("Reading the project fields", "Fields loaded", () =>
    init.columnFields(project.id),
  );
  if (fields.length === 0) {
    p.log.error(`"${project.title}" has no single-select field to use as columns.`);
    p.outro("Add a single-select field (like Status) to the project and run tako init again.");
    return 1;
  }
  const field = await chooseField(fields);

  // 4. Roles. Options already taken are hidden, so one column cannot get two roles.
  const roles: RoleMapping = {};
  for (const role of ROLES) {
    const taken = new Set(Object.values(roles).map((binding) => binding.optionId));
    const available = field.options.filter((option) => !taken.has(option.id));
    const required = isRequiredRole(role);

    const answer = await ask(
      p.select({
        message: `Which column means "${role}"? (${ROLE_DESCRIPTIONS[role]}${required ? "" : ", optional"})`,
        options: [
          ...available.map((option) => ({ value: option.id, label: option.name })),
          required
            ? { value: MISSING, label: "None of these", hint: "I need to create this column first" }
            : { value: SKIP, label: "None", hint: "skip this role" },
        ],
        maxItems: 10,
      }),
    );

    if (answer === MISSING) {
      p.log.error(`tako needs a column for "${role}" (${ROLE_DESCRIPTIONS[role]}).`);
      p.outro(`Add it as an option of the "${field.name}" field on the board, then run tako init again.`);
      return 1;
    }
    if (answer === SKIP) continue;

    const option = available.find((candidate) => candidate.id === answer)!;
    roles[role] = bindOption(option);
  }

  // 5. Default agent: no question when only one is installed.
  const [onlyAgent] = context.installedAgents;
  let agentId: string;
  if (context.installedAgents.length === 1 && onlyAgent) {
    agentId = onlyAgent.id;
    p.log.info(`Default agent: ${onlyAgent.displayName}`);
  } else {
    agentId = await ask(
      p.select({
        message: "Which agent should open by default?",
        options: context.installedAgents.map((agent) => ({ value: agent.id, label: agent.displayName })),
      }),
    );
  }

  // 6. Base branch for new branches and pull requests.
  const baseBranch = await ask(
    p.text({
      message: "Base branch for new branches and pull requests",
      initialValue: "main",
      validate: (value) => (value?.trim() ? undefined : "The base branch cannot be empty"),
    }),
  );

  // 7. Save.
  const outcome = await withSpinner("Writing the config", "Config written", () =>
    init.finish({ project, field, roles, agentId, baseBranch: baseBranch.trim() }),
  );
  if (!outcome.ok) {
    // The config was broken while the wizard ran.
    if (outcome.kind === "invalid_config") return invalidConfig(configPath, outcome.errors);
    // Unreachable through this wizard (taken options are hidden), kept as a safety net.
    for (const error of outcome.errors) p.log.error(JSON.stringify(error));
    return 1;
  }

  const summary = ROLES.map((role) => `${role.padEnd(12)} ${outcome.project.roles[role]?.name ?? "(none)"}`);
  p.note(summary.join("\n"), `${project.title} / ${field.name}`);

  const count = outcome.config.projects.length;
  p.log.info(`Saved in ${configPath} (${count} project${count === 1 ? "" : "s"}).`);
  p.outro(fromBoard ? `Done. Opening "${project.title}".` : `Done. Run tako from any folder to open "${project.title}".`);
  return 0;
}

// From the board's project picker: the same questions, then back to the
// board, which opens the last project added. A failure stays on screen until
// Enter, since the board takes the whole terminal again.
export async function runAddProject(init: InitProject, configPath: string): Promise<void> {
  if ((await runInitWizard(init, configPath, true)) !== 0) {
    await p.text({ message: "Press Enter to go back to the board" });
  }
}

function invalidConfig(configPath: string, errors: { path: string; message: string }[]): number {
  p.log.error(`${configPath} is invalid, so it was left untouched:`);
  for (const error of errors) p.log.message(`${error.path}: ${error.message}`);
  p.outro("Fix the file, or delete it to start over, then run tako init again.");
  return 1;
}

// When gh is logged out or lacks the project scope, offers to run gh's own
// auth flow and retries once. Any other failure goes to runInitWizard.
async function prepareWithAuthFix(init: InitProject) {
  const load = () => withSpinner("Loading your GitHub projects", "Projects loaded", () => init.prepare());
  try {
    return await load();
  } catch (error) {
    if (!(error instanceof GitHubError) || !isAuthFixable(error.kind)) throw error;

    p.log.warn(error.message);
    const fix = await ask(p.confirm({ message: "Run it now? gh will guide you in the browser.", initialValue: true }));
    if (!fix) throw new Cancelled();

    if (!(await init.fixAuth(error.kind))) {
      throw new GitHubError(error.kind, "gh did not finish the authentication. Run the command above yourself.");
    }
    return load();
  }
}

async function chooseField(fields: ColumnField[]): Promise<ColumnField> {
  const [only] = fields;
  if (fields.length === 1 && only) {
    p.log.info(`Using the "${only.name}" field as columns.`);
    return only;
  }
  const fieldId = await ask(
    p.select({
      message: "Which field defines the board columns?",
      options: fields.map((field) => ({
        value: field.id,
        label: field.name,
        hint: field.options.map((option) => option.name).join(", "),
      })),
      initialValue: suggestColumnField(fields)?.id,
    }),
  );
  return fields.find((field) => field.id === fieldId)!;
}

// Unwraps a clack answer, turning a cancel into an exception so every
// step does not need its own `isCancel` check.
async function ask<T>(prompt: Promise<T | symbol>): Promise<Exclude<T, symbol>> {
  const answer = await prompt;
  if (p.isCancel(answer)) throw new Cancelled();
  return answer as Exclude<T, symbol>;
}

async function withSpinner<T>(start: string, done: string, task: () => Promise<T>): Promise<T> {
  const spinner = p.spinner();
  spinner.start(start);
  try {
    const result = await task();
    spinner.stop(done);
    return result;
  } catch (error) {
    spinner.stop("Failed");
    throw error;
  }
}
