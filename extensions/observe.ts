import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  truncateTail,
} from "@earendil-works/pi-coding-agent";

export const kubernetesOperations = [
  "context",
  "resources",
  "events",
  "describe",
  "logs",
] as const;
export type KubernetesOperation = (typeof kubernetesOperations)[number];

export const kubernetesResourceKinds = [
  "pods",
  "deployments",
  "statefulsets",
  "daemonsets",
  "jobs",
  "services",
  "nodes",
] as const;
export type KubernetesResourceKind = (typeof kubernetesResourceKinds)[number];

export interface KubernetesObserveInput {
  operation: KubernetesOperation;
  context?: string;
  namespace?: string;
  resourceKind?: KubernetesResourceKind;
  name?: string;
  container?: string;
  tail?: number;
}

export const systemdOperations = ["failed-units", "status", "logs"] as const;
export type SystemdOperation = (typeof systemdOperations)[number];

export interface SystemdObserveInput {
  operation: SystemdOperation;
  unit?: string;
  lines?: number;
}

export interface CommandSpec {
  command: "kubectl" | "systemctl" | "journalctl";
  args: string[];
  timeout: number;
  output: "head" | "tail";
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
}

function requireSafeIdentifier(
  value: string | undefined,
  field: string,
  pattern: RegExp,
): string {
  if (!value) throw new Error(`${field} is required for this operation.`);
  if (value.startsWith("-") || !pattern.test(value)) {
    throw new Error(`${field} contains unsupported characters.`);
  }
  return value;
}

function optionalSafeIdentifier(
  value: string | undefined,
  field: string,
  pattern: RegExp,
): string | undefined {
  return value === undefined
    ? undefined
    : requireSafeIdentifier(value, field, pattern);
}

const kubernetesIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,252}$/;
const systemdUnit = /^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,255}$/;

export function buildKubernetesCommand(
  input: KubernetesObserveInput,
): CommandSpec {
  if (!kubernetesOperations.includes(input.operation))
    throw new Error("Unsupported Kubernetes operation.");

  const context = optionalSafeIdentifier(
    input.context,
    "context",
    kubernetesIdentifier,
  );
  const namespace =
    optionalSafeIdentifier(
      input.namespace,
      "namespace",
      kubernetesIdentifier,
    ) ?? "default";
  const base = context ? ["--context", context] : [];
  const requestTimeout = "--request-timeout=10s";

  if (input.operation === "context") {
    return {
      command: "kubectl",
      args: ["config", "current-context"],
      timeout: 10_000,
      output: "head",
    };
  }

  if (input.operation === "events") {
    return {
      command: "kubectl",
      args: [
        ...base,
        "get",
        "events",
        "--namespace",
        namespace,
        "--sort-by=.metadata.creationTimestamp",
        requestTimeout,
      ],
      timeout: 15_000,
      output: "tail",
    };
  }

  if (input.operation === "logs") {
    const name = requireSafeIdentifier(
      input.name,
      "name",
      kubernetesIdentifier,
    );
    const container = optionalSafeIdentifier(
      input.container,
      "container",
      kubernetesIdentifier,
    );
    const tail = input.tail ?? 200;
    if (!Number.isInteger(tail) || tail < 1 || tail > 500) {
      throw new Error("tail must be an integer from 1 to 500.");
    }
    const args = [
      ...base,
      "logs",
      name,
      "--namespace",
      namespace,
      `--tail=${tail}`,
      requestTimeout,
    ];
    if (container) args.push("--container", container);
    return { command: "kubectl", args, timeout: 20_000, output: "tail" };
  }

  const resourceKind = input.resourceKind;
  if (!resourceKind || !kubernetesResourceKinds.includes(resourceKind)) {
    throw new Error(
      `resourceKind must be one of: ${kubernetesResourceKinds.join(", ")}.`,
    );
  }
  const namespaceArgs =
    resourceKind === "nodes" ? [] : ["--namespace", namespace];

  if (input.operation === "resources") {
    return {
      command: "kubectl",
      args: [
        ...base,
        "get",
        resourceKind,
        ...namespaceArgs,
        "-o",
        "wide",
        requestTimeout,
      ],
      timeout: 15_000,
      output: "head",
    };
  }

  const name = requireSafeIdentifier(input.name, "name", kubernetesIdentifier);
  return {
    command: "kubectl",
    args: [
      ...base,
      "describe",
      resourceKind,
      name,
      ...namespaceArgs,
      requestTimeout,
    ],
    timeout: 20_000,
    output: "tail",
  };
}

export function buildSystemdCommand(input: SystemdObserveInput): CommandSpec {
  if (!systemdOperations.includes(input.operation))
    throw new Error("Unsupported systemd operation.");

  if (input.operation === "failed-units") {
    return {
      command: "systemctl",
      args: ["--no-pager", "--failed", "--type=service"],
      timeout: 10_000,
      output: "head",
    };
  }

  const unit = requireSafeIdentifier(input.unit, "unit", systemdUnit);
  if (input.operation === "status") {
    return {
      command: "systemctl",
      args: ["--no-pager", "--full", "status", unit],
      timeout: 10_000,
      output: "tail",
    };
  }

  const lines = input.lines ?? 200;
  if (!Number.isInteger(lines) || lines < 1 || lines > 500) {
    throw new Error("lines must be an integer from 1 to 500.");
  }
  return {
    command: "journalctl",
    args: [
      "--no-pager",
      "--unit",
      unit,
      `--lines=${lines}`,
      "--output=short-iso",
    ],
    timeout: 15_000,
    output: "tail",
  };
}

export function formatCommandResult(
  spec: CommandSpec,
  result: ExecResult,
): string {
  if (result.killed)
    throw new Error(
      `${spec.command} was cancelled or exceeded ${spec.timeout} ms.`,
    );

  const combined = [result.stdout.trim(), result.stderr.trim()]
    .filter(Boolean)
    .join("\n\n[stderr]\n");
  const truncate = spec.output === "head" ? truncateHead : truncateTail;
  const truncation = truncate(combined || "Command completed without output.", {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });

  if (result.code !== 0) {
    throw new Error(
      `${spec.command} exited with code ${result.code}.\n${truncation.content}`,
    );
  }

  return truncation.truncated
    ? `${truncation.content}\n\n[Output truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES} bytes.]`
    : truncation.content;
}
