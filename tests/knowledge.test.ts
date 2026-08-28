import { expect, test } from "vitest";
import {
  loadCatalog,
  readArticle,
  searchKnowledge,
} from "../extensions/knowledge.ts";

test("catalog contains the complete short-note and long-form corpus", async () => {
  const catalog = await loadCatalog();

  expect(catalog.counts).toEqual({ blog: 149, docs: 260, total: 409 });
  expect(catalog.articles).toHaveLength(409);
  expect(new Set(catalog.articles.map((article) => article.path)).size).toBe(
    409,
  );
});

test("search ranks relevant bilingual corpus entries", async () => {
  const results = await searchKnowledge("Kubernetes 網路除錯", 10);

  expect(results).not.toHaveLength(0);
  expect(results.some((article) => article.path.includes("k8s-network"))).toBe(
    true,
  );
  expect(results.every((article) => article.path.endsWith(".md"))).toBe(true);
  expect(results.every((article) => article.date.length >= 4)).toBe(true);
});

test("permissive metadata parsing preserves the malformed Terraform note", async () => {
  const results = await searchKnowledge("terraform 小筆記", 5);

  expect(results[0]).toMatchObject({
    path: "blog/2023/06-21-terraform.md",
    title: "terraform 小筆記",
  });
});

test("article reading is catalog-bound and supports pagination", async () => {
  const excerpt = await readArticle(
    "articles/blog/2023/04-12-oom_event.md",
    1,
    10,
  );

  expect(excerpt.article.title).toContain("OOM");
  expect(excerpt.startLine).toBe(1);
  expect(excerpt.endLine).toBe(10);
  expect(excerpt.totalLines).toBeGreaterThan(10);
  expect(excerpt.truncated).toBe(true);
  await expect(readArticle("../../package.json")).rejects.toThrow(
    "Unknown article path",
  );
});

test("search validates bounded inputs", async () => {
  await expect(searchKnowledge("x")).rejects.toThrow("at least two characters");
  await expect(searchKnowledge("kubernetes", 21)).rejects.toThrow("1 to 20");
});
