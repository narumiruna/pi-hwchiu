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
3. Use `hwchiu_knowledge_search` when available, apply kind, tag, year, or match-mode filters only when they reflect the request, then use `hwchiu_read_article` or `read` to inspect every selected source before relying on it.
4. Use `hwchiu_related_articles` when a selected source belongs to a series or assumes adjacent context, then read the relevant previous or next article before citing the sequence.
5. Prefer multiple relevant sources when a topic spans architecture, implementation, and operations.
6. Treat search and read freshness signals as prompts for a concrete current-verification action, not as proof that an article is wrong.
7. For incidents, separate observations, hypotheses, completed tests, and conclusions.
8. Record an observation only when a bounded source directly supports it, keep untested explanations under hypotheses, and never use an unexecuted test to support a conclusion.
9. Use `hwchiu_k8s_observe` or `hwchiu_systemd_observe` only for bounded read-only evidence collection when the target environment is understood.
10. Before recommending or executing a mutation, explain the expected impact, rollback, and validation, then obtain the user's approval.
11. Use `hwchiu_incident_report` only after evidence collection is complete, and call it as the final and only tool in its batch.
12. Cite each material source by title, date or year precision, bundled path under `references/articles/`, and revision-pinned source URL when available.

## Evidence Rules

Treat reading-note posts as hwchiu's summary of an external source and preserve that distinction.
Treat versions, commands, APIs, pricing, security guidance, and provider behavior as time-sensitive.
Verify time-sensitive details against the target environment or current authoritative documentation before operational use.
Turn each current-verification signal into a specific check, and state when that check is unavailable.
State when a source has only a year-level date or when current verification is unavailable.
Do not expose Kubernetes Secrets or broaden a diagnostic command beyond the fixed read-only operations supplied by the extension.
Summarize sensitive logs in incident reports instead of copying an unbounded transcript.

Read [the series map](references/SERIES.md) when a result belongs to a multi-part sequence.
Use [the machine-readable series catalog](references/series.json) to verify ordered paths.
