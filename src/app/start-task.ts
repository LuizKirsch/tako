// Use case: start a task, after the user picked the agent and the model.
//
//   findRepo()    -> the folder where the card's repository is cloned:
//                    the one remembered, else the current folder if it is
//                    that repository; otherwise the UI asks
//   useRepoAt()   -> checks a folder the user typed and remembers it
//   prepareRepo() -> creates .tako/rules.md there the first time
//   moveToInProgress() -> moves the card to the in_progress column
//   launch()      -> creates the task's worktree (its own folder and branch),
//                    starts the agent there in the background with the issue
//                    as the first message, and follows the task
//                    (see track-tasks.ts)
//
// Folders are remembered per repository in the tako config, so a project
// with issues from several repositories works too.

import type { Card } from "../domain/board.js";
import { rememberRepo, repoPath, type ProjectConfig } from "../domain/config.js";
import { join } from "node:path";
import { branchName, buildTaskPrompt, sameRepo, worktreeDir } from "../domain/task.js";
import type { AgentAdapter } from "../ports/agent.js";
import type { Files } from "../ports/files.js";
import type { GitPort } from "../ports/git.js";
import type { BoardSource } from "../ports/board-source.js";
import { RECOMMENDED_RULES, RULES_FILE } from "../templates/recommended-rules.js";
import { loadConfig, saveConfig } from "./config-file.js";
import { loadTasks, saveTasks } from "./task-store.js";

export interface StartDeps {
  files: Files; // rooted at the tako config directory
  git: GitPort;
  board: BoardSource;
  agents: readonly AgentAdapter[];
  repoFiles: (root: string) => Files; // files inside a repository
  cwd: string; // where tako was started
}

export interface StartRequest {
  card: Card; // has a repository: the board refuses drafts
  agentId: string;
  model: string | undefined;
  project: ProjectConfig; // the board the card came from
}

export type UseRepoResult =
  | { ok: true; root: string }
  | { ok: false; reason: "not_a_repo" }
  | { ok: false; reason: "other_repo"; found: string | undefined };

export class StartTask {
  constructor(private readonly deps: StartDeps) {}

  // The repository's folder, or undefined when the user has to say where it is.
  async findRepo(repo: string): Promise<string | undefined> {
    const loaded = await loadConfig(this.deps.files);
    const saved = loaded.status === "ok" ? repoPath(loaded.config, repo) : undefined;
    // A remembered folder may have been moved or deleted since: check it.
    if (saved && (await this.isRepo(saved, repo))) return saved;

    const here = await this.deps.git.inspect(this.deps.cwd);
    if (here?.repo && sameRepo(here.repo, repo)) {
      await this.remember(repo, here.root);
      return here.root;
    }
    return undefined;
  }

  async useRepoAt(repo: string, dir: string): Promise<UseRepoResult> {
    const local = await this.deps.git.inspect(dir);
    if (!local) return { ok: false, reason: "not_a_repo" };
    if (!local.repo || !sameRepo(local.repo, repo)) return { ok: false, reason: "other_repo", found: local.repo };
    await this.remember(repo, local.root);
    return { ok: true, root: local.root };
  }

  // Creates the rules file the first time; never overwrites the user's rules.
  // Returns whether it was created.
  async prepareRepo(root: string): Promise<boolean> {
    const files = this.deps.repoFiles(root);
    if (await files.exists(RULES_FILE)) return false;
    await files.writeText(RULES_FILE, RECOMMENDED_RULES);
    return true;
  }

  // Returns the name of the column the card went to.
  async moveToInProgress({ card, project }: StartRequest): Promise<string> {
    // Required by parseConfig; the check only satisfies the type.
    const target = project.roles.in_progress;
    if (!target) throw new Error("This project has no in_progress column. Run `tako init` again.");
    await this.deps.board.moveCard({
      projectId: project.project.id,
      itemId: card.itemId,
      fieldId: project.columnField.id,
      optionId: target.optionId,
    });
    return target.name;
  }

  // Resolves with the worktree as soon as the agent runs in the background.
  async launch(request: StartRequest, root: string): Promise<string> {
    const agent = this.deps.agents.find((a) => a.id === request.agentId);
    if (!agent) throw new Error(`Unknown agent "${request.agentId}".`);
    const { card, project } = request;

    const branch = branchName(card);
    const worktree = join(root, worktreeDir(branch));
    await this.deps.git.addWorktree(root, worktree, branch, project.baseBranch);

    const comments = await this.deps.board.listComments(card);
    const rulesFile = join(root, RULES_FILE);
    const prompt = buildTaskPrompt({ card, comments, baseBranch: project.baseBranch, rulesFile });
    const name = `tako #${card.number ?? "?"} ${card.title}`;
    const sessionId = await agent.start({ cwd: worktree, model: request.model, prompt, name });

    const tasks = (await loadTasks(this.deps.files)).filter((t) => t.itemId !== card.itemId);
    tasks.push({
      itemId: card.itemId,
      projectId: project.project.id,
      agentId: agent.id,
      sessionId,
      repo: card.repo ?? "",
      root,
      worktree,
      branch,
      number: card.number,
      title: card.title,
    });
    await saveTasks(this.deps.files, tasks);
    return worktree;
  }

  private async isRepo(dir: string, repo: string): Promise<boolean> {
    const local = await this.deps.git.inspect(dir);
    return local?.repo !== undefined && sameRepo(local.repo, repo);
  }

  // Best effort: a config that cannot be read is left alone (it may hold
  // projects), and the folder is simply asked again next time.
  private async remember(repo: string, root: string): Promise<void> {
    const loaded = await loadConfig(this.deps.files);
    if (loaded.status !== "ok") return;
    await saveConfig(this.deps.files, rememberRepo(loaded.config, repo, root));
  }
}
