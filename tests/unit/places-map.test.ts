// Protects map precision, geographic area rendering and safe camera framing.
import { describe, expect, it } from "vitest";

import type { PlacesMapItem } from "@/server/places/map-view";
import { buildMapStyle, buildPlacesGeoJson } from "@/features/places/components/places-map";
import { buildPlacesAreasGeoJson, buildPlacesAreaOutlinesGeoJson, formatApproximationRadius, placeViewportBounds } from "@/features/places/map-areas";

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

  it("renders uncertainty as bounded geographic areas, including the date line, poles and world-scale radii", () => {
    const areas = [
      place({ id: "street", longitude: 2, latitude: 48, precision: "APPROXIMATE", approximationRadiusMeters: 250 }),
      place({ id: "date-line", longitude: 179.9, latitude: 0, precision: "APPROXIMATE", approximationRadiusMeters: 50_000 }),
      place({ id: "north", longitude: 30, latitude: 85, precision: "APPROXIMATE", approximationRadiusMeters: 2_000_000 }),
      place({ id: "world", longitude: -70, latitude: -20, precision: "APPROXIMATE", approximationRadiusMeters: Math.PI * 6_371_000 }),
    ];
    const data = buildPlacesAreasGeoJson([...areas, place()], "street");
    expect(data.features).toHaveLength(4);
    expect(data.features[0].properties).toMatchObject({ id: "street", selected: true });
    for (const feature of data.features) {
      const coordinates = feature.geometry.coordinates;
      expect(coordinates.flat(2).length).toBeLessThan(300);
      for (const [ring] of coordinates) {
        expect(ring[0]).toEqual(ring.at(-1));
        expect(ring.length).toBeGreaterThanOrEqual(4);
        for (const [index, [longitude, latitude]] of ring.entries()) {
          expect(Number.isFinite(longitude) && Math.abs(longitude) <= 180).toBe(true);
          expect(Number.isFinite(latitude) && Math.abs(latitude) <= 90).toBe(true);
          if (index) expect(Math.abs(longitude - ring[index - 1][0])).toBeLessThanOrEqual(90.00001);
        }
      }
    }
    const local = data.features[0].geometry.coordinates.flat(2);
    const latitudes = local.map(point => point[1]);
    expect((Math.max(...latitudes) - Math.min(...latitudes)) * Math.PI / 180 * 6_371_000).toBeCloseTo(500, 3);
    const wrapped = data.features[1].geometry.coordinates.flat(2).map(point => point[0]);
    expect(wrapped.some(longitude => longitude > 179)).toBe(true);
    expect(wrapped.some(longitude => longitude < -179)).toBe(true);
    const world = data.features[3].geometry.coordinates.flat(2);
    expect(Math.min(...world.map(point => point[0]))).toBe(-180);
    expect(Math.max(...world.map(point => point[0]))).toBe(180);
    expect(Math.min(...world.map(point => point[1]))).toBe(-90);
    expect(Math.max(...world.map(point => point[1]))).toBe(90);
  });

  it("frames the uncertainty radius instead of a street pin and labels small radii in metres", () => {
    const bounds = placeViewportBounds(place({ longitude: 179.9, latitude: 0, precision: "APPROXIMATE", approximationRadiusMeters: 50_000 }));
    expect(bounds[0][0]).toBeLessThan(179.9);
    expect(bounds[1][0]).toBeGreaterThan(180);
    expect(bounds[1][0] - bounds[0][0]).toBeLessThan(1);
    expect(bounds[1][1] - bounds[0][1]).toBeGreaterThan(0.8);
    for (const latitude of [-89.999, 89.999]) {
      const polar = placeViewportBounds(place({ latitude, precision: "APPROXIMATE", approximationRadiusMeters: 50 }));
      expect(polar[0][1]).toBeLessThanOrEqual(polar[1][1]);
      expect(polar.flat().every(value => Number.isFinite(value))).toBe(true);
    }
    expect([250, 1000, 1500, 20_000].map(formatApproximationRadius)).toEqual(["Zone approximative · rayon ~250 m", "Zone approximative · rayon ~1 km", "Zone approximative · rayon ~1,5 km", "Zone approximative · rayon ~20 km"]);
    expect(buildPlacesAreasGeoJson([place({ precision: "APPROXIMATE", approximationRadiusMeters: null })], null).features).toEqual([]);
  });

  it("draws only true circular boundaries without date-line or world-wide clipping seams", () => {
    const data = buildPlacesAreaOutlinesGeoJson([
      place({ id: "local", longitude: 179.9, latitude: 0, precision: "APPROXIMATE", approximationRadiusMeters: 50_000 }),
      place({ id: "global", precision: "APPROXIMATE", approximationRadiusMeters: Math.PI * 6_371_000 }),
    ], null);
    expect(data.features.map(feature => feature.properties.id)).toEqual(["local"]);
    const lines = data.features[0].geometry.coordinates;
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.flat().length).toBeLessThan(150);
    for (const line of lines) for (let index = 1; index < line.length; index += 1) {
      expect(Math.abs(line[index][0] - line[index - 1][0])).toBeLessThan(2);
    }
  });

});
