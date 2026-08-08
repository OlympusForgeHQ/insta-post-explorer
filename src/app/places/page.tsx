import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getConfiguredOwnerId } from "@/auth/config";
import { getSession } from "@/auth/session";
import type { PlacesStatsDto } from "@/contracts/api/places";
import { PLACES_GLOBE_ATTRIBUTION, PLACES_GLOBE_TEXTURE_URL } from "@/lib/places/globe-texture";
import { PlacesExplorer } from "@/features/places/components/places-explorer";
import { parsePlacesUrlState } from "@/features/places/query-state";
import { databaseConfigured } from "@/server/db";
import { loadPlacesMapView } from "@/server/places/map-view";
import { getPlacesStats } from "@/server/places/stats";

const EMPTY_PLACES_STATS: PlacesStatsDto = {
  totals: {
    eligiblePosts: 0,
    identifiedPlaces: 0,
    countries: 0,
    continents: 0,
    postsWithPlaces: 0,
    needsReview: 0,
  },
  byTheme: [],
  byCountry: [],
  byContinent: [],
  byPrecision: [],
  byReviewStatus: [],
};

export const metadata: Metadata = {
  title: "Places · Insta Post Explorer",
  description: "Carte des lieux identifiés dans les publications sauvegardées.",
};

// Server Component: it calls the server services directly (no internal HTTP loop
// to /api/v1) and hands the client explorer everything it needs in one pass.
// The owner capped Places at ~1000 canonical places, so the whole set is loaded
// once and filtered in the browser.

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function toSearchParams(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") search.set(key, value);
    else if (Array.isArray(value) && value[0]) search.set(key, value[0]);
  }
  return search;
}

export default async function PlacesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const initialState = parsePlacesUrlState(toSearchParams(params));
  const ownerId = getConfiguredOwnerId();
  const session = await getSession().catch(() => null);
  const emptyView: Awaited<ReturnType<typeof loadPlacesMapView>> = { items: [], truncated: false };

  // Without a configured database the page still renders: an empty map, empty
  // statistics and working controls, instead of crashing.
  const [view, stats] = databaseConfigured
    ? await Promise.all([loadPlacesMapView(ownerId), getPlacesStats({}, ownerId)]).catch(
        (): [typeof emptyView, PlacesStatsDto] => [emptyView, EMPTY_PLACES_STATS],
      )
    : [emptyView, EMPTY_PLACES_STATS];

  // Map tiles are a public, client-side resource: the key is a NEXT_PUBLIC_ tile
  // URL, never the server-only geocoding key. Attribution is mandatory.
  const tileUrl = process.env.NEXT_PUBLIC_PLACES_TILE_URL?.trim() ?? "";

  // A MapLibre style document turns the map from stretched raster images into
  // real vector rendering: client-drawn labels, continuous zoom, rotation and
  // tilt. It takes precedence over the raster URL when both are set, and leaving
  // it empty keeps the Phase G raster path exactly as it was — so rolling back is
  // unsetting one variable, not reverting code.
  const styleUrl = process.env.NEXT_PUBLIC_PLACES_STYLE_URL?.trim() ?? "";
  const tileAttribution =
    process.env.NEXT_PUBLIC_PLACES_TILE_ATTRIBUTION?.trim() ||
    'Powered by <a href="https://www.geoapify.com/">Geoapify</a> | © OpenStreetMap contributors';

  // The 3D globe uses a static local texture instead of a tile provider: no key,
  // no account, no recurring cost. Source and licence are recorded in
  // public/places/ATTRIBUTION.md (Natural Earth, public domain).
  const textureUrl = PLACES_GLOBE_TEXTURE_URL;
  const textureAttribution = PLACES_GLOBE_ATTRIBUTION;

  return (
    <main className="places-page">
      <header className="places-page-head">
        <Link className="places-back-link" href="/">
          <ArrowLeft size={15} aria-hidden="true" /> Retour aux posts
        </Link>
        <h1>Places</h1>
        <p>
          {view.items.length} lieu{view.items.length > 1 ? "x" : ""} identifié
          {view.items.length > 1 ? "s" : ""} dans vos publications sauvegardées.
        </p>
      </header>
      <PlacesExplorer
        places={view.items}
        stats={stats}
        initialState={initialState}
        truncated={view.truncated}
        isAdmin={session?.role === "admin"}
        tileUrl={tileUrl}
        styleUrl={styleUrl}
        tileAttribution={tileAttribution}
        tilesConfigured={tileUrl.length > 0 || styleUrl.length > 0}
        textureUrl={textureUrl}
        textureAttribution={textureAttribution}
      />
    </main>
  );
}
