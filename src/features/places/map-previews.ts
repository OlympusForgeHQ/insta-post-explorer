import type { PlacesMapItem } from "@/server/places/map-view";
export type MapPreviewPoint = { place: PlacesMapItem; x: number; y: number };
export const MAP_PREVIEW_SIZE = 48;
const GAP = 12;

export function layoutMapPreviews(
  points: MapPreviewPoint[],
  view: { zoom: number; width: number; height: number; selectedId: string | null },
): MapPreviewPoint[] {
  const candidates = points.filter(({ place, x, y }) =>
    place.previewThumbnailUrl && ["EXACT", "PROBABLE"].includes(place.precision) &&
    Number.isFinite(x) && Number.isFinite(y),
  ).sort((a, b) =>
    Number(b.place.id === view.selectedId) - Number(a.place.id === view.selectedId) ||
    a.place.id.localeCompare(b.place.id),
  );
  // Clustering already determines which individual pins are visible. Do not hide
  // their images behind another zoom, collision or count threshold.
  return candidates.map(point => ({
    ...point,
    x: Math.max(MAP_PREVIEW_SIZE / 2, Math.min(view.width - MAP_PREVIEW_SIZE / 2, point.x)),
    y: Math.max(MAP_PREVIEW_SIZE + GAP, Math.min(view.height, point.y)),
  }));
}
