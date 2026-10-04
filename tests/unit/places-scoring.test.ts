import { describe, expect, it } from "vitest";

import type { PlaceCandidate } from "@/lib/places/candidates";
import { scoreResolvedCandidate, type ScoringInput } from "@/lib/places/scoring";
import type { ResolvedPlaceCandidate } from "@/server/places/resolvers/types";

function candidate(overrides: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    name: "Nobu Dubai",
    address: null,
    city: "Dubai",
    region: null,
    country: "United Arab Emirates",
    category: "restaurant",
    confidence: 0.95,
    evidence: [],
    ...overrides,
  };
}

function resolved(overrides: Partial<ResolvedPlaceCandidate> = {}): ResolvedPlaceCandidate {
  return {
    provider: "geoapify",
    providerPlaceId: "geo-1",
    displayName: "Nobu Dubai",
    category: "catering.restaurant",
    address: "Atlantis, Dubai",
    city: "Dubai",
    region: null,
    country: "United Arab Emirates",
    countryCode: "AE",
    latitude: 25.1,
    longitude: 55.1,
    providerResultType: "amenity",
    providerRank: 0.9,
    providerMatchType: "full_match",
    attribution: "© Geoapify",
    ...overrides,
  };
}

function input(c: Partial<PlaceCandidate>, r: Partial<ResolvedPlaceCandidate>): ScoringInput {
  return { candidate: candidate(c), resolved: resolved(r) };
}

describe("scoreResolvedCandidate", () => {
  it("matches typographic apostrophes without treating an arrondissement or postcode as a house number",()=>{
    const result=scoreResolvedCandidate(input({name:'Terre d’Azur',address:'10 Avenue de Wagram, 75008 Paris',city:'Paris',country:'France'},
      {displayName:"Terre d'Azur",address:"Terre d'Azur, Avenue de Wagram, 8th Arrondissement of Paris, 75008 Paris, France",city:'Paris',country:'France'}));
    expect(result.precision).toBe('EXACT');expect(result.reasons).not.toContain('address_contradiction');
    const mismatch=scoreResolvedCandidate(input({address:'Rue des Bains 28, Genève, Suisse'}, {address:'Rue des Bains 40, Genève, Suisse'}));
    expect(mismatch.precision).toBe('UNKNOWN');expect(mismatch.reasons).toContain('address_contradiction');
  });

  it("classifies a specific verified POI as EXACT with no radius", () => {
    const result = scoreResolvedCandidate(input({}, {}));
    expect(result.precision).toBe("EXACT");
    expect(result.approximationRadiusMeters).toBeNull();
    expect(result.confidence).toBe(0.9375);
  });

  it("classifies an incomplete but specific match as PROBABLE with no radius", () => {
    const result = scoreResolvedCandidate(
      input(
        { name: "Sushi Bar", city: "Tokyo", region: null, country: null, confidence: 0.8 },
        { displayName: "Sushi Bar", city: "Tokyo", country: "Japan", countryCode: "JP", providerResultType: "amenity" },
      ),
    );
    expect(result.precision).toBe("PROBABLE");
    expect(result.approximationRadiusMeters).toBeNull();
    expect(result.confidence).toBeGreaterThanOrEqual(0.75);
    expect(result.confidence).toBeLessThan(0.9);
  });

  it("classifies a city-level area match as APPROXIMATE with a mandatory radius", () => {
    const result = scoreResolvedCandidate(
      input(
        { name: null, city: "Kyoto", region: null, country: "Japan", confidence: 0.7 },
        { displayName: "Kyoto", city: "Kyoto", country: "Japan", countryCode: "JP", providerResultType: "city" },
      ),
    );
    expect(result.precision).toBe("APPROXIMATE");
    expect(result.approximationRadiusMeters).toBe(10_000);
  });

  it("classifies a provider-verified caption address as EXACT even when the handle is not the provider name", () => {
    const result = scoreResolvedCandidate(
      input(
        {
          name: "@airelleschateaudeversailles",
          address: "12 rue de l'Independance Americaine, 78000 Versailles",
          city: "Versailles",
          region: "Ile-de-France",
          country: "France",
          confidence: 0.87,
        },
        {
          displayName: "Airelles Chateau de Versailles, Le Grand Controle",
          address: "12 Rue de l'Independance Americaine, 78000 Versailles, France",
          city: "Versailles",
          region: "Ile-de-France",
          country: "France",
          countryCode: "FR",
          providerResultType: "building",
          providerRank: 0.96,
          providerMatchType: "full_match",
        },
      ),
    );

    expect(result.precision).toBe("EXACT");
    expect(result.approximationRadiusMeters).toBeNull();
    expect(result.confidence).toBe(0.96);
    expect(result.reasons).toEqual(expect.arrayContaining(["address_match", "address_provider_verified", "exact_specific_match"]));
  });

  it("accepts Geoapify inner_part for an exact house-number address with maximum provider confidence", () => {
    const result = scoreResolvedCandidate(
      input(
        {
          name: "@airelleschateaudeversailles",
          address: "12 rue de l'Independance Americaine, 78000 Versailles",
          city: "Versailles",
          region: "Ile-de-France",
          country: "France",
          confidence: 0.98,
        },
        {
          displayName: "Airelles Chateau de Versailles, Le Grand Controle",
          address: "12 Rue de l'Independance Americaine, 78000 Versailles, France",
          city: "Versailles",
          region: "Ile-de-France",
          country: "France",
          countryCode: "FR",
          providerResultType: "amenity",
          providerRank: 1,
          providerMatchType: "inner_part",
        },
      ),
    );

    expect(result.precision).toBe("EXACT");
    expect(result.confidence).toBe(1);
    expect(result.approximationRadiusMeters).toBeNull();
    expect(result.reasons).toEqual(expect.arrayContaining(["address_match", "address_provider_verified", "exact_specific_match"]));
  });

  it("blocks address-authorized EXACT when the house number contradicts", () => {
    const result = scoreResolvedCandidate(
      input(
        {
          name: "@airelleschateaudeversailles",
          address: "12 Rue Royale, 1000 Bruxelles",
          city: "Bruxelles",
          region: "Bruxelles-Capitale",
          country: "Belgique",
          confidence: 0.95,
        },
        {
          displayName: "Un autre batiment",
          address: "14 Rue Royale, 1000 Bruxelles, Belgique",
          city: "Bruxelles",
          region: "Bruxelles-Capitale",
          country: "Belgique",
          providerResultType: "building",
          providerRank: 0.99,
          providerMatchType: "full_match",
        },
      ),
    );

    expect(result.precision).not.toBe("EXACT");
    expect(result.reasons).toContain("address_contradiction");
  });

  it.each([
    ["weak provider rank", { providerRank: 0.89, providerMatchType: "full_match" }],
    ["inner-part rank below its stricter threshold", { providerRank: 0.94, providerMatchType: "inner_part" }],
    ["street-only provider match", { providerRank: 0.99, providerMatchType: "match_by_street" }],
    ["missing provider match type", { providerRank: 0.99, providerMatchType: null }],
  ])("does not authorize address-based EXACT for %s", (_label, provider) => {
    const result = scoreResolvedCandidate(
      input(
        {
          name: "@unrelated_handle",
          address: "12 rue de l'Independance Americaine, 78000 Versailles",
          city: "Versailles",
          region: null,
          country: "France",
          confidence: 0.87,
        },
        {
          displayName: "Airelles Chateau de Versailles",
          address: "12 Rue de l'Independance Americaine, 78000 Versailles, France",
          city: "Versailles",
          region: "Ile-de-France",
          country: "France",
          providerResultType: "building",
          ...provider,
        },
      ),
    );

    expect(result.precision).not.toBe("EXACT");
    expect(result.reasons).not.toContain("address_provider_verified");
  });

  it("keeps an address candidate approximate when Geoapify resolves only the city", () => {
    const result = scoreResolvedCandidate(
      input(
        {
          name: "@airelleschateaudeversailles",
          address: "12 rue de l'Independance Americaine, 78000 Versailles",
          city: "Versailles",
          region: null,
          country: "France",
          confidence: 0.87,
        },
        {
          displayName: "Versailles",
          address: "Versailles, France",
          city: "Versailles",
          region: "Ile-de-France",
          country: "France",
          providerResultType: "city",
          providerRank: 0.25,
          providerMatchType: "match_by_city_or_disrict",
        },
      ),
    );

    expect(result.precision).toBe("APPROXIMATE");
    expect(result.approximationRadiusMeters).toBe(10_000);
  });

  it.each([
    ["suburb", 5_000],
    ["district", 5_000],
    ["city", 10_000],
    ["postcode", 10_000],
    ["county", 50_000],
    ["state", 150_000],
  ])("uses the documented radius for area type %s", (resultType, radius) => {
    const result = scoreResolvedCandidate(
      input(
        { name: null, city: "Somewhere", region: null, country: "Japan", confidence: 0.8 },
        { city: "Somewhere", country: "Japan", countryCode: "JP", providerResultType: resultType },
      ),
    );
    expect(result.precision).toBe("APPROXIMATE");
    expect(result.approximationRadiusMeters).toBe(radius);
  });

  it("returns UNKNOWN for a country-only match and creates no radius", () => {
    const result = scoreResolvedCandidate(
      input(
        { name: null, city: null, region: null, country: "Japan", confidence: 0.9 },
        { displayName: "Japan", city: null, country: "Japan", countryCode: "JP", providerResultType: "country" },
      ),
    );
    expect(result.precision).toBe("UNKNOWN");
    expect(result.approximationRadiusMeters).toBeNull();
    expect(result.reasons).toContain("country_only");
  });

  it("returns UNKNOWN when candidate and provider countries contradict", () => {
    const result = scoreResolvedCandidate(
      input(
        { name: "Nobu", city: "Dubai", region: null, country: "France", confidence: 0.9 },
        { displayName: "Nobu", city: "Dubai", country: "Spain", countryCode: "ES", providerResultType: "amenity" },
      ),
    );
    expect(result.precision).toBe("UNKNOWN");
    expect(result.reasons).toContain("country_contradiction");
  });

  it("returns UNKNOWN when a specific match scores below the PROBABLE threshold", () => {
    const result = scoreResolvedCandidate(
      input(
        { name: "Vague place", city: null, region: null, country: null, confidence: 0.4 },
        { displayName: "Something else", city: null, country: null, countryCode: null, providerResultType: "amenity" },
      ),
    );
    expect(result.precision).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for an unrecognized provider result type", () => {
    const result = scoreResolvedCandidate(input({}, { providerResultType: "galaxy" }));
    expect(result.precision).toBe("UNKNOWN");
  });

  it("never returns a radius for a non-approximate precision", () => {
    for (const type of ["amenity", "country", "galaxy"]) {
      const result = scoreResolvedCandidate(input({}, { providerResultType: type }));
      if (result.precision !== "APPROXIMATE") {
        expect(result.approximationRadiusMeters).toBeNull();
      }
    }
  });

  it("clamps confidence to the [0,1] range", () => {
    const result = scoreResolvedCandidate(input({}, {}));
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("is deterministic and does not mutate its inputs", () => {
    const arg = input({}, {});
    const frozenCandidate = { ...arg.candidate };
    const frozenResolved = { ...arg.resolved };
    const a = scoreResolvedCandidate(arg);
    const b = scoreResolvedCandidate(arg);
    expect(a).toEqual(b);
    expect(arg.candidate).toEqual(frozenCandidate);
    expect(arg.resolved).toEqual(frozenResolved);
  });
});
