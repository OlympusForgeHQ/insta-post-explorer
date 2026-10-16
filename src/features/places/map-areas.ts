import type { FeatureCollection, MultiLineString, MultiPolygon } from "geojson";
import type { PlacesMapItem } from "@/server/places/map-view";

export type PlacesAreasGeoJson = FeatureCollection<MultiPolygon, { id: string; selected: boolean }>;
export type PlacesAreaOutlinesGeoJson = FeatureCollection<MultiLineString, { id: string; selected: boolean }>;
type Coordinate = [number, number];
type Bounds = [Coordinate, Coordinate];
const EARTH_RADIUS_METERS = 6_371_000;
const RADIANS = Math.PI / 180;
const LATITUDE_STEPS = 64;

function angularRadius(place: PlacesMapItem): number | null {
  const radius = place.approximationRadiusMeters;
  return place.precision === "APPROXIMATE" && radius !== null && Number.isFinite(radius) && radius > 0
    && Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90
    && Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180
    ? Math.min(Math.PI, radius / EARTH_RADIUS_METERS) : null;
}

// Clip an unwrapped ring to one longitude boundary. Splitting into narrow strips
// avoids date-line shortcuts and inverted hemispheres in the globe projection.
function clipLongitude(ring: Coordinate[], longitude: number, keepEast: boolean): Coordinate[] {
  const inside = ([lng]: Coordinate) => keepEast ? lng >= longitude : lng <= longitude;
  const output: Coordinate[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const previous = ring[(index + ring.length - 1) % ring.length];
    if (inside(current) !== inside(previous)) {
      const fraction = (longitude - previous[0]) / (current[0] - previous[0]);
      output.push([longitude, previous[1] + fraction * (current[1] - previous[1])]);
    }
    if (inside(current)) output.push(current);
  }
  return output;
}

function areaGeometry(place: PlacesMapItem, radius: number): MultiPolygon {
  const latitude = place.latitude * RADIANS;
  const south = Math.max(-Math.PI / 2, latitude - radius);
  const north = Math.min(Math.PI / 2, latitude + radius);
  const west: Coordinate[] = [];
  const east: Coordinate[] = [];
  // On each latitude, the spherical distance equation gives the exact angular
  // half-width. Unlike a bearing ring, it also represents caps and >hemisphere
  // radii without turning their interior into the opposite side of the globe.
  for (let step = 0; step <= LATITUDE_STEPS; step += 1) {
    const lat = south + (north - south) * (1 - Math.cos(Math.PI * step / LATITUDE_STEPS)) / 2;
    const denominator = Math.cos(latitude) * Math.cos(lat);
    const numerator = Math.cos(radius) - Math.sin(latitude) * Math.sin(lat);
    const halfWidth = denominator < 1e-15
      ? (numerator <= 1e-15 ? Math.PI : 0)
      : Math.acos(Math.max(-1, Math.min(1, numerator / denominator)));
    west.push([place.longitude - halfWidth / RADIANS, lat / RADIANS]);
    east.push([place.longitude + halfWidth / RADIANS, lat / RADIANS]);
  }
  const ring = [...east, ...west.reverse()];
  const coordinates: MultiPolygon["coordinates"] = [];
  for (let strip = -360; strip < 360; strip += 90) {
    const clipped = clipLongitude(clipLongitude(ring, strip, true), strip + 90, false);
    if (clipped.length < 3) continue;
    const area = clipped.reduce((sum, point, index) => {
      const next = clipped[(index + 1) % clipped.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0);
    if (Math.abs(area) < 1e-12) continue;
    const offset = strip < -180 ? 360 : strip >= 180 ? -360 : 0;
    const normalized = clipped.map(([lng, lat]) => [lng + offset, lat] as Coordinate);
    if (area < 0) normalized.reverse();
    normalized.push(normalized[0]);
    coordinates.push([normalized]);
  }
  return { type: "MultiPolygon", coordinates };
}

export function buildPlacesAreasGeoJson(places: readonly PlacesMapItem[], selectedId: string | null): PlacesAreasGeoJson {
  return {
    type: "FeatureCollection",
    features: places.flatMap(place => {
      const radius = angularRadius(place);
      return radius === null ? [] : [{
        type: "Feature" as const,
        id: place.id,
        geometry: areaGeometry(place, radius),
        properties: { id: place.id, selected: place.id === selectedId },
      }];
    }),
  };
}

export function buildPlacesAreaOutlinesGeoJson(places: readonly PlacesMapItem[], selectedId: string | null): PlacesAreaOutlinesGeoJson {
  return { type: "FeatureCollection", features: places.flatMap(place => {
    const radius = angularRadius(place);
    // The entire sphere has no boundary. In particular, polygon clipping strips
    // must never appear as geographic meridians or become clickable outlines.
    if (radius === null || radius >= Math.PI) return [];
    const latitude = place.latitude * RADIANS;
    const points: Coordinate[] = [];
    for (let step = 0; step < 128; step += 1) {
      const bearing = step / 128 * 2 * Math.PI;
      const lat = Math.asin(Math.max(-1, Math.min(1, Math.sin(latitude) * Math.cos(radius)
        + Math.cos(latitude) * Math.sin(radius) * Math.cos(bearing))));
      const lng = place.longitude + Math.atan2(Math.sin(bearing) * Math.sin(radius) * Math.cos(latitude),
        Math.cos(radius) - Math.sin(latitude) * Math.sin(lat)) / RADIANS;
      points.push([((lng + 180) % 360 + 360) % 360 - 180, lat / RADIANS]);
    }
    points.push(points[0]);
    const lines: Coordinate[][] = [[points[0]]];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1], point = points[index];
      const delta = point[0] - previous[0];
      if (Math.abs(delta) > 180) {
        const longitude = previous[0] > 0 ? 180 : -180;
        const continuous = point[0] + (delta > 0 ? -360 : 360);
        const crossingLatitude = previous[1] + (point[1] - previous[1]) * (longitude - previous[0]) / (continuous - previous[0]);
        lines.at(-1)!.push([longitude, crossingLatitude]);
        lines.push([[-longitude, crossingLatitude]]);
      }
      lines.at(-1)!.push(point);
    }
    return [{ type: "Feature" as const, id: place.id,
      geometry: { type: "MultiLineString" as const, coordinates: lines },
      properties: { id: place.id, selected: place.id === selectedId } }];
  }) };
}

export function placeViewportBounds(place: PlacesMapItem): Bounds {
  const radius = angularRadius(place);
  if (radius === null) return [[place.longitude, place.latitude], [place.longitude, place.latitude]];
  const latitude = place.latitude * RADIANS;
  const reachesPole = Math.abs(latitude) + radius >= Math.PI / 2;
  const width = reachesPole ? 180 : Math.asin(Math.sin(radius) / Math.cos(latitude)) / RADIANS;
  const mercatorLatitude = (value: number) => Math.max(-85.051129, Math.min(85.051129, value));
  return [
    [reachesPole ? -180 : place.longitude - width, mercatorLatitude(place.latitude - radius / RADIANS)],
    [reachesPole ? 180 : place.longitude + width, mercatorLatitude(place.latitude + radius / RADIANS)],
  ];
}

export function formatApproximationRadius(radiusMeters: number | null): string {
  if (radiusMeters === null || !Number.isFinite(radiusMeters) || radiusMeters <= 0) return "Zone approximative";
  const value = radiusMeters < 1000 ? Math.max(1, Math.round(radiusMeters)) : radiusMeters / 1000;
  return `Zone approximative · rayon ~${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ${radiusMeters < 1000 ? "m" : "km"}`;
}
