"use client";

import dynamic from "next/dynamic";
import { useRef } from "react";
import type { KeyboardEvent } from "react";
import { Globe2, MapPin } from "lucide-react";

import type { PlacesRendererProps } from "@/features/places/renderer-contract";
import { WEBGL_FALLBACK_MESSAGE } from "@/lib/places/webgl";

// What the shell has *resolved*, not what the URL asked for. `probing` is the
// state where the user asked for the globe but the WebGL probe has not answered
// yet — it renders a placeholder and does not request the shared MapLibre chunk
// until a real renderer can be mounted (FR-I-12).
export type ResolvedPlacesView = "map" | "globe" | "probing";

// The shell keeps every piece of state — filters, search, selection, panels,
// statistics, list and detail — and delegates only the canvas to MapLibre. The
// same component instance changes projection, so switching 2D ↔ globe does not
// tear down the WebGL context or restart the data sources.

const PlacesMap = dynamic(() => import("@/features/places/components/places-map"), {
  ssr: false,
  loading: () => <div className="places-map-canvas places-map-loading" aria-hidden="true" />,
});


export type PlacesRendererShellProps = PlacesRendererProps & {
  view: ResolvedPlacesView;
  tileUrl: string;
  styleUrl?: string;
  tileAttribution: string;
  tilesConfigured: boolean;
  textureUrl: string;
  textureAttribution: string;
  reducedMotion: boolean;
  webglAvailable: boolean | null;
};

export function PlacesRenderer({
  view,
  tileUrl,
  styleUrl = "",
  tileAttribution,
  tilesConfigured,
  textureUrl,
  textureAttribution,
  reducedMotion,
  webglAvailable,
  ...rendererProps
}: PlacesRendererShellProps) {
  if (webglAvailable === null) return <CapabilityProbing globe={view === "probing"} />;
  if (webglAvailable === false) return <MapUnavailable />;

  if (view === "globe") {
    return (
      <PlacesMap
        {...rendererProps}
        tileUrl={tileUrl}
        styleUrl={styleUrl}
        tileAttribution={tileAttribution}
        projection="globe"
        textureUrl={textureUrl}
        textureAttribution={textureAttribution}
        reducedMotion={reducedMotion}
      />
    );
  }
  if (!tilesConfigured) return <MapNotConfigured />;
  return (
    <PlacesMap
      {...rendererProps}
      tileUrl={tileUrl}
      styleUrl={styleUrl}
      tileAttribution={tileAttribution}
      projection="mercator"
      textureUrl={textureUrl}
      textureAttribution={textureAttribution}
      reducedMotion={reducedMotion}
    />
  );
}

export function PlacesMapA11yList({
  places,
  selectedId,
  onSelect,
}: Pick<PlacesRendererProps, "places" | "selectedId" | "onSelect">) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusButton = (index: number) => buttonRefs.current[index]?.focus();
  const handleGroupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      focusButton(0);
    }
  };
  const handleButtonKeyDown = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    const nextIndex =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? Math.min(index + 1, places.length - 1)
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? places.length - 1
              : null;
    if (nextIndex == null) return;
    event.preventDefault();
    focusButton(nextIndex);
  };
  if (places.length === 0) return null;
  return (
    <div
      className="places-map-a11y-list"
      role="group"
      aria-label="Lieux affichés sur la carte"
      tabIndex={0}
      onKeyDown={handleGroupKeyDown}
    >
      {places.map((place, index) => (
        <button
          key={place.id}
          ref={(element) => {
            buttonRefs.current[index] = element;
          }}
          type="button"
          tabIndex={-1}
          aria-label={`Sélectionner ${place.displayName}`}
          aria-pressed={selectedId === place.id}
          onKeyDown={(event) => handleButtonKeyDown(index, event)}
          onClick={() => onSelect(place.id)}
        >
          {place.displayName}
        </button>
      ))}
    </div>
  );
}

function CapabilityProbing({ globe }: { globe: boolean }) {
  return (
    <div
      className={globe ? "places-globe-canvas places-globe-loading" : "places-map-canvas places-map-loading"}
      role="status"
      data-testid={globe ? "places-globe-probing" : "places-map-probing"}
    >
      {globe ? <Globe2 aria-hidden="true" /> : <MapPin aria-hidden="true" />}
      <span>{globe ? "Préparation du globe…" : "Préparation de la carte…"}</span>
    </div>
  );
}

function MapUnavailable() {
  return (
    <div className="places-map-canvas places-map-missing" role="status" data-testid="places-map-unavailable">
      <MapPin aria-hidden="true" />
      <p>{WEBGL_FALLBACK_MESSAGE}</p>
    </div>
  );
}

function MapNotConfigured() {
  return (
    <div className="places-map-canvas places-map-missing">
      <MapPin aria-hidden="true" />
      <p>
        La carte n’est pas configurée. Renseignez <code>NEXT_PUBLIC_PLACES_STYLE_URL</code> pour un fond vectoriel, ou{" "}
        <code>NEXT_PUBLIC_PLACES_TILE_URL</code> pour des tuiles raster ; la liste et les filtres restent utilisables.
      </p>
    </div>
  );
}
