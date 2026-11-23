# Hyphenated provider names

## Diagnosis

The 23 November sync imported a guide to five European theme parks. Four were
linked; Europa Park stayed `UNKNOWN` (`provider_entity_name_unverified`) although
the provider returned the right theme park, rank 1, in Rust. Name normalization
deleted the provider's hyphen (`Europa-Park` → `europapark`) while the source
kept its space (`europa park`).

## Change

`entityNamesAgree` also accepts two names that are identical once every
hyphen and punctuation run is read as a space. All other characters and words
must still match: `Europa-Park-Straße` and a bare `Europa` are rejected.
Policy `provider-context-v16`. Web/API only; no migration or consumer change.

## Verification

- `places-scoring.test.ts`: three rows in the existing name table (accepted
  hyphen/space pair, a longer street name, a prefix), both directions.
- Read-only production replay of the job: Europa Park `UNKNOWN` → `PROBABLE`
  on the provider's Europa-Park; the four other parks are unchanged.

## Rollback

Revert and redeploy the web/API.
