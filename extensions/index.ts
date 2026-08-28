import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readArticle, searchKnowledge } from "./knowledge.ts";
import {
  buildKubernetesCommand,
  buildSystemdCommand,
  formatCommandResult,
  kubernetesOperations,
  kubernetesResourceKinds,
  systemdOperations,
} from "./observe.ts";

export default function piHwchiu(pi: ExtensionAPI) {
  pi.registerTool({
    name: "hwchiu_knowledge_search",
    label: "Search hwchiu Knowledge",
    description:
      "Search all 409 bundled hwchiu articles by Traditional Chinese or English text, title, tag, path, and article body. Returns ranked source paths with dates and summaries.",
    promptSnippet:
      "Search hwchiu's SRE, DevOps, Kubernetes, networking, cloud, and engineering corpus",
    promptGuidelines: [
      "Use hwchiu_knowledge_search before applying hwchiu's knowledge, then read the selected articles and cite their paths and dates.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description: "Traditional Chinese or English search terms",
      }),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 20, default: 8 }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      signal?.throwIfAborted();
      const results = await searchKnowledge(params.query, params.limit ?? 8);
      signal?.throwIfAborted();
      const text =
        results.length === 0
          ? `No bundled articles matched: ${params.query}`
          : results
              .map(
                (article, index) =>
                  `${index + 1}. ${article.title}\n` +
                  `   Source: ${article.path} (${article.date}; ${article.datePrecision})\n` +
                  `   Tags: ${article.tags.join(", ") || "none"}\n` +
                  `   Summary: ${article.summary || "No summary available."}`,
              )
              .join("\n\n");

      return {
        content: [{ type: "text", text }],
        details: {
          query: params.query,
          matches: results.map(
            ({ path, title, date, datePrecision, score }) => ({
              path,
              title,
              date,
              datePrecision,
              score,
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
      "Read a bounded line range from a bundled hwchiu article returned by hwchiu_knowledge_search. Output is limited to 50KB or 2,000 lines.",
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
        `Date: ${excerpt.article.date} (${excerpt.article.datePrecision})`,
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
          startLine: excerpt.startLine,
          endLine: excerpt.endLine,
          totalLines: excerpt.totalLines,
          hasMore: excerpt.truncated,
        },
      };
    },
  });

  pi.registerTool({
    name: "hwchiu_k8s_observe",
    label: "Observe Kubernetes",
    description:
      "Run one fixed read-only kubectl observation for a context or namespace. Supports context, bounded resource lists, events, describe, and at most 500 log lines. Never reads Secret objects or mutates the cluster. Events and logs may contain sensitive data.",
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
}
