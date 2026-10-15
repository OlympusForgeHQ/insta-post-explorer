import type { PlacesMapItem } from "@/server/places/map-view";

// The contract every Places renderer honours. Phase G established it at the
// Places renderer seam; Phase I promotes it to its own module so the 2D map and
// the 3D globe are interchangeable.
//
// The rules that make the seam work:
// - a renderer receives places that are ALREADY filtered by the shell; it never
//   filters, searches, sorts or fetches anything itself;
// - it owns no state the shell needs, and reports interaction upward only;
// - anything engine-specific (raster tiles for 2D, a texture for 3D) stays on
//   the renderer's own props and never leaks into this shared shape.
//
// Removing a renderer therefore means deleting its file and its branch in
// `places-renderer.tsx` — nothing else (NFR-I-06).

/** Position in CSS pixels relative to the renderer's own container. */
export type ScreenPoint = { x: number; y: number };

export type PlacesRendererProps = {
  places: readonly PlacesMapItem[];
  selectedId: string | null;
  onSelect: (placeId: string) => void;
  onOpenPost?: (placeId: string, postId: string, trigger?: HTMLElement) => void;
  onHover: (place: PlacesMapItem | null, point: ScreenPoint | null) => void;
};
