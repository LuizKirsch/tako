import { describe, expect, it } from "vitest";
import type { Card } from "../../src/domain/board.js";
import { branchName, buildTaskPrompt, repoFromRemoteUrl, sameRepo } from "../../src/domain/task.js";

const card: Card = {
  itemId: "PVTI_1",
  contentId: "I_1",
  optionId: "o-ready",
  kind: "issue",
  title: "Corrigir a página de login",
  number: 3,
  url: "https://github.com/LuizKirsch/portfolio/issues/3",
  repo: "LuizKirsch/portfolio",
  closed: false,
  body: "## Checklist\n- [ ] Fix it\n",
  labels: [],
  assignees: [],
};

describe("repoFromRemoteUrl", () => {
  it("reads HTTPS and SSH GitHub remotes, lowercased", () => {
    expect(repoFromRemoteUrl("https://github.com/LuizKirsch/portfolio.git")).toBe("luizkirsch/portfolio");
    expect(repoFromRemoteUrl("https://github.com/LuizKirsch/portfolio")).toBe("luizkirsch/portfolio");
    expect(repoFromRemoteUrl("git@github.com:LuizKirsch/portfolio.git")).toBe("luizkirsch/portfolio");
    expect(repoFromRemoteUrl("ssh://git@github.com/LuizKirsch/my.repo.git\n")).toBe("luizkirsch/my.repo");
  });

  it("ignores remotes that are not GitHub", () => {
    expect(repoFromRemoteUrl("https://gitlab.com/LuizKirsch/portfolio.git")).toBeUndefined();
  });

  it("compares repositories without case", () => {
    expect(sameRepo("LuizKirsch/portfolio", "luizkirsch/Portfolio")).toBe(true);
    expect(sameRepo("LuizKirsch/portfolio", "LuizKirsch/other")).toBe(false);
  });
});

describe("branchName", () => {
  it("uses the issue number and the title without accents", () => {
    expect(branchName(card)).toBe("tako/3-corrigir-a-pagina-de-login");
  });

  it("cuts long titles and trims dashes", () => {
    const long = { ...card, title: "  Uma tarefa com um título muito, muito longo mesmo!!  " };
    expect(branchName(long)).toBe("tako/3-uma-tarefa-com-um-titulo-muito-muito-lon");
    // A cut that lands on a dash does not leave it at the end.
    expect(branchName({ ...card, title: "a".repeat(39) + " tail" })).toBe(`tako/3-${"a".repeat(39)}`);
  });
});

describe("buildTaskPrompt", () => {
  it("puts the workflow first, then the issue and its comments", () => {
    const prompt = buildTaskPrompt({
      card,
      comments: [{ author: "alice", body: "Also check mobile.", createdAt: "2026-01-02T10:00:00Z" }],
      baseBranch: "main",
      rulesFile: ".tako/rules.md",
    });

    expect(prompt).toContain("Work on GitHub issue #3 in LuizKirsch/portfolio: Corrigir a página de login");
    expect(prompt).toContain("create the branch `tako/3-corrigir-a-pagina-de-login` from `main`");
    expect(prompt).toContain("Follow the rules in `.tako/rules.md`");
    expect(prompt).toContain("Do not push and do not open a pull request");
    expect(prompt).toContain("## Issue description\n## Checklist\n- [ ] Fix it");
    expect(prompt).toContain("## Comments (1)\n\n### @alice · 2026-01-02\nAlso check mobile.");
    expect(prompt.indexOf("## How to work")).toBeLessThan(prompt.indexOf("## Issue description"));
  });

  it("says when there is no description and skips an empty comment list", () => {
    const prompt = buildTaskPrompt({ card: { ...card, body: "" }, comments: [], baseBranch: "main", rulesFile: "r.md" });
    expect(prompt).toContain("(no description)");
    expect(prompt).not.toContain("## Comments");
  });
});
