// Captures real GraphQL responses from YOUR GitHub account into
// test/fixtures/github, replacing the hand-written *.sample.json files.
//
// Usage: npx tsx scripts/capture-fixtures.ts [projectId]
// Without projectId, it uses the first open project returned.
// Review the files before committing: they contain project titles and IDs.

import { writeFileSync } from "node:fs";
import { execaGhRunner } from "../src/infra/github/gh-runner.js";
import { LIST_CARDS, LIST_COLUMN_FIELDS, LIST_PROJECTS } from "../src/infra/github/queries.js";
import { parseProjects } from "../src/infra/github/parse.js";

const dir = new URL("../test/fixtures/github/", import.meta.url);

async function query(q: string, vars: Record<string, string> = {}): Promise<string> {
  const args = ["api", "graphql", "-f", `query=${q}`];
  for (const [k, v] of Object.entries(vars)) args.push("-f", `${k}=${v}`);
  const result = await execaGhRunner(args);
  if (result.exitCode !== 0) console.warn(`gh exited with ${result.exitCode}: ${result.stderr}`);
  // Pretty-print so diffs of the fixtures stay readable.
  return JSON.stringify(JSON.parse(result.stdout), null, 2) + "\n";
}

const projectsJson = await query(LIST_PROJECTS);
writeFileSync(new URL("list-projects.sample.json", dir), projectsJson);

const projectId =
  process.argv[2] ?? parseProjects(JSON.parse(projectsJson).data).find((p) => !p.closed)?.id;
if (!projectId) {
  console.error("No open project found; pass a project ID as argument.");
  process.exit(1);
}

writeFileSync(new URL("list-column-fields.sample.json", dir), await query(LIST_COLUMN_FIELDS, { projectId }));
writeFileSync(new URL("list-cards.json", dir), await query(LIST_CARDS, { projectId }));
console.log(`Fixtures captured (column fields from ${projectId}). Run npm test to check the parsers.`);
