import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
} from "@earendil-works/pi-coding-agent";

export interface ArticleRecord {
  path: string;
  kind: "note" | "article";
  year: string;
  date: string;
  datePrecision: "timestamp" | "path-day" | "year" | "unknown";
  title: string;
  tags: string[];
  summary: string;
  explicitAuthor: boolean;
}

interface Catalog {
  source: string;
  sourceAuthor: string;
  counts: { blog: number; docs: number; total: number };
  articles: ArticleRecord[];
}

export interface KnowledgeSearchResult extends ArticleRecord {
  score: number;
}

export interface ArticleExcerpt {
  article: ArticleRecord;
  text: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}

const extensionRoot = dirname(fileURLToPath(import.meta.url));
export const referencesRoot = join(
  extensionRoot,
  "../skills/hwchiu-sre-knowledge/references",
);
const catalogPath = join(referencesRoot, "catalog.json");
const articlesRoot = join(referencesRoot, "articles");

const aliases = new Map<string, string[]>([
  ["k8s", ["kubernetes"]],
  ["sre", ["reliability", "可靠性", "slo", "sli"]],
  ["監控", ["observability", "prometheus", "grafana", "loki"]],
  ["網路", ["network", "networking", "cni", "iptables", "ipvs"]],
  ["日誌", ["logs", "logging", "loki"]],
  ["部署", ["deployment", "deploy", "gitops", "ci/cd"]],
  ["儲存", ["storage", "csi", "ceph", "drbd"]],
  ["雲端", ["cloud", "gcp", "aws", "azure"]],
]);

let catalogPromise: Promise<Catalog> | undefined;
let searchableArticlesPromise:
  | Promise<Array<ArticleRecord & { body: string }>>
  | undefined;

export function loadCatalog(): Promise<Catalog> {
  catalogPromise ??= readFile(catalogPath, "utf8").then(
    (content) => JSON.parse(content) as Catalog,
  );
  return catalogPromise;
}

async function loadSearchableArticles(): Promise<
  Array<ArticleRecord & { body: string }>
> {
  searchableArticlesPromise ??= loadCatalog().then((catalog) =>
    Promise.all(
      catalog.articles.map(async (article) => ({
        ...article,
        body: await readFile(join(articlesRoot, article.path), "utf8"),
      })),
    ),
  );
  return searchableArticlesPromise;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function queryTerms(query: string): string[] {
  const normalized = normalize(query).trim();
  const baseTerms = normalized
    .split(/[\s,，、/]+/)
    .filter((term) => term.length > 1);
  const expanded = new Set(baseTerms.length > 0 ? baseTerms : [normalized]);
  for (const term of [...expanded]) {
    for (const alias of aliases.get(term) ?? []) expanded.add(alias);
  }
  return [...expanded].filter(Boolean);
}

function occurrenceScore(
  text: string,
  term: string,
  weight: number,
  maximum: number,
): number {
  let count = 0;
  let position = text.indexOf(term);
  while (position >= 0 && count < maximum) {
    count += 1;
    position = text.indexOf(term, position + term.length);
  }
  return count * weight;
}

export async function searchKnowledge(
  query: string,
  limit = 8,
): Promise<KnowledgeSearchResult[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2)
    throw new Error(
      "Knowledge search query must contain at least two characters.",
    );
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("Knowledge search limit must be an integer from 1 to 20.");
  }

  const exactQuery = normalize(trimmedQuery);
  const terms = queryTerms(trimmedQuery);
  const articles = await loadSearchableArticles();
  const results = articles
    .map((article) => {
      const title = normalize(article.title);
      const tags = normalize(article.tags.join(" "));
      const path = normalize(article.path);
      const summary = normalize(article.summary);
      const body = normalize(article.body);
      let score = title.includes(exactQuery) ? 24 : 0;

      for (const term of terms) {
        score += occurrenceScore(title, term, 10, 2);
        score += occurrenceScore(tags, term, 8, 2);
        score += occurrenceScore(path, term, 5, 2);
        score += occurrenceScore(summary, term, 4, 3);
        score += occurrenceScore(body, term, 1, 5);
      }

      const { body: _body, ...record } = article;
      return { ...record, score };
    })
    .filter((article) => article.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || right.date.localeCompare(left.date),
    );

  return results.slice(0, limit);
}

export async function readArticle(
  requestedPath: string,
  startLine = 1,
  lineCount = 500,
): Promise<ArticleExcerpt> {
  const normalizedPath = requestedPath
    .trim()
    .replace(/^@/, "")
    .replace(/^references\/articles\//, "")
    .replace(/^articles\//, "");
  const catalog = await loadCatalog();
  const article = catalog.articles.find(
    (candidate) => candidate.path === normalizedPath,
  );

  if (!article)
    throw new Error(
      "Unknown article path. Use hwchiu_knowledge_search to obtain a valid path.",
    );
  if (!Number.isInteger(startLine) || startLine < 1)
    throw new Error("startLine must be a positive integer.");
  if (!Number.isInteger(lineCount) || lineCount < 1 || lineCount > 1000) {
    throw new Error("lineCount must be an integer from 1 to 1000.");
  }

  const content = await readFile(join(articlesRoot, article.path), "utf8");
  const lines = content.split(/\r?\n/);
  if (startLine > lines.length) {
    throw new Error(`startLine exceeds the article's ${lines.length} lines.`);
  }
  const selected = lines
    .slice(startLine - 1, startLine - 1 + lineCount)
    .join("\n");
  const truncation = truncateHead(selected, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  const outputLines = truncation.content
    ? truncation.content.split("\n").length
    : 0;

  return {
    article,
    text: truncation.content,
    startLine,
    endLine: startLine + Math.max(0, outputLines - 1),
    totalLines: lines.length,
    truncated: truncation.truncated || startLine - 1 + lineCount < lines.length,
  };
}
