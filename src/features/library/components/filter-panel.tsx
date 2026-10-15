"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Check, Image, Images, Search, SlidersHorizontal, Trash2, Video, X } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { TagMode } from "@/features/library/types";
import type { ContentTypeFilter } from "@/features/library/query-state";
import { cn } from "@/lib/utils";

export type TagFacet = { name: string; count: number };

type FilterContentProps = {
  facets: TagFacet[];
  selectedTags: string[];
  tagMode: TagMode;
  onTagModeChange: (mode: TagMode) => void;
  onToggleTag: (tag: string) => void;
  onReset: () => void;
  selectedContentType: ContentTypeFilter | null;
  onContentTypeChange: (type: ContentTypeFilter | null) => void;
  canReset?: boolean;
};

export const FilterContent = memo(function FilterContent({
  facets,
  selectedTags,
  tagMode,
  onTagModeChange,
  onToggleTag,
  onReset,
  selectedContentType,
  onContentTypeChange,
  canReset,
}: FilterContentProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"frequency" | "alphabetical">("frequency");
  const visibleFacets = useMemo(() => {
    const normalizedQuery = normalize(query);
    const filtered = facets.filter((facet) => normalize(facet.name).includes(normalizedQuery));
    return filtered.sort((a, b) =>
      sort === "frequency" ? b.count - a.count || a.name.localeCompare(b.name) : a.name.localeCompare(b.name),
    );
  }, [facets, query, sort]);

  return (
    <div className="filter-content">
      <div className="filter-heading">
        <SlidersHorizontal aria-hidden="true" className="size-4 text-accent" />
        <h2 className="text-balance font-semibold">Filtres avancés</h2>
      </div>

      <fieldset className="media-type-fieldset">
        <legend className="field-label">Type de média</legend>
        <div className="segmented media-type-segmented">
          {([null, "image", "carousel", "reel"] as const).map((type) => {
            const config = type === null ? ["Tous", null] as const : type === "image" ? ["Photo", Image] as const : type === "carousel" ? ["Carrousel", Images] as const : ["Vidéo", Video] as const;
            const Icon = config[1];
            return <button key={type ?? "all"} type="button" className={cn(selectedContentType === type && "is-active")} aria-pressed={selectedContentType === type} onClick={() => onContentTypeChange(type)}>{Icon ? <Icon aria-hidden="true" className="size-3.5" /> : null}{config[0]}</button>;
          })}
        </div>
      </fieldset>

      <label className="field-label" htmlFor="tag-search">
        Recherche de tags
      </label>
      <div className="input-shell">
        <Search aria-hidden="true" className="size-4" />
        <input
          id="tag-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher un tag…"
        />
      </div>

      <div className="filter-row">
        <span className="field-label">Correspondance</span>
        <div className="segmented" aria-label="Mode de correspondance des tags">
          <button
            type="button"
            className={cn(tagMode === "or" && "is-active")}
            aria-pressed={tagMode === "or"}
            onClick={() => onTagModeChange("or")}
          >
            OU
          </button>
          <button
            type="button"
            className={cn(tagMode === "and" && "is-active")}
            aria-pressed={tagMode === "and"}
            onClick={() => onTagModeChange("and")}
          >
            ET
          </button>
        </div>
      </div>

      <div className="filter-row">
        <span className="field-label">Trier les tags</span>
        <select aria-label="Trier les tags" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
          <option value="frequency">Fréquence</option>
          <option value="alphabetical">A–Z</option>
        </select>
      </div>

      <div className="tag-list" aria-label="Tags disponibles">
        {visibleFacets.slice(0, 80).map((facet) => {
          const selected = selectedTags.includes(facet.name);
          return (
            <button
              key={facet.name}
              type="button"
              className={cn("tag-option", selected && "is-selected")}
              aria-pressed={selected}
              onClick={() => onToggleTag(facet.name)}
            >
              <span className="tag-check" aria-hidden="true">{selected ? <Check className="size-3" /> : null}</span>
              <span className="truncate">{facet.name}</span>
              <span className="ml-auto tabular-nums text-muted">{facet.count.toLocaleString("fr-FR")}</span>
            </button>
          );
        })}
        {visibleFacets.length === 0 ? <p className="p-3 text-pretty text-sm text-muted">Aucun tag trouvé.</p> : null}
      </div>

      <button className="button w-full" type="button" onClick={onReset} disabled={canReset !== undefined ? !canReset : selectedTags.length === 0 && selectedContentType === null}>
        <Trash2 aria-hidden="true" className="size-4" />
        Effacer les filtres
      </button>
    </div>
  );
});

export function MobileFilterDrawer({ open, onOpenChange, mobileSecondaryControls, ...props }: FilterContentProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mobileSecondaryControls?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="filter-drawer"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.querySelector<HTMLButtonElement>(".mobile-filter-trigger")?.focus();
          }}
        >
          <header className="drawer-header">
          <Dialog.Title>Filtres avancés</Dialog.Title>
          <Dialog.Close asChild>
            <button className="icon-button drawer-close" type="button" aria-label="Fermer les filtres">
              <X aria-hidden="true" className="size-4" />
            </button>
          </Dialog.Close>
          </header>
          {mobileSecondaryControls ? <div className="drawer-mobile-secondary" aria-label="Filtres auteur, année et collection">{mobileSecondaryControls}</div> : null}
          <FilterContent {...props} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR").trim();
}
