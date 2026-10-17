// The `gh-relay init` wizard.
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

// Returns the process exit code.
export async function runInitWizard(init: InitProject): Promise<number> {
  p.intro("gh-relay init");
  try {
    return await wizard(init);
  } catch (error) {
    if (error instanceof Cancelled) {
      p.cancel("Init cancelled. Nothing was written.");
      return 1;
    }
    if (error instanceof GitHubError) {
      p.log.error(error.message);
      p.outro("Fix the problem above and run gh-relay init again.");
      return 1;
    }
    throw error;
  }
}

async function wizard(init: InitProject): Promise<number> {
  // 1. Load everything that does not depend on the user's answers.
  const context = await prepareWithAuthFix(init);

  if (context.installedAgents.length === 0) {
    p.log.error("No supported AI agent was found on this machine.");
    p.outro("Install Claude Code (https://docs.claude.com/en/docs/claude-code) and run gh-relay init again.");
    return 1;
  }

  if (context.existingConfig.status === "ok") {
    const replace = await ask(
      p.confirm({
        message: `This repo is already configured for "${context.existingConfig.config.project.title}". Replace the config?`,
        initialValue: false,
      }),
    );
    if (!replace) {
      p.outro("Kept the existing config.");
      return 0;
    }
  } else if (context.existingConfig.status === "invalid") {
    p.log.warn("The existing .gh-relay.json is invalid and will be replaced.");
  }

  // 2. Project.
  const openProjects = context.projects.filter((project) => !project.closed);
  if (openProjects.length === 0) {
    p.log.error("No open GitHub Projects found for your account or your organizations.");
    p.outro("Create a project at https://github.com/users/<you>/projects and run gh-relay init again.");
    return 1;
  }

  const projectId = await ask(
    p.select({
      message: "Which project holds the tasks for this repository?",
      options: openProjects.map((project) => ({
        value: project.id,
        label: project.title,
        hint: `${project.owner} #${project.number}${project.ownerType === "organization" ? " (org)" : ""}`,
      })),
      maxItems: 10,
    }),
  );
  const project = openProjects.find((candidate) => candidate.id === projectId)!;

  // 3. The field whose options are the board columns.
  const fields = await withSpinner("Reading the project fields", "Fields loaded", () =>
    init.columnFields(project.id),
  );
  if (fields.length === 0) {
    p.log.error(`"${project.title}" has no single-select field to use as columns.`);
    p.outro("Add a single-select field (like Status) to the project and run gh-relay init again.");
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
      p.log.error(`gh-relay needs a column for "${role}" (${ROLE_DESCRIPTIONS[role]}).`);
      p.outro(`Add it as an option of the "${field.name}" field on the board, then run gh-relay init again.`);
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
    // Unreachable through this wizard (taken options are hidden), kept as a safety net.
    for (const error of outcome.errors) p.log.error(JSON.stringify(error));
    return 1;
  }

  const summary = ROLES.map((role) => `${role.padEnd(12)} ${outcome.config.roles[role]?.name ?? "(none)"}`);
  p.note(summary.join("\n"), `${project.title} / ${field.name}`);

  const files = [".gh-relay.json"];
  if (outcome.rulesFileCreated) files.push(outcome.config.rulesFile);
  else p.log.info(`Kept your existing ${outcome.config.rulesFile}.`);

  p.outro(`Done. Commit ${files.join(" and ")}, then run gh-relay.`);
  return 0;
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
