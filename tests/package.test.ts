import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import piHwchiu from "../extensions/index.ts";
import type { IncidentReportInput } from "../extensions/report.ts";

const root = join(import.meta.dirname, "..");

interface CapturedTool {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: undefined,
    context: { cwd: string },
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details?: unknown;
    terminate?: boolean;
  }>;
}

function captureTools(exec = vi.fn()) {
  const registered: CapturedTool[] = [];
  const pi = {
    registerTool(tool: CapturedTool) {
      registered.push(tool);
    },
    exec,
  };
  piHwchiu(pi as unknown as ExtensionAPI);
  return { registered, exec };
}

test("registers knowledge, observation, related-reading, and reporting tools", () => {
  const { registered } = captureTools();

  expect(registered.map((tool) => tool.name)).toEqual([
    "hwchiu_knowledge_search",
    "hwchiu_read_article",
    "hwchiu_related_articles",
    "hwchiu_k8s_observe",
    "hwchiu_systemd_observe",
    "hwchiu_incident_report",
  ]);
});

test("knowledge search returns excerpts, provenance, and freshness details", async () => {
  const { registered } = captureTools();
  const tool = registered.find(
    (candidate) => candidate.name === "hwchiu_knowledge_search",
  );
  if (!tool) throw new Error("hwchiu_knowledge_search was not registered");

  const result = await tool.execute(
    "call-search",
    { query: "terraform 小筆記", limit: 1, kind: "note" },
    new AbortController().signal,
    undefined,
    { cwd: root },
  );

  expect(result.content[0].text).toContain("Excerpt:");
  expect(result.content[0].text).toContain("Original:");
  expect(result.content[0].text).toContain("Freshness:");
  expect(result.details).toMatchObject({
    filters: { kind: "note" },
    matches: [{ path: "blog/2023/06-21-terraform.md" }],
  });
});

test("observation tools pass cwd, abort signal, and timeout to pi.exec", async () => {
  const exec = vi.fn().mockResolvedValue({
    stdout: "default",
    stderr: "",
    code: 0,
    killed: false,
  });
  const { registered } = captureTools(exec);
  const tool = registered.find(
    (candidate) => candidate.name === "hwchiu_k8s_observe",
  );
  if (!tool) throw new Error("hwchiu_k8s_observe was not registered");
  const controller = new AbortController();

  await tool.execute(
    "call-1",
    { operation: "context" },
    controller.signal,
    undefined,
    { cwd: "/workspace" },
  );

  expect(exec).toHaveBeenCalledWith("kubectl", ["config", "current-context"], {
    cwd: "/workspace",
    signal: controller.signal,
    timeout: 10_000,
  });

  controller.abort();
  await expect(
    tool.execute(
      "call-2",
      { operation: "context" },
      controller.signal,
      undefined,
      { cwd: "/workspace" },
    ),
  ).rejects.toThrow();
  expect(exec).toHaveBeenCalledTimes(1);
});

test("incident formatter returns matching structured details and terminates", async () => {
  const { registered } = captureTools();
  const tool = registered.find(
    (candidate) => candidate.name === "hwchiu_incident_report",
  );
  if (!tool) throw new Error("hwchiu_incident_report was not registered");
  const report: IncidentReportInput = {
    title: "api.service failure",
    scope: "api.service",
    observations: [{ finding: "Unit failed", source: "systemctl --failed" }],
    hypotheses: [],
    tests: [],
    recommendedChanges: [],
    sources: [],
    openQuestions: [],
  };

  const result = await tool.execute(
    "call-report",
    report as unknown as Record<string, unknown>,
    new AbortController().signal,
    undefined,
    { cwd: root },
  );

  expect(result.content[0].text).toContain("# api.service failure");
  expect(result.details).toEqual(report);
  expect(result.terminate).toBe(true);

  await expect(
    tool.execute(
      "call-invalid-report",
      { ...report, title: "" } as unknown as Record<string, unknown>,
      new AbortController().signal,
      undefined,
      { cwd: root },
    ),
  ).rejects.toThrow("title must be a non-empty string");
});

test("declares a discoverable Pi package with its prompt template", async () => {
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as {
    name: string;
    keywords: string[];
    files: string[];
    pi: { extensions: string[]; skills: string[]; prompts: string[] };
  };
  const projectSettings = JSON.parse(
    await readFile(join(root, ".pi/settings.json"), "utf8"),
  ) as { packages: string[] };

  expect(manifest.name).toBe("pi-hwchiu");
  expect(manifest.keywords).toContain("pi-package");
  expect(manifest.files).toContain("prompts");
  expect(manifest.pi).toEqual({
    extensions: ["./extensions/index.ts"],
    skills: ["./skills"],
    prompts: ["./prompts"],
  });
  expect(projectSettings.packages).toEqual(["../"]);
  expect(
    await readFile(join(root, "prompts/hwchiu-incident-report.md"), "utf8"),
  ).toContain(`\${ARGUMENTS:-current incident}`);
});

test("skill frontmatter and generated article links are valid", async () => {
  const skill = await readFile(
    join(root, "skills/hwchiu-sre-knowledge/SKILL.md"),
    "utf8",
  );
  const index = await readFile(
    join(root, "skills/hwchiu-sre-knowledge/references/INDEX.md"),
    "utf8",
  );
  const catalog = JSON.parse(
    await readFile(
      join(root, "skills/hwchiu-sre-knowledge/references/catalog.json"),
      "utf8",
    ),
  ) as { counts: { total: number } };
  const links = [...index.matchAll(/\]\(articles\/([^)]+\.md)\)/g)].map(
    (match) => match[1],
  );

  expect(skill).toMatch(/^---\nname: hwchiu-sre-knowledge\ndescription: .+/);
  expect(links).toHaveLength(catalog.counts.total);
  await Promise.all(
    links.map((path) =>
      stat(
        join(root, "skills/hwchiu-sre-knowledge/references/articles", path),
      ).then((entry) => expect(entry.isFile()).toBe(true)),
    ),
  );
});
