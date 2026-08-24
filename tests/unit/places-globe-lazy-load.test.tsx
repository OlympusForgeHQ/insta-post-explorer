import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlacesStatsDto } from "@/contracts/api/places";
import type { WebGlState } from "@/features/places/capabilities";
import type { PlacesMapItem } from "@/server/places/map-view";

// FR-I-12 proof: the shared MapLibre renderer must never be requested before WebGL2 is proven.
const state = vi.hoisted(() => ({ mapImported: false, webgl: "unknown" as WebGlState }));

vi.mock("@/features/places/components/places-map", () => {
  return {
    default: () => {
      state.mapImported = true;
      return <div data-testid="maplibre-canvas" />;
    },
  };
});

// The capability is driven directly so the four states can be reproduced
// exactly, including "unknown", which is what the server render and the
// hydration pass see before the client has answered.
vi.mock("@/features/places/capabilities", () => ({
  useWebGlSupport: () => state.webgl,
  usePrefersReducedMotion: () => false,
  resetWebGlSupportCache: () => {},
}));

vi.mock("@/features/places/actions", () => ({
  loadPlacePostsAction: vi.fn(async () => ({ ok: true, posts: [] })),
  confirmPlaceAction: vi.fn(async () => ({ ok: true })),
  rejectPlaceAction: vi.fn(async () => ({ ok: true })),
}));

// next/dynamic → React.lazy: the loader runs when the component renders, which
// is exactly the moment the real chunk would be fetched.
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
      const Lazy = React.lazy(loader);
      return function Dynamic(props: Record<string, unknown>) {
        return (
          <React.Suspense fallback={null}>
            <Lazy {...props} />
          </React.Suspense>
        );
      };
    },
  };
});

const { PlacesExplorer } = await import("@/features/places/components/places-explorer");

const STATS: PlacesStatsDto = {
  totals: { eligiblePosts: 0, identifiedPlaces: 0, countries: 0, continents: 0, postsWithPlaces: 0, needsReview: 0 },
  byTheme: [],
  byCountry: [],
  byContinent: [],
  byPrecision: [],
  byReviewStatus: [],
};

const PLACES: PlacesMapItem[] = [
  {
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
  },
];

function renderExplorer(view: "map" | "globe") {
  return render(
    <PlacesExplorer
      places={PLACES}
      stats={STATS}
      initialState={{
        q: "rome",
        themes: [],
        categories: [],
        precisions: [],
        reviews: [],
        countryCodes: [],
        placeId: "p1",
        view,
      }}
      truncated={false}
      isAdmin={false}
      tileUrl="https://tiles.example/{z}/{x}/{y}.png"
      tileAttribution="© tiles"
      tilesConfigured
      textureUrl="/places/earth-dark.png"
      textureAttribution="Fond de carte : Natural Earth (domaine public)"
    />,
  );
}

beforeEach(() => {
  state.mapImported = false;
  window.history.replaceState(null, "", "/places");
});

afterEach(cleanup);

describe("3D engine is never imported without a proven WebGL capability", () => {
  it.each([
    { name: "WebGL available", view: "map" as const, webgl: "supported" as WebGlState, expectMap: true },
    // Server render and hydration pass: nothing is known yet.
    { name: "probe still unknown", view: "map" as const, webgl: "unknown" as WebGlState, expectMap: false },
    { name: "WebGL unsupported", view: "map" as const, webgl: "unsupported" as WebGlState, expectMap: false },
    { name: "probe failed", view: "map" as const, webgl: "failed" as WebGlState, expectMap: false },
  ])("$name", async ({ view, webgl, expectMap }) => {
    state.webgl = webgl;
    renderExplorer(view);

    if (expectMap) {
      await waitFor(() => expect(screen.getByTestId("maplibre-canvas")).toBeDefined());
    } else if (webgl === "unknown") {
      // Unknown shows a waiting state, not the map: the deep link is still
      // legitimate and must not be downgraded before the answer arrives.
      await waitFor(() => expect(screen.getByTestId("places-globe-probing")).toBeDefined());
      expect(screen.queryByTestId("maplibre-canvas")).toBeNull();
    } else {
      await waitFor(() => expect(screen.getByTestId("places-map-unavailable")).toBeDefined());
      expect(screen.queryByTestId("maplibre-canvas")).toBeNull();
    }

    if (!expectMap) expect(state.mapImported).toBe(false);
    // Whatever the state, the rest of the page stays usable.
    expect(screen.getByRole("searchbox", { name: "Rechercher un lieu" })).toBeDefined();
  });
});
