# Places inference service

**Mode:** Critical
**Status:** Approved scope; implementation authorized by the owner on 4 October 2026.
**Owner:** Karim

## Problem and outcome

Video/audio analysis needs execution independent of Instagram synchronization.
OUT-001: a separately restartable Places service reaches DeepSeek V4.1 Flash
through OpenRouter while the existing sync and Hermes gateways remain running.

## Requirements

- REQ-001: Use the existing Hermes engine in a dedicated state directory and
  service. The upstream provider is `openrouter`, model
  `deepseek/deepseek-v4.1-flash`, including the auxiliary vision configuration.
- REQ-002: Bind the native Hermes API to `127.0.0.1:8645`, require a unique Bearer
  secret and limit concurrent sessions to one. Disable profile multiplexing.
- REQ-003: Keep secrets out of Git, logs, argv and verification output; state
  directory mode 0700 and environment mode 0600. Retain the local API key on
  reinstall. Refuse to overwrite an unrelated service or state directory.
- REQ-004: Bound the service to one CPU and 2 GiB RAM. Hide other Hermes profiles;
  allow writes only to its state and private temporary directory. Enable reboot
  startup and restart on failure.
- REQ-005: Do not claim real post jobs until the Places handler is implemented.
  Enable no agent tools, messaging integrations or automatic scheduled jobs.
  Synthetic text/image inference is the acceptance check for this slice.

## Invariants and errors

One repository, application API, PostgreSQL database and R2 store remain.
No application schema, Instagram schedule, existing Hermes profile or app
credential changes. Missing/invalid upstream credentials fail verification;
they never trigger an implicit fallback provider. Readiness alone does not prove
upstream inference, which must be checked separately.

## Acceptance and test seams

- AC-001 / REQ-001: a synthetic inference passes through the new Hermes API and
  its runtime metadata identifies the requested OpenRouter model.
- AC-002 / REQ-002: authenticated health succeeds, protected requests without a
  key fail, and only the loopback listener is present.
- AC-003 / REQ-003: installer refuses foreign state and preserves the API key on
  retry; live permission checks and sanitized receipts show no exposed secrets.
- AC-004 / REQ-004: systemd configuration and active state show the limits and
  isolation; existing sync/Argos/Cortana remain healthy.
- AC-005 / REQ-005: the gateway starts with no tools or other platforms and has
  no production post queue credentials.

## Out of scope and risks

Full audio/OCR/video extraction, geographic resolution, category changes,
automatic job submission and the 421-post backfill remain separate work. Hermes
is shared installed software, so an engine upgrade needs revalidation. The local
API is for trusted backend clients, not a public application endpoint. No fixed
budget for a full backfill is implied by a synthetic connectivity check.
