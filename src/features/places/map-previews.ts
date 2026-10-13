import type { PlacesMapItem } from "@/server/places/map-view";
export type MapPreviewPoint = { place: PlacesMapItem; x: number; y: number };
export const MAP_PREVIEW_MIN_ZOOM = 13;
export const MAP_PREVIEW_SIZE = 48;
const GAP = 12;
const MAX_PREVIEWS = 40;

export function layoutMapPreviews(
  points: MapPreviewPoint[],
  view: { zoom: number; width: number; height: number; selectedId: string | null },
): MapPreviewPoint[] {
  if (view.zoom < MAP_PREVIEW_MIN_ZOOM) return [];
  const candidates = points.filter(({ place, x, y }) =>
    place.previewThumbnailUrl && ["EXACT", "PROBABLE"].includes(place.precision) &&
    Number.isFinite(x) && Number.isFinite(y) &&
    x >= MAP_PREVIEW_SIZE / 2 && x <= view.width - MAP_PREVIEW_SIZE / 2 &&
    y >= MAP_PREVIEW_SIZE + GAP && y <= view.height,
  ).sort((a, b) =>
    Number(b.place.id === view.selectedId) - Number(a.place.id === view.selectedId) ||
    a.place.id.localeCompare(b.place.id),
  );
  const visible: MapPreviewPoint[] = [];
  for (const point of candidates) {
    if (visible.some(other => other.place.id === point.place.id ||
      (Math.abs(other.x - point.x) < MAP_PREVIEW_SIZE + GAP && Math.abs(other.y - point.y) < MAP_PREVIEW_SIZE + GAP))) continue;
    visible.push(point);
    if (visible.length >= MAX_PREVIEWS) break;
  }
  return visible;
}
