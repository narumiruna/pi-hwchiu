#!/usr/bin/env node

import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(
  repositoryRoot,
  process.argv[2] ?? "docusaurus-blog",
);
const skillRoot = resolve(repositoryRoot, "skills/hwchiu-sre-knowledge");
const referencesRoot = join(skillRoot, "references");
const articlesRoot = join(referencesRoot, "articles");

async function listMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }

  return files.sort();
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  const delimiter =
    lines[0] === "---" || lines[0] === "--" ? lines[0] : undefined;
  if (!delimiter) return { data: {}, body: content };

  const end = lines.indexOf(delimiter, 1);
  if (end < 0) return { data: {}, body: content };

  const data = {};
  let listKey;

  for (const line of lines.slice(1, end)) {
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && listKey) {
      data[listKey] ??= [];
      data[listKey].push(unquote(listItem[1]));
      continue;
    }

    const property = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!property) continue;

    const [, key, rawValue] = property;
    listKey = rawValue ? undefined : key;
    data[key] = rawValue ? unquote(rawValue) : [];
  }

  return { data, body: lines.slice(end + 1).join("\n") };
}

function inferDate(articlePath, explicitDate) {
  if (typeof explicitDate === "string") {
    const match = explicitDate.match(/\d{4}-\d{2}-\d{2}/);
    if (match) return { date: match[0], datePrecision: "timestamp" };
  }

  const blogMatch = articlePath.match(/^blog\/(\d{4})\/(\d{2}-\d{2})-/);
  if (blogMatch) {
    return {
      date: `${blogMatch[1]}-${blogMatch[2]}`,
      datePrecision: "path-day",
    };
  }

  const yearMatch = articlePath.match(/^(?:blog|docs)\/(\d{4})\//);
  return {
    date: yearMatch?.[1] ?? "unknown",
    datePrecision: yearMatch ? "year" : "unknown",
  };
}

function inferTitle(data, body, articlePath) {
  if (typeof data.title === "string" && data.title.trim())
    return data.title.trim();
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return basename(articlePath, ".md").replaceAll("-", " ");
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))];
}

function makeSummary(body) {
  const prose = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return prose.slice(0, 240);
}

function markdownEscape(value) {
  return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function buildIndex(catalog) {
  const tagCounts = new Map();
  for (const article of catalog.articles) {
    for (const tag of article.tags) {
      const normalized = tag.toLowerCase();
      tagCounts.set(normalized, (tagCounts.get(normalized) ?? 0) + 1);
    }
  }

  const topTags = [...tagCounts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, 20)
    .map(([tag, count]) => `- ${tag}: ${count}`);

  const byYear = Map.groupBy(catalog.articles, (article) => article.year);
  const years = [...byYear.keys()].sort().reverse();
  const articleLines = [];

  for (const year of years) {
    articleLines.push(`### ${year}`, "");
    for (const article of byYear.get(year)) {
      const date =
        article.datePrecision === "year" ? article.date : article.date;
      const tags =
        article.tags.length > 0 ? `; ${article.tags.join(", ")}` : "";
      articleLines.push(
        `- [${markdownEscape(article.title)}](articles/${article.path}) — ${article.kind}; ${date}${tags}`,
      );
    }
    articleLines.push("");
  }

  return `# hwchiu Knowledge Corpus Index

This snapshot contains every Markdown article found in the source site's short-note and long-form article collections.

## Coverage

- Short notes from \`blog/\`: ${catalog.counts.blog}
- Long-form articles from \`docs/\`: ${catalog.counts.docs}
- Total articles: ${catalog.counts.total}
- Source author: hwchiu (邱宏瑋 / HungWei Chiu)

The source is predominantly Traditional Chinese with English technical terms and code.

Article dates marked only with a year were inferred from their directory and must not be presented as exact publication dates.

## Most Common Tags

${topTags.join("\n")}

## Every Article

${articleLines.join("\n")}`;
}

async function main() {
  const sourceFiles = [];
  for (const kind of ["blog", "docs"]) {
    const directory = join(sourceRoot, kind);
    for (const path of await listMarkdownFiles(directory)) {
      sourceFiles.push({ kind, path });
    }
  }

  await rm(articlesRoot, { recursive: true, force: true });
  await mkdir(articlesRoot, { recursive: true });

  const articles = [];
  for (const source of sourceFiles) {
    const sourceRelativePath = relative(sourceRoot, source.path)
      .split(sep)
      .join("/");
    const destination = join(articlesRoot, sourceRelativePath);
    const content = await readFile(source.path, "utf8");
    const { data, body } = parseFrontmatter(content);
    const { date, datePrecision } = inferDate(sourceRelativePath, data.date);

    await mkdir(dirname(destination), { recursive: true });
    await cp(source.path, destination);

    articles.push({
      path: sourceRelativePath,
      kind: source.kind === "blog" ? "note" : "article",
      year: date.slice(0, 4),
      date,
      datePrecision,
      title: inferTitle(data, body, sourceRelativePath),
      tags: normalizeTags(data.tags),
      summary: makeSummary(body),
      explicitAuthor: data.author === "hwchiu" || data.authors === "hwchiu",
    });
  }

  articles.sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      left.path.localeCompare(right.path),
  );
  const catalog = {
    source: "https://github.com/hwchiu/docusaurus-blog",
    sourceAuthor: "hwchiu",
    counts: {
      blog: articles.filter((article) => article.kind === "note").length,
      docs: articles.filter((article) => article.kind === "article").length,
      total: articles.length,
    },
    articles,
  };

  await mkdir(referencesRoot, { recursive: true });
  await writeFile(
    join(referencesRoot, "catalog.json"),
    `${JSON.stringify(catalog, null, 2)}\n`,
  );
  await writeFile(join(referencesRoot, "INDEX.md"), buildIndex(catalog));

  console.log(
    `Synced ${catalog.counts.total} articles (${catalog.counts.blog} notes and ${catalog.counts.docs} long-form articles).`,
  );
}

await main();
