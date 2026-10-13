"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { PlacesRendererProps } from "@/features/places/renderer-contract";
import { layoutMapPreviews, type MapPreviewPoint } from "@/features/places/map-previews";

type Props = PlacesRendererProps & { map: MapLibreMap };

// Native buttons stay accessible and do not require copying remote thumbnails
// into the WebGL texture atlas. Only unclustered, currently rendered pins qualify.
export function PlacesMapPreviews({ map, places, selectedId, onSelect, onOpenPost, onHover }: Props) {
  const [points, setPoints] = useState<MapPreviewPoint[]>([]);
  const failedImages = useRef(new Map<string, string>());

  useEffect(() => {
    let frame = 0;
    let disposed = false;
    const refresh = () => {
      frame = 0;
      if (disposed) return;
      const container = map.getContainer();
      const renderedIds = new Set<string>();
      if (map.getLayer("places-pins")) {
        for (const feature of map.queryRenderedFeatures({ layers: ["places-pins"] })) {
          if (typeof feature.properties?.id === "string") renderedIds.add(feature.properties.id);
        }
      }
      const next = layoutMapPreviews(places.filter(place => renderedIds.has(place.id) &&
        failedImages.current.get(place.id) !== place.previewThumbnailUrl).map(place => {
        const point = map.project([place.longitude, place.latitude]);
        return { place, x: Math.round(point.x), y: Math.round(point.y) };
      }), { zoom: map.getZoom(), width: container.clientWidth, height: container.clientHeight, selectedId });
      setPoints(previous => previous.length === next.length && previous.every((point, index) =>
        point.place === next[index].place && point.x === next[index].x && point.y === next[index].y,
      ) ? previous : next);
    };
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(refresh); };
    map.on("render", schedule);
    schedule();
    return () => { disposed = true; map.off("render", schedule); cancelAnimationFrame(frame); };
  }, [map, places, selectedId]);

  // Filter synchronously too: stale engine data must never leave a filtered-out
  // post clickable while the GeoJSON worker catches up.
  const visibleIds = new Set(places.map(place => place.id));
  return createPortal(
    <div className="places-map-previews" aria-label="Aperçus des publications">
      {points.filter(point => visibleIds.has(point.place.id)).map(({ place, x, y }) => (
        <button
          key={`${place.id}:${place.previewThumbnailUrl}`}
          type="button"
          className={`places-map-preview is-${place.precision.toLowerCase()}${place.id === selectedId ? " is-selected" : ""}`}
          style={{ left: x, top: y }}
          data-map-preview-id={place.id}
          data-post-id={place.previewPostId ?? undefined}
          aria-label={`Ouvrir le post de ${place.displayName}${place.postCount > 1 ? ` · ${place.postCount} posts associés` : ""}`}
          title={place.displayName}
          onPointerEnter={() => onHover(null, null)}
          onClick={event => {
            event.stopPropagation();
            onHover(null, null);
            if (onOpenPost && place.previewPostId) onOpenPost(place.id, place.previewPostId);
            else onSelect(place.id);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={place.previewThumbnailUrl!} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
            onError={() => {
              failedImages.current.set(place.id, place.previewThumbnailUrl!);
              setPoints(current => current.filter(point => point.place.id !== place.id));
              map.triggerRepaint();
            }}
          />
          {place.postCount > 1 ? <span className="places-map-preview-count" aria-hidden="true">+{place.postCount - 1}</span> : null}
        </button>
      ))}
    </div>,
    map.getContainer(),
  );
}
