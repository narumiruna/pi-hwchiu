import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  findRelatedArticles,
  readArticle,
  searchKnowledge,
} from "./knowledge.ts";
import {
  buildKubernetesCommand,
  buildSystemdCommand,
  formatCommandResult,
  kubernetesEventTypes,
  kubernetesOperations,
  kubernetesResourceKinds,
  systemdOperations,
} from "./observe.ts";
import {
  formatIncidentReport,
  type IncidentReportInput,
  incidentReportSchema,
} from "./report.ts";

function freshnessLine(freshness: {
  ageBand: string;
  requiresCurrentVerification: boolean;
  reasons: string[];
}): string {
  const verification = freshness.requiresCurrentVerification
    ? "current verification required"
    : "no automatic verification flag";
  const reasons =
    freshness.reasons.length > 0 ? `; ${freshness.reasons.join(" ")}` : "";
  return `Freshness: ${freshness.ageBand}; ${verification}${reasons}`;
}

export default function piHwchiu(pi: ExtensionAPI) {
  pi.registerTool({
    name: "hwchiu_knowledge_search",
    label: "Search hwchiu Knowledge",
    description:
      "Search the bundled hwchiu corpus by Traditional Chinese or English text with optional kind, tag, year, and match-mode filters. Returns ranked source paths, bounded match excerpts, dates, and freshness signals.",
    promptSnippet:
      "Search hwchiu's SRE, DevOps, Kubernetes, networking, cloud, and engineering corpus",
    promptGuidelines: [
      "Use hwchiu_knowledge_search before applying hwchiu's knowledge, then read the selected articles and cite their paths and dates.",
      "Treat hwchiu_knowledge_search freshness signals as prompts for current verification, not proof that an article is wrong.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description: "Traditional Chinese or English search terms",
        minLength: 2,
        maxLength: 500,
      }),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 20, default: 8 }),
      ),
      kind: Type.Optional(StringEnum(["note", "article"] as const)),
      tags: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 100 }), {
          maxItems: 10,
        }),
      ),
      yearFrom: Type.Optional(Type.Integer({ minimum: 1900, maximum: 2100 })),
      yearTo: Type.Optional(Type.Integer({ minimum: 1900, maximum: 2100 })),
      matchMode: Type.Optional(StringEnum(["any", "all"] as const)),
    }),
    async execute(_toolCallId, params, signal) {
      signal?.throwIfAborted();
      const options = {
        kind: params.kind,
        tags: params.tags,
        yearFrom: params.yearFrom,
        yearTo: params.yearTo,
        matchMode: params.matchMode,
      };
      const results = await searchKnowledge(
        params.query,
        params.limit ?? 8,
        options,
      );
      signal?.throwIfAborted();
      const text =
        results.length === 0
          ? `No bundled articles matched: ${params.query}`
          : results
              .map(
                (article, index) =>
                  `${index + 1}. ${article.title}\n` +
                  `   Source: ${article.path} (${article.date}; ${article.datePrecision})\n` +
                  `   Original: ${article.sourceUrl}\n` +
                  `   Tags: ${article.tags.join(", ") || "none"}\n` +
                  `   Matched: ${article.matchedFields.join(", ")} [${article.matchedTerms.join(", ")}]\n` +
                  `   Excerpt: ${article.matchExcerpt || "No excerpt available."}\n` +
                  `   ${freshnessLine(article.freshness)}`,
              )
              .join("\n\n");

      return {
        content: [{ type: "text", text }],
        details: {
          query: params.query,
          filters: options,
          matches: results.map(
            ({
              path,
              title,
              date,
              datePrecision,
              score,
              matchExcerpt,
              matchedFields,
              matchedTerms,
              freshness,
              sourceUrl,
            }) => ({
              path,
              title,
              date,
              datePrecision,
              score,
              matchExcerpt,
              matchedFields,
              matchedTerms,
              freshness,
              sourceUrl,
            }),
          ),
        },
      };
    },
  });

  pi.registerTool({
    name: "hwchiu_read_article",
    label: "Read hwchiu Article",
    description:
      "Read a bounded line range from a bundled hwchiu article returned by hwchiu_knowledge_search. Output is limited to 50KB or 2,000 lines and includes provenance and freshness signals.",
    parameters: Type.Object({
      path: Type.String({
        description: "Exact article path returned by hwchiu_knowledge_search",
      }),
      startLine: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
      lineCount: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 1000, default: 500 }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      signal?.throwIfAborted();
      const excerpt = await readArticle(
        params.path,
        params.startLine ?? 1,
        params.lineCount ?? 500,
      );
      signal?.throwIfAborted();
      const header = [
        `Title: ${excerpt.article.title}`,
        `Source: ${excerpt.article.path}`,
        `Original: ${excerpt.article.sourceUrl}`,
        `Date: ${excerpt.article.date} (${excerpt.article.datePrecision})`,
        freshnessLine(excerpt.freshness),
        `Lines: ${excerpt.startLine}-${excerpt.endLine} of ${excerpt.totalLines}`,
      ].join("\n");
      const continuation = excerpt.truncated
        ? `\n\n[More content is available. Continue from line ${excerpt.endLine + 1}.]`
        : "";

      return {
        content: [
          { type: "text", text: `${header}\n\n${excerpt.text}${continuation}` },
        ],
        details: {
          path: excerpt.article.path,
          title: excerpt.article.title,
          date: excerpt.article.date,
          datePrecision: excerpt.article.datePrecision,
          sourceUrl: excerpt.article.sourceUrl,
          freshness: excerpt.freshness,
          startLine: excerpt.startLine,
          endLine: excerpt.endLine,
          totalLines: excerpt.totalLines,
          hasMore: excerpt.truncated,
        },
      };
    },
  });

  pi.registerTool({
    name: "hwchiu_related_articles",
    label: "Find Related hwchiu Articles",
    description:
      "Find the previous and next entries in a curated hwchiu series plus deterministically related bundled articles. Accepts only catalog paths and returns at most 20 related entries.",
    promptSnippet:
      "Follow hwchiu article series and find related bundled reading",
    promptGuidelines: [
      "Use hwchiu_related_articles when a selected source belongs to a sequence or needs adjacent conceptual context.",
    ],
    parameters: Type.Object({
      path: Type.String({
        description: "Exact article path returned by hwchiu_knowledge_search",
      }),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 20, default: 8 }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      signal?.throwIfAborted();
      const result = await findRelatedArticles(params.path, params.limit ?? 8);
      signal?.throwIfAborted();
      const series = result.series
        ? `Series: ${result.series.title} (${result.series.position}/${result.series.total})`
        : "Series: none curated";
      const adjacent = [
        result.previous
          ? `Previous: ${result.previous.path}`
          : "Previous: none",
        result.next ? `Next: ${result.next.path}` : "Next: none",
      ];
      const related =
        result.related.length > 0
          ? result.related
              .map(
                (article, index) =>
                  `${index + 1}. ${article.title}\n` +
                  `   Source: ${article.path} (${article.date}; ${article.kind})\n` +
                  `   Reasons: ${article.reasons.join("; ")}`,
              )
              .join("\n\n")
          : "No related bundled articles found.";
      return {
        content: [
          {
            type: "text",
            text: [
              `Article: ${result.article.path}`,
              series,
              ...adjacent,
              "",
              related,
            ].join("\n"),
          },
        ],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "hwchiu_k8s_observe",
    label: "Observe Kubernetes",
    description:
      "Run one fixed read-only kubectl observation for a confirmed context and namespace. Supports bounded resources, warning events, pod health, describe, and current or previous logs. Never reads Secret objects or mutates the cluster. Output may contain sensitive data.",
    promptSnippet:
      "Collect bounded, read-only Kubernetes evidence for SRE diagnosis",
    promptGuidelines: [
      "Use hwchiu_k8s_observe only after identifying the intended Kubernetes context and namespace, and do not treat observations as permission to mutate the cluster.",
    ],
    parameters: Type.Object({
      operation: StringEnum(kubernetesOperations),
      context: Type.Optional(
        Type.String({
          description: "kubectl context; current context when omitted",
        }),
      ),
      namespace: Type.Optional(
        Type.String({ description: "namespace; defaults to default" }),
      ),
      resourceKind: Type.Optional(StringEnum(kubernetesResourceKinds)),
      name: Type.Optional(
        Type.String({
          description: "resource or Pod name for describe or logs",
        }),
      ),
      container: Type.Optional(
        Type.String({ description: "container name for logs" }),
      ),
      tail: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 500, default: 200 }),
      ),
      previous: Type.Optional(
        Type.Boolean({ description: "read previous container logs" }),
      ),
      sinceSeconds: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 86_400 }),
      ),
      eventType: Type.Optional(StringEnum(kubernetesEventTypes)),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      signal?.throwIfAborted();
      const spec = buildKubernetesCommand(params);
      onUpdate?.({
        content: [
          {
            type: "text",
            text: `Running read-only ${spec.command} observation...`,
          },
        ],
        details: {},
      });
      const result = await pi.exec(spec.command, spec.args, {
        cwd: ctx.cwd,
        signal,
        timeout: spec.timeout,
      });
      signal?.throwIfAborted();
      const text = formatCommandResult(spec, result);
      return {
        content: [{ type: "text", text }],
        details: {
          command: spec.command,
          args: spec.args,
          exitCode: result.code,
        },
      };
    },
  });

  pi.registerTool({
    name: "hwchiu_systemd_observe",
    label: "Observe systemd",
    description:
      "Run one fixed read-only systemd observation. Lists failed services, shows one unit's status, or reads at most 500 journal lines. Never uses sudo or changes a unit. Status and logs may contain sensitive data.",
    promptSnippet:
      "Collect bounded, read-only systemd service evidence for SRE diagnosis",
    promptGuidelines: [
      "Use hwchiu_systemd_observe only for read-only service evidence, and obtain approval before proposing any restart or configuration change.",
    ],
    parameters: Type.Object({
      operation: StringEnum(systemdOperations),
      unit: Type.Optional(
        Type.String({ description: "systemd unit for status or logs" }),
      ),
      lines: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 500, default: 200 }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      signal?.throwIfAborted();
      const spec = buildSystemdCommand(params);
      onUpdate?.({
        content: [
          {
            type: "text",
            text: `Running read-only ${spec.command} observation...`,
          },
        ],
        details: {},
      });
      const result = await pi.exec(spec.command, spec.args, {
        cwd: ctx.cwd,
        signal,
        timeout: spec.timeout,
      });
      signal?.throwIfAborted();
      const text = formatCommandResult(spec, result);
      return {
        content: [{ type: "text", text }],
        details: {
          command: spec.command,
          args: spec.args,
          exitCode: result.code,
        },
      };
    },
  });

  pi.registerTool({
    name: "hwchiu_incident_report",
    label: "Format Incident Evidence Report",
    description:
      "Format already collected evidence into a bounded Markdown incident report. Use only established observations and completed tests, keep hypotheses separate, and call this as the final and only tool in its batch. This tool runs no commands and writes no files.",
    promptSnippet:
      "Emit a final structured incident evidence report from collected evidence",
    promptGuidelines: [
      "Use hwchiu_incident_report only after evidence collection is complete, and call it as the final and only tool in its batch.",
    ],
    parameters: incidentReportSchema,
    async execute(_toolCallId, params) {
      const report = params as IncidentReportInput;
      const text = formatIncidentReport(report);
      return {
        content: [{ type: "text", text }],
        details: report,
        terminate: true,
      };
    },
  });
}
