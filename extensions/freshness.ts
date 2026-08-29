export type FreshnessAgeBand = "recent" | "aging" | "dated" | "unknown";

export interface FreshnessArticle {
  date: string;
  datePrecision: "timestamp" | "path-day" | "year" | "unknown";
  title: string;
  tags: string[];
  summary: string;
  body?: string;
}

export interface FreshnessAssessment {
  ageBand: FreshnessAgeBand;
  datePrecision: FreshnessArticle["datePrecision"];
  requiresCurrentVerification: boolean;
  reasons: string[];
}

export const recentYears = 2;
export const datedYears = 5;
const maximumReasons = 5;
const millisecondsPerYear = 365.2425 * 24 * 60 * 60 * 1000;

const timeSensitiveRules: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: "Contains version-specific information.",
    pattern: /\b(?:version|v?\d+\.\d+(?:\.\d+)?)\b|版本/iu,
  },
  {
    reason: "Contains API-specific information.",
    pattern: /\bapi(?:version)?\b|應用程式介面/iu,
  },
  {
    reason: "Contains CLI commands or command behavior.",
    pattern: /\b(?:kubectl|helm|terraform|gcloud|aws cli|az cli)\b|指令/iu,
  },
  {
    reason: "Contains pricing or cost information.",
    pattern: /\b(?:price|pricing|cost)\b|價格|費用/iu,
  },
  {
    reason: "Contains security-sensitive guidance.",
    pattern: /\b(?:cve|security|rbac|secret|vulnerability)\b|安全|漏洞/iu,
  },
  {
    reason: "Describes managed cloud or provider-specific behavior.",
    pattern:
      /\b(?:gke|eks|aks|aws|azure|gcp|cloud sql|rancher|argocd|circleci)\b/iu,
  },
];

function publicationDate(article: FreshnessArticle): Date | undefined {
  if (article.datePrecision === "unknown") return undefined;
  if (article.datePrecision === "year") {
    const year = Number.parseInt(article.date, 10);
    return Number.isInteger(year) ? new Date(Date.UTC(year, 0, 1)) : undefined;
  }
  const date = new Date(`${article.date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function ageBand(
  article: FreshnessArticle,
  referenceDate: Date,
): FreshnessAgeBand {
  const published = publicationDate(article);
  if (!published) return "unknown";
  const age = Math.max(0, referenceDate.getTime() - published.getTime());
  const years = age / millisecondsPerYear;
  if (years < recentYears) return "recent";
  if (years < datedYears) return "aging";
  return "dated";
}

export function assessFreshness(
  article: FreshnessArticle,
  referenceDate = new Date(),
): FreshnessAssessment {
  const band = ageBand(article, referenceDate);
  const searchable = `${article.title} ${article.tags.join(" ")} ${article.summary} ${article.body ?? ""}`;
  const reasons = [];

  if (article.datePrecision === "unknown") {
    reasons.push("Publication date is unknown.");
  } else if (article.datePrecision === "year") {
    reasons.push("Publication date has year-level precision only.");
  }
  if (band === "aging") {
    reasons.push("The article is at least two years old.");
  } else if (band === "dated") {
    reasons.push("The article is at least five years old.");
  }

  const verificationReasons = timeSensitiveRules
    .filter((rule) => rule.pattern.test(searchable))
    .map((rule) => rule.reason);
  reasons.push(...verificationReasons);

  return {
    ageBand: band,
    datePrecision: article.datePrecision,
    requiresCurrentVerification: verificationReasons.length > 0,
    reasons: [...new Set(reasons)].slice(0, maximumReasons),
  };
}
