#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = resolve(repositoryRoot, "skills/hwchiu-sre-knowledge");
const referencesRoot = join(skillRoot, "references");
const articlesRoot = join(referencesRoot, "articles");
const catalogPath = join(referencesRoot, "catalog.json");
const indexPath = join(referencesRoot, "INDEX.md");
const seriesPath = join(referencesRoot, "series.json");
const sourceUrl = "https://github.com/hwchiu/docusaurus-blog";

export function parseArgs(args) {
  let check = false;
  let source;

  for (const argument of args) {
    if (argument === "--check") {
      check = true;
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (source) {
      throw new Error("Only one source directory may be provided.");
    } else {
      source = argument;
    }
  }

  return {
    check,
    sourceRoot: resolve(repositoryRoot, source ?? "docusaurus-blog"),
  };
}

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
  if (typeof data.title === "string" && data.title.trim()) {
    return data.title.trim();
  }
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

function digest(content) {
  return createHash("sha256").update(content).digest("hex");
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
      const tags =
        article.tags.length > 0 ? `; ${article.tags.join(", ")}` : "";
      articleLines.push(
        `- [${markdownEscape(article.title)}](articles/${article.path}) — ${article.kind}; ${article.date}${tags}`,
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
- Source revision: \`${catalog.sourceRevision}\`
- Source revision date: ${catalog.sourceRevisionDate}

The source is predominantly Traditional Chinese with English technical terms and code.

Article dates marked only with a year were inferred from their directory and must not be presented as exact publication dates.

## Most Common Tags

${topTags.join("\n")}

## Every Article

${articleLines.join("\n")}`;
}

export async function readSourceProvenance(sourceRoot) {
  const unknown = {
    sourceRevision: "unknown",
    sourceRevisionDate: "unknown",
  };
  const options = {
    cwd: sourceRoot,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeout: 10_000,
  };

  let topLevel;
  try {
    topLevel = await execFile("git", ["rev-parse", "--show-toplevel"], options);
  } catch {
    return unknown;
  }

  const [resolvedSourceRoot, resolvedTopLevel] = await Promise.all([
    realpath(sourceRoot),
    realpath(topLevel.stdout.trim()),
  ]);
  if (resolvedSourceRoot !== resolvedTopLevel) return unknown;

  const status = await execFile(
    "git",
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignored=matching",
      "--",
      "blog",
      "docs",
    ],
    options,
  );
  if (status.stdout.trim()) {
    throw new Error(
      "Source checkout must have clean blog/ and docs/ trees before provenance can be pinned.",
    );
  }

  const revision = await execFile("git", ["rev-parse", "HEAD"], options);
  const revisionDate = await execFile(
    "git",
    ["show", "-s", "--format=%cI", "HEAD"],
    options,
  );
  return {
    sourceRevision: revision.stdout.trim(),
    sourceRevisionDate: revisionDate.stdout.trim(),
  };
}

export async function buildSnapshot(sourceRoot) {
  const sourceFiles = [];
  for (const kind of ["blog", "docs"]) {
    const directory = join(sourceRoot, kind);
    for (const path of await listMarkdownFiles(directory)) {
      sourceFiles.push({ kind, path });
    }
  }

  const provenance = await readSourceProvenance(sourceRoot);
  const contents = new Map();
  const articles = [];
  for (const source of sourceFiles) {
    const articlePath = relative(sourceRoot, source.path).split(sep).join("/");
    const content = await readFile(source.path, "utf8");
    const { data, body } = parseFrontmatter(content);
    const { date, datePrecision } = inferDate(articlePath, data.date);
    contents.set(articlePath, content);
    articles.push({
      path: articlePath,
      kind: source.kind === "blog" ? "note" : "article",
      year: date.slice(0, 4),
      date,
      datePrecision,
      title: inferTitle(data, body, articlePath),
      tags: normalizeTags(data.tags),
      summary: makeSummary(body),
      explicitAuthor: data.author === "hwchiu" || data.authors === "hwchiu",
      contentDigest: digest(content),
      sourceUrl: `${sourceUrl}/blob/${provenance.sourceRevision === "unknown" ? "main" : provenance.sourceRevision}/${articlePath}`,
    });
  }

  articles.sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      left.path.localeCompare(right.path),
  );
  const catalog = {
    schemaVersion: 2,
    source: sourceUrl,
    sourceAuthor: "hwchiu",
    ...provenance,
    counts: {
      blog: articles.filter((article) => article.kind === "note").length,
      docs: articles.filter((article) => article.kind === "article").length,
      total: articles.length,
    },
    articles,
  };

  return {
    catalog,
    catalogText: `${JSON.stringify(catalog, null, 2)}\n`,
    indexText: buildIndex(catalog),
    contents,
  };
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export function validateSeriesCatalog(seriesCatalog, articlePaths) {
  if (!seriesCatalog || !Array.isArray(seriesCatalog.series)) {
    throw new Error("series.json must contain a series array.");
  }

  const ids = new Set();
  const assignedPaths = new Set();
  for (const series of seriesCatalog.series) {
    if (
      !series ||
      typeof series.id !== "string" ||
      !series.id ||
      typeof series.title !== "string" ||
      !series.title ||
      !Array.isArray(series.paths) ||
      series.paths.length === 0
    ) {
      throw new Error(
        "Each series must have a non-empty id, title, and paths.",
      );
    }
    if (ids.has(series.id))
      throw new Error(`Duplicate series id: ${series.id}`);
    ids.add(series.id);

    const localPaths = new Set();
    for (const path of series.paths) {
      if (typeof path !== "string" || !articlePaths.has(path)) {
        throw new Error(`Unknown series article path: ${String(path)}`);
      }
      if (localPaths.has(path)) {
        throw new Error(`Duplicate path in series ${series.id}: ${path}`);
      }
      if (assignedPaths.has(path)) {
        throw new Error(`Article belongs to multiple series: ${path}`);
      }
      localPaths.add(path);
      assignedPaths.add(path);
    }
  }
}

async function currentArticleDigest(path) {
  try {
    return digest(await readFile(join(articlesRoot, path), "utf8"));
  } catch {
    return undefined;
  }
}

export async function compareCatalogs(oldCatalog, nextCatalog) {
  const oldByPath = new Map(
    (oldCatalog?.articles ?? []).map((article) => [article.path, article]),
  );
  const nextByPath = new Map(
    nextCatalog.articles.map((article) => [article.path, article]),
  );
  const added = [...nextByPath.keys()]
    .filter((path) => !oldByPath.has(path))
    .sort();
  const removed = [...oldByPath.keys()]
    .filter((path) => !nextByPath.has(path))
    .sort();
  const modified = [];

  for (const [path, next] of nextByPath) {
    const old = oldByPath.get(path);
    if (!old) continue;
    const oldDigest = old.contentDigest ?? (await currentArticleDigest(path));
    if (oldDigest !== next.contentDigest) modified.push(path);
  }
  modified.sort();
  return { added, removed, modified };
}

export function formatChanges(changes) {
  const lines = [];
  for (const [label, paths] of [
    ["Added", changes.added],
    ["Removed", changes.removed],
    ["Modified", changes.modified],
  ]) {
    lines.push(`${label}: ${paths.length}`);
    lines.push(...paths.map((path) => `  - ${path}`));
  }
  return lines.join("\n");
}

async function findCurrentArticlePaths(directory, prefix = "") {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const paths = [];
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        paths.push(
          ...(await findCurrentArticlePaths(
            join(directory, entry.name),
            relativePath,
          )),
        );
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        paths.push(relativePath);
      }
    }
    return paths.sort();
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function hasSnapshotDrift(snapshot) {
  const currentCatalogText = await readFile(catalogPath, "utf8").catch(
    () => "",
  );
  const currentIndexText = await readFile(indexPath, "utf8").catch(() => "");
  if (
    currentCatalogText !== snapshot.catalogText ||
    currentIndexText !== snapshot.indexText
  ) {
    return true;
  }

  const currentPaths = await findCurrentArticlePaths(articlesRoot);
  const nextPaths = [...snapshot.contents.keys()].sort();
  if (JSON.stringify(currentPaths) !== JSON.stringify(nextPaths)) return true;

  for (const [path, content] of snapshot.contents) {
    const current = await readFile(join(articlesRoot, path), "utf8").catch(
      () => undefined,
    );
    if (current !== content) return true;
  }
  return false;
}

async function writeSnapshot(snapshot) {
  await rm(articlesRoot, { recursive: true, force: true });
  await mkdir(articlesRoot, { recursive: true });
  for (const [path, content] of snapshot.contents) {
    const destination = join(articlesRoot, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  await writeFile(catalogPath, snapshot.catalogText);
  await writeFile(indexPath, snapshot.indexText);
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const snapshot = await buildSnapshot(options.sourceRoot);
  const oldCatalog = await readJson(catalogPath);
  const seriesCatalog = await readJson(seriesPath);
  if (seriesCatalog) {
    validateSeriesCatalog(
      seriesCatalog,
      new Set(snapshot.catalog.articles.map((article) => article.path)),
    );
  }
  const changes = await compareCatalogs(oldCatalog, snapshot.catalog);
  console.log(formatChanges(changes));

  if (options.check) {
    if (await hasSnapshotDrift(snapshot)) {
      console.error(
        "Corpus drift detected. Run npm run sync:blog to update it.",
      );
      process.exitCode = 1;
      return;
    }
    console.log("No corpus drift detected.");
    return;
  }

  await writeSnapshot(snapshot);
  console.log(
    `Synced ${snapshot.catalog.counts.total} articles (${snapshot.catalog.counts.blog} notes and ${snapshot.catalog.counts.docs} long-form articles) from ${snapshot.catalog.sourceRevision}.`,
  );
}

const isCli =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  await main();
}
