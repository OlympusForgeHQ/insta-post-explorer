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
  it.each(['street', 'amenity'])("rejects a zero-confidence %s even when its name matches the requested park", (providerResultType) => {
    const result = scoreResolvedCandidate(input(
      { name: "St. James's Park", city: 'London', region: 'England', country: 'United Kingdom', category: 'voyage', confidence: 0.8 },
      {
        displayName: "St James's Park", providerName: "St James's Park",
        address: "St James's Park, London, CR0 2UT, United Kingdom",
        city: 'London', region: 'England', country: 'United Kingdom', countryCode: 'GB',
        latitude: 51.384155, longitude: -0.101136,
        providerResultType, providerRank: 0, providerMatchType: 'match_by_street',
      },
    ));
    expect(result.precision).toBe('UNKNOWN');
    expect(result.approximationRadiusMeters).toBeNull();
  });

  it.each([
    ['Barbican Conservatory', 'London', 'City of London', 0.81],
    ["St. Paul's Cathedral", 'London', 'City of London', 0.81],
    ['British Museum', 'London', 'Greater London', 1],
    ['British Museum', 'Londres', 'Greater London', 1],
    ['British Museum', 'Londres', 'London', 1],
  ])("accepts %s when %s is the broad GB context of %s", (name, city, providerCity, providerRank) => {
    const result = scoreResolvedCandidate(input(
      { name, city, region: 'England', country: 'United Kingdom', category: 'voyage', confidence: 0.85 },
      { displayName: name, providerName: name, city: providerCity, region: 'England',
        country: 'United Kingdom', countryCode: 'GB', providerRank },
    ));
    expect(result.precision).toBe('EXACT');
    expect(result.reasons).not.toContain('city_contradiction');
  });

  it.each([
    ['City of London', 'Greater London', 'GB', 'United Kingdom', 'United Kingdom'],
    ['City of London', 'London', 'GB', 'United Kingdom', 'United Kingdom'],
    ['London', 'City of London', 'CA', 'Canada', 'Canada'],
    ['London', 'Greater London', null, 'United Kingdom', 'United Kingdom'],
    ['London', 'Londonderry', 'GB', 'United Kingdom', 'United Kingdom'],
    ['London', 'Greater London', 'GB', 'France', 'United Kingdom'],
    ['Paris', 'Greater Paris', 'FR', 'France', 'France'],
  ])("keeps incompatible city context %s / %s / %s rejected", (city, providerCity, countryCode, country, providerCountry) => {
    const result = scoreResolvedCandidate(input(
      { name: 'Example Museum', city, region: null, country, category: 'voyage' },
      { displayName: 'Example Museum', providerName: 'Example Museum', city: providerCity,
        country: providerCountry, countryCode },
    ));
    expect(result.precision).toBe('UNKNOWN');
  });

  it("does not use broad London context to verify another entity or a city namesake station", () => {
    const source = { name: 'British Museum', city: 'London', country: 'United Kingdom', category: 'voyage' as const };
    const provider = { displayName: 'British Museum', providerName: 'British Museum', city: 'Greater London',
      country: 'United Kingdom', countryCode: 'GB', providerResultType: 'amenity', providerRank: 1 };
    expect(scoreResolvedCandidate(input(source, { ...provider, displayName: 'Other Museum', providerName: 'Other Museum' })).precision).toBe('UNKNOWN');
    expect(scoreResolvedCandidate(input(source, { ...provider, displayName: 'Greater London', providerName: 'Greater London', providerResultType: 'city' })).precision).toBe('UNKNOWN');
    expect(scoreResolvedCandidate(input({ ...source, name: 'London' }, { ...provider, displayName: 'London', providerName: 'London' })).precision).toBe('UNKNOWN');
  });

  it("preserves a corroborated named building with low positive provider confidence", () => {
    const result = scoreResolvedCandidate(input(
      { name: 'Au Fond du Jardin', address: '6 rue de la Râpe', city: 'Strasbourg', country: 'France', category: 'patisserie' },
      { displayName: 'Au Fond du Jardin', providerName: 'Au Fond du Jardin', address: '6 Rue de la Râpe, Strasbourg, France',
        city: 'Strasbourg', country: 'France', countryCode: 'FR', providerResultType: 'building',
        providerRank: 1 / 6, providerMatchType: 'full_match' },
    ));
    expect(result.precision).toBe('EXACT');
  });

  it("does not replace a named destination with an unrelated district in the same city", () => {
    const source = {name:'River Valley',city:'Example City',country:'France',category:'voyage' as const};
    const provider = {displayName:'Garden Quarter',city:'Example City',country:'France',countryCode:'FR',providerResultType:'district'};
    expect(scoreResolvedCandidate(input(source,provider)).precision).toBe('UNKNOWN');
    expect(scoreResolvedCandidate(input(source,{...provider,displayName:'Example City',providerResultType:'city'})).precision).toBe('UNKNOWN');
    expect(scoreResolvedCandidate(input({...source,name:'Example City'},
      {...provider,displayName:'Garden Quarter, Example City, France',providerName:null})).precision).toBe('UNKNOWN');
    expect(scoreResolvedCandidate(input({...source,name:'Example Park'},
      {...provider,displayName:'Example Park Service Area',providerName:'Example Park Service Area',providerResultType:'amenity'})).precision).toBe('UNKNOWN');
    for(const [name,providerName,precision] of [
      ['Hotel Belle Vue','Restaurant Belle Vue','UNKNOWN'],
      ['Belle Vue','Restaurant Belle Vue','EXACT'],
      ['Restaurant Belle Vue','Belle Vue','EXACT'],
    ] as const){
      expect(scoreResolvedCandidate(input({name},{displayName:providerName,providerName})).precision).toBe(precision);
    }
  });

  it("does not treat hotel prefixes or an explicit address as proof of a city area", () => {
    const area = {displayName:'Paris',providerName:'Paris',city:'Paris',country:'France',countryCode:'FR',providerResultType:'city'};
    for (const source of [
      {name:'Hotel Paris',address:null},
      {name:'Paris',address:'12 Rue Example, Paris'},
    ]) {
      const result = scoreResolvedCandidate(input({...source,city:'Paris',country:'France',category:'voyage'},area));
      expect(result.precision).toBe('UNKNOWN');
      expect(result.approximationRadiusMeters).toBeNull();
    }
  });

  it("keeps an explicitly named city or village as an area instead of selecting its namesake station", () => {
    for (const [name, category] of [['Springfield','voyage'], ['Springfield village','voyage'], ['Springfield village','city']] as const) {
      const city = { name, city: 'Springfield', country: 'United States', category };
      const station = { displayName: name, city: 'Springfield', country: 'United States', countryCode: 'US', providerResultType: 'amenity' };
      expect(scoreResolvedCandidate(input(city, station)).precision).toBe('UNKNOWN');
      expect(scoreResolvedCandidate(input(city, {...station, displayName: 'Springfield', providerResultType: 'city'})).precision).toBe('APPROXIMATE');
    }
    expect(scoreResolvedCandidate(input({name: 'Springfield Museum', city:'Springfield', category:'voyage'},
      {displayName:'Springfield Museum', city:'Springfield'})).precision).toBe('EXACT');
  });

  it.each([
    ['Japon', 'Japan', 'JP'],
    ['Belgique', 'Belgium', 'BE'],
    ['Royaume-Uni', 'United Kingdom', 'GB'],
    ['Émirats arabes unis', 'United Arab Emirates', 'AE'],
    ['Verenigd Koninkrijk', 'United Kingdom', 'GB'],
  ])("recognizes the provider country code for %s / %s", (sourceCountry, providerCountry, countryCode) => {
    const result = scoreResolvedCandidate(input({ country: sourceCountry }, { country: providerCountry, countryCode }));
    expect(result.precision).toBe('EXACT');
    expect(result.reasons).toContain('country_match');
    expect(result.reasons).not.toContain('country_contradiction');
  });

  it("matches a complete provider bilingual locality while rejecting other and partial localities", () => {
    const localities: [string, string, boolean][] = [['Ixelles', 'Ixelles - Elsene', true], ['Elsene', 'Ixelles - Elsene', true],
      ['Ix', 'Ixelles - Elsene', false], ['Bruxelles', 'Ixelles - Elsene', false], ['Saint', 'Saint-Gilles', false]];
    for (const [city, providerCity, agrees] of localities) {
      const result = scoreResolvedCandidate(input({ city, country: 'Belgique' },
        { city: providerCity, country: 'Belgium', countryCode: 'BE' }));
      expect(result.precision).toBe(agrees ? 'EXACT' : 'UNKNOWN');
      expect(result.reasons).toContain(agrees ? 'city_match' : 'city_contradiction');
    }
    const differentCountry = scoreResolvedCandidate(input({ country: 'Japon' }, { country: 'China', countryCode: 'CN' }));
    expect(differentCountry.precision).toBe('UNKNOWN');
    expect(differentCountry.reasons).toContain('country_contradiction');
    for (const countryCode of [null, 'INVALID']) {
      const unsupported = scoreResolvedCandidate(input({ country: 'Japon' }, { country: 'Japan', countryCode }));
      expect(unsupported.precision).toBe('UNKNOWN');
      expect(unsupported.reasons).toContain('country_contradiction');
    }
  });

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

  it("leaves a named address unresolved when Geoapify verifies only the city", () => {
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

    expect(result.precision).toBe("UNKNOWN");
    expect(result.approximationRadiusMeters).toBeNull();
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
        { displayName: "Somewhere", city: "Somewhere", country: "Japan", countryCode: "JP", providerResultType: resultType },
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
