import { z } from "zod";

// Textual place candidates produced by Claude Code or the Codex CLI. The
// contract is deliberately text-only: models never provide coordinates, a
// provider, a provider identifier, or a precision. Only PlaceResolver may
// return coordinates. `.strict()` rejects any such forbidden extra field.

export const PLACE_CANDIDATE_CATEGORIES = [
  "restaurant",
  "lodging",
  "landmark",
  "city",
  "region",
  "other",
] as const;

export const PLACE_CANDIDATE_EVIDENCE_TYPES = [
  "CAPTION",
  "HASHTAG",
  "AUTHOR_TEXT",
  "INSTAGRAM_LOCATION",
] as const;

const MAX_EXCERPT_LENGTH = 500;
const MAX_EVIDENCE_PER_CANDIDATE = 8;
// The bound exists to keep an externally produced batch bounded, not to express
// how many places a post may mention. Five was fitted to the first analysis
// generation, whose candidates were mostly names and cities. Address-bearing
// analyses legitimately exceed it: guide posts listing Tokyo districts or London
// landmarks reached 45 candidates in a real 407-post batch, and 42 of those
// records were rejected outright by this limit.
//
// Fifty keeps the input bounded with a little headroom above the largest batch
// observed, so a slightly longer guide does not fail the contract again.
export const MAX_CANDIDATES_PER_POST = 50;

const boundedNullableName = z.string().trim().min(1).max(200).nullable();
const boundedNullableAddress = z.string().trim().min(1).max(300).nullable();

const candidateEvidenceSchema = z
  .object({
    type: z.enum(PLACE_CANDIDATE_EVIDENCE_TYPES),
    excerpt: z.string().trim().min(1).max(MAX_EXCERPT_LENGTH),
  })
  .strict();

export const placeCandidateSchema = z
  .object({
    name: boundedNullableName,
    address: boundedNullableAddress,
    city: boundedNullableName,
    region: boundedNullableName,
    country: boundedNullableName,
    category: z.enum(PLACE_CANDIDATE_CATEGORIES),
    confidence: z.number().min(0).max(1),
    evidence: z.array(candidateEvidenceSchema).max(MAX_EVIDENCE_PER_CANDIDATE),
  })
  .strict();

export const placeCandidateBatchSchema = z.array(placeCandidateSchema).max(MAX_CANDIDATES_PER_POST);

// A canonical lowercase SHA-256 hex digest (the exact shape produced by
// computePlacesInputHash).
const SHA256_HEX = /^[0-9a-f]{64}$/;

// One JSONL line of the caption-analysis result: the post it belongs to, the
// immutable identity of the exported analysis input (`input_hash` +
// `analysis_version`), and its bounded, text-only candidates. The model must
// echo `post_id`, `input_hash`, and `analysis_version` from the exported line
// unchanged. `.strict()` rejects any coordinate, provider, providerPlaceId,
// precision, or other unknown field at the record level too.
export const placeCandidateRecordSchema = z
  .object({
    post_id: z.string().trim().min(1).max(200),
    input_hash: z.string().trim().regex(SHA256_HEX),
    analysis_version: z.string().trim().min(1).max(120),
    candidates: placeCandidateBatchSchema,
  })
  .strict();

export type PlaceCandidate = z.infer<typeof placeCandidateSchema>;
export type PlaceCandidateEvidence = z.infer<typeof candidateEvidenceSchema>;
export type PlaceCandidateCategory = (typeof PLACE_CANDIDATE_CATEGORIES)[number];
export type PlaceCandidateRecord = z.infer<typeof placeCandidateRecordSchema>;
