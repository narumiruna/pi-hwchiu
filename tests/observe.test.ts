import { expect, test } from "vitest";
import {
  buildKubernetesCommand,
  buildSystemdCommand,
  formatCommandResult,
  type KubernetesObserveInput,
} from "../extensions/observe.ts";

test("builds fixed read-only kubectl resource arrays", () => {
  expect(
    buildKubernetesCommand({
      operation: "resources",
      context: "production-eu",
      namespace: "payments",
      resourceKind: "pods",
    }),
  ).toEqual({
    command: "kubectl",
    args: [
      "--context",
      "production-eu",
      "get",
      "pods",
      "--namespace",
      "payments",
      "-o",
      "wide",
      "--request-timeout=10s",
    ],
    timeout: 15_000,
    output: "head",
  });
});

test("bounds current and previous Kubernetes logs", () => {
  expect(
    buildKubernetesCommand({
      operation: "logs",
      namespace: "default",
      name: "api-123",
      container: "api",
      tail: 500,
      previous: true,
      sinceSeconds: 3_600,
    }).args,
  ).toEqual([
    "logs",
    "api-123",
    "--namespace",
    "default",
    "--tail=500",
    "--request-timeout=10s",
    "--container",
    "api",
    "--previous",
    "--since=3600s",
  ]);

  expect(() =>
    buildKubernetesCommand({
      operation: "logs",
      name: "--selector=everything",
    }),
  ).toThrow("unsupported characters");
  expect(() =>
    buildKubernetesCommand({ operation: "logs", name: "api", tail: 501 }),
  ).toThrow("1 to 500");
  expect(() =>
    buildKubernetesCommand({
      operation: "logs",
      name: "api",
      sinceSeconds: 86_401,
    }),
  ).toThrow("1 to 86400");
  expect(() =>
    buildKubernetesCommand({
      operation: "logs",
      name: "api",
      previous: "yes" as unknown as boolean,
    }),
  ).toThrow("previous must be a boolean");
});

test("filters Warning events with a fixed selector", () => {
  expect(
    buildKubernetesCommand({
      operation: "events",
      context: "staging",
      namespace: "payments",
      eventType: "warning",
    }).args,
  ).toEqual([
    "--context",
    "staging",
    "get",
    "events",
    "--namespace",
    "payments",
    "--sort-by=.metadata.creationTimestamp",
    "--field-selector=type=Warning",
    "--request-timeout=10s",
  ]);
  expect(() =>
    buildKubernetesCommand({
      operation: "events",
      eventType: "type=Warning,reason=Injected" as "warning",
    }),
  ).toThrow("eventType must be one of");
});

test("pod health uses fixed columns without full specs or environment values", () => {
  const command = buildKubernetesCommand({
    operation: "pod-health",
    context: "staging",
    namespace: "payments",
  });
  const joined = command.args.join(" ");

  expect(command.command).toBe("kubectl");
  expect(command.args.slice(0, 6)).toEqual([
    "--context",
    "staging",
    "get",
    "pods",
    "--namespace",
    "payments",
  ]);
  expect(joined).toContain(
    "RESTARTS:.status.containerStatuses[*].restartCount",
  );
  expect(joined).toContain(
    "REQUESTS_CPU:.spec.containers[*].resources.requests.cpu",
  );
  expect(joined).not.toMatch(/secret|\.spec\.containers\[\*\]\.env(?:\s|,|$)/i);
  expect(command.output).toBe("head");
});

test("rejects operation-incompatible Kubernetes fields", () => {
  const invalidInputs: KubernetesObserveInput[] = [
    { operation: "events", tail: 10 },
    { operation: "resources", resourceKind: "pods", name: "api" },
    {
      operation: "describe",
      resourceKind: "pods",
      name: "api",
      previous: true,
    },
    { operation: "pod-health", resourceKind: "pods" },
    { operation: "context", eventType: "warning" },
  ];

  for (const input of invalidInputs) {
    expect(() => buildKubernetesCommand(input)).toThrow("not supported");
  }
});

test("never exposes Kubernetes Secret resources or mutation verbs", () => {
  expect(() =>
    buildKubernetesCommand({
      operation: "resources",
      resourceKind: "secrets" as "pods",
    }),
  ).toThrow("resourceKind must be one of");

  const commands = [
    buildKubernetesCommand({ operation: "context" }),
    buildKubernetesCommand({ operation: "events", eventType: "warning" }),
    buildKubernetesCommand({ operation: "pod-health" }),
    buildKubernetesCommand({
      operation: "resources",
      resourceKind: "deployments",
    }),
    buildKubernetesCommand({
      operation: "describe",
      resourceKind: "pods",
      name: "api",
    }),
    buildKubernetesCommand({
      operation: "logs",
      name: "api",
      previous: true,
    }),
  ];
  const forbidden = new Set([
    "apply",
    "delete",
    "edit",
    "exec",
    "patch",
    "replace",
    "scale",
    "secrets",
  ]);

  expect(
    commands
      .flatMap((command) => command.args)
      .some((argument) => forbidden.has(argument.toLowerCase())),
  ).toBe(false);
});

test("builds fixed read-only systemd and journal commands", () => {
  expect(buildSystemdCommand({ operation: "failed-units" }).args).toEqual([
    "--no-pager",
    "--failed",
    "--type=service",
  ]);
  expect(
    buildSystemdCommand({ operation: "logs", unit: "api.service", lines: 50 }),
  ).toEqual({
    command: "journalctl",
    args: [
      "--no-pager",
      "--unit",
      "api.service",
      "--lines=50",
      "--output=short-iso",
    ],
    timeout: 15_000,
    output: "tail",
  });
  expect(() =>
    buildSystemdCommand({ operation: "status", unit: "--all" }),
  ).toThrow("unsupported characters");
});

test("truncates observation output and surfaces command failures", () => {
  const spec = buildSystemdCommand({ operation: "logs", unit: "api.service" });
  const output = Array.from(
    { length: 2_500 },
    (_, index) => `line-${index}`,
  ).join("\n");
  const formatted = formatCommandResult(spec, {
    stdout: output,
    stderr: "",
    code: 0,
    killed: false,
  });

  expect(formatted).toContain("line-2499");
  expect(formatted).toContain("Output truncated");
  expect(() =>
    formatCommandResult(spec, {
      stdout: "",
      stderr: "permission denied",
      code: 1,
      killed: false,
    }),
  ).toThrow("permission denied");
  expect(() =>
    formatCommandResult(spec, {
      stdout: "partial",
      stderr: "",
      code: 0,
      killed: true,
    }),
  ).toThrow("cancelled or exceeded");
});
