"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { BarChart3, Check, ListFilter, MapPin, Search, SlidersHorizontal, X } from "lucide-react";

import { PLACE_CATEGORY_GROUPS } from "@/lib/places/categories";
import { PLACES_ELIGIBLE_THEMES } from "@/lib/places/eligibility";
import { isWebGlUsable } from "@/lib/places/webgl";
import { usePrefersReducedMotion, useWebGlSupport } from "@/features/places/capabilities";
import type { PlacesStatsDto } from "@/contracts/api/places";
import type { PlacesMapItem } from "@/server/places/map-view";
import { cn } from "@/lib/utils";
import {
  EMPTY_FILTERS,
  PLACE_PRECISION_VALUES,
  collectCountries,
  countActiveFilters,
  filterPlaces,
  isMappable,
  narrowCountries,
  parsePlacesUrlState,
  serializePlacesUrlState,
  toggleValue,
  type PlacesFilters,
  type PlacesUrlState,
  type PlacesViewMode,
  type ReviewFilter,
} from "@/features/places/query-state";
import { PlaceDetailSheet } from "@/features/places/components/place-detail-sheet";
import { PlacesMapA11yList, PlacesRenderer, type ResolvedPlacesView } from "@/features/places/components/places-renderer";
import type { ScreenPoint } from "@/features/places/renderer-contract";

const PRECISION_LABEL: Record<string, string> = {
  EXACT: "Exact",
  PROBABLE: "Probable",
  APPROXIMATE: "Approximatif",
};
const REVIEW_LABEL: Record<ReviewFilter, string> = {
  needs_review: "À vérifier",
  confirmed: "Confirmés",
};

export type PlacesExplorerProps = {
  places: PlacesMapItem[];
  stats: PlacesStatsDto;
  initialState: PlacesUrlState;
  truncated: boolean;
  isAdmin: boolean;
  tileUrl: string;
  styleUrl?: string;
  tileAttribution: string;
  tilesConfigured: boolean;
  textureUrl: string;
  textureAttribution: string;
};

export function PlacesExplorer({
  places,
  stats,
  initialState,
  truncated,
  isAdmin,
  tileUrl,
  styleUrl = "",
  tileAttribution,
  tilesConfigured,
  textureUrl,
  textureAttribution,
}: PlacesExplorerProps) {
  const [filters, setFilters] = useState<PlacesFilters>({ ...EMPTY_FILTERS, ...initialState });
  const [selectedId, setSelectedId] = useState<string | null>(initialState.placeId);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [hover, setHover] = useState<{ place: PlacesMapItem; x: number; y: number } | null>(null);
  const [countryQuery, setCountryQuery] = useState("");
  // The view the user asked for. What actually renders can differ when the
  // device cannot run WebGL — see `resolvedView` below.
  const [view, setView] = useState<PlacesViewMode>(initialState.view);

  // "unknown" until the client has answered: the globe must not be offered — nor
  // its chunk requested — before then (FR-I-12).
  const webgl = useWebGlSupport();
  const reducedMotion = usePrefersReducedMotion();
  const globeAvailable = webgl === "unknown" ? null : isWebGlUsable(webgl);

  // What actually renders, resolved from the requested view AND the probe. The
  // globe branch is reachable **only** on a proven `true`, so the engine chunk is
  // never requested on an unproven capability (FR-I-12). `null` is not "probably
  // fine": during SSR and the hydration pass the client has not answered yet, and
  // rendering MapLibre there would request the shared engine before the answer.
  //
  // - view=map + true     → the 2D map;
  // - view=map + null     → a light map waiting state;
  // - view=map + false    → an unavailable-map message;
  // - globe + true        → the globe;
  // - globe + null        → a light waiting state; the URL keeps view=globe,
  //                         because nothing is known yet and rewriting it would
  //                         lose a legitimate deep link;
  // - globe + false       → an unavailable-map message, URL rewritten, everything
  //                         else preserved.
  const resolvedView: ResolvedPlacesView =
    view !== "globe" ? "map" : globeAvailable === true ? "globe" : globeAvailable === false ? "map" : "probing";
  // Only a proven refusal rewrites the URL.
  const urlView: PlacesViewMode = view === "globe" && globeAvailable === false ? "map" : view;

  const [, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement | null>(null);

  const mappable = useMemo(() => places.filter(isMappable), [places]);
  const visible = useMemo(() => filterPlaces(mappable, filters), [mappable, filters]);
  const renderedPoints = useMemo(() => visible.filter((place) => place.precision !== "APPROXIMATE"), [visible]);
  const selected = useMemo(
    () => visible.find((place) => place.id === selectedId) ?? places.find((place) => place.id === selectedId) ?? null,
    [visible, places, selectedId],
  );
  const activeFilterCount = countActiveFilters(filters);

  // Countries actually present, so a filter can never be empty by construction.
  const countries = useMemo(() => collectCountries(mappable), [mappable]);
  const visibleCountries = useMemo(
    () => narrowCountries(countries, countryQuery, filters.countryCodes),
    [countries, countryQuery, filters.countryCodes],
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const place of mappable) {
      if (!place.categoryGroup) continue;
      counts.set(place.categoryGroup, (counts.get(place.categoryGroup) ?? 0) + 1);
    }
    return counts;
  }, [mappable]);

  const urlFor = useCallback(
    (state: { filters: PlacesFilters; placeId: string | null; view: PlacesViewMode }) => {
      const query = serializePlacesUrlState({ ...state.filters, placeId: state.placeId, view: state.view });
      return query ? `/places?${query}` : "/places";
    },
    [],
  );

  // Keep the URL in sync so filters and the selection are shareable and the
  // browser back button works, without pushing an entry per keystroke. The
  // effective view is written, so a globe link that fell back to 2D says so.
  useEffect(() => {
    const next = urlFor({ filters, placeId: selectedId, view: urlView });
    if (typeof window !== "undefined" && window.location.pathname + window.location.search !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [filters, selectedId, urlView, urlFor]);

  // The view is the one piece of state worth a history entry: back and forward
  // then move between 2D and 3D instead of leaving the page.
  const switchView = useCallback(
    (next: PlacesViewMode) => {
      if (next === view) return;
      if (next === "globe" && globeAvailable !== true) {
        setView("globe");
        return;
      }
      setView(next);
      if (typeof window !== "undefined") {
        window.history.pushState(null, "", urlFor({ filters, placeId: selectedId, view: next }));
      }
    },
    [view, globeAvailable, filters, selectedId, urlFor],
  );

  // Restore the whole shared state from the URL on back/forward, so history is
  // coherent for the view, the filters and the selection alike (FR-I-08).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      const state = parsePlacesUrlState(new URLSearchParams(window.location.search));
      const { placeId, view: nextView, ...nextFilters } = state;
      setFilters(nextFilters);
      setSelectedId(placeId);
      setView(nextView);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const patch = useCallback((next: Partial<PlacesFilters>) => {
    startTransition(() => setFilters((current) => ({ ...current, ...next })));
  }, []);

  const clearFilters = useCallback(() => {
    startTransition(() => setFilters({ ...EMPTY_FILTERS }));
  }, []);

  const handleSelect = useCallback((placeId: string) => {
    setSelectedId(placeId);
    setHover(null);
  }, []);

  const handleHover = useCallback((place: PlacesMapItem | null, point: ScreenPoint | null) => {
    setHover(place && point ? { place, x: point.x, y: point.y } : null);
  }, []);

  const toggleFilters = useCallback(() => {
    setFiltersOpen((open) => {
      if (!open) {
        setListOpen(false);
        setStatsOpen(false);
      }
      return !open;
    });
  }, []);

  const toggleList = useCallback(() => {
    setListOpen((open) => {
      if (!open) {
        setFiltersOpen(false);
        setStatsOpen(false);
      }
      return !open;
    });
  }, []);

  return (
    <section className="places-shell" aria-label="Lieux sauvegardés">
      <div className="places-stage">
        {/* Only the canvas depends on the active view; everything below — search,
            filters, statistics, list, detail and summary — is shared. */}
        <PlacesRenderer
          view={resolvedView}
          places={renderedPoints}
          selectedId={selectedId}
          onSelect={handleSelect}
          onHover={handleHover}
          tileUrl={tileUrl}
          styleUrl={styleUrl}
          tileAttribution={tileAttribution}
          tilesConfigured={tilesConfigured}
          textureUrl={textureUrl}
          textureAttribution={textureAttribution}
          reducedMotion={reducedMotion}
          webglAvailable={globeAvailable}
        />

        {/* Hover callout: photo + arrow pointing at the marker. Informative only. */}
        {hover ? (
          <div
            className="places-callout"
            style={{ left: hover.x, top: hover.y }}
            role="tooltip"
            aria-hidden="true"
          >
            <div className="places-callout-media">
              {hover.place.previewThumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hover.place.previewThumbnailUrl} alt="" loading="lazy" />
              ) : (
                <span className="places-callout-fallback" aria-hidden="true">
                  <MapPin />
                </span>
              )}
              <span className={cn("places-badge", `is-${hover.place.precision.toLowerCase()}`)}>
                {hover.place.precision === "APPROXIMATE" && hover.place.approximationRadiusMeters
                  ? `Zone ~${Math.round(hover.place.approximationRadiusMeters / 1000)} km`
                  : PRECISION_LABEL[hover.place.precision]}
              </span>
            </div>
            <div className="places-callout-body">
              <p className="places-callout-name">{hover.place.displayName}</p>
              <p className="places-callout-sub">
                {[hover.place.city, hover.place.country].filter(Boolean).join(" · ") || "Localisation"}
              </p>
              <p className="places-callout-count">{hover.place.postCount} post(s)</p>
            </div>
          </div>
        ) : null}

        {/* Top control bar: search + a single filters button. */}
        <div className="places-topbar">
          <div className="places-search">
            <Search aria-hidden="true" size={15} />
            <input
              ref={searchRef}
              type="search"
              value={filters.q}
              placeholder="Rechercher un lieu, une ville, un pays…"
              aria-label="Rechercher un lieu"
              onChange={(event) => patch({ q: event.target.value })}
            />
            {filters.q ? (
              <button type="button" className="places-search-clear" aria-label="Effacer la recherche" onClick={() => patch({ q: "" })}>
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className={cn("places-button", activeFilterCount > 0 && "is-active")}
            aria-expanded={filtersOpen}
            aria-controls="places-filters"
            onClick={toggleFilters}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            Filtres
            {activeFilterCount > 0 ? <span className="places-count-badge">{activeFilterCount}</span> : null}
          </button>
          {/* Concept 2: the view switch sits next to the filters and uses the
              same visual language as the rest of the chrome. */}
          <div className="places-segmented" role="group" aria-label="Type de vue">
            <button
              type="button"
              className={cn("places-segment", urlView === "map" && "is-active")}
              aria-pressed={urlView === "map"}
              onClick={() => switchView("map")}
            >
              2D
            </button>
            <button
              type="button"
              className={cn("places-segment", urlView === "globe" && "is-active")}
              aria-pressed={urlView === "globe"}
              disabled={globeAvailable === false}
              onClick={() => switchView("globe")}
            >
              3D
            </button>
          </div>
        </div>

        <PlacesMapA11yList places={renderedPoints} selectedId={selectedId} onSelect={handleSelect} />

        {filtersOpen ? (
          <div className="places-panel" id="places-filters" role="dialog" aria-label="Filtres">
            <header>
              <h2>Filtres</h2>
              <div className="places-panel-actions">
                <button type="button" className="places-link" onClick={clearFilters}>
                  Effacer
                </button>
                <button type="button" className="places-icon-button" aria-label="Fermer les filtres" onClick={() => setFiltersOpen(false)}>
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            </header>
            <div className="places-panel-body">
              <FilterGroup label="Thème du post">
                {PLACES_ELIGIBLE_THEMES.map((theme) => (
                  <FilterOption
                    key={theme}
                    checked={filters.themes.includes(theme)}
                    label={theme}
                    onToggle={() => patch({ themes: toggleValue(filters.themes, theme) })}
                  />
                ))}
              </FilterGroup>

              <FilterGroup label="Type de lieu">
                {PLACE_CATEGORY_GROUPS.map((group) => (
                  <FilterOption
                    key={group.key}
                    checked={filters.categories.includes(group.key)}
                    label={`${group.icon} ${group.label}`}
                    count={categoryCounts.get(group.key) ?? 0}
                    onToggle={() => patch({ categories: toggleValue(filters.categories, group.key) })}
                  />
                ))}
              </FilterGroup>

              <FilterGroup label="Précision">
                {PLACE_PRECISION_VALUES.map((precision) => (
                  <FilterOption
                    key={precision}
                    checked={filters.precisions.includes(precision)}
                    label={PRECISION_LABEL[precision]}
                    swatch={precision}
                    onToggle={() => patch({ precisions: toggleValue(filters.precisions, precision) })}
                  />
                ))}
              </FilterGroup>

              <FilterGroup label="Revue">
                {(Object.keys(REVIEW_LABEL) as ReviewFilter[]).map((review) => (
                  <FilterOption
                    key={review}
                    checked={filters.reviews.includes(review)}
                    label={REVIEW_LABEL[review]}
                    onToggle={() => patch({ reviews: toggleValue(filters.reviews, review) })}
                  />
                ))}
              </FilterGroup>

              {countries.length > 0 ? (
                <FilterGroup label="Pays">
                  {/* Every country stays selectable: the list scrolls and can be
                      narrowed locally instead of being cut off. */}
                  {countries.length > 8 ? (
                    <label className="places-country-search">
                      <span className="sr-only">Filtrer les pays</span>
                      <Search size={13} aria-hidden="true" />
                      <input
                        type="search"
                        value={countryQuery}
                        placeholder="Filtrer les pays…"
                        onChange={(event) => setCountryQuery(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <div className="places-country-list">
                    {visibleCountries.map((country) => (
                      <FilterOption
                        key={country.code}
                        checked={filters.countryCodes.includes(country.code)}
                        label={country.label}
                        count={country.count}
                        onToggle={() => patch({ countryCodes: toggleValue(filters.countryCodes, country.code) })}
                      />
                    ))}
                    {visibleCountries.length === 0 ? (
                      <p className="places-country-empty">Aucun pays ne correspond.</p>
                    ) : null}
                  </div>
                </FilterGroup>
              ) : null}
            </div>
            <footer>
              <button type="button" className="places-primary" onClick={() => setFiltersOpen(false)}>
                Appliquer
              </button>
            </footer>
          </div>
        ) : null}

        {statsOpen ? (
          <div className="places-stats" role="dialog" aria-label="Statistiques">
            <header>
              <h2>Statistiques</h2>
              <button type="button" className="places-icon-button" aria-label="Fermer les statistiques" onClick={() => setStatsOpen(false)}>
                <X size={15} aria-hidden="true" />
              </button>
            </header>
            <StatBars label="Par thème" rows={stats.byTheme.map((row) => ({ key: row.theme, label: row.theme, value: row.placeCount }))} />
            <StatBars
              label="Par pays"
              rows={stats.byCountry
                .slice(0, 6)
                .map((row) => ({ key: row.countryCode ?? row.country ?? "?", label: row.country ?? row.countryCode ?? "Inconnu", value: row.placeCount }))}
            />
          </div>
        ) : null}

        {listOpen ? (
          <aside className="places-drawer" aria-label="Liste des lieux">
            <header>
              <h2>
                {visible.length} lieu{visible.length > 1 ? "x" : ""}
              </h2>
              <button type="button" className="places-icon-button" aria-label="Fermer la liste" onClick={() => setListOpen(false)}>
                <X size={15} aria-hidden="true" />
              </button>
            </header>
            <ul className="places-list">
              {visible.map((place) => (
                <li key={place.id}>
                  <button
                    type="button"
                    className={cn("places-row", place.id === selectedId && "is-selected")}
                    data-place-id={place.id}
                    onClick={() => handleSelect(place.id)}
                  >
                    <span className="places-row-thumb" aria-hidden="true">
                      {place.previewThumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={place.previewThumbnailUrl} alt="" loading="lazy" />
                      ) : (
                        <MapPin size={16} />
                      )}
                    </span>
                    <span className="places-row-body">
                      <span className="places-row-name">{place.displayName}</span>
                      <span className="places-row-sub">
                        {[place.city, place.country].filter(Boolean).join(" · ") || "—"}
                      </span>
                      <span className="places-row-meta">
                        <span className={cn("places-badge", `is-${place.precision.toLowerCase()}`)}>
                          {PRECISION_LABEL[place.precision]}
                        </span>
                        <span className="places-row-count">{place.postCount} post(s)</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {visible.length === 0 ? <li className="places-empty">Aucun lieu ne correspond à ces filtres.</li> : null}
            </ul>
          </aside>
        ) : null}

        {selected ? (
          <PlaceDetailSheet
            place={selected}
            isAdmin={isAdmin}
            onClose={() => setSelectedId(null)}
          />
        ) : null}

        <div className="places-summary" role="status">
          <span>
            <strong>{visible.length}</strong> lieu{visible.length > 1 ? "x" : ""}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <strong>{stats.totals.postsWithPlaces}</strong> posts
          </span>
          {stats.totals.needsReview > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="places-summary-review">{stats.totals.needsReview} à vérifier</span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <button type="button" className="places-link" aria-expanded={statsOpen} onClick={() => setStatsOpen((open) => !open)}>
            <BarChart3 size={13} aria-hidden="true" /> Statistiques
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" className="places-link" aria-expanded={listOpen} onClick={toggleList}>
            <ListFilter size={13} aria-hidden="true" /> Liste
          </button>
        </div>

        {truncated ? (
          <p className="places-truncated" role="status">
            Seuls les 1000 lieux les plus récents sont affichés.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="places-filter-group">
      <legend>{label}</legend>
      {children}
    </fieldset>
  );
}

function FilterOption({
  checked,
  label,
  count,
  swatch,
  onToggle,
}: {
  checked: boolean;
  label: string;
  count?: number;
  swatch?: string;
  onToggle: () => void;
}) {
  return (
    <label className="places-option">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className={cn("places-checkbox", checked && "is-checked")} aria-hidden="true">
        {checked ? <Check size={12} /> : null}
      </span>
      {swatch ? <span className={cn("places-swatch", `is-${swatch.toLowerCase()}`)} aria-hidden="true" /> : null}
      <span className="places-option-label">{label}</span>
      {count != null ? <span className="places-option-count">{count}</span> : null}
    </label>
  );
}

function StatBars({ label, rows }: { label: string; rows: Array<{ key: string; label: string; value: number }> }) {
  const max = rows.reduce((peak, row) => Math.max(peak, row.value), 0) || 1;
  return (
    <div className="places-stat-block">
      <p className="places-stat-label">{label}</p>
      {rows.length === 0 ? <p className="places-stat-empty">Aucune donnée.</p> : null}
      {rows.map((row) => (
        <div className="places-stat-row" key={row.key}>
          <span className="places-stat-key">{row.label}</span>
          <span className="places-stat-track">
            <span className="places-stat-fill" style={{ width: `${Math.round((row.value / max) * 100)}%` }} />
          </span>
          <span className="places-stat-value">{row.value}</span>
        </div>
      ))}
    </div>
  );
}
