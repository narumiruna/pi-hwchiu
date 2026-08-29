import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  expandQuery,
  findRelatedArticles,
  loadCatalog,
  loadSeriesCatalog,
  readArticle,
  referencesRoot,
  searchKnowledge,
  tokenize,
} from "../extensions/knowledge.ts";

interface SearchCase {
  query: string;
  requiredTopFive: string[];
}

const searchCases = JSON.parse(
  await readFile(
    join(import.meta.dirname, "fixtures/search-cases.json"),
    "utf8",
  ),
) as SearchCase[];

const sha256 = (content: string) =>
  createHash("sha256").update(content).digest("hex");

test("catalog is internally consistent and pinned to an upstream revision", async () => {
  const catalog = await loadCatalog();

  expect(catalog.schemaVersion).toBe(2);
  expect(catalog.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
  expect(catalog.sourceRevisionDate).not.toBe("unknown");
  expect(catalog.counts.blog + catalog.counts.docs).toBe(catalog.counts.total);
  expect(catalog.articles).toHaveLength(catalog.counts.total);
  expect(new Set(catalog.articles.map((article) => article.path)).size).toBe(
    catalog.counts.total,
  );
  expect(
    catalog.articles.filter((article) => article.kind === "note"),
  ).toHaveLength(catalog.counts.blog);
  expect(
    catalog.articles.filter((article) => article.kind === "article"),
  ).toHaveLength(catalog.counts.docs);
});

test("every article digest and revision-pinned source URL is valid", async () => {
  const catalog = await loadCatalog();
  await Promise.all(
    catalog.articles.map(async (article) => {
      const content = await readFile(
        join(referencesRoot, "articles", article.path),
        "utf8",
      );
      expect(article.contentDigest).toBe(sha256(content));
      expect(article.sourceUrl).toContain(
        `/blob/${catalog.sourceRevision}/${article.path}`,
      );
    }),
  );
});

test("tokenizer and alias expansion normalize English and CJK terms", () => {
  expect(tokenize("Ｋ8S Kubernetes 網路除錯")).toEqual([
    "k8s",
    "kubernetes",
    "網路",
    "路除",
    "除錯",
  ]);
  expect(expandQuery("Ｋ8S")).toEqual({
    requiredGroups: [["k8s", "kubernetes"]],
    expanded: ["k8s", "kubernetes"],
  });
  expect(expandQuery("網路除錯").requiredGroups).toEqual([
    ["網路"],
    ["路除"],
    ["除錯"],
  ]);
});

describe("search quality cases", () => {
  for (const searchCase of searchCases) {
    test(`${searchCase.query} includes required results in the top five`, async () => {
      const results = await searchKnowledge(searchCase.query, 5);
      const paths = results.map((article) => article.path);
      for (const required of searchCase.requiredTopFive) {
        expect(paths).toContain(required);
      }
      expect(
        results.every((article) => article.matchExcerpt.length <= 322),
      ).toBe(true);
      expect(results.every((article) => article.matchedFields.length > 0)).toBe(
        true,
      );
      expect(results.every((article) => article.matchedTerms.length <= 8)).toBe(
        true,
      );
    });
  }
});

test("search filters by kind, tags, years, and all-term matching", async () => {
  const results = await searchKnowledge("Kubernetes GitOps", 20, {
    kind: "article",
    tags: ["Kubernetes"],
    yearFrom: 2020,
    yearTo: 2021,
    matchMode: "all",
  });

  expect(results.length).toBeGreaterThan(0);
  expect(results.every((article) => article.kind === "article")).toBe(true);
  expect(
    results.every((article) =>
      article.tags.some((tag) => tag.toLowerCase() === "kubernetes"),
    ),
  ).toBe(true);
  expect(
    results.every(
      (article) => Number(article.year) >= 2020 && Number(article.year) <= 2021,
    ),
  ).toBe(true);
});

test("permissive metadata parsing preserves the malformed Terraform note", async () => {
  const results = await searchKnowledge("terraform 小筆記", 5);

  expect(results[0]).toMatchObject({
    path: "blog/2023/06-21-terraform.md",
    title: "terraform 小筆記",
  });
});

test("article reading is catalog-bound, paginated, and freshness-consistent", async () => {
  const [excerpt, searchResult] = await Promise.all([
    readArticle("articles/blog/2023/04-12-oom_event.md", 1, 10),
    searchKnowledge("OOM event", 1),
  ]);

  expect(excerpt.article.title).toContain("OOM");
  expect(excerpt.startLine).toBe(1);
  expect(excerpt.endLine).toBe(10);
  expect(excerpt.totalLines).toBeGreaterThan(10);
  expect(excerpt.truncated).toBe(true);
  expect(excerpt.freshness).toEqual(searchResult[0].freshness);
  await expect(readArticle("../../package.json")).rejects.toThrow(
    "Unknown article path",
  );
});

test("search validates bounded and incompatible inputs", async () => {
  await expect(searchKnowledge("x")).rejects.toThrow("2 to 500");
  await expect(searchKnowledge("x".repeat(501))).rejects.toThrow("2 to 500");
  await expect(searchKnowledge("--")).rejects.toThrow("no searchable terms");
  await expect(searchKnowledge("kubernetes", 21)).rejects.toThrow("1 to 20");
  await expect(
    searchKnowledge("kubernetes", 5, { yearFrom: 2025, yearTo: 2020 }),
  ).rejects.toThrow("yearFrom");
  await expect(
    searchKnowledge("kubernetes", 5, { kind: "book" as "article" }),
  ).rejects.toThrow("kind");
  await expect(
    searchKnowledge("kubernetes", 5, {
      tags: Array.from({ length: 11 }, () => "x"),
    }),
  ).rejects.toThrow("at most 10");
});

test("related articles expose curated series adjacency and score reasons", async () => {
  const cases = [
    {
      path: "articles/docs/2018/introduce-cni-ii.md",
      id: "container-network-interface",
      previous: "docs/2018/introduce-cni-i.md",
      next: "docs/2018/introduce-cni-iii.md",
    },
    {
      path: "docs/2018/kubernetes-service-ii.md",
      id: "kubernetes-service",
      previous: "docs/2018/kubernetes-service-i.md",
      next: "docs/2018/kubernetes-service-iii.md",
    },
    {
      path: "docs/2020/ipvs-2.md",
      id: "ipvs",
      previous: "docs/2020/ipvs-1.md",
      next: "docs/2020/ipvs-3.md",
    },
  ];

  for (const fixture of cases) {
    const result = await findRelatedArticles(fixture.path, 5);
    expect(result.series?.id).toBe(fixture.id);
    expect(result.previous?.path).toBe(fixture.previous);
    expect(result.next?.path).toBe(fixture.next);
    expect(result.related[0].reasons).toContain("adjacent in the same series");
    expect(
      result.related.every((article) => article.path !== result.article.path),
    ).toBe(true);
  }

  const readingNote = await findRelatedArticles(
    "blog/2022/01-03-reading-notes.md",
    5,
  );
  expect(readingNote.series).toBeUndefined();
  expect(readingNote.related.length).toBeGreaterThan(0);
  expect(readingNote.related[0].reasons.join(" ")).toContain(
    "shared title terms",
  );
  expect(await findRelatedArticles(readingNote.article.path, 5)).toEqual(
    readingNote,
  );

  await expect(findRelatedArticles("unknown.md")).rejects.toThrow(
    "Unknown article path",
  );
  await expect(findRelatedArticles(cases[0].path, 21)).rejects.toThrow(
    "1 to 20",
  );
});

test("every curated series path exists in the catalog", async () => {
  const [catalog, seriesCatalog] = await Promise.all([
    loadCatalog(),
    loadSeriesCatalog(),
  ]);
  const paths = new Set(catalog.articles.map((article) => article.path));
  const seriesPaths = seriesCatalog.series.flatMap((series) => series.paths);

  expect(new Set(seriesPaths).size).toBe(seriesPaths.length);
  expect(seriesPaths.every((path) => paths.has(path))).toBe(true);
});
