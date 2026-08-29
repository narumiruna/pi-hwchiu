import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { assessFreshness, type FreshnessAssessment } from "./freshness.ts";

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
  contentDigest: string;
  sourceUrl: string;
}

export interface Catalog {
  schemaVersion: number;
  source: string;
  sourceAuthor: string;
  sourceRevision: string;
  sourceRevisionDate: string;
  counts: { blog: number; docs: number; total: number };
  articles: ArticleRecord[];
}

interface SeriesDefinition {
  id: string;
  title: string;
  paths: string[];
}

interface SeriesCatalog {
  schemaVersion: number;
  series: SeriesDefinition[];
}

export type SearchMatchMode = "any" | "all";

export interface KnowledgeSearchOptions {
  kind?: ArticleRecord["kind"];
  tags?: string[];
  yearFrom?: number;
  yearTo?: number;
  matchMode?: SearchMatchMode;
}

export interface KnowledgeSearchResult extends ArticleRecord {
  score: number;
  matchExcerpt: string;
  matchedFields: string[];
  matchedTerms: string[];
  freshness: FreshnessAssessment;
}

export interface ArticleExcerpt {
  article: ArticleRecord;
  freshness: FreshnessAssessment;
  text: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}

export interface RelatedArticle extends ArticleRecord {
  score: number;
  reasons: string[];
}

export interface RelatedArticlesResult {
  article: ArticleRecord;
  series?: { id: string; title: string; position: number; total: number };
  previous?: ArticleRecord;
  next?: ArticleRecord;
  related: RelatedArticle[];
}

interface IndexedArticle {
  article: ArticleRecord;
  body: string;
  fields: Record<SearchField, Map<string, number>>;
  fieldLengths: Record<SearchField, number>;
}

type SearchField = "title" | "tags" | "path" | "summary" | "body";

const searchFields: SearchField[] = [
  "title",
  "tags",
  "path",
  "summary",
  "body",
];
const fieldWeights: Record<SearchField, number> = {
  title: 6,
  tags: 4.5,
  path: 3,
  summary: 2,
  body: 1,
};
const maximumExcerptLength = 320;
const maximumMatchedTerms = 8;
const bm25K1 = 1.2;
const bm25B = 0.75;

const extensionRoot = dirname(fileURLToPath(import.meta.url));
export const referencesRoot = join(
  extensionRoot,
  "../skills/hwchiu-sre-knowledge/references",
);
const catalogPath = join(referencesRoot, "catalog.json");
const seriesPath = join(referencesRoot, "series.json");
const articlesRoot = join(referencesRoot, "articles");

const aliases = new Map<string, string[]>([
  ["k8s", ["kubernetes"]],
  ["kubernetes", ["k8s"]],
  ["sre", ["reliability", "可靠性", "slo", "sli"]],
  ["監控", ["observability", "prometheus", "grafana", "loki"]],
  ["網路", ["network", "networking", "cni", "iptables", "ipvs"]],
  ["network", ["網路", "networking", "cni"]],
  ["日誌", ["logs", "logging", "loki"]],
  ["部署", ["deployment", "deploy", "gitops", "ci/cd"]],
  ["儲存", ["storage", "csi", "ceph", "drbd"]],
  ["雲端", ["cloud", "gcp", "aws", "azure"]],
]);

let catalogPromise: Promise<Catalog> | undefined;
let seriesCatalogPromise: Promise<SeriesCatalog> | undefined;
let searchIndexPromise: Promise<IndexedArticle[]> | undefined;

export function loadCatalog(): Promise<Catalog> {
  catalogPromise ??= readFile(catalogPath, "utf8").then(
    (content) => JSON.parse(content) as Catalog,
  );
  return catalogPromise;
}

export function loadSeriesCatalog(): Promise<SeriesCatalog> {
  seriesCatalogPromise ??= readFile(seriesPath, "utf8").then(
    (content) => JSON.parse(content) as SeriesCatalog,
  );
  return seriesCatalogPromise;
}

export function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

export function tokenize(value: string): string[] {
  const normalized = normalize(value);
  const tokens: string[] = [
    ...(normalized.match(/[a-z0-9][a-z0-9.+#_-]*/g) ?? []),
  ];
  const cjkRuns = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  for (const run of cjkRuns) {
    if ([...run].length === 1) {
      tokens.push(run);
      continue;
    }
    const characters = [...run];
    for (let index = 0; index < characters.length - 1; index += 1) {
      tokens.push(`${characters[index]}${characters[index + 1]}`);
    }
  }
  return tokens;
}

function termFrequency(tokens: string[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  return frequencies;
}

async function loadSearchIndex(): Promise<IndexedArticle[]> {
  searchIndexPromise ??= loadCatalog().then((catalog) =>
    Promise.all(
      catalog.articles.map(async (article) => {
        const body = await readFile(join(articlesRoot, article.path), "utf8");
        const values: Record<SearchField, string> = {
          title: article.title,
          tags: article.tags.join(" "),
          path: article.path,
          summary: article.summary,
          body,
        };
        const fields = {} as Record<SearchField, Map<string, number>>;
        const fieldLengths = {} as Record<SearchField, number>;
        for (const field of searchFields) {
          const tokens = tokenize(values[field]);
          fields[field] = termFrequency(tokens);
          fieldLengths[field] = tokens.length;
        }
        return { article, body, fields, fieldLengths };
      }),
    ),
  );
  return searchIndexPromise;
}

export function expandQuery(query: string): {
  requiredGroups: string[][];
  expanded: string[];
} {
  const normalized = normalize(query).trim();
  const rawTerms = normalized
    .split(/[\s,，、/]+/)
    .filter((term) => term.length > 1);
  const baseTerms = rawTerms.length > 0 ? rawTerms : [normalized];
  const requiredGroups = baseTerms.flatMap((term) => {
    const tokens = tokenize(term);
    const aliasTokens = (aliases.get(term) ?? []).flatMap(tokenize);
    return tokens.map((token, index) =>
      index === 0 ? [...new Set([token, ...aliasTokens])] : [token],
    );
  });
  const expanded = [...new Set(requiredGroups.flat())];
  return { requiredGroups, expanded };
}

function validateSearchOptions(options: KnowledgeSearchOptions): void {
  if (options.kind && options.kind !== "note" && options.kind !== "article") {
    throw new Error("kind must be either note or article.");
  }
  if (
    options.matchMode &&
    options.matchMode !== "any" &&
    options.matchMode !== "all"
  ) {
    throw new Error("matchMode must be either any or all.");
  }
  for (const [name, year] of [
    ["yearFrom", options.yearFrom],
    ["yearTo", options.yearTo],
  ] as const) {
    if (
      year !== undefined &&
      (!Number.isInteger(year) || year < 1900 || year > 2100)
    ) {
      throw new Error(`${name} must be an integer from 1900 to 2100.`);
    }
  }
  if (
    options.yearFrom !== undefined &&
    options.yearTo !== undefined &&
    options.yearFrom > options.yearTo
  ) {
    throw new Error("yearFrom must not be greater than yearTo.");
  }
  if (options.tags) {
    if (
      !Array.isArray(options.tags) ||
      options.tags.length > 10 ||
      options.tags.some(
        (tag) =>
          typeof tag !== "string" || !tag.trim() || tag.trim().length > 100,
      )
    ) {
      throw new Error(
        "tags must contain at most 10 non-empty strings of at most 100 characters.",
      );
    }
  }
}

function hasTerm(indexed: IndexedArticle, term: string): boolean {
  return searchFields.some((field) => indexed.fields[field].has(term));
}

function matchesFilters(
  article: ArticleRecord,
  options: KnowledgeSearchOptions,
): boolean {
  if (options.kind && article.kind !== options.kind) return false;
  const year = Number.parseInt(article.year, 10);
  if (
    (options.yearFrom !== undefined || options.yearTo !== undefined) &&
    !Number.isFinite(year)
  ) {
    return false;
  }
  if (options.yearFrom !== undefined && year < options.yearFrom) return false;
  if (options.yearTo !== undefined && year > options.yearTo) return false;
  if (options.tags?.length) {
    const articleTags = new Set(article.tags.map(normalize));
    if (options.tags.some((tag) => !articleTags.has(normalize(tag)))) {
      return false;
    }
  }
  return true;
}

function averageFieldLengths(
  index: IndexedArticle[],
): Record<SearchField, number> {
  const averages = {} as Record<SearchField, number>;
  for (const field of searchFields) {
    averages[field] =
      index.reduce((total, entry) => total + entry.fieldLengths[field], 0) /
        index.length || 1;
  }
  return averages;
}

function documentFrequencies(
  index: IndexedArticle[],
  terms: string[],
): Map<string, number> {
  return new Map(
    terms.map((term) => [
      term,
      index.reduce(
        (count, article) => count + Number(hasTerm(article, term)),
        0,
      ),
    ]),
  );
}

function scoreArticle(
  indexed: IndexedArticle,
  terms: string[],
  frequencies: Map<string, number>,
  averages: Record<SearchField, number>,
  documentCount: number,
  exactQuery: string,
): number {
  let score = normalize(indexed.article.title).includes(exactQuery) ? 20 : 0;
  for (const term of terms) {
    const documentFrequency = frequencies.get(term) ?? 0;
    const inverseDocumentFrequency = Math.log(
      1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5),
    );
    for (const field of searchFields) {
      const frequency = indexed.fields[field].get(term) ?? 0;
      if (frequency === 0) continue;
      const normalizedLength =
        indexed.fieldLengths[field] / Math.max(1, averages[field]);
      const denominator =
        frequency + bm25K1 * (1 - bm25B + bm25B * normalizedLength);
      score +=
        fieldWeights[field] *
        inverseDocumentFrequency *
        ((frequency * (bm25K1 + 1)) / denominator);
    }
  }
  return score;
}

function matchedFields(indexed: IndexedArticle, terms: string[]): string[] {
  return searchFields.filter((field) =>
    terms.some((term) => indexed.fields[field].has(term)),
  );
}

function buildMatchExcerpt(
  body: string,
  query: string,
  terms: string[],
): string {
  const compact = body.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const normalizedBody = normalize(compact);
  const candidates = [normalize(query), ...terms]
    .filter((term) => term.length > 1)
    .map((term) => normalizedBody.indexOf(term))
    .filter((position) => position >= 0);
  const position = candidates.length > 0 ? Math.min(...candidates) : 0;
  const start = Math.max(0, position - Math.floor(maximumExcerptLength / 3));
  const end = Math.min(compact.length, start + maximumExcerptLength);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end).trim()}${
    end < compact.length ? "…" : ""
  }`;
}

export async function searchKnowledge(
  query: string,
  limit = 8,
  options: KnowledgeSearchOptions = {},
): Promise<KnowledgeSearchResult[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2 || trimmedQuery.length > 500) {
    throw new Error(
      "Knowledge search query must contain from 2 to 500 characters.",
    );
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("Knowledge search limit must be an integer from 1 to 20.");
  }
  validateSearchOptions(options);

  const index = await loadSearchIndex();
  const { requiredGroups, expanded } = expandQuery(trimmedQuery);
  if (requiredGroups.length === 0) {
    throw new Error("Knowledge search query has no searchable terms.");
  }
  const filteredIndex = index.filter(({ article }) =>
    matchesFilters(article, options),
  );
  const averages = averageFieldLengths(index);
  const frequencies = documentFrequencies(index, expanded);
  const matchAll = options.matchMode === "all";

  return filteredIndex
    .filter((article) => {
      const matches = requiredGroups.map((group) =>
        group.some((term) => hasTerm(article, term)),
      );
      return matchAll ? matches.every(Boolean) : matches.some(Boolean);
    })
    .map((indexed) => {
      const matchingTerms = expanded
        .filter((term) => hasTerm(indexed, term))
        .slice(0, maximumMatchedTerms);
      return {
        ...indexed.article,
        score: scoreArticle(
          indexed,
          expanded,
          frequencies,
          averages,
          index.length,
          normalize(trimmedQuery),
        ),
        matchExcerpt: buildMatchExcerpt(
          indexed.body,
          trimmedQuery,
          matchingTerms,
        ),
        matchedFields: matchedFields(indexed, matchingTerms),
        matchedTerms: matchingTerms,
        freshness: assessFreshness(indexed.article),
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.date.localeCompare(left.date) ||
        left.path.localeCompare(right.path),
    )
    .slice(0, limit);
}

function normalizeArticlePath(requestedPath: string): string {
  return requestedPath
    .trim()
    .replace(/^@/, "")
    .replace(/^references\/articles\//, "")
    .replace(/^articles\//, "");
}

export async function readArticle(
  requestedPath: string,
  startLine = 1,
  lineCount = 500,
): Promise<ArticleExcerpt> {
  const normalizedPath = normalizeArticlePath(requestedPath);
  const catalog = await loadCatalog();
  const article = catalog.articles.find(
    (candidate) => candidate.path === normalizedPath,
  );

  if (!article) {
    throw new Error(
      "Unknown article path. Use hwchiu_knowledge_search to obtain a valid path.",
    );
  }
  if (!Number.isInteger(startLine) || startLine < 1) {
    throw new Error("startLine must be a positive integer.");
  }
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
    freshness: assessFreshness(article),
    text: truncation.content,
    startLine,
    endLine: startLine + Math.max(0, outputLines - 1),
    totalLines: lines.length,
    truncated: truncation.truncated || startLine - 1 + lineCount < lines.length,
  };
}

function articleTerms(article: ArticleRecord): Set<string> {
  return new Set(tokenize(article.title));
}

function toRelated(
  candidate: ArticleRecord,
  score: number,
  reasons: string[],
): RelatedArticle {
  return { ...candidate, score, reasons: reasons.slice(0, 4) };
}

export async function findRelatedArticles(
  requestedPath: string,
  limit = 8,
): Promise<RelatedArticlesResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("Related article limit must be an integer from 1 to 20.");
  }
  const path = normalizeArticlePath(requestedPath);
  const [catalog, seriesCatalog] = await Promise.all([
    loadCatalog(),
    loadSeriesCatalog(),
  ]);
  const article = catalog.articles.find((candidate) => candidate.path === path);
  if (!article) {
    throw new Error(
      "Unknown article path. Use hwchiu_knowledge_search to obtain a valid path.",
    );
  }
  const byPath = new Map(
    catalog.articles.map((candidate) => [candidate.path, candidate]),
  );
  const series = seriesCatalog.series.find((candidate) =>
    candidate.paths.includes(path),
  );
  const position = series?.paths.indexOf(path) ?? -1;
  const previous =
    series && position > 0 ? byPath.get(series.paths[position - 1]) : undefined;
  const next =
    series && position >= 0 && position < series.paths.length - 1
      ? byPath.get(series.paths[position + 1])
      : undefined;
  const sourceTerms = articleTerms(article);
  const sourceTags = new Set(article.tags.map(normalize));
  const sourceYear = Number.parseInt(article.year, 10);

  const related = catalog.articles
    .filter((candidate) => candidate.path !== path)
    .map((candidate) => {
      let score = 0;
      const reasons = [];
      const candidateSeriesPosition =
        series?.paths.indexOf(candidate.path) ?? -1;
      if (candidateSeriesPosition >= 0) {
        const distance = Math.abs(candidateSeriesPosition - position);
        score += 10_000 - distance * 100;
        reasons.push(
          distance === 1 ? "adjacent in the same series" : "same series",
        );
      }
      const commonTags = candidate.tags
        .map(normalize)
        .filter((tag) => sourceTags.has(tag));
      if (commonTags.length > 0) {
        score += commonTags.length * 100;
        reasons.push(`shared tags: ${commonTags.slice(0, 3).join(", ")}`);
      }
      const commonTerms = [...articleTerms(candidate)].filter((term) =>
        sourceTerms.has(term),
      );
      if (commonTerms.length > 0) {
        score += Math.min(5, commonTerms.length) * 20;
        reasons.push(
          `shared title terms: ${commonTerms.slice(0, 3).join(", ")}`,
        );
      }
      const candidateYear = Number.parseInt(candidate.year, 10);
      if (Number.isFinite(sourceYear) && Number.isFinite(candidateYear)) {
        score += Math.max(0, 10 - Math.abs(candidateYear - sourceYear));
      }
      return toRelated(candidate, score, reasons);
    })
    .filter((candidate) => candidate.reasons.length > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.date.localeCompare(left.date) ||
        left.path.localeCompare(right.path),
    )
    .slice(0, limit);

  return {
    article,
    series: series
      ? {
          id: series.id,
          title: series.title,
          position: position + 1,
          total: series.paths.length,
        }
      : undefined,
    previous,
    next,
    related,
  };
}
