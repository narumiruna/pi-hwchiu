import { StringEnum, Type } from "@earendil-works/pi-ai";
import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";

const maximumItems = 6;
const maximumTextLength = 1_000;
const maximumItemLength = 500;

const boundedText = (description: string, maxLength = maximumTextLength) =>
  Type.String({ description, minLength: 1, maxLength });

export const incidentReportSchema = Type.Object(
  {
    title: boundedText("Short incident title", 200),
    scope: boundedText("Affected system, environment, namespace, or unit", 500),
    impact: Type.Optional(boundedText("Observed user or system impact")),
    observations: Type.Array(
      Type.Object({
        finding: boundedText("Directly observed fact", maximumItemLength),
        source: boundedText(
          "Command, log range, event, metric, or article path supporting the fact",
          maximumItemLength,
        ),
      }),
      { maxItems: maximumItems },
    ),
    hypotheses: Type.Array(
      Type.Object({
        statement: boundedText("Candidate explanation", maximumItemLength),
        status: StringEnum(["proposed", "supported", "rejected"] as const),
        evidence: Type.Array(boundedText("Evidence reference", 250), {
          maxItems: 4,
        }),
      }),
      { maxItems: maximumItems },
    ),
    tests: Type.Array(
      Type.Object({
        action: boundedText(
          "Read-only test or check performed",
          maximumItemLength,
        ),
        result: boundedText("Observed test result", maximumItemLength),
        conclusion: boundedText(
          "What the result supports or rejects",
          maximumItemLength,
        ),
      }),
      { maxItems: maximumItems },
    ),
    conclusion: Type.Optional(
      boundedText("Conclusion supported by completed tests"),
    ),
    recommendedChanges: Type.Array(
      Type.Object({
        change: boundedText("Proposed change", maximumItemLength),
        expectedImpact: boundedText(
          "Expected effect and risk",
          maximumItemLength,
        ),
      }),
      { maxItems: maximumItems },
    ),
    rollback: Type.Optional(boundedText("Rollback procedure")),
    validation: Type.Optional(boundedText("Post-change validation procedure")),
    sources: Type.Array(
      Type.Object({
        label: boundedText("Human-readable source label", 200),
        reference: boundedText(
          "Article path and date, or bounded environment evidence reference",
          maximumItemLength,
        ),
      }),
      { maxItems: maximumItems },
    ),
    openQuestions: Type.Array(boundedText("Unresolved question", 300), {
      maxItems: maximumItems,
    }),
  },
  { additionalProperties: false },
);

export interface IncidentReportInput {
  title: string;
  scope: string;
  impact?: string;
  observations: Array<{ finding: string; source: string }>;
  hypotheses: Array<{
    statement: string;
    status: "proposed" | "supported" | "rejected";
    evidence: string[];
  }>;
  tests: Array<{ action: string; result: string; conclusion: string }>;
  conclusion?: string;
  recommendedChanges: Array<{ change: string; expectedImpact: string }>;
  rollback?: string;
  validation?: string;
  sources: Array<{ label: string; reference: string }>;
  openQuestions: string[];
}

function inline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function validateText(value: string, field: string, maximum: number): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  if (value.length > maximum) {
    throw new Error(`${field} must not exceed ${maximum} characters.`);
  }
}

function validateArray(value: unknown[], field: string): void {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`${field} must contain at most ${maximumItems} items.`);
  }
}

export function validateIncidentReport(report: IncidentReportInput): void {
  validateText(report.title, "title", 200);
  validateText(report.scope, "scope", 500);
  if (report.impact !== undefined) {
    validateText(report.impact, "impact", maximumTextLength);
  }
  for (const [field, values] of [
    ["observations", report.observations],
    ["hypotheses", report.hypotheses],
    ["tests", report.tests],
    ["recommendedChanges", report.recommendedChanges],
    ["sources", report.sources],
    ["openQuestions", report.openQuestions],
  ] as const) {
    validateArray(values, field);
  }
  for (const [index, observation] of report.observations.entries()) {
    validateText(
      observation.finding,
      `observations[${index}].finding`,
      maximumItemLength,
    );
    validateText(
      observation.source,
      `observations[${index}].source`,
      maximumItemLength,
    );
  }
  for (const [index, hypothesis] of report.hypotheses.entries()) {
    validateText(
      hypothesis.statement,
      `hypotheses[${index}].statement`,
      maximumItemLength,
    );
    if (
      !(["proposed", "supported", "rejected"] as const).includes(
        hypothesis.status,
      )
    ) {
      throw new Error(`hypotheses[${index}].status is unsupported.`);
    }
    if (!Array.isArray(hypothesis.evidence) || hypothesis.evidence.length > 4) {
      throw new Error(
        `hypotheses[${index}].evidence must contain at most 4 items.`,
      );
    }
    for (const evidence of hypothesis.evidence) {
      validateText(evidence, `hypotheses[${index}].evidence`, 250);
    }
  }
  for (const [index, test] of report.tests.entries()) {
    validateText(test.action, `tests[${index}].action`, maximumItemLength);
    validateText(test.result, `tests[${index}].result`, maximumItemLength);
    validateText(
      test.conclusion,
      `tests[${index}].conclusion`,
      maximumItemLength,
    );
  }
  for (const [index, change] of report.recommendedChanges.entries()) {
    validateText(
      change.change,
      `recommendedChanges[${index}].change`,
      maximumItemLength,
    );
    validateText(
      change.expectedImpact,
      `recommendedChanges[${index}].expectedImpact`,
      maximumItemLength,
    );
  }
  for (const [index, source] of report.sources.entries()) {
    validateText(source.label, `sources[${index}].label`, 200);
    validateText(
      source.reference,
      `sources[${index}].reference`,
      maximumItemLength,
    );
  }
  for (const [index, question] of report.openQuestions.entries()) {
    validateText(question, `openQuestions[${index}]`, 300);
  }
  for (const [field, value] of [
    ["conclusion", report.conclusion],
    ["rollback", report.rollback],
    ["validation", report.validation],
  ] as const) {
    if (value !== undefined) validateText(value, field, maximumTextLength);
  }
}

function bullets(lines: string[]): string {
  return lines.length > 0
    ? lines.map((line) => `- ${inline(line)}`).join("\n")
    : "Not established.";
}

export function formatIncidentReport(report: IncidentReportInput): string {
  validateIncidentReport(report);
  const formatted = [
    `# ${inline(report.title)}`,
    "",
    "## Scope",
    "",
    inline(report.scope),
    "",
    "## Impact",
    "",
    report.impact ? inline(report.impact) : "Not established.",
    "",
    "## Observations",
    "",
    bullets(
      report.observations.map(
        (observation) =>
          `${observation.finding} — Source: ${observation.source}`,
      ),
    ),
    "",
    "## Hypotheses",
    "",
    bullets(
      report.hypotheses.map((hypothesis) => {
        const evidence =
          hypothesis.evidence.length > 0
            ? ` Evidence: ${hypothesis.evidence.join("; ")}`
            : "";
        return `[${hypothesis.status}] ${hypothesis.statement}.${evidence}`;
      }),
    ),
    "",
    "## Tests",
    "",
    bullets(
      report.tests.map(
        (test) => `${test.action} → ${test.result} → ${test.conclusion}`,
      ),
    ),
    "",
    "## Conclusion",
    "",
    report.conclusion ? inline(report.conclusion) : "Not established.",
    "",
    "## Recommended Changes",
    "",
    bullets(
      report.recommendedChanges.map(
        (change) =>
          `${change.change} — Expected impact: ${change.expectedImpact}`,
      ),
    ),
    "",
    "## Rollback",
    "",
    report.rollback ? inline(report.rollback) : "Not established.",
    "",
    "## Validation",
    "",
    report.validation ? inline(report.validation) : "Not established.",
    "",
    "## Sources",
    "",
    bullets(
      report.sources.map((source) => `${source.label}: ${source.reference}`),
    ),
    "",
    "## Open Questions",
    "",
    bullets(report.openQuestions),
  ].join("\n");
  if (Buffer.byteLength(formatted, "utf8") > DEFAULT_MAX_BYTES) {
    throw new Error(
      `Formatted incident report exceeds the ${DEFAULT_MAX_BYTES}-byte output limit. Shorten the evidence summaries.`,
    );
  }
  return formatted;
}
