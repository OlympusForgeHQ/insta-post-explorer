// Required to protect the MapLibre style/GeoJSON contracts and REQ-001 points-only regression.
import { describe, expect, it } from "vitest";

import type { PlacesMapItem } from "@/server/places/map-view";
import { buildMapStyle, buildPlacesGeoJson } from "@/features/places/components/places-map";

function place(overrides: Partial<PlacesMapItem> = {}): PlacesMapItem {
  return {
    id: "place-1",
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
    postCount: 2,
    sourceThemes: ["Restaurant"],
    previewThumbnailUrl: null,
    ...overrides,
  };
}

describe("MapLibre Places data", () => {
  it("builds a raster style with the configured attribution", () => {
    const style = buildMapStyle("https://tiles.example/{z}/{x}/{y}.png", "© tiles");

    expect(style.sources.placesRaster).toEqual({
      type: "raster",
      tiles: ["https://tiles.example/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© tiles",
    });
    expect(style.layers.map((layer) => layer.id)).toContain("places-raster");
    // One continuous projection: `globe` is a sphere zoomed out and becomes
    // Mercator as the user zooms in, so the style never declares mercator.
    expect(style.projection).toEqual({ type: "globe" });
  });

  it("falls back to the local Earth image only when no tile provider is configured", () => {
    const style = buildMapStyle("", "", { textureUrl: "/places/earth-dark.png" });

    expect(style.sources.placesEarth).toMatchObject({
      type: "image",
      url: "/places/earth-dark.png",
      coordinates: [
        [-180, 85.051129],
        [180, 85.051129],
        [180, -85.051129],
        [-180, -85.051129],
      ],
    });
    expect(style.layers.map((layer) => layer.id)).toEqual(["places-earth"]);
    expect(style.projection).toEqual({ type: "globe" });
  });

  it("prefers provider tiles over the local texture, with no visibility switching left", () => {
    const style = buildMapStyle("https://tiles.example/{z}/{x}/{y}.png", "© tiles", {
      textureUrl: "/places/earth-dark.png",
    });

    // The texture existed to give the globe a base without a provider. With one
    // configured, the tiles wrap onto the sphere themselves and the texture would
    // only be a lower-resolution duplicate.
    expect(style.sources.placesEarth).toBeUndefined();
    expect(style.layers.map((layer) => layer.id)).toEqual(["places-raster"]);
    expect(style.layers.every((layer) => layer.layout?.visibility === undefined)).toBe(true);
  });

  it("serializes pins with stable ids, icons, precision colors and selection", () => {
    const data = buildPlacesGeoJson([place(), place({ id: "place-2", precision: "APPROXIMATE", categoryGroup: null })], "place-2");

    expect(data.features).toHaveLength(1);
    expect(data.features[0]).toMatchObject({
      geometry: { type: "Point", coordinates: [55.1, 25.1] },
      properties: { id: "place-1", iconImage: "places-icon-restaurant", color: "#16794b", selected: false },
    });
    expect(data.features.find((feature) => feature.properties.id === "place-2")).toBeUndefined();
  });

});
