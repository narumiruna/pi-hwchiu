import { expect, test } from "vitest";
import {
  buildKubernetesCommand,
  buildSystemdCommand,
  formatCommandResult,
} from "../extensions/observe.ts";

test("builds fixed read-only kubectl argument arrays", () => {
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

test("bounds Kubernetes logs and rejects option injection", () => {
  expect(
    buildKubernetesCommand({
      operation: "logs",
      namespace: "default",
      name: "api-123",
      container: "api",
      tail: 500,
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
    buildKubernetesCommand({ operation: "events" }),
    buildKubernetesCommand({
      operation: "resources",
      resourceKind: "deployments",
    }),
    buildKubernetesCommand({
      operation: "describe",
      resourceKind: "pods",
      name: "api",
    }),
    buildKubernetesCommand({ operation: "logs", name: "api" }),
  ];
  const forbidden = new Set([
    "apply",
    "delete",
    "edit",
    "exec",
    "patch",
    "replace",
    "scale",
  ]);

  expect(
    commands
      .flatMap((command) => command.args)
      .some((argument) => forbidden.has(argument)),
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
