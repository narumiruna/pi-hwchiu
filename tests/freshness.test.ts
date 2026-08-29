import { describe, expect, test } from "vitest";
import {
  assessFreshness,
  type FreshnessArticle,
} from "../extensions/freshness.ts";

const baseArticle: FreshnessArticle = {
  date: "2024-01-01",
  datePrecision: "path-day",
  title: "Container design concepts",
  tags: ["Container"],
  summary: "Conceptual boundaries and responsibilities.",
};

test("age bands use fixed thresholds without declaring content outdated", () => {
  expect(
    assessFreshness(
      { ...baseArticle, date: "2024-01-02" },
      new Date("2026-01-01T00:00:00Z"),
    ).ageBand,
  ).toBe("recent");
  expect(
    assessFreshness(baseArticle, new Date("2026-01-02T00:00:00Z")).ageBand,
  ).toBe("aging");
  const dated = assessFreshness(
    { ...baseArticle, date: "2021-01-01" },
    new Date("2026-01-02T00:00:00Z"),
  );
  expect(dated.ageBand).toBe("dated");
  expect(dated.requiresCurrentVerification).toBe(false);
  expect(dated.reasons.join(" ")).not.toContain("outdated");
});

test("unknown and year-only dates preserve their precision", () => {
  const unknown = assessFreshness({
    ...baseArticle,
    date: "unknown",
    datePrecision: "unknown",
  });
  const yearOnly = assessFreshness(
    { ...baseArticle, date: "2020", datePrecision: "year" },
    new Date("2026-01-01T00:00:00Z"),
  );

  expect(unknown).toMatchObject({
    ageBand: "unknown",
    datePrecision: "unknown",
  });
  expect(unknown.reasons).toContain("Publication date is unknown.");
  expect(yearOnly.datePrecision).toBe("year");
  expect(yearOnly.reasons).toContain(
    "Publication date has year-level precision only.",
  );
});

describe("time-sensitive rules", () => {
  for (const [text, reason] of [
    ["Kubernetes version v1.20", "version-specific"],
    ["API behavior", "API-specific"],
    ["kubectl command guide", "CLI commands"],
    ["Cloud pricing and cost", "pricing"],
    ["RBAC security guide", "security-sensitive"],
    ["GKE managed cluster", "managed cloud"],
  ]) {
    test(`${text} requires current verification`, () => {
      const assessment = assessFreshness({ ...baseArticle, title: text });
      expect(assessment.requiresCurrentVerification).toBe(true);
      expect(assessment.reasons.some((item) => item.includes(reason))).toBe(
        true,
      );
    });
  }
});

test("body-only sensitive details require current verification", () => {
  const assessment = assessFreshness({
    ...baseArticle,
    summary: "A conceptual introduction without command details.",
    body: `${"Background. ".repeat(30)}Run kubectl against the current API.`,
  });

  expect(assessment.requiresCurrentVerification).toBe(true);
  expect(assessment.reasons).toContain("Contains API-specific information.");
  expect(assessment.reasons).toContain(
    "Contains CLI commands or command behavior.",
  );
});

test("freshness reasons stay bounded", () => {
  const assessment = assessFreshness({
    ...baseArticle,
    date: "2010",
    datePrecision: "year",
    title: "GKE API v1.20 kubectl security pricing",
  });

  expect(assessment.reasons.length).toBeLessThanOrEqual(5);
});
