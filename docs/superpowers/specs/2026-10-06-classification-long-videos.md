# Complete long-video classification

**Mode:** Critical  
**Status:** approved design, implementation pending  
**Owner:** project owner

## Problem and outcomes

The owner requested classification of the entire existing library and explicitly
confirmed preservation of protected tags. Three originals exceed the existing
250 MiB / fifteen-minute limits and would be excluded. On 6 October the owner
authorized finishing every remaining operation, including the previously
presented sixty-minute / 600 MiB design.

## Requirements and compatibility

- `REQ-001`: Classification accepts verified MP4 originals up to 600 MiB and
  a real duration up to 3,600,000 ms, rejecting greater sizes or durations.
- `REQ-002`: Classification decodes the full video, samples at most twelve frames
  over its actual video timeline, and transcribes the entire audio. It neither
  truncates originals nor reports partial media as complete coverage.
- `REQ-003`: Classification permits 5,400,000 ms per post/process and 600,000 ms
  for a download. Its signed URLs remain valid for 7,200 seconds. Heartbeats,
  abort handling, bounded retries and temporary cleanup remain operative.
- `INV-001`: Places keeps its 250 MiB, 900,000 ms, 180-second download,
  600-second process and 1,800-second signing defaults. Images keep 250 MiB.
- `INV-002`: Keep all eight existing themes, the three-to-five proposed tag
  contract, every protected tag link, deletions, existing Places and source
  fencing. Reuse successful jobs; introduce no migration, dependency, provider,
  service, arbitrary URL, direct worker SQL or geographic reanalysis.
- `ERR-001`: Missing, corrupt, oversized or overlong originals fail explicitly;
  no thumbnail substitution or invented classification coverage.

## Acceptance and evidence

`AC-001` verifies REQ-001/003 through app result and worker claim boundary tests,
including one unit over each limit and preservation of image bounds.
`AC-002` verifies REQ-002/INV-001 through a real, low-resolution sixty-minute
video and audio fixture, an independent WAV-duration transcription assertion,
last-frame coverage, a 3,601-second rejection, and the existing Places tests.
`AC-003` verifies app-owned signed media and transactional completion through
PostgreSQL: larger verified MP4 accepted only by classification; owner isolation,
manual-tag preservation, canonical paths and replay preserved.
`AC-004` requires lint, app/worker types, full app/worker/Python tests, both
builds, independent review, and a reviewed deployment/runtime smoke.

## Architecture, risks, rollout and rollback

Reuse the existing shared extractor with an explicit classification-only limit
argument and unchanged default behavior. Scope server media size and signing
policies similarly. Raising shared global Places limits was rejected because it
would change an unrelated domain. Numeric bounds widen within the existing
classification V1 shape; successful existing results remain valid. No ADR-level
new topology is introduced.

Long ASR may reach the deadline or disk capacity; one consumer, twenty-media
maximum, actual-byte checks, process cancellation and finally-cleanup bound the
work. Classification images remain under the existing bound. A lease heartbeat
retains ownership throughout the longer deadline. Longer signed links stay
owner-scoped, HTTPS R2-only, version-bound and read-only.

Deploy the backward-compatible web validation first, then the reviewed consumer,
and admit the three larger media only after consumer compatibility is verified.
Keep the old release for rollback and do not delete queue/audit receipts. On
rollback stop larger-media admissions/consumer rather than hand a large-media
lease to an old consumer. Systemd replacement requires real root access; broad
user authorization does not provide a sudo password. The temporary supervised
consumer continues until permanent handover is possible.

## Scope

Only classification media limits and their tests/docs. Preserve sync scheduling,
Instagram profile/quota state, Places behavior and original objects. Recovery
of the other absent original and bulk processing are private operational work.
