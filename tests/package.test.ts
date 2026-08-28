import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import piHwchiu from "../extensions/index.ts";

const root = join(import.meta.dirname, "..");

interface CapturedTool {
  name: string;
  execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal,
    onUpdate: undefined,
    context: { cwd: string },
  ) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

test("registers the knowledge and read-only observation tools", () => {
  const registered: Array<{ name: string }> = [];
  const pi = {
    registerTool(tool: { name: string }) {
      registered.push(tool);
    },
  };

  piHwchiu(pi as unknown as ExtensionAPI);

  expect(registered.map((tool) => tool.name)).toEqual([
    "hwchiu_knowledge_search",
    "hwchiu_read_article",
    "hwchiu_k8s_observe",
    "hwchiu_systemd_observe",
  ]);
});

test("observation tools pass cwd, abort signal, and timeout to pi.exec", async () => {
  const registered: CapturedTool[] = [];
  const exec = vi.fn().mockResolvedValue({
    stdout: "default",
    stderr: "",
    code: 0,
    killed: false,
  });
  const pi = {
    registerTool(tool: CapturedTool) {
      registered.push(tool);
    },
    exec,
  };
  piHwchiu(pi as unknown as ExtensionAPI);
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
    {
      cwd: "/workspace",
    },
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
      {
        cwd: "/workspace",
      },
    ),
  ).rejects.toThrow();
  expect(exec).toHaveBeenCalledTimes(1);
});

test("declares a discoverable Pi package", async () => {
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as {
    name: string;
    keywords: string[];
    pi: { extensions: string[]; skills: string[] };
  };
  const projectSettings = JSON.parse(
    await readFile(join(root, ".pi/settings.json"), "utf8"),
  ) as { packages: string[] };

  expect(manifest.name).toBe("pi-hwchiu");
  expect(manifest.keywords).toContain("pi-package");
  expect(manifest.pi).toEqual({
    extensions: ["./extensions/index.ts"],
    skills: ["./skills"],
  });
  expect(projectSettings.packages).toEqual(["../"]);
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
  const links = [...index.matchAll(/\]\(articles\/([^)]+\.md)\)/g)].map(
    (match) => match[1],
  );

  expect(skill).toMatch(/^---\nname: hwchiu-sre-knowledge\ndescription: .+/);
  expect(links).toHaveLength(409);
  await Promise.all(
    links.map((path) =>
      stat(
        join(root, "skills/hwchiu-sre-knowledge/references/articles", path),
      ).then((entry) => expect(entry.isFile()).toBe(true)),
    ),
  );
});
