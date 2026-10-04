# Places service implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution.

**Goal:** Provision and verify an independent Hermes Places service using OpenRouter.
**Architecture:** Existing Instagram deployment plus a private systemd Hermes
service. One repository; future Places business writes use the existing API.
**Tech stack:** Installed Hermes 0.21.5, systemd, Python standard library.
**Spec:** ../specs/2026-10-04-places-worker-openrouter-design.md

## Global constraints and review focus

Model `deepseek/deepseek-v4.1-flash`, loopback port 8645, concurrency 1,
CPUQuota 100%, MemoryMax 2G. No production post processing in this slice.
Review credential leakage, unrelated-state overwrite, API key rotation on retry,
Hermes fallback/tool inheritance and interference with existing services.

## Task 1: Reproducible isolated deployment

- [x] Add `services/worker/places-hermes/config.json`, systemd unit, installer,
  focused installer tests and README. Exercise foreign-state rejection,
  atomic secret permissions and key preservation on retry.
- [x] Update authoritative architecture references with the accepted decision.
- [x] Validate artifacts, app lint/types/tests/build and worker checks; request
  an independent review before activation.

## Task 2: Authorized deployment and verification

- [x] Install the dedicated state and unit without touching existing profiles.
- [x] Validate the unit, start/enable it and check authenticated health,
  unauthorized denial, loopback binding, filesystem/resource isolation.
- [x] Run bounded synthetic text/image checks through Hermes and verify actual
  model/provider metadata. Record sanitized results and prior-service health.
- [x] Update operational handoff with the implemented scope and remaining pipeline work.
