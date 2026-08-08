import { foldForSearch } from "@/lib/import/normalize";
import { parseCategoryGroups, type PlaceCategoryGroupKey } from "@/lib/places/categories";
import { canonicalPlacesTheme, type PlacesEligibleTheme } from "@/lib/places/eligibility";
import type { PlacePrecisionDto } from "@/contracts/api/places";
import type { PlacesMapItem } from "@/server/places/map-view";

// Pure filter state for the Places page: parsed from the URL, serialized back to
// it, and applied in the browser over the full owner-scoped set (the owner capped
// Places at ~1000 canonical places, so filtering never needs a round trip).
// Keeping this module free of React and MapLibre makes every rule directly
// testable and keeps deep links, history and rendering consistent.

export const PLACE_PRECISION_VALUES = ["EXACT", "PROBABLE", "APPROXIMATE"] as const;
export const REVIEW_FILTERS = ["needs_review", "confirmed"] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

// Phase I put a renderer choice in the URL because 2D and 3D were two different
// scenes. MapLibre's `globe` projection already turns into Mercator as the user
// zooms in, so there is one continuous view and nothing left to choose. The
// parameter is kept parseable so links written before this change still open —
// it is read, ignored, and dropped from the URL rather than 404ing a shared link.
export const PLACES_VIEW_MODES = ["map", "globe"] as const;
export type PlacesViewMode = (typeof PLACES_VIEW_MODES)[number];
export const DEFAULT_PLACES_VIEW: PlacesViewMode = "map";

export function parseViewMode(value: string | null | undefined): PlacesViewMode {
  const normalized = value?.trim().toLowerCase();
  return (PLACES_VIEW_MODES as readonly string[]).includes(normalized ?? "")
    ? (normalized as PlacesViewMode)
    : DEFAULT_PLACES_VIEW;
}

export type PlacesFilters = {
  q: string;
  themes: PlacesEligibleTheme[];
  categories: PlaceCategoryGroupKey[];
  precisions: PlacePrecisionDto[];
  reviews: ReviewFilter[];
  countryCodes: string[];
};

export type PlacesUrlState = PlacesFilters & {
  placeId: string | null;
  view: PlacesViewMode;
};

export const EMPTY_FILTERS: PlacesFilters = {
  q: "",
  themes: [],
  categories: [],
  precisions: [],
  reviews: [],
  countryCodes: [],
};

function splitList(value: string | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
  }
  return out;
}

export function parsePlacesUrlState(params: URLSearchParams): PlacesUrlState {
  const themes: PlacesEligibleTheme[] = [];
  for (const raw of splitList(params.get("theme"))) {
    const theme = canonicalPlacesTheme(raw);
    if (theme && !themes.includes(theme)) themes.push(theme);
  }

  const precisions = splitList(params.get("precision"))
    .map((value) => value.toUpperCase())
    .filter((value): value is PlacePrecisionDto =>
      (PLACE_PRECISION_VALUES as readonly string[]).includes(value),
    );

  const reviews = splitList(params.get("review"))
    .map((value) => value.toLowerCase())
    .filter((value): value is ReviewFilter => (REVIEW_FILTERS as readonly string[]).includes(value));

  const countryCodes = splitList(params.get("country"))
    .map((value) => value.toUpperCase())
    .filter((value) => /^[A-Z]{2}$/.test(value));

  return {
    q: (params.get("q") ?? "").trim(),
    themes,
    categories: parseCategoryGroups(params.get("categories")),
    precisions,
    reviews,
    countryCodes,
    placeId: params.get("placeId")?.trim() || null,
    view: parseViewMode(params.get("view")),
  };
}

// Serialize back to a query string. Empty values are omitted so a default page
// keeps a clean URL and the browser history stays meaningful.
export function serializePlacesUrlState(state: PlacesUrlState): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.themes.length > 0) params.set("theme", state.themes.join(","));
  if (state.categories.length > 0) params.set("categories", state.categories.join(","));
  if (state.precisions.length > 0) params.set("precision", state.precisions.join(","));
  if (state.reviews.length > 0) params.set("review", state.reviews.join(","));
  if (state.countryCodes.length > 0) params.set("country", state.countryCodes.join(","));
  if (state.placeId) params.set("placeId", state.placeId);
  // The view parameter is never written back: there is a single continuous view,
  // so carrying it would only preserve a distinction the UI no longer makes.
  return params.toString();
}

export function countActiveFilters(filters: PlacesFilters): number {
  return (
    (filters.q ? 1 : 0) +
    filters.themes.length +
    filters.categories.length +
    filters.precisions.length +
    filters.reviews.length +
    filters.countryCodes.length
  );
}

export function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function matchesSearch(place: PlacesMapItem, folded: string): boolean {
  if (!folded) return true;
  const haystack = foldForSearch(
    [place.displayName, place.city, place.region, place.country].filter(Boolean).join(" "),
  );
  return haystack.includes(folded);
}

// A place is "needs review" when it is unreviewed or in conflict and the user has
// not confirmed it; "confirmed" mirrors the durable user decision.
function matchesReview(place: PlacesMapItem, reviews: readonly ReviewFilter[]): boolean {
  if (reviews.length === 0) return true;
  return reviews.some((filter) =>
    filter === "confirmed"
      ? place.isUserConfirmed || place.reviewStatus === "CONFIRMED"
      : !place.isUserConfirmed && (place.reviewStatus === "UNREVIEWED" || place.reviewStatus === "CONFLICT"),
  );
}

export function filterPlaces(places: readonly PlacesMapItem[], filters: PlacesFilters): PlacesMapItem[] {
  const folded = foldForSearch(filters.q.trim());
  return places.filter((place) => {
    if (!matchesSearch(place, folded)) return false;
    if (filters.themes.length > 0 && !filters.themes.some((theme) => place.sourceThemes.includes(theme))) return false;
    if (filters.categories.length > 0 && (!place.categoryGroup || !filters.categories.includes(place.categoryGroup))) {
      return false;
    }
    if (filters.precisions.length > 0 && !filters.precisions.includes(place.precision)) return false;
    if (!matchesReview(place, filters.reviews)) return false;
    if (filters.countryCodes.length > 0 && (!place.countryCode || !filters.countryCodes.includes(place.countryCode))) {
      return false;
    }
    return true;
  });
}

// Rejected places stay out of the map and list. Approximate results remain
// available to the review/list UI and are filtered only at renderer boundaries.
export function isMappable(place: PlacesMapItem): boolean {
  return place.reviewStatus !== "REJECTED";
}

export type CountryFacet = { code: string; label: string; count: number };

// Countries actually present in the data, most represented first. The filter can
// therefore never offer a country that would return nothing.
export function collectCountries(places: readonly PlacesMapItem[]): CountryFacet[] {
  const byCode = new Map<string, CountryFacet>();
  for (const place of places) {
    if (!place.countryCode) continue;
    const entry = byCode.get(place.countryCode);
    if (entry) entry.count += 1;
    else byCode.set(place.countryCode, { code: place.countryCode, label: place.country ?? place.countryCode, count: 1 });
  }
  return [...byCode.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// Narrow the country list locally. Every country stays reachable — the list is
// never truncated — and an already selected country is always kept visible so a
// filter can still be removed while the search is active.
export function narrowCountries(
  countries: readonly CountryFacet[],
  query: string,
  selectedCodes: readonly string[],
): CountryFacet[] {
  const folded = foldForSearch(query.trim());
  if (!folded) return [...countries];
  return countries.filter(
    (country) =>
      selectedCodes.includes(country.code) ||
      foldForSearch(country.label).includes(folded) ||
      country.code.toLowerCase().includes(folded),
  );
}
