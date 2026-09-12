"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowUp, Grid2X2, LayoutGrid, LogIn, LogOut, MapPin, Search, Settings2, SlidersHorizontal, Sparkles, Upload, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ThemeMenu } from "@/components/theme-menu";
import { Brand } from "@/components/brand";
import { FilterContent, MobileFilterDrawer, type TagFacet } from "@/features/library/components/filter-panel";
import { ImportDialog } from "@/features/library/components/import-dialog";
import { EmptyLibrary, LibraryError, NoResults } from "@/features/library/components/library-states";
import { LibraryStatsDialog } from "@/features/library/components/library-stats-dialog";
import { MediaRepairDialog } from "@/features/library/components/media-repair-dialog";
import { PostCard } from "@/features/library/components/post-card";
import { PostDetailDialog } from "@/features/library/components/post-detail-dialog";
import { RefreshPostsControl, useRefreshPosts } from "@/features/library/components/refresh-posts-button";
import { CollectionManager } from "@/features/library/components/collection-manager";
import { AuthorAutocomplete, type AuthorOption } from "@/features/library/components/author-autocomplete";
import { useDebouncedValue } from "@/features/library/hooks/use-debounced-value";
import type { ContentTypeFilter } from "@/features/library/query-state";
import type { LibraryCollection, LibraryPost, LibraryYear, SortMode, TagMode, ViewMode } from "@/features/library/types";
import { cn } from "@/lib/utils";

export type LibraryInitialState = {
  query: string;
  tags: string[];
  theme: string | null;
  contentType: ContentTypeFilter | null;
  author: string | null;
  year: number | null;
  collection: string | null;
  tagMode: TagMode;
  sort: SortMode;
  view: ViewMode;
  postId: string | null;
};

export function LibraryExplorer({
  posts: initialPosts,
  initialNextCursor,
  initialTotalFiltered,
  initialTotalLibrary,
  initialState,
  initialMainThemes,
  initialTagFacets,
  initialCollections,
  initialYears,
  initialError,
  isAdmin,
}: {
  posts: LibraryPost[];
  initialNextCursor: string | null;
  initialTotalFiltered: number;
  initialTotalLibrary: number;
  initialState: LibraryInitialState;
  initialMainThemes: string[];
  initialTagFacets: TagFacet[];
  initialCollections: LibraryCollection[];
  initialYears: LibraryYear[];
  initialError?: string;
  isAdmin: boolean;
}) {
  const refreshPosts = useRefreshPosts(() => window.location.reload(), isAdmin);
  const [posts, setPosts] = useState(initialPosts);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [totalFiltered, setTotalFiltered] = useState(initialTotalFiltered);
  const [totalLibrary, setTotalLibrary] = useState(initialTotalLibrary);
  const [loadingMore, setLoadingMore] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialState.query);
  const [selectedTags, setSelectedTags] = useState(initialState.tags);
  const [selectedTheme, setSelectedTheme] = useState(initialState.theme);
  const [selectedContentType, setSelectedContentType] = useState(initialState.contentType);
  const [selectedAuthor, setSelectedAuthor] = useState(initialState.author ?? "");
  const [selectedYear, setSelectedYear] = useState<number | null>(initialState.year);
  const [selectedCollection, setSelectedCollection] = useState(initialState.collection);
  const [tagMode, setTagMode] = useState<TagMode>(initialState.tagMode);
  const [sort, setSort] = useState<SortMode>(initialState.sort);
  const [view, setView] = useState<ViewMode>(initialState.view);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(initialState.postId);
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [mediaRepairOpen, setMediaRepairOpen] = useState(false);
  const [isFiltering, setIsFiltering] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const initialRequest = useRef(true);
  const debouncedQuery = useDebouncedValue(query, 250);
  const debouncedAuthor = useDebouncedValue(selectedAuthor, 200);
  const [authorOptions, setAuthorOptions] = useState<AuthorOption[]>(() => [...new Set(initialPosts.map((post) => post.authorUsername))].sort((a, b) => a.localeCompare(b, "fr-FR")));

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: "12" });
    if (debouncedAuthor) params.set("q", debouncedAuthor.replace(/^@/, ""));
    fetch(`/api/authors?${params}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: { items?: Array<{ username: string; postCount: number }> }) => setAuthorOptions(payload.items ?? []))
      .catch((error) => { if (error?.name !== "AbortError") setAuthorOptions([]); });
    return () => controller.abort();
  }, [debouncedAuthor]);

  useEffect(() => {
    const updateVisibility = () => setShowBackToTop(window.scrollY > 480);
    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateVisibility);
  }, []);

  const facets = initialTagFacets.filter((facet) => facet.name !== "Favoris");
  const regularSelectedTags = selectedTags.filter((tag) => tag !== "Favoris");
  const activeFilterCount = selectedTags.length
    + Number(Boolean(query.trim()))
    + Number(Boolean(selectedTheme))
    + Number(Boolean(selectedContentType))
    + Number(Boolean(selectedAuthor))
    + Number(Boolean(selectedYear))
    + Number(Boolean(selectedCollection));

  const mainThemes = initialMainThemes;

  const filteredPosts = useMemo(() => {
    const normalizedQuery = normalize(debouncedQuery);
    const filtered = posts.filter((post) => {
      const matchesQuery = !normalizedQuery || normalize(`${post.caption} ${post.authorUsername} ${post.tags.join(" ")}`).includes(normalizedQuery);
      const matchesTags = selectedTags.length === 0 || (tagMode === "and"
        ? selectedTags.every((tag) => post.tags.includes(tag))
        : selectedTags.some((tag) => post.tags.includes(tag)));
      return matchesQuery && matchesTags && (!selectedTheme || post.mainTheme === selectedTheme)
        && (!selectedContentType || post.contentType === selectedContentType)
        && (!selectedAuthor || normalize(post.authorUsername) === normalize(selectedAuthor))
        && (!selectedYear || (!!post.publishedAt && new Date(post.publishedAt).getUTCFullYear() === selectedYear))
        && (!selectedCollection || post.collections.includes(selectedCollection) || (selectedCollection === "favoris" && post.tags.includes("Favoris")));
    });
    return filtered.sort((a, b) => comparePosts(a, b, sort));
  }, [debouncedQuery, posts, selectedAuthor, selectedCollection, selectedContentType, selectedTags, selectedTheme, selectedYear, sort, tagMode]);

  const selectedIndex = filteredPosts.findIndex((post) => post.id === selectedPostId);
  const selectedPost = selectedIndex >= 0 ? filteredPosts[selectedIndex] : null;

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (selectedTags.length) params.set("tags", selectedTags.join(","));
    if (selectedTheme) params.set("theme", selectedTheme);
    if (selectedContentType) params.set("type", selectedContentType);
    if (selectedAuthor) params.set("author", selectedAuthor);
    if (selectedYear) params.set("year", String(selectedYear));
    if (selectedCollection) params.set("collection", selectedCollection);
    if (tagMode !== "and") params.set("tagMode", tagMode);
    if (sort !== "newest") params.set("sort", sort);
    if (view !== "masonry") params.set("view", view);
    if (selectedPostId) params.set("post", selectedPostId);
    const nextUrl = `${window.location.pathname}${params.size ? `?${params.toString()}` : ""}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [debouncedQuery, selectedAuthor, selectedCollection, selectedContentType, selectedPostId, selectedTags, selectedTheme, selectedYear, sort, tagMode, view]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    if (initialRequest.current) {
      initialRequest.current = false;
      return;
    }

    const controller = new AbortController();
    const refresh = async () => {
      setRequestError(null);
      setIsFiltering(true);
      try {
        const response = await fetch(`/api/posts?${librarySearchParams({
          query: debouncedQuery,
          selectedTags,
          selectedTheme,
          selectedContentType,
          selectedAuthor,
          selectedYear,
          selectedCollection,
          tagMode,
          sort,
        })}`, { signal: controller.signal });
        if (!response.ok) throw new Error("REQUEST_FAILED");
        const page = (await response.json()) as { items: LibraryPost[]; nextCursor: string | null; totalFiltered: number; totalLibrary: number };
        setPosts(page.items);
        setNextCursor(page.nextCursor);
        setTotalFiltered(page.totalFiltered);
        setTotalLibrary(page.totalLibrary);
        setSelectedPostId(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRequestError("Impossible d’actualiser les résultats.");
      } finally {
        if (!controller.signal.aborted) setIsFiltering(false);
      }
    };
    void refresh();
    return () => controller.abort();
  }, [debouncedQuery, selectedAuthor, selectedCollection, selectedContentType, selectedTags, selectedTheme, selectedYear, sort, tagMode]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setRequestError(null);
    try {
      const response = await fetch(`/api/posts?${librarySearchParams({
        query: debouncedQuery,
        selectedTags,
        selectedTheme,
        selectedContentType,
        selectedAuthor,
        selectedYear,
        selectedCollection,
        tagMode,
        sort,
        cursor: nextCursor,
      })}`);
      if (!response.ok) throw new Error("REQUEST_FAILED");
      const page = (await response.json()) as { items: LibraryPost[]; nextCursor: string | null; totalFiltered: number; totalLibrary: number };
      setPosts((current) => {
        const byId = new Map(current.map((post) => [post.id, post]));
        for (const post of page.items) byId.set(post.id, post);
        return [...byId.values()];
      });
      setNextCursor(page.nextCursor);
      setTotalFiltered(page.totalFiltered);
      setTotalLibrary(page.totalLibrary);
    } catch {
      setRequestError("Impossible de charger la suite des résultats.");
    } finally {
      setLoadingMore(false);
    }
  }, [debouncedQuery, loadingMore, nextCursor, selectedAuthor, selectedCollection, selectedContentType, selectedTags, selectedTheme, selectedYear, sort, tagMode]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !nextCursor || loadingMore || isFiltering) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "500px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [isFiltering, loadMore, loadingMore, nextCursor]);

  const toggleTag = useCallback((tag: string) => {
    setIsFiltering(true);
    setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  }, []);

  const toggleFavorite = useCallback(async (post: LibraryPost) => {
    const favorite = post.tags.includes("Favoris");
    setPosts((current) => current.map((item) => item.id === post.id
      ? { ...item, tags: favorite ? item.tags.filter((tag) => tag !== "Favoris") : [...item.tags, "Favoris"] }
      : item));
    setRequestError(null);
    try {
      const favoriteCollection = initialCollections.find((collection) => collection.slug === "favoris");
      if (!favoriteCollection) throw new Error("FAVORITES_COLLECTION_MISSING");
      const response = await fetch(`/api/collections/${encodeURIComponent(favoriteCollection.id)}/posts/${encodeURIComponent(post.id)}`, {
        method: favorite ? "DELETE" : "PUT",
      });
      if (!response.ok) throw new Error("FAVORITE_FAILED");
    } catch {
      setPosts((current) => current.map((item) => item.id === post.id ? post : item));
      setRequestError("Impossible de modifier les favoris.");
    }
  }, [initialCollections]);

  const resetFilters = useCallback(() => {
    setQuery("");
    setSelectedTags([]);
    setSelectedTheme(null);
    setSelectedContentType(null);
    setSelectedAuthor(""); setSelectedYear(null); setSelectedCollection(null);
    setTagMode("and");
  }, []);

  const discoverPost = useCallback(async () => {
    setDiscovering(true);
    setRequestError(null);
    try {
      const params = librarySearchParams({
        query: debouncedQuery,
        selectedTags,
        selectedTheme,
        selectedContentType,
        selectedAuthor,
        selectedYear,
        selectedCollection,
        tagMode,
        sort,
      });
      const response = await fetch(`/api/posts?${params}&random=1`);
      if (!response.ok) throw new Error("DISCOVERY_FAILED");
      const { item } = (await response.json()) as { item: LibraryPost | null };
      if (!item) return;
      setPosts((current) => current.some((post) => post.id === item.id) ? current : [...current, item]);
      setSelectedPostId(item.id);
    } catch {
      setRequestError("Impossible de proposer une découverte pour le moment.");
    } finally {
      setDiscovering(false);
    }
  }, [debouncedQuery, selectedAuthor, selectedCollection, selectedContentType, selectedTags, selectedTheme, selectedYear, sort, tagMode]);

  const showPrevious = useCallback(() => {
    if (!filteredPosts.length) return;
    const nextIndex = selectedIndex <= 0 ? filteredPosts.length - 1 : selectedIndex - 1;
    setSelectedPostId(filteredPosts[nextIndex].id);
  }, [filteredPosts, selectedIndex]);

  const showNext = useCallback(() => {
    if (!filteredPosts.length) return;
    const nextIndex = selectedIndex < 0 || selectedIndex === filteredPosts.length - 1 ? 0 : selectedIndex + 1;
    setSelectedPostId(filteredPosts[nextIndex].id);
  }, [filteredPosts, selectedIndex]);

  const filterProps = { facets, selectedTags, tagMode, onTagModeChange: setTagMode, onToggleTag: toggleTag, onReset: resetFilters, selectedContentType, onContentTypeChange: (type: ContentTypeFilter | null) => { setIsFiltering(true); setSelectedContentType(type); }, canReset: activeFilterCount > 0 };
  const selectedCollectionName = initialCollections.find((collection) => collection.slug === selectedCollection)?.name ?? selectedCollection;

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" href="/" aria-label="Insta Post Explorer, accueil"><Brand compact /></Link>
        <label className="global-search">
          <Search aria-hidden="true" className="size-4" />
          <span className="sr-only">Rechercher dans la bibliothèque</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Rechercher parmi ${totalLibrary.toLocaleString("fr-FR")} souvenirs`}
          />
          <kbd>⌘ K</kbd>
        </label>
        <nav className="header-actions" aria-label="Actions principales">
          {/* Places is a permanent destination, on desktop and mobile alike. */}
          <Link className="header-tab places-tab" href="/places">
            <MapPin aria-hidden="true" className="size-4" /> <span>Places</span>
          </Link>
          <button
            className="header-tab desktop-only"
            type="button"
            disabled={discovering || totalFiltered === 0}
            onClick={() => void discoverPost()}
          >
            <Sparkles aria-hidden="true" className="size-4" /> {discovering ? "Recherche…" : "Découverte"}
          </button>
          {isAdmin ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="button manage-button" type="button" aria-label="Gérer la bibliothèque">
                  <Settings2 aria-hidden="true" className="size-4" /><span>Gérer</span>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="menu-content manage-menu" align="end" sideOffset={8}>
                  <DropdownMenu.Label className="menu-label">Administration</DropdownMenu.Label>
                  <RefreshPostsControl menuItem controller={refreshPosts} />
                  <DropdownMenu.Item asChild>
                    <button className="menu-item" type="button" onClick={() => setMediaRepairOpen(true)}>
                      <Wrench aria-hidden="true" className="size-4" />Réparer les médias
                    </button>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item asChild>
                    <button className="menu-item" type="button" onClick={() => setImportOpen(true)}>
                      <Upload aria-hidden="true" className="size-4" />Importer JSON
                    </button>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="menu-separator" />
                  <form action="/api/auth/logout" method="post" role="none">
                    <DropdownMenu.Item asChild>
                      <button className="menu-item" type="submit">
                        <LogOut aria-hidden="true" className="size-4" />Quitter le mode admin
                      </button>
                    </DropdownMenu.Item>
                  </form>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : null}
          <LibraryStatsDialog />
          <ThemeMenu />
          {!isAdmin ? (
            <Link className="button" href="/login" aria-label="Ouvrir la connexion administrateur">
              <LogIn aria-hidden="true" className="size-4" />
              <span className="desktop-only">Admin</span>
            </Link>
          ) : null}
        </nav>
      </header>

      <section className="mobile-sticky-toolbar" aria-label="Filtres et tri rapides">
        <button className={cn("button mobile-filter-trigger", activeFilterCount > 0 && "is-active")} type="button" aria-label={`Ouvrir les filtres, ${activeFilterCount} actif${activeFilterCount === 1 ? "" : "s"}`} aria-haspopup="dialog" aria-expanded={mobileFiltersOpen} onClick={() => setMobileFiltersOpen(true)}>
          <SlidersHorizontal aria-hidden="true" className="size-4 text-accent" /> Filtres
          {activeFilterCount ? <span className="count-badge" aria-hidden="true">{activeFilterCount}</span> : null}
        </button>
        <strong className="results-count tabular-nums" aria-live="polite">{totalFiltered.toLocaleString("fr-FR")}</strong>
        <label className="mobile-sort-control"><span className="sr-only">Trier les résultats</span><select aria-label="Trier les résultats" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
          <option value="newest">Plus récents</option><option value="oldest">Plus anciens</option><option value="author">Auteur</option><option value="relevance">Pertinence</option><option value="likes">Plus likés</option>
        </select></label>
        <div className="view-switch" aria-label="Mode d’affichage">
          <button type="button" aria-label="Grille régulière" aria-pressed={view === "grid"} className={cn(view === "grid" && "is-active")} onClick={() => setView("grid")}><Grid2X2 aria-hidden="true" className="size-4" /></button>
          <button type="button" aria-label="Grille masonry" aria-pressed={view === "masonry"} className={cn(view === "masonry" && "is-active")} onClick={() => setView("masonry")}><LayoutGrid aria-hidden="true" className="size-4" /></button>
        </div>
        {activeFilterCount > 0 ? (
          <div className="mobile-active-filters" aria-label="Filtres actifs">
            {query.trim() ? <ActiveMobileFilter label={`Recherche : ${query.trim()}`} onRemove={() => setQuery("")} /> : null}
            {selectedTheme ? <ActiveMobileFilter label={themeLabel(selectedTheme)} onRemove={() => setSelectedTheme(null)} /> : null}
            {selectedContentType ? <ActiveMobileFilter label={contentTypeLabel(selectedContentType)} onRemove={() => setSelectedContentType(null)} /> : null}
            {selectedAuthor ? <ActiveMobileFilter label={`@${selectedAuthor.replace(/^@/, "")}`} onRemove={() => setSelectedAuthor("")} /> : null}
            {selectedYear ? <ActiveMobileFilter label={String(selectedYear)} onRemove={() => setSelectedYear(null)} /> : null}
            {selectedCollection ? <ActiveMobileFilter label={selectedCollectionName ?? selectedCollection} onRemove={() => setSelectedCollection(null)} /> : null}
            {selectedTags.map((tag) => <ActiveMobileFilter key={tag} label={tag} onRemove={() => toggleTag(tag)} />)}
            <button className="mobile-clear-filters" type="button" onClick={resetFilters}>Tout effacer</button>
          </div>
        ) : null}
      </section>

      <section className="control-ribbon" aria-label="Filtres et tri">
        <button className="button desktop-only" type="button" aria-expanded={filtersVisible} onClick={() => setFiltersVisible((value) => !value)}>
          <SlidersHorizontal aria-hidden="true" className="size-4 text-accent" /> Filtres avancés
        </button>
        <button className="button mobile-only mobile-filter-trigger" type="button" aria-label={`Ouvrir les filtres, ${activeFilterCount} actif${activeFilterCount === 1 ? "" : "s"}`} aria-haspopup="dialog" aria-expanded={mobileFiltersOpen} onClick={() => setMobileFiltersOpen(true)}>
          <SlidersHorizontal aria-hidden="true" className="size-4 text-accent" /> Filtres
          {activeFilterCount ? <span className="count-badge" aria-hidden="true">{activeFilterCount}</span> : null}
        </button>

        <div className="main-theme-filters" aria-label="Filtres principaux">
          {mainThemes.map((theme) => (
            <button
              key={theme}
              type="button"
              className={cn(selectedTheme === theme && "is-active")}
              aria-pressed={selectedTheme === theme}
              onClick={() => {
                setIsFiltering(true);
                setSelectedTheme((current) => current === theme ? null : theme);
              }}
            >
              {themeLabel(theme)}
            </button>
          ))}
          <button
            type="button"
            className={cn(selectedCollection === "favoris" && "is-active")}
            aria-pressed={selectedCollection === "favoris"}
            onClick={() => setSelectedCollection((current) => current === "favoris" ? null : "favoris")}
          >
            Favoris
          </button>
        </div>

        <div className="active-tags" aria-label="Tags actifs">
          {regularSelectedTags.length ? regularSelectedTags.map((tag) => (
            <button key={tag} type="button" onClick={() => toggleTag(tag)} aria-label={`Retirer le tag ${tag}`}>
              {tag}<X aria-hidden="true" className="size-3" />
            </button>
          )) : null}
          {regularSelectedTags.length ? <span className="mode-pill">Mode {tagMode.toLocaleUpperCase("fr-FR")}</span> : null}
        </div>

        <div className="ribbon-end">
          <div className="compact-control author-control"><span className="compact-control-label">Auteur</span><AuthorAutocomplete options={authorOptions} value={selectedAuthor} onValueChange={setSelectedAuthor} /></div>
          <label className="compact-control year-control"><span className="compact-control-label">Année</span><select aria-label="Filtrer par année" value={selectedYear ?? ""} onChange={(event) => setSelectedYear(event.target.value ? Number(event.target.value) : null)}>
            <option value="">Toutes les années</option>
            {initialYears.map(({ year, count }) => <option key={year} value={year}>{year} ({count})</option>)}
          </select></label>
          <label className="compact-control collection-control"><span className="compact-control-label">Collection</span><select aria-label="Filtrer par collection" value={selectedCollection ?? ""} onChange={(event) => setSelectedCollection(event.target.value || null)}>
            <option value="">Toutes les collections</option>{initialCollections.map((collection) => <option key={collection.id} value={collection.slug}>{collection.name} ({collection.count})</option>)}
          </select></label>
          <strong className="results-count tabular-nums" aria-live="polite">
            {totalFiltered.toLocaleString("fr-FR")} <span>résultats</span>
          </strong>
          <span className="loaded-count tabular-nums">{filteredPosts.length.toLocaleString("fr-FR")} chargés</span>
          <label className="compact-control sort-control"><span className="compact-control-label">Trier par</span><select aria-label="Trier les résultats" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
            <option value="newest">Plus récents</option>
            <option value="oldest">Plus anciens</option>
            <option value="author">Auteur</option>
            <option value="relevance">Pertinence</option>
            <option value="likes">Plus likés</option>
          </select></label>
          {(query || selectedTags.length || selectedTheme || selectedContentType) ? <button className="text-button desktop-only" type="button" onClick={resetFilters}>Effacer les filtres</button> : null}
          <div className="view-switch" aria-label="Mode d’affichage">
            <button type="button" aria-label="Grille régulière" aria-pressed={view === "grid"} className={cn(view === "grid" && "is-active")} onClick={() => setView("grid")}><Grid2X2 aria-hidden="true" className="size-4" /></button>
            <button type="button" aria-label="Grille masonry" aria-pressed={view === "masonry"} className={cn(view === "masonry" && "is-active")} onClick={() => setView("masonry")}><LayoutGrid aria-hidden="true" className="size-4" /></button>
          </div>
        </div>
      </section>

      <main className={cn("library-layout", filtersVisible && "has-filters")}>
        {filtersVisible ? <aside className="desktop-filter-panel desktop-only"><FilterContent {...filterProps} />{isAdmin ? <CollectionManager initialCollections={initialCollections} /> : null}</aside> : null}
        <section className="library-content" aria-label="Publications sauvegardées" aria-live="polite" aria-busy={isFiltering}>
          {requestError ? <p className="request-error" role="alert">{requestError}</p> : null}
          {isFiltering ? (
            <div className="filter-loading" role="status"><span className="loading-spinner" aria-hidden="true" />Chargement des résultats…</div>
          ) : initialError ? <LibraryError message={initialError} /> : posts.length === 0 ? <EmptyLibrary onImport={isAdmin ? () => setImportOpen(true) : undefined} /> : filteredPosts.length === 0 ? <NoResults onReset={resetFilters} /> : (
            <>
              <div className={cn("posts-grid", view === "masonry" ? "posts-masonry" : "posts-regular", view === "masonry" && filteredPosts.length <= 4 && "posts-masonry-sparse", view === "masonry" && filteredPosts.length === 1 && "posts-masonry-single")}>
                {filteredPosts.map((post) => <PostCard key={post.id} post={post} view={view} onOpen={() => setSelectedPostId(post.id)} isAdmin={isAdmin} onToggleFavorite={() => void toggleFavorite(post)} />)}
              </div>
              {nextCursor ? (
                <div className="load-more-row" ref={loadMoreRef}>
                  <button className="button" type="button" disabled={loadingMore} onClick={() => void loadMore()}>
                    {loadingMore ? "Chargement…" : `Charger la suite (${filteredPosts.length.toLocaleString("fr-FR")} sur ${totalFiltered.toLocaleString("fr-FR")})`}
                  </button>
                  {loadingMore ? <div className="loading-card-skeletons" aria-hidden="true"><span /><span /><span /></div> : null}
                </div>
              ) : null}
            </>
          )}
        </section>
      </main>

      <MobileFilterDrawer
        open={mobileFiltersOpen}
        onOpenChange={setMobileFiltersOpen}
        mobileSecondaryControls={(
          <>
            <div className="compact-control author-control"><span className="compact-control-label">Auteur</span><AuthorAutocomplete options={authorOptions} value={selectedAuthor} onValueChange={setSelectedAuthor} label="Filtrer par auteur dans le drawer" forceBelow /></div>
            <label className="compact-control year-control"><span className="compact-control-label">Année</span><select aria-label="Filtrer par année dans le drawer" value={selectedYear ?? ""} onChange={(event) => setSelectedYear(event.target.value ? Number(event.target.value) : null)}>
              <option value="">Toutes les années</option>
              {initialYears.map(({ year, count }) => <option key={year} value={year}>{year} ({count})</option>)}
            </select></label>
            <label className="compact-control collection-control"><span className="compact-control-label">Collection</span><select aria-label="Filtrer par collection dans le drawer" value={selectedCollection ?? ""} onChange={(event) => setSelectedCollection(event.target.value || null)}>
              <option value="">Toutes les collections</option>{initialCollections.map((collection) => <option key={collection.id} value={collection.slug}>{collection.name} ({collection.count})</option>)}
            </select></label>
          </>
        )}
        {...filterProps}
      />
      {showBackToTop ? <button className="back-to-top" type="button" aria-label="Retour en haut de la page" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}><ArrowUp aria-hidden="true" className="size-4" /><span>Retour en haut</span></button> : null}
      {isAdmin ? (
        <>
          <ImportDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            onImported={() => window.location.reload()}
          />
          <MediaRepairDialog
            open={mediaRepairOpen}
            onOpenChange={setMediaRepairOpen}
            onRepaired={() => window.location.reload()}
          />
        </>
      ) : null}
      <PostDetailDialog
        post={selectedPost}
        position={selectedIndex}
        total={totalFiltered}
        onClose={() => setSelectedPostId(null)}
        onPrevious={showPrevious}
        onNext={showNext}
        isAdmin={isAdmin}
      />
    </div>
  );
}

function themeLabel(theme: string) {
  return ["cuisne", "cusine"].includes(normalize(theme)) ? "Cuisine" : theme;
}

function contentTypeLabel(type: ContentTypeFilter) {
  return type === "image" ? "Photos" : type === "carousel" ? "Carrousels" : "Vidéos";
}

function ActiveMobileFilter({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <button type="button" className="mobile-filter-chip" aria-label={`Retirer le filtre ${label}`} onClick={onRemove}><span className="truncate">{label}</span><X aria-hidden="true" className="size-3" /></button>;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR");
}

function comparePosts(a: LibraryPost, b: LibraryPost, sort: SortMode) {
  if (sort === "author") return a.authorUsername.localeCompare(b.authorUsername, "fr-FR");
  if (sort === "relevance") return 0;
  if (sort === "likes") return (b.likesCount ?? -1) - (a.likesCount ?? -1);
  const aDate = Date.parse(a.savedAt || a.createdAt || "1970-01-01");
  const bDate = Date.parse(b.savedAt || b.createdAt || "1970-01-01");
  return sort === "oldest" ? aDate - bDate : bDate - aDate;
}

function librarySearchParams(input: {
  query: string;
  selectedTags: string[];
  selectedTheme: string | null;
  selectedContentType: ContentTypeFilter | null;
  selectedAuthor: string;
  selectedYear: number | null;
  selectedCollection: string | null;
  tagMode: TagMode;
  sort: SortMode;
  cursor?: string;
}) {
  const params = new URLSearchParams({
    limit: "30",
    tagMode: input.tagMode,
    sort: input.sort,
  });
  if (input.query) params.set("q", input.query);
  if (input.selectedTags.length) params.set("tags", input.selectedTags.join(","));
  if (input.selectedTheme) params.set("theme", input.selectedTheme);
  if (input.selectedContentType) params.set("type", input.selectedContentType);
  if (input.selectedAuthor) params.set("author", input.selectedAuthor);
  if (input.selectedYear) params.set("year", String(input.selectedYear));
  if (input.selectedCollection) params.set("collection", input.selectedCollection);
  if (input.cursor) params.set("cursor", input.cursor);
  return params.toString();
}
