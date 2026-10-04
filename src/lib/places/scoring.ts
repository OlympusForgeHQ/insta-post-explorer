import { foldForSearch } from "@/lib/import/normalize";
import type { PlaceCandidate } from "@/lib/places/candidates";
import type { ResolvedPlaceCandidate } from "@/server/places/resolvers/types";

// Deterministic resolution scoring (design section 6). A textual candidate and
// its provider-verified resolution are combined into a bounded confidence and a
// precision class. The score never depends on provider coordinates or on the
// non-deterministic order of provider results; the same input always yields the
// same output. `EXACT` additionally requires a provider-verified specific result
// type and no contradiction. A country-only match is always `UNKNOWN`.

export type PlacePrecisionOutcome = "EXACT" | "PROBABLE" | "APPROXIMATE" | "UNKNOWN";

export type ScoringInput = {
  candidate: Pick<PlaceCandidate, "name" | "address" | "city" | "region" | "country" | "category" | "confidence">;
  resolved: ResolvedPlaceCandidate;
};

export type ScoredResolution = {
  confidence: number;
  precision: PlacePrecisionOutcome;
  approximationRadiusMeters: number | null;
  reasons: string[];
};

// Confidence thresholds (design section 7.2 / CODEX_PLACES_EXTENSION section 7).
export const PRECISION_THRESHOLDS = {
  EXACT: 0.9,
  PROBABLE: 0.75,
  APPROXIMATE: 0.5,
} as const;

// Additive weights, summing to 1.0, applied to normalized field agreement and
// the model's own stated confidence. Name and city dominate because they carry
// the most locating signal for a caption-derived candidate.
export const SCORING_WEIGHTS = {
  candidateConfidence: 0.25,
  nameMatch: 0.35,
  cityMatch: 0.2,
  countryMatch: 0.15,
  regionMatch: 0.05,
} as const;

// Each contradicting locating field (city or country asserted by the model but
// disagreeing with the provider) subtracts this much, which is enough to push an
// otherwise strong match below the APPROXIMATE floor.
export const CONTRADICTION_PENALTY = 0.4;
export const ADDRESS_PROVIDER_EXACT_THRESHOLD = 0.9;
export const ADDRESS_PROVIDER_INNER_PART_EXACT_THRESHOLD = 0.95;

const ADDRESS_LEVEL_MATCH_TYPES = new Set(["full_match", "match_by_building"]);

// Approximation radii by area level (design section 4 / D4).
export const APPROXIMATION_RADII_METERS = {
  district: 5_000,
  city: 10_000,
  county: 50_000,
  state: 150_000,
} as const;

type ResultKind =
  | { kind: "specific" }
  | { kind: "area"; radius: number }
  | { kind: "country" }
  | { kind: "unknown" };

// Map a provider result type to a specificity kind. Unknown types are treated as
// non-locating and resolve to UNKNOWN — the safe default.
function classifyResultType(resultType: string | null): ResultKind {
  const key = (resultType ?? "").trim().toLowerCase();
  if (["amenity", "building", "street", "housenumber", "house", "tourism", "leisure", "poi"].includes(key)) {
    return { kind: "specific" };
  }
  if (["suburb", "district", "neighbourhood", "quarter"].includes(key)) {
    return { kind: "area", radius: APPROXIMATION_RADII_METERS.district };
  }
  if (["city", "town", "village", "municipality", "locality", "postcode"].includes(key)) {
    return { kind: "area", radius: APPROXIMATION_RADII_METERS.city };
  }
  if (key === "county") {
    return { kind: "area", radius: APPROXIMATION_RADII_METERS.county };
  }
  if (["state", "region", "province"].includes(key)) {
    return { kind: "area", radius: APPROXIMATION_RADII_METERS.state };
  }
  if (key === "country") {
    return { kind: "country" };
  }
  return { kind: "unknown" };
}

function normalizedEquals(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  return foldForSearch(left) === foldForSearch(right);
}

// A field agrees (1) when both sides assert it and they fold-match; it
// contradicts when both assert it and they differ; otherwise it is neutral (0).
function fieldAgreement(candidateValue: string | null, resolvedValue: string | null): {
  match: number;
  contradiction: boolean;
} {
  if (!candidateValue || !resolvedValue) return { match: 0, contradiction: false };
  return normalizedEquals(candidateValue, resolvedValue)
    ? { match: 1, contradiction: false }
    : { match: 0, contradiction: true };
}

type AddressAgreement = {
  match: boolean;
  houseNumberMatch: boolean;
  contradiction: boolean;
};

function normalizeAddress(value: string): string {
  return foldForSearch(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function likelyHouseNumber(value: string): string | null {
  // Ignore postal codes and ordinal district names; a number must introduce
  // a street/address segment, rather than appear anywhere in formatted text.
  const cleaned = value.replace(/\b\d{1,3}(?:st|nd|rd|th|er|e|eme|ème)\b/gi, '').replace(/\b\d{5,}\b/g, '');
  for (const [index, segment] of cleaned.split(',').entries()) {
    const leading = segment.match(/^\s*(\d{1,4}[a-z]?(?:[-/]\d{1,4}[a-z]?)?)\s+\p{L}/iu)?.[1];
    if (leading && !(index > 0 && /^\d{4}$/.test(leading))) return leading.toLowerCase();
    const trailing = segment.match(/\p{L}\s+(\d{1,4}[a-z]?(?:[-/]\d{1,4}[a-z]?)?)\s*$/iu)?.[1];
    if (trailing) return trailing.toLowerCase();
  }
  return null;
}

function addressAgreement(candidateValue: string | null, resolvedValue: string | null): AddressAgreement {
  if (!candidateValue || !resolvedValue) {
    return { match: false, houseNumberMatch: false, contradiction: false };
  }

  const candidateAddress = normalizeAddress(candidateValue);
  const resolvedAddress = normalizeAddress(resolvedValue);
  const candidateHouseNumber = likelyHouseNumber(candidateValue);
  const resolvedHouseNumber = likelyHouseNumber(resolvedValue);
  const houseNumberMatch =
    candidateHouseNumber !== null && candidateHouseNumber === resolvedHouseNumber;
  const contradiction =
    candidateHouseNumber !== null &&
    resolvedHouseNumber !== null &&
    candidateHouseNumber !== resolvedHouseNumber;
  const containsAddress =
    Math.min(candidateAddress.length, resolvedAddress.length) >= 8 &&
    (candidateAddress.includes(resolvedAddress) || resolvedAddress.includes(candidateAddress));

  return {
    match: containsAddress && !contradiction,
    houseNumberMatch,
    contradiction,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

export function scoreResolvedCandidate({ candidate, resolved }: ScoringInput): ScoredResolution {
  const reasons: string[] = [];

  // Name only ever contributes positively: caption names and provider display
  // names vary too much to treat a mismatch as a contradiction.
  const nameMatch =
    candidate.name && resolved.displayName && foldForSearch(resolved.displayName).replace(/[’‘`]/g, "'").includes(foldForSearch(candidate.name).replace(/[’‘`]/g, "'"))
      ? 1
      : 0;
  if (nameMatch) reasons.push("name_match");

  const city = fieldAgreement(candidate.city, resolved.city);
  const country = fieldAgreement(candidate.country, resolved.country);
  const region = fieldAgreement(candidate.region, resolved.region);
  const address = addressAgreement(candidate.address, resolved.address);
  if (city.match) reasons.push("city_match");
  if (country.match) reasons.push("country_match");
  if (address.match) reasons.push("address_match");
  if (city.contradiction) reasons.push("city_contradiction");
  if (country.contradiction) reasons.push("country_contradiction");
  if (address.contradiction) reasons.push("address_contradiction");

  const contradictions =
    (city.contradiction ? 1 : 0) +
    (country.contradiction ? 1 : 0) +
    (address.contradiction ? 1 : 0);
  const base =
    SCORING_WEIGHTS.candidateConfidence * candidate.confidence +
    SCORING_WEIGHTS.nameMatch * nameMatch +
    SCORING_WEIGHTS.cityMatch * city.match +
    SCORING_WEIGHTS.countryMatch * country.match +
    SCORING_WEIGHTS.regionMatch * region.match;
  const addressVerifiedBase =
    address.match && resolved.providerRank !== null
      ? Math.max(base, resolved.providerRank)
      : base;
  const confidence = round4(clamp01(addressVerifiedBase - CONTRADICTION_PENALTY * contradictions));

  const providerMatchType = (resolved.providerMatchType ?? "").trim().toLowerCase();
  const providerMatchTypeAccepted =
    ADDRESS_LEVEL_MATCH_TYPES.has(providerMatchType) ||
    (providerMatchType === "inner_part" &&
      resolved.providerRank !== null &&
      resolved.providerRank >= ADDRESS_PROVIDER_INNER_PART_EXACT_THRESHOLD);
  const strongAddressMatch =
    address.match &&
    address.houseNumberMatch &&
    resolved.providerRank !== null &&
    resolved.providerRank >= ADDRESS_PROVIDER_EXACT_THRESHOLD &&
    providerMatchTypeAccepted;
  if (strongAddressMatch) reasons.push("address_provider_verified");

  const resultKind = classifyResultType(resolved.providerResultType);

  if (resultKind.kind === "country") {
    reasons.push("country_only");
    return { confidence, precision: "UNKNOWN", approximationRadiusMeters: null, reasons };
  }
  if (resultKind.kind === "unknown") {
    reasons.push("unresolvable_result_type");
    return { confidence, precision: "UNKNOWN", approximationRadiusMeters: null, reasons };
  }

  if (resultKind.kind === "specific") {
    if (
      confidence >= PRECISION_THRESHOLDS.EXACT &&
      contradictions === 0 &&
      (nameMatch === 1 || strongAddressMatch)
    ) {
      reasons.push("exact_specific_match");
      return { confidence, precision: "EXACT", approximationRadiusMeters: null, reasons };
    }
    if (confidence >= PRECISION_THRESHOLDS.PROBABLE) {
      reasons.push("probable_specific_match");
      return { confidence, precision: "PROBABLE", approximationRadiusMeters: null, reasons };
    }
    reasons.push("below_probable_threshold");
    return { confidence, precision: "UNKNOWN", approximationRadiusMeters: null, reasons };
  }

  // Area kind.
  if (confidence >= PRECISION_THRESHOLDS.APPROXIMATE) {
    reasons.push("approximate_area_match");
    return { confidence, precision: "APPROXIMATE", approximationRadiusMeters: resultKind.radius, reasons };
  }
  reasons.push("below_approximate_threshold");
  return { confidence, precision: "UNKNOWN", approximationRadiusMeters: null, reasons };
}
