import { describe, expect, it } from "vitest";

import {
  EMPTY_FILTERS,
  collectCountries,
  countActiveFilters,
  filterPlaces,
  isMappable,
  narrowCountries,
  parseViewMode,
  parsePlacesUrlState,
  serializePlacesUrlState,
  toggleValue,
  type PlacesFilters,
} from "@/features/places/query-state";
import type { PlacesMapItem } from "@/server/places/map-view";

function place(overrides: Partial<PlacesMapItem> = {}): PlacesMapItem {
  return {
    id: "p1",
    displayName: "Nobu Dubai",
    category: "catering.restaurant",
    categoryGroup: "restaurant",
    city: "Dubai",
    region: null,
    country: "Émirats arabes unis",
    countryCode: "AE",
    latitude: 25.1,
    longitude: 55.1,
    precision: "EXACT",
    confidence: 0.9,
    approximationRadiusMeters: null,
    reviewStatus: "UNREVIEWED",
    isUserConfirmed: false,
    postCount: 3,
    sourceThemes: ["Restaurant"],
    previewThumbnailUrl: null,
    ...overrides,
  };
}

describe("places URL state", () => {
  it("parses every filter from the query string", () => {
    const state = parsePlacesUrlState(
      new URLSearchParams("q=nobu&theme=Voyages,Restaurant&categories=cafe,restaurant&precision=EXACT,APPROXIMATE&review=needs_review&country=ae,fr&placeId=abc"),
    );
    expect(state).toEqual({
      q: "nobu",
      themes: ["Voyages", "Restaurant"],
      categories: ["cafe", "restaurant"],
      precisions: ["EXACT", "APPROXIMATE"],
      reviews: ["needs_review"],
      countryCodes: ["AE", "FR"],
      placeId: "abc",
      view: "map",
    });
  });

  it("normalizes accented and lower-case themes and drops unknown values", () => {
    const state = parsePlacesUrlState(
      new URLSearchParams("theme=voyages,Cuisine&categories=cafe,brunch&precision=exact,NOPE&review=bogus&country=zzz,FR"),
    );
    expect(state.themes).toEqual(["Voyages"]);
    expect(state.categories).toEqual(["cafe"]); // "brunch" is not a group key
    expect(state.precisions).toEqual(["EXACT"]);
    expect(state.reviews).toEqual([]);
    expect(state.countryCodes).toEqual(["FR"]);
  });

  it("returns an empty state for an empty query string", () => {
    expect(parsePlacesUrlState(new URLSearchParams())).toEqual({ ...EMPTY_FILTERS, placeId: null, view: "map" });
  });

  it("serializes only the non-empty parts and round-trips", () => {
    expect(serializePlacesUrlState({ ...EMPTY_FILTERS, placeId: null, view: "map" })).toBe("");
    const state = {
      q: "rome",
      themes: ["Voyages" as const],
      categories: ["cafe" as const],
      precisions: ["PROBABLE" as const],
      reviews: ["confirmed" as const],
      countryCodes: ["IT"],
      placeId: "xyz",
      view: "globe" as const,
    };
    const serialized = serializePlacesUrlState(state);
    // The view is no longer written back — there is one continuous view — so a
    // round-trip returns the default rather than what was passed in.
    // Checked as a parameter, not a substring: "review=confirmed" contains "view=".
    expect(new URLSearchParams(serialized).has("view")).toBe(false);
    expect(parsePlacesUrlState(new URLSearchParams(serialized))).toEqual({ ...state, view: "map" });
  });

  it("counts active filters including the search term", () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
    expect(
      countActiveFilters({ ...EMPTY_FILTERS, q: "a", themes: ["Voyages"], categories: ["cafe", "bar"] }),
    ).toBe(4);
  });

  it("toggles a value in and out of a list", () => {
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  });
});

// Phase I — the view mode is additive: it must never change how a Phase G URL
// resolves, and anything unexpected must degrade to the 2D map rather than
// rendering an unknown view.
describe("places view mode", () => {
  it("resolves only the two supported modes and degrades everything else to the map", () => {
    const cases: [string | null | undefined, string][] = [
      ["map", "map"], ["globe", "globe"], ["  GLOBE ", "globe"], ["Map", "map"],
      [null, "map"], [undefined, "map"], ["", "map"], ["   ", "map"],
      ["3d", "map"], ["cesium", "map"], ["globe,map", "map"],
    ];
    for (const [input, expected] of cases) {
      expect(parseViewMode(input), `view=${String(input)}`).toBe(expected);
    }
    expect(parsePlacesUrlState(new URLSearchParams("view=globe")).view).toBe("globe");
    expect(parsePlacesUrlState(new URLSearchParams("view=hologram")).view).toBe("map");
  });

  it("leaves every URL written before Phase I on the 2D map, byte for byte", () => {
    for (const query of ["", "q=rome", "theme=Voyages&categories=cafe", "precision=EXACT&review=confirmed&country=FR", "placeId=abc"]) {
      expect(parsePlacesUrlState(new URLSearchParams(query)).view, query).toBe("map");
    }
    // A 2D URL must not gain a redundant parameter on the first interaction.
    expect(
      serializePlacesUrlState({ ...EMPTY_FILTERS, q: "rome", themes: ["Voyages"], placeId: "abc", view: "map" }),
    ).toBe("q=rome&theme=Voyages&placeId=abc");
  });

  // The parameter outlived the feature: links shared while the 2D/3D switch
  // existed must still open, and must no longer carry a distinction the UI does
  // not make.
  it("still parses an old view deep link and stops writing it back", () => {
    expect(parsePlacesUrlState(new URLSearchParams("view=globe")).view).toBe("globe");
    expect(parsePlacesUrlState(new URLSearchParams("view=bogus")).view).toBe("map");

    const base = { ...EMPTY_FILTERS, placeId: null };
    expect(serializePlacesUrlState({ ...base, view: "map" })).toBe("");
    expect(serializePlacesUrlState({ ...base, view: "globe" })).toBe("");

    const state = { ...base, q: "santorin", placeId: "place-1", view: "globe" as const };
    const serialized = serializePlacesUrlState(state);
    expect(serialized).toBe("q=santorin&placeId=place-1");
    expect(parsePlacesUrlState(new URLSearchParams(serialized)).view).toBe("map");
  });
});

describe("places filtering", () => {
  const nobu = place();
  const cafe = place({ id: "p2", displayName: "Bar San Calisto", categoryGroup: "cafe", category: "catering.cafe", city: "Rome", country: "Italie", countryCode: "IT", precision: "PROBABLE", sourceThemes: ["Voyages"] });
  const zone = place({ id: "p3", displayName: "Caldeira de Santorin", categoryGroup: "plage", category: "beach", city: "Oia", country: "Grèce", countryCode: "GR", precision: "APPROXIMATE", approximationRadiusMeters: 5000, sourceThemes: ["Voyages"], reviewStatus: "CONFLICT" });
  const confirmed = place({ id: "p4", displayName: "Tsukiji", categoryGroup: "patisserie", category: "catering.bakery", city: "Tokyo", country: "Japon", countryCode: "JP", reviewStatus: "CONFIRMED", isUserConfirmed: true, sourceThemes: ["Restaurant"] });
  const all = [nobu, cafe, zone, confirmed];

  const withFilters = (overrides: Partial<PlacesFilters>) => filterPlaces(all, { ...EMPTY_FILTERS, ...overrides });

  it("returns everything when no filter is active", () => {
    expect(withFilters({})).toHaveLength(4);
  });

  it("searches name, city and country without accents or case", () => {
    expect(withFilters({ q: "santorin" }).map((p) => p.id)).toEqual(["p3"]);
    expect(withFilters({ q: "GRECE" }).map((p) => p.id)).toEqual(["p3"]);
    expect(withFilters({ q: "tokyo" }).map((p) => p.id)).toEqual(["p4"]);
  });

  it("filters by source theme", () => {
    expect(withFilters({ themes: ["Restaurant"] }).map((p) => p.id).sort()).toEqual(["p1", "p4"]);
  });

  it("filters by several place types at once", () => {
    expect(withFilters({ categories: ["cafe", "plage"] }).map((p) => p.id).sort()).toEqual(["p2", "p3"]);
  });

  it("filters by precision", () => {
    expect(withFilters({ precisions: ["APPROXIMATE"] }).map((p) => p.id)).toEqual(["p3"]);
  });

  it("separates places needing review from confirmed ones", () => {
    expect(withFilters({ reviews: ["confirmed"] }).map((p) => p.id)).toEqual(["p4"]);
    expect(withFilters({ reviews: ["needs_review"] }).map((p) => p.id).sort()).toEqual(["p1", "p2", "p3"]);
  });

  it("filters by country", () => {
    expect(withFilters({ countryCodes: ["IT"] }).map((p) => p.id)).toEqual(["p2"]);
  });

  it("combines filters with AND across groups", () => {
    expect(withFilters({ themes: ["Voyages"], precisions: ["PROBABLE"] }).map((p) => p.id)).toEqual(["p2"]);
    expect(withFilters({ themes: ["Voyages"], categories: ["patisserie"] })).toHaveLength(0);
  });

  it("keeps rejected places off the map and list", () => {
    expect(isMappable(place({ reviewStatus: "REJECTED" }))).toBe(false);
    expect(isMappable(place({ precision: "APPROXIMATE" }))).toBe(true);
    expect(isMappable(nobu)).toBe(true);
  });
});

describe("country facets", () => {
  // More than twelve countries: the filter used to slice the list to 12, which
  // made the remaining ones impossible to select.
  const many = [
    ["FR", "France"], ["IT", "Italie"], ["JP", "Japon"], ["GR", "Grèce"],
    ["AE", "Émirats arabes unis"], ["ES", "Espagne"], ["PT", "Portugal"], ["US", "États-Unis"],
    ["MX", "Mexique"], ["TH", "Thaïlande"], ["VN", "Viêt Nam"], ["MA", "Maroc"],
    ["TR", "Turquie"], ["IS", "Islande"], ["NO", "Norvège"],
  ].map(([code, country], index) =>
    place({ id: `c${index}`, countryCode: code, country, displayName: `Lieu ${index}` }),
  );

  it("exposes every country present, not just the first twelve", () => {
    const countries = collectCountries(many);
    expect(countries).toHaveLength(15);
    expect(countries.map((entry) => entry.code)).toContain("NO");
    expect(countries.map((entry) => entry.code)).toContain("IS");
  });

  it("counts places per country and sorts the most represented first", () => {
    const countries = collectCountries([
      ...many,
      place({ id: "extra-1", countryCode: "NO", country: "Norvège" }),
      place({ id: "extra-2", countryCode: "NO", country: "Norvège" }),
    ]);
    expect(countries[0]).toMatchObject({ code: "NO", count: 3 });
  });

  it("ignores places without a country code", () => {
    expect(collectCountries([place({ countryCode: null, country: null })])).toEqual([]);
  });

  it("narrows the list locally without accents or case", () => {
    const countries = collectCountries(many);
    expect(narrowCountries(countries, "norv", []).map((entry) => entry.code)).toEqual(["NO"]);
    expect(narrowCountries(countries, "GRECE", []).map((entry) => entry.code)).toEqual(["GR"]);
    expect(narrowCountries(countries, "jp", []).map((entry) => entry.code)).toEqual(["JP"]);
  });

  it("returns the whole list when the query is empty", () => {
    const countries = collectCountries(many);
    expect(narrowCountries(countries, "   ", [])).toHaveLength(15);
  });

  it("always keeps a selected country visible so it can be unselected", () => {
    const countries = collectCountries(many);
    const narrowed = narrowCountries(countries, "norv", ["JP"]);
    expect(narrowed.map((entry) => entry.code).sort()).toEqual(["JP", "NO"]);
  });

  it("returns nothing when no country matches", () => {
    expect(narrowCountries(collectCountries(many), "zzzz", [])).toEqual([]);
  });
});
