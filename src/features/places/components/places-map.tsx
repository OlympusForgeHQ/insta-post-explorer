"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeatureCollection, Point } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, StyleSpecification } from "maplibre-gl";

import { PLACE_CATEGORY_GROUPS } from "@/lib/places/categories";
import type { PlacesRendererProps } from "@/features/places/renderer-contract";
import type { PlacesMapItem } from "@/server/places/map-view";

// MapLibre is loaded lazily on the client only. Everything engine-specific stays
// in this component; the rest of Places talks to it through the shared renderer
// contract. Raster tiles remain a prop so the public provider configuration stays
// outside the renderer.

export type PlacesMapProps = PlacesRendererProps & {
  tileUrl: string;
  styleUrl?: string;
  tileAttribution: string;
  projection?: PlacesProjection;
  textureUrl?: string;
  textureAttribution?: string;
  reducedMotion?: boolean;
};

export type PlacesProjection = "mercator" | "globe";

// Served from public/maplibre, kept in sync with the installed maplibre-gl by
// scripts/places/sync-maplibre-worker.mjs so the vendored copy cannot drift.
export const PLACES_MAPLIBRE_WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";

const RASTER_SOURCE_ID = "placesRaster";
const RASTER_LAYER_ID = "places-raster";
const EARTH_SOURCE_ID = "placesEarth";
const EARTH_LAYER_ID = "places-earth";
const PLACES_SOURCE_ID = "places";
const CLUSTER_LAYER_ID = "places-clusters";
const CLUSTER_COUNT_LAYER_ID = "places-cluster-count";
const PIN_LAYER_ID = "places-pins";
const PIN_ICON_LAYER_ID = "places-pin-icons";

function isBenchmarkEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_PLACES_BENCHMARK !== "1" || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("places-benchmark") === "1";
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

const PRECISION_COLOR: Record<string, string> = {
  EXACT: "#16794b",
  PROBABLE: "#b7791f",
};

type PlaceProperties = {
  id: string;
  iconImage: string;
  color: string;
  selected: boolean;
};

export type PlacesGeoJson = FeatureCollection<Point, PlaceProperties>;

function iconImageFor(place: PlacesMapItem): string {
  const group = PLACE_CATEGORY_GROUPS.find((candidate) => candidate.key === place.categoryGroup);
  return `places-icon-${group?.key ?? "default"}`;
}

function addPlaceIconImages(map: MapLibreMap): void {
  if (typeof document === "undefined") return;
  const icons = [...PLACE_CATEGORY_GROUPS, { key: "default", icon: "📍" }];
  for (const { key, icon } of icons) {
    const id = `places-icon-${key}`;
    if (map.hasImage(id)) continue;
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) continue;
    context.font = '32px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(icon, 32, 32);
    map.addImage(id, context.getImageData(0, 0, 64, 64), { pixelRatio: 2 });
  }
}

export type PlacesMapStyleOptions = {
  projection?: PlacesProjection;
  textureUrl?: string;
};

export function buildMapStyle(
  tileUrl: string,
  tileAttribution: string,
  { projection = "mercator", textureUrl }: PlacesMapStyleOptions = {},
): StyleSpecification {
  const sources: StyleSpecification["sources"] = {};
  const layers: StyleSpecification["layers"] = [];

  if (tileUrl) {
    sources[RASTER_SOURCE_ID] = {
      type: "raster",
      tiles: [tileUrl],
      tileSize: 256,
      maxzoom: 19,
      attribution: tileAttribution,
    };
    layers.push({
      id: RASTER_LAYER_ID,
      type: "raster",
      source: RASTER_SOURCE_ID,
      layout: { visibility: projection === "mercator" ? "visible" : "none" },
      paint: {
        "raster-saturation": -0.28,
        "raster-contrast": -0.04,
      },
    });
  }

  if (textureUrl) {
    sources[EARTH_SOURCE_ID] = {
      type: "image",
      url: textureUrl,
      coordinates: [
        [-180, 85.051129],
        [180, 85.051129],
        [180, -85.051129],
        [-180, -85.051129],
      ],
    };
    layers.push({
      id: EARTH_LAYER_ID,
      type: "raster",
      source: EARTH_SOURCE_ID,
      layout: { visibility: projection === "globe" ? "visible" : "none" },
      paint: { "raster-opacity": 1 },
    });
  }

  return {
    version: 8,
    projection: { type: projection },
    sources,
    layers,
  };
}

function syncProjection(
  map: MapLibreMap,
  projection: PlacesProjection,
  places: readonly PlacesMapItem[],
  selectedId: string | null,
  reducedMotion: boolean | undefined,
): boolean {
  if (map.getProjection().type === projection) return false;

  map.setRenderWorldCopies(projection !== "globe");
  map.setProjection({ type: projection });
  if (map.getLayer(RASTER_LAYER_ID)) {
    map.setLayoutProperty(RASTER_LAYER_ID, "visibility", projection === "mercator" ? "visible" : "none");
  }
  if (map.getLayer(EARTH_LAYER_ID)) {
    map.setLayoutProperty(EARTH_LAYER_ID, "visibility", projection === "globe" ? "visible" : "none");
  }
  if (projection === "mercator" && places.length > 0) return true;
  const selected = selectedId ? places.find((place) => place.id === selectedId) : null;
  const reduceMotion = reducedMotion ?? prefersReducedMotion();
  map.easeTo({
    center: selected ? [selected.longitude, selected.latitude] : map.getCenter(),
    zoom:
      projection === "globe"
        ? selected
          ? 3.5
          : Math.min(map.getZoom(), 1.15)
        : selected
          ? Math.max(map.getZoom(), 12)
          : Math.max(map.getZoom(), 2),
    duration: reduceMotion || projection !== "globe" ? 0 : 700,
  });
  return true;
}

export function buildPlacesGeoJson(places: readonly PlacesMapItem[], selectedId: string | null): PlacesGeoJson {
  return {
    type: "FeatureCollection",
    features: places.filter((place) => place.precision !== "APPROXIMATE").map((place) => ({
      type: "Feature",
      id: place.id,
      geometry: { type: "Point", coordinates: [place.longitude, place.latitude] },
      properties: {
        id: place.id,
        iconImage: iconImageFor(place),
        color: PRECISION_COLOR[place.precision] ?? "#6f6878",
        selected: place.id === selectedId,
      },
    })),
  };
}

function placeIdFromFeature(feature: { properties?: Record<string, unknown> } | undefined): string | null {
  const id = feature?.properties?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function PlacesMap({
  places,
  selectedId,
  onSelect,
  onHover,
  tileUrl,
  styleUrl,
  tileAttribution,
  projection = "mercator",
  textureUrl,
  textureAttribution,
  reducedMotion,
}: PlacesMapProps) {
  // A configured style document replaces the raster tiles and the local globe
  // texture alike, so the Natural Earth credit must not be shown next to a globe
  // that is no longer drawn from it.
  const vector = Boolean(styleUrl);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const initialProjectionRef = useRef<PlacesProjection>(projection);
  const projectionRef = useRef<PlacesProjection>(projection);
  const lastViewportProjectionRef = useRef<PlacesProjection>(projection);
  const placesRef = useRef<readonly PlacesMapItem[]>(places);
  const selectedIdRef = useRef(selectedId);
  const handlersRef = useRef({ onSelect, onHover });
  const reducedMotionRef = useRef(reducedMotion);
  const hoveredPlaceIdRef = useRef<string | null>(null);
  const renderRef = useRef<() => void>(() => undefined);
  const [mapReadyVersion, setMapReadyVersion] = useState(0);

  useEffect(() => {
    placesRef.current = places;
    selectedIdRef.current = selectedId;
    projectionRef.current = projection;
    handlersRef.current = { onSelect, onHover };
    reducedMotionRef.current = reducedMotion;
  }, [places, selectedId, projection, onSelect, onHover, reducedMotion]);

  const render = useCallback(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const placesSource = map.getSource(PLACES_SOURCE_ID) as GeoJSONSource | undefined;
    placesSource?.setData(buildPlacesGeoJson(places, selectedId));
    if (hoveredPlaceIdRef.current && !places.some((place) => place.id === hoveredPlaceIdRef.current)) {
      hoveredPlaceIdRef.current = null;
      handlersRef.current.onHover(null, null);
    }
  }, [places, selectedId]);

  useEffect(() => {
    renderRef.current = render;
  }, [render]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let mapInstance: MapLibreMap | null = null;
    let benchmarkRenderHandler: (() => void) | null = null;
    const container = containerRef.current;
    if (!container) return;
    (async () => {
      if (mapRef.current) return;
      const maplibre = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;

      // MapLibre 6 ships its worker as a separate ESM file and locates it from
      // `import.meta.url`. Turbopack does not expose an http(s) `import.meta.url`
      // inside the bundled chunk, so MapLibre's own resolver returns an empty
      // string and constructs `new Worker("", { type: "module" })`. That does not
      // throw: the worker loads the HTML document as a module, dies on the parse
      // error, and every GeoJSON source stays unloaded forever — a blank map with
      // no console error. Pointing MapLibre at the copies served from /maplibre
      // keeps the worker alive. See scripts/places/sync-maplibre-worker.mjs.
      if (!maplibre.getWorkerUrl()) maplibre.setWorkerUrl(PLACES_MAPLIBRE_WORKER_URL);

      const initialProjection = initialProjectionRef.current;

      // A style document is handed to MapLibre as a URL so it fetches its own
      // sources, glyphs and sprites. Rotation and tilt are only worth offering on
      // that path: raster labels are baked into the images and smear when tilted,
      // which is why the Phase G map deliberately locked both off.
      const map = new maplibre.Map({
        container: containerRef.current,
        style: vector
          ? styleUrl
          : buildMapStyle(tileUrl, tileAttribution, { projection: initialProjection, textureUrl }),
        center: initialProjection === "globe" ? [0, 20] : [10, 30],
        zoom: initialProjection === "globe" ? 1.15 : 2,
        renderWorldCopies: initialProjection !== "globe",
        dragRotate: vector,
        pitchWithRotate: vector,
        touchPitch: vector,
        touchZoomRotate: true,
        attributionControl: {
          compact: false,
          // Attribution is mandatory and must not depend on what a third-party
          // style happens to declare, so the configured credit is always added.
          // MapLibre de-duplicates an identical string coming from the style.
          customAttribution: tileAttribution,
        },
      });
      // No setProjection here: a style loaded from a URL is still in flight at
      // this point and MapLibre throws "Style is not done loading". The existing
      // syncProjection call at the end of the load handler applies the requested
      // projection once the style is ready, which is the same path a user switch
      // takes.
      mapInstance = map;
      mapRef.current = map;
      benchmarkRenderHandler =
        isBenchmarkEnabled()
          ? () => window.dispatchEvent(new Event("places-map-render"))
          : null;
      if (benchmarkRenderHandler) {
        map.on("render", benchmarkRenderHandler);
        window.dispatchEvent(new CustomEvent("places-map-ready", { detail: map }));
      }
      if (!vector) map.touchZoomRotate.disableRotation();
      // The compass is only useful once the map can actually be rotated; it is
      // also the way back to north, so it ships with rotation or not at all.
      map.addControl(new maplibre.NavigationControl({ showCompass: vector }), "top-left");
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => map.resize());
        resizeObserver.observe(container);
      }

      map.once("load", () => {
        if (cancelled) return;
        map.addSource(PLACES_SOURCE_ID, {
          type: "geojson",
          data: buildPlacesGeoJson(placesRef.current, null),
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 48,
        });
        addPlaceIconImages(map);

        map.addLayer({
          id: CLUSTER_LAYER_ID,
          type: "circle",
          source: PLACES_SOURCE_ID,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": ["step", ["get", "point_count"], "#6f6878", 10, "#4c4660", 50, "#302b45"],
            "circle-radius": ["step", ["get", "point_count"], 18, 10, 22, 50, 28],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
        // Numeric cluster labels use MapLibre's bundled TinySDF fallback; no
        // remote glyph endpoint is needed for this local style.
        map.addLayer({
          id: CLUSTER_COUNT_LAYER_ID,
          type: "symbol",
          source: PLACES_SOURCE_ID,
          filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 },
          paint: { "text-color": "#ffffff" },
        });
        map.addLayer({
          id: PIN_LAYER_ID,
          type: "circle",
          source: PLACES_SOURCE_ID,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["case", ["get", "selected"], 9, 7],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": ["case", ["get", "selected"], 3, 2],
          },
        });
        map.addLayer({
          id: PIN_ICON_LAYER_ID,
          type: "symbol",
          source: PLACES_SOURCE_ID,
          filter: ["!", ["has", "point_count"]],
          layout: {
            "icon-image": ["get", "iconImage"],
            "icon-size": 0.65,
            "icon-anchor": "bottom",
            "icon-offset": [0, -4],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: { "icon-opacity": 1 },
        });

        const interactiveLayers = [PIN_LAYER_ID, PIN_ICON_LAYER_ID];
        const clickLayers = [...interactiveLayers, CLUSTER_LAYER_ID];
        const interactiveFeature = (event: MapLayerMouseEvent) =>
          event.features?.find(
            (feature) => feature.layer?.id === PIN_LAYER_ID || feature.layer?.id === PIN_ICON_LAYER_ID,
          ) ?? event.features?.[0];
        const selectPlace = (event: MapLayerMouseEvent) => {
          const feature = interactiveFeature(event);
          const id = placeIdFromFeature(feature);
          if (id) handlersRef.current.onSelect(id);
        };
        const expandCluster = (event: MapLayerMouseEvent) => {
          const feature = event.features?.find((candidate) => candidate.layer?.id === CLUSTER_LAYER_ID);
          const clusterId = Number(feature?.properties?.cluster_id);
          if (!Number.isFinite(clusterId)) return;
          const source = map.getSource(PLACES_SOURCE_ID) as GeoJSONSource;
          void source
            .getClusterExpansionZoom(clusterId)
            .then((zoom) => {
              if (!cancelled && mapRef.current) {
                map.easeTo({
                  center: (feature?.geometry as Point).coordinates as [number, number],
                  zoom,
                  duration:
                    (reducedMotionRef.current ?? prefersReducedMotion())
                      ? 0
                      : 450,
                });
              }
            })
            .catch(() => undefined);
        };
        const selectOrExpand = (event: MapLayerMouseEvent) => {
          if (event.features?.[0]?.layer?.id === CLUSTER_LAYER_ID) {
            expandCluster(event);
            return;
          }
          selectPlace(event);
        };
        const hoverPlace = (event: MapLayerMouseEvent) => {
          const feature = interactiveFeature(event);
          const id = placeIdFromFeature(feature);
          const place = id ? placesRef.current.find((candidate) => candidate.id === id) : undefined;
          if (!place) return;
          map.getCanvas().style.cursor = "pointer";
          if (id === hoveredPlaceIdRef.current) return;
          hoveredPlaceIdRef.current = id;
          const geometry = feature?.geometry;
          const point = geometry?.type === "Point" ? map.project(geometry.coordinates as [number, number]) : event.point;
          handlersRef.current.onHover(place, { x: point.x, y: point.y });
        };
        const clearHover = () => {
          if (hoveredPlaceIdRef.current === null) return;
          hoveredPlaceIdRef.current = null;
          map.getCanvas().style.cursor = "";
          handlersRef.current.onHover(null, null);
        };

        map.on("click", clickLayers, selectOrExpand);
        map.on("mousemove", interactiveLayers, hoverPlace);
        map.on("mouseleave", interactiveLayers, clearHover);
        map.resize();
        readyRef.current = true;
        renderRef.current();
        setMapReadyVersion((version) => version + 1);
        syncProjection(
          map,
          projectionRef.current,
          placesRef.current,
          selectedIdRef.current,
          reducedMotionRef.current,
        );
      });
    })().catch((error: unknown) => {
      if (!cancelled) console.error("Places map failed to initialize", error);
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (benchmarkRenderHandler && mapInstance) mapInstance.off("render", benchmarkRenderHandler);
      mapInstance?.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, [tileAttribution, tileUrl, styleUrl, vector, textureUrl]);

  useEffect(() => {
    render();
  }, [render]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    syncProjection(map, projection, places, selectedId, reducedMotion);
  }, [places, projection, reducedMotion, selectedId, tileUrl]);

  useEffect(() => {
    const projectionChanged = lastViewportProjectionRef.current !== projection;
    lastViewportProjectionRef.current = projection;
    const map = mapRef.current;
    if (!map || !readyRef.current || places.length === 0 || (projectionChanged && projection === "globe")) return;
    let cancelled = false;

    const applyViewport = async () => {
      const { LngLatBounds } = await import("maplibre-gl");
      if (cancelled || !mapRef.current) return;
      const reduceMotion = reducedMotion ?? prefersReducedMotion();
      const selected = selectedId ? places.find((place) => place.id === selectedId) : null;
      if (selected) {
        map.easeTo({
          center: [selected.longitude, selected.latitude],
          zoom: projection === "globe" ? 3.5 : Math.max(map.getZoom(), 12),
          duration: reduceMotion ? 0 : 450,
        });
        return;
      }

      if (projection === "globe") return;

      const bounds = new LngLatBounds();
      for (const place of places) bounds.extend([place.longitude, place.latitude]);
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 56, maxZoom: 13, duration: reduceMotion ? 0 : 450 });
      }
    };

    void applyViewport();
    return () => {
      cancelled = true;
    };
  }, [mapReadyVersion, places, projection, reducedMotion, selectedId]);

  return (
    <>
      <div
        ref={containerRef}
        className={`places-map-canvas${projection === "globe" ? " places-globe-canvas" : ""}`}
        role="application"
        aria-label={projection === "globe" ? "Globe des lieux" : "Carte des lieux"}
      />
      {projection === "globe" && !vector && textureAttribution ? (
        <p className="places-globe-attribution">{textureAttribution}</p>
      ) : null}
    </>
  );
}

export default PlacesMap;
