import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlacesStatsDto } from "@/contracts/api/places";
import type { WebGlState } from "@/features/places/capabilities";
import type { PlacesMapItem } from "@/server/places/map-view";
import { clearRecentSearches, readRecentSearches } from "@/lib/recent-searches";

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

function renderExplorer(view: "map" | "globe", { places = PLACES, q = "rome", placeId = "p1", truncated = false }: {
  places?: PlacesMapItem[]; q?: string; placeId?: string | null; truncated?: boolean;
} = {}) {
  return render(
    <PlacesExplorer
      places={places}
      stats={STATS}
      initialState={{
        q,
        themes: [],
        categories: [],
        precisions: [],
        reviews: [],
        countryCodes: [],
        placeId,
        view,
      }}
      truncated={truncated}
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

const ZONES: PlacesMapItem[] = [
  { ...PLACES[0], id: "japan-a", displayName: "Voyage au Japon", city: null, country: "Japon", countryCode: "JP", precision: "APPROXIMATE", approximationRadiusMeters: 150_000, latitude: 35, longitude: 135 },
  { ...PLACES[0], id: "japan-b", displayName: "Autre voyage au Japon", city: null, country: "Japon", countryCode: "JP", precision: "APPROXIMATE", approximationRadiusMeters: 150_000, latitude: 35, longitude: 135 },
  { ...PLACES[0], id: "italy", displayName: "Voyage en Italie", city: null, country: "Italie", countryCode: "IT", precision: "APPROXIMATE", approximationRadiusMeters: 200_000, latitude: 43, longitude: 12 },
];

it("opens every filtered zone in the shared drawer and restores the list without changing filters", async () => {
  state.webgl = "unsupported";
  renderExplorer("map", { places: [...PLACES, ...ZONES], q: "", placeId: null, truncated: true });
  const zonesButton = screen.getByRole("button", { name: "Zones approximatives (3)" });
  const input = screen.getByRole("combobox", { name: "Rechercher un lieu" });
  expect(zonesButton).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(zonesButton);
  let drawer = screen.getByRole("complementary", { name: "Zones approximatives" });
  expect(zonesButton).toHaveAttribute("aria-controls", drawer.id);
  expect(zonesButton).toHaveAttribute("aria-expanded", "true");
  expect(within(drawer).getByRole("heading")).toHaveFocus();
  expect(within(drawer).getAllByRole("button").length).toBe(4);
  expect(within(drawer).queryByRole("button", { name: /Nobu Dubai/ })).not.toBeInTheDocument();
  expect(within(drawer).getByText(/1 000 lieux les plus récents/)).toBeVisible();
  expect(input).toHaveValue("");

  const list = within(drawer).getByRole("list");
  list.scrollTop = 140;
  fireEvent.scroll(list);
  fireEvent.click(within(drawer).getByRole("button", { name: /^Voyage au Japon/ }));
  expect(screen.queryByRole("complementary", { name: "Zones approximatives" })).not.toBeInTheDocument();
  const detail = await screen.findByRole("dialog", { name: "Détail de Voyage au Japon" });
  expect(detail).toHaveFocus();
  fireEvent.keyDown(detail, { key: "Escape" });
  expect(zonesButton).toHaveFocus();
  fireEvent.click(zonesButton);
  drawer = screen.getByRole("complementary", { name: "Zones approximatives" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(within(drawer).getByRole("list").scrollTop).toBe(140);
  fireEvent.keyDown(drawer, { key: "Escape" });
  expect(zonesButton).toHaveFocus();

  fireEvent.click(screen.getByRole("button", { name: "Liste" }));
  expect(within(screen.getByRole("complementary", { name: "Liste des lieux" })).getByRole("button", { name: /Nobu Dubai/ })).toBeVisible();
  fireEvent.click(zonesButton);
  fireEvent.change(input, { target: { value: "Japon" } });
  expect(screen.getByRole("button", { name: "Zones approximatives (2)" })).toHaveAttribute("aria-expanded", "true");
  drawer = screen.getByRole("complementary", { name: "Zones approximatives" });
  expect(within(drawer).queryByRole("button", { name: /Italie/ })).not.toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole("button", { name: /^Autre voyage au Japon/ }));
  await screen.findByRole("dialog", { name: "Détail de Autre voyage au Japon" });
  fireEvent.change(input, { target: { value: "Italie" } });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get("placeId")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Zones approximatives (1)" }));
  drawer = screen.getByRole("complementary", { name: "Zones approximatives" });
  expect(within(drawer).getByRole("button", { name: /^Voyage en Italie/ })).toBeVisible();
  expect(input).toHaveValue("Italie");
});

it("preserves valid initial and restored place links while applying their filters", async () => {
  state.webgl = "unsupported";
  renderExplorer("map", { places: ZONES, q: "Japon", placeId: "japan-a" });
  const detail = await screen.findByRole("dialog", { name: "Détail de Voyage au Japon" });
  expect(detail).toBeVisible();
  fireEvent.keyDown(detail, { key: "Escape" });
  expect(screen.getByRole("button", { name: "Liste" })).toHaveFocus();
  window.history.replaceState(null, "", "/places?q=Italie&placeId=italy");
  fireEvent.popState(window);
  expect(await screen.findByRole("dialog", { name: "Détail de Voyage en Italie" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Rechercher un lieu" })).toHaveValue("Italie");
  expect(new URLSearchParams(window.location.search).get("placeId")).toBe("italy");
});

it("keeps map selection and the list, filters and statistics mutually exclusive", async () => {
  state.webgl = "unsupported";
  renderExplorer("map", { places: ZONES, q: "", placeId: null });
  for (const label of ["Zones approximatives (3)", "Filtres", "Statistiques"]) {
    const control = screen.getByRole("button", { name: label });
    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: /^Sélectionner Voyage au Japon/ }));
    expect(control).toHaveAttribute("aria-expanded", "false");
    expect(await screen.findByRole("dialog", { name: "Détail de Voyage au Japon" })).toBeVisible();
    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("dialog", { name: "Détail de Voyage au Japon" })).not.toBeInTheDocument();
  }
});

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
    expect(screen.getByRole("combobox", { name: "Rechercher un lieu" })).toBeDefined();
  });
});

it("keeps typed Places queries and their history current before deferred renders finish", () => {
  state.webgl = "unsupported";
  clearRecentSearches("places");
  renderExplorer("map");
  const input = screen.getByRole("combobox", { name: "Rechercher un lieu" });
  act(() => input.focus());

  act(() => {
    for (const term of ["Paris", "Rome", "Tokyo", "Lyon", "Lille", "Bruxelles"]) {
      // Flush each discrete input event, keeping concurrent transitions pending.
      flushSync(() => { fireEvent.change(input, { target: { value: term } }); });
      expect(input).toHaveValue(term);
      flushSync(() => { fireEvent.keyDown(input, { key: "Enter" }); });
    }
  });
  expect(readRecentSearches("places")).toEqual(["Bruxelles", "Lille", "Lyon", "Tokyo", "Rome"]);

  act(() => {
    flushSync(() => { fireEvent.change(input, { target: { value: "Liège" } }); });
    flushSync(() => { fireEvent.change(input, { target: { value: "" } }); });
    expect(input).toHaveValue("");
  });
  expect(readRecentSearches("places")[0]).toBe("Liège");
  act(() => {
    flushSync(() => { fireEvent.change(input, { target: { value: "Dubai" } }); });
    flushSync(() => { fireEvent.blur(input); });
  });
  expect(readRecentSearches("places")[0]).toBe("Dubai");
  expect(document.querySelector(".places-summary-count")).toHaveTextContent("1 lieu");
  expect(new URLSearchParams(window.location.search).get("q")).toBe("Dubai");
});
