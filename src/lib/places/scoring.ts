import { foldForSearch } from "@/lib/import/normalize";
import { continentCodeForCountry } from "@/lib/places/continents";
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

// Compare source-language country labels against the provider's verified ISO
// code. ICU supplies exact translations; no fuzzy match can erase a conflict.
const countryNames = ['fr', 'en', 'nl'].map(locale => new Intl.DisplayNames([locale], { type: 'region' }));
function countryAgreement(candidateValue: string | null, resolved: ResolvedPlaceCandidate) {
  const code = resolved.countryCode?.trim().toUpperCase();
  if (candidateValue && code && continentCodeForCountry(code)) {
    const aliases = [code, ...countryNames.map(names => names.of(code) ?? '')];
    if (aliases.some(alias => normalizedEquals(candidateValue, alias))) return { match: 1, contradiction: false };
  }
  return fieldAgreement(candidateValue, resolved.country);
}

function cityAgreement(candidateValue: string | null, resolvedValue: string | null) {
  if (candidateValue && resolvedValue) {
    // Only a complete bilingual component asserted by the provider is an alias.
    // Do not split ordinary hyphenated names or accept arbitrary substrings.
    const aliases = resolvedValue.split(/\s+[-–—/]\s+/u);
    if (aliases.some(alias => normalizedEquals(candidateValue, alias))) return { match: 1, contradiction: false };
  }
  return fieldAgreement(candidateValue, resolvedValue);
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

function explicitlyNamesCity(candidate: ScoringInput['candidate']): boolean {
  if (!['voyage', 'city'].includes(candidate.category) || candidate.address || !candidate.name || !candidate.city) return false;
  const name = foldForSearch(candidate.name)
    .replace(/^(?:ville de|village de|city of|village of)\s+/u, '')
    .replace(/\s+(?:ville|city|village)$/u, '');
  return name === foldForSearch(candidate.city);
}

function normalizedEntityName(value: string): string {
  return foldForSearch(value)
    .replace(/[-’‘`']/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function entityNamesAgree(left: string, right: string): boolean {
  const a = normalizedEntityName(left), b = normalizedEntityName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const prefix = /^(restaurant|hotel|plage)\s+/u;
  const aPrefix = a.match(prefix), bPrefix = b.match(prefix);
  // An omitted generic prefix is compatible; two different explicit entity
  // descriptors (for example a hotel and a restaurant) are not interchangeable.
  if (aPrefix && bPrefix) return false;
  return a.replace(prefix, '') === b.replace(prefix, '');
}

export function scoreResolvedCandidate({ candidate, resolved }: ScoringInput): ScoredResolution {
  const reasons: string[] = [];

  // Match the entity itself, never a city embedded in its formatted address or
  // a different entity with a longer name (for example a park's motorway stop).
  const entityName = resolved.providerName ?? resolved.displayName.split(',')[0];
  const nameMatch =
    candidate.name && entityName && entityNamesAgree(candidate.name, entityName)
      ? 1
      : 0;
  if (nameMatch) reasons.push("name_match");

  const city = cityAgreement(candidate.city, resolved.city);
  const country = countryAgreement(candidate.country, resolved);
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

  // A verified street address does not establish that its named occupant is
  // the business in the source. Old tenants are common in provider datasets.
  if (resultKind.kind === 'specific' && candidate.name && !candidate.name.startsWith('@') &&
    resolved.providerName && nameMatch === 0) {
    reasons.push('provider_entity_name_unverified');
    return { confidence, precision: 'UNKNOWN', approximationRadiusMeters: null, reasons };
  }

  // A destination city cannot become a station or shop sharing the city name.
  if (resultKind.kind === 'specific' && explicitlyNamesCity(candidate)) {
    reasons.push('city_candidate_requires_area');
    return { confidence, precision: 'UNKNOWN', approximationRadiusMeters: null, reasons };
  }

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

  // An area can locate itself, but its city/region label cannot verify that a
  // named business or monument lies inside the area's fixed uncertainty radius.
  // In particular, unrelated businesses must not collapse into one city record.
  const namesArea = (candidate.name && normalizedEntityName(candidate.name) === normalizedEntityName(entityName)) ||
    (explicitlyNamesCity(candidate) && cityAgreement(candidate.city, entityName).match === 1);
  const businessCategory = ['restaurant', 'cafe', 'patisserie', 'lodging'].includes(candidate.category);
  if (candidate.address || (candidate.name && (!namesArea || businessCategory))) {
    reasons.push('specific_candidate_area_unverified');
    return { confidence, precision: 'UNKNOWN', approximationRadiusMeters: null, reasons };
  }

  // Area kind.
  if (!nameMatch && !cityAgreement(candidate.city, entityName).match &&
    !fieldAgreement(candidate.region, entityName).match) {
    reasons.push('area_identity_unverified');
    return { confidence, precision: 'UNKNOWN', approximationRadiusMeters: null, reasons };
  }
  if (confidence >= PRECISION_THRESHOLDS.APPROXIMATE) {
    reasons.push("approximate_area_match");
    return { confidence, precision: "APPROXIMATE", approximationRadiusMeters: resultKind.radius, reasons };
  }
  reasons.push("below_approximate_threshold");
  return { confidence, precision: "UNKNOWN", approximationRadiusMeters: null, reasons };
}
