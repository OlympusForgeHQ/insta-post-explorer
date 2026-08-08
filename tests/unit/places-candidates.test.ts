import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MAX_CANDIDATES_PER_POST,
  placeCandidateSchema,
  placeCandidateBatchSchema,
  placeCandidateRecordSchema,
} from "@/lib/places/candidates";

// These schemas are the boundary between an AI-produced file and the database.
// The risk they guard is a permissive parser letting the model supply anything
// authoritative — coordinates, a provider id, a precision — or an unbounded
// payload. Every rejected shape below is a distinct branch of that risk, grouped
// into rejection tables instead of one test per field.

const validCandidate = {
  name: "Nobu Dubai",
  address: null,
  city: "Dubai",
  region: null,
  country: "United Arab Emirates",
  category: "restaurant" as const,
  confidence: 0.9,
  evidence: [{ type: "CAPTION" as const, excerpt: "Dinner at Nobu Dubai" }],
};

describe("placeCandidateSchema", () => {
  it("accepts a bounded textual candidate, with or without evidence", () => {
    expect(placeCandidateSchema.parse(validCandidate)).toEqual(validCandidate);
    expect(placeCandidateSchema.parse({ ...validCandidate, evidence: [] })).toBeDefined();
  });

  it("keeps the documented JSON Schema aligned with the required address contract", () => {
    const schema = JSON.parse(
      readFileSync(path.join(process.cwd(), "docs", "places-caption-candidate.schema.json"), "utf8"),
    ) as {
      $defs: {
        candidate: {
          required: string[];
          properties: Record<string, { maxLength?: number }>;
        };
      };
    };

    expect(schema.$defs.candidate.required).toEqual([
      "name",
      "address",
      "city",
      "region",
      "country",
      "category",
      "confidence",
      "evidence",
    ]);
    expect(schema.$defs.candidate.properties.address).toMatchObject({ maxLength: 300 });
  });

  it("requires a nullable bounded address as part of the textual contract", () => {
    expect(
      placeCandidateSchema.parse({
        ...validCandidate,
        address: "12 rue de l'Independance Americaine, 78000 Versailles",
      }).address,
    ).toBe("12 rue de l'Independance Americaine, 78000 Versailles");

    const withoutAddress = { ...validCandidate } as Record<string, unknown>;
    delete withoutAddress.address;
    expect(() => placeCandidateSchema.parse(withoutAddress)).toThrow();
    expect(() => placeCandidateSchema.parse({ ...validCandidate, address: "x".repeat(301) })).toThrow();
  });

  it("refuses anything authoritative or unbounded coming from the model", () => {
    const rejected: [string, Record<string, unknown>][] = [
      // The model proposes text only: coordinates and provider identity are the
      // geographic provider's job, never the model's.
      ["latitude", { latitude: 25.14 }],
      ["longitude", { longitude: 55.18 }],
      ["providerPlaceId", { providerPlaceId: "forbidden" }],
      ["provider", { provider: "geoapify" }],
      ["precision", { precision: "EXACT" }],
      // Bounded vocabulary and ranges.
      ["unknown category", { category: "airport" }],
      ["confidence above 1", { confidence: 1.5 }],
      ["confidence below 0", { confidence: -0.1 }],
      // Bounded payload size.
      ["over-long excerpt", { evidence: [{ type: "CAPTION", excerpt: "x".repeat(501) }] }],
      ["more than eight evidence rows", { evidence: Array.from({ length: 9 }, () => ({ type: "CAPTION", excerpt: "a" })) }],
    ];
    for (const [label, override] of rejected) {
      expect(() => placeCandidateSchema.parse({ ...validCandidate, ...override }), label).toThrow();
    }
  });
});

describe("placeCandidateBatchSchema", () => {
  // Bound to the constant rather than a literal: the limit is expected to move
  // with the analysis generation, and a hardcoded number silently drifts from it.
  it("accepts the bounded number of candidates per post and rejects one more", () => {
    const batch = Array.from({ length: MAX_CANDIDATES_PER_POST }, () => validCandidate);
    expect(placeCandidateBatchSchema.parse(batch)).toHaveLength(MAX_CANDIDATES_PER_POST);
    expect(() => placeCandidateBatchSchema.parse([...batch, validCandidate])).toThrow();
  });
});

describe("placeCandidateRecordSchema", () => {
  const validRecord = {
    post_id: "post-1",
    input_hash: "a".repeat(64),
    analysis_version: "places-v1",
    candidates: [validCandidate],
  };

  function without(key: string): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...validRecord };
    delete copy[key];
    return copy;
  }

  it("accepts a record carrying a canonical hash and a version", () => {
    expect(placeCandidateRecordSchema.parse(validRecord)).toBeDefined();
  });

  it("refuses a record whose identity or provenance cannot be trusted", () => {
    // The hash and the version are what make a re-import idempotent and a stale
    // analysis detectable; a lenient parser here would silently reopen both.
    const rejected: [string, Record<string, unknown>][] = [
      ["hash too short", { ...validRecord, input_hash: "xyz" }],
      ["hash uppercase (non-canonical)", { ...validRecord, input_hash: "A".repeat(64) }],
      ["hash one char short", { ...validRecord, input_hash: "a".repeat(63) }],
      ["hash missing", without("input_hash")],
      ["version missing", without("analysis_version")],
      ["version empty", { ...validRecord, analysis_version: "" }],
      ["unknown property", { ...validRecord, latitude: 25.14 }],
    ];
    for (const [label, record] of rejected) {
      expect(() => placeCandidateRecordSchema.parse(record), label).toThrow();
    }
  });
});
