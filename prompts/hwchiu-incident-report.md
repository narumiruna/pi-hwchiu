---
description: Build a bounded incident evidence report from the current session
argument-hint: "[scope]"
---

Prepare an incident evidence report for `${ARGUMENTS:-current incident}`.

Review the evidence already present in this session before collecting anything new.
If the Kubernetes context, namespace, systemd unit, or diagnostic scope is unclear, ask the user to confirm it before observation.
Use only the fixed read-only hwchiu observation tools when additional bounded evidence is necessary.
Do not execute or propose a mutation as though it were approved.
Keep direct observations, hypotheses, completed tests, and conclusions separate.
Do not place an untested hypothesis in the conclusion.
Summarize sensitive logs instead of copying an unbounded transcript.
Cite hwchiu articles by title, date, and bundled path, and cite environment evidence by command and bounded scope.
Include expected impact, rollback, and validation for every recommended change.
Call `hwchiu_incident_report` as the final and only tool call in its batch.
Do not emit another assistant response after the formatter tool.
