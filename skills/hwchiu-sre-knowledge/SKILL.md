---
name: hwchiu-sre-knowledge
description: Applies hwchiu's Traditional Chinese knowledge corpus to SRE, DevOps, Kubernetes, containers, Linux networking, GitOps, CI/CD, cloud, storage, security, and observability work. Use when explaining these topics, designing infrastructure, diagnosing incidents, reviewing operational changes, or retrieving hwchiu's blog knowledge.
license: See repository LICENSE; bundled articles retain their source attribution.
compatibility: Pi package tools use Node.js 22 or newer; optional diagnostics require kubectl, systemctl, or journalctl.
---

# hwchiu SRE Knowledge

Use hwchiu's articles as grounded experience, not as automatically current product documentation.

## Workflow

1. Identify the system, symptom, desired outcome, constraints, and available evidence.
2. Read [the topic map](references/TOPICS.md) for common entry points or [the complete index](references/INDEX.md) for the full corpus.
3. Use `hwchiu_knowledge_search` when available, then use `hwchiu_read_article` or `read` to inspect every selected source before relying on it.
4. Prefer multiple relevant sources when a topic spans architecture, implementation, and operations.
5. For incidents, separate observations, hypotheses, tests, and conclusions.
6. Use `hwchiu_k8s_observe` or `hwchiu_systemd_observe` only for bounded read-only evidence collection when the target environment is understood.
7. Before recommending or executing a mutation, explain the expected impact, rollback, and validation, then obtain the user's approval.
8. Cite each material source by title, date or year precision, and bundled path under `references/articles/`.

## Evidence Rules

Treat reading-note posts as hwchiu's summary of an external source and preserve that distinction.
Treat versions, commands, APIs, pricing, security guidance, and provider behavior as time-sensitive.
Verify time-sensitive details against the target environment or current authoritative documentation before operational use.
State when a source has only a year-level date or when current verification is unavailable.
Do not expose Kubernetes Secrets or broaden a diagnostic command beyond the fixed read-only operations supplied by the extension.

Read [the series map](references/SERIES.md) when a result belongs to a multi-part sequence.
