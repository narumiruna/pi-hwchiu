import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  formatIncidentReport,
  type IncidentReportInput,
  validateIncidentReport,
} from "../extensions/report.ts";

const fixtures = JSON.parse(
  await readFile(join(import.meta.dirname, "fixtures/incidents.json"), "utf8"),
) as IncidentReportInput[];

test("formats Kubernetes and systemd fixtures with fixed evidence sections", () => {
  for (const fixture of fixtures) {
    const report = formatIncidentReport(fixture);
    for (const heading of [
      "## Scope",
      "## Impact",
      "## Observations",
      "## Hypotheses",
      "## Tests",
      "## Conclusion",
      "## Recommended Changes",
      "## Rollback",
      "## Validation",
      "## Sources",
      "## Open Questions",
    ]) {
      expect(report).toContain(heading);
    }
  }
});

test("keeps untested hypotheses out of the conclusion", () => {
  const report = formatIncidentReport(fixtures[1]);
  const conclusion = report
    .split("## Conclusion\n\n")[1]
    .split("\n\n## Recommended Changes")[0];

  expect(report).toContain("[proposed] The service configuration is invalid.");
  expect(conclusion).toBe("Not established.");
});

test("preserves bounded Unicode evidence while normalizing inline whitespace", () => {
  const report = formatIncidentReport({
    ...fixtures[1],
    title: "Kubernetes 診斷報告",
    observations: [{ finding: "Pod\n重新啟動", source: "events\tWarning" }],
  });

  expect(report).toContain("# Kubernetes 診斷報告");
  expect(report).toContain("Pod 重新啟動 — Source: events Warning");
});

test("rejects oversized arrays, strings, and invalid hypothesis status", () => {
  expect(() =>
    validateIncidentReport({
      ...fixtures[1],
      openQuestions: Array.from({ length: 7 }, () => "question"),
    }),
  ).toThrow("at most 6");
  expect(() =>
    validateIncidentReport({ ...fixtures[1], title: "x".repeat(201) }),
  ).toThrow("200 characters");
  expect(() =>
    validateIncidentReport({
      ...fixtures[1],
      hypotheses: [
        {
          statement: "Invalid state",
          status: "confirmed" as "proposed",
          evidence: [],
        },
      ],
    }),
  ).toThrow("status is unsupported");
});

test("rejects a Unicode-heavy report that would exceed the tool output limit", () => {
  const repeated = "證".repeat(500);
  const six = Array.from({ length: 6 });
  expect(() =>
    formatIncidentReport({
      title: "大型報告",
      scope: repeated,
      impact: repeated,
      observations: six.map(() => ({ finding: repeated, source: repeated })),
      hypotheses: six.map(() => ({
        statement: repeated,
        status: "supported" as const,
        evidence: Array.from({ length: 4 }, () => "據".repeat(250)),
      })),
      tests: six.map(() => ({
        action: repeated,
        result: repeated,
        conclusion: repeated,
      })),
      conclusion: repeated,
      recommendedChanges: six.map(() => ({
        change: repeated,
        expectedImpact: repeated,
      })),
      rollback: repeated,
      validation: repeated,
      sources: six.map(() => ({
        label: "源".repeat(200),
        reference: repeated,
      })),
      openQuestions: six.map(() => "問".repeat(300)),
    }),
  ).toThrow("output limit");
});
