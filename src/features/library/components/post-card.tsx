"use client";

import { Heart, Images, Play } from "lucide-react";
import { useCallback, useState } from "react";

import { BrokenImage } from "@/features/library/components/library-states";
import type { LibraryPost, ViewMode } from "@/features/library/types";
import { cn } from "@/lib/utils";

export function PostCard({ post, view, onOpen, isAdmin, onToggleFavorite, selection }: { post: LibraryPost; view: ViewMode; onOpen: (trigger: HTMLButtonElement) => void; isAdmin: boolean; onToggleFavorite: () => void; selection?: { checked: boolean; disabled: boolean; onToggle: () => void } }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [videoPreviewActive, setVideoPreviewActive] = useState(false);
  const [mediaRatio, setMediaRatio] = useState<number | null>(null);
  const measureLoadedImage = useCallback((image: HTMLImageElement | null) => {
    // SSR/cache images can finish before React attaches its load handler.
    // Recover their real proportions instead of keeping the shared placeholder.
    if (image?.complete) {
      if (image.naturalWidth > 0) setMediaRatio(validMediaRatio(image.naturalWidth, image.naturalHeight));
      else if (image.getAttribute("src")) setImageFailed(true);
    }
  }, []);
  const previewVideo = post.media.find((media) => media.type === "video" && media.url);
  const imageUrl = post.thumbnailUrl || post.mediaUrl || "";
  const TypeIcon = post.contentType === "reel" ? Play : post.contentType === "carousel" ? Images : null;
  const favorite = post.tags.includes("Favoris");
  const visibleTags = isAdmin ? post.tags : post.tags.filter((tag) => tag !== "Favoris");

  return (
    <article className={cn("post-card", view === "masonry" && "post-card-masonry", selection?.checked && "is-selected")}>
      <button
        className="post-card-button"
        type="button"
        data-post-id={post.id}
        onClick={event => { if (selection) selection.onToggle(); else onOpen(event.currentTarget); }}
        disabled={selection?.disabled}
        aria-pressed={selection?.checked}
        onMouseEnter={() => {
          if (!selection && window.matchMedia("(hover: hover) and (pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) setVideoPreviewActive(true);
        }}
        onMouseLeave={() => setVideoPreviewActive(false)}
        onFocus={(event) => { if (!selection && event.currentTarget.matches(":focus-visible") && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) setVideoPreviewActive(true); }}
        onBlur={() => setVideoPreviewActive(false)}
        aria-label={`${selection ? "Sélectionner" : "Ouvrir"} la publication de ${post.authorUsername}`}
      >
        <div className="post-media" style={{ aspectRatio: view === "masonry" ? mediaRatio ?? "4 / 5" : "1" }}>
          {imageFailed || !imageUrl ? (
            <BrokenImage />
          ) : (
            // Media URLs are validated as public HTTPS URLs during import. We avoid
            // forwarding the application URL to third-party image hosts.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={measureLoadedImage}
              src={imageUrl}
              alt={`Média de la publication de ${post.authorUsername}`}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              width={600}
              height={view === "masonry" ? 750 : 600}
              onLoad={(event) => setMediaRatio(validMediaRatio(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight))}
              onError={() => setImageFailed(true)}
            />
          )}
          {/* Preserve the poster as the pointer target: replacing it between
              pointerdown and pointerup can cancel the native click. */}
          {videoPreviewActive && previewVideo?.url ? (
            <video
              className="post-preview-video"
              src={previewVideo.url}
              poster={(previewVideo.thumbnailUrl ?? imageUrl) || undefined}
              muted loop autoPlay playsInline preload="metadata" aria-hidden="true"
            />
          ) : null}
          {!isAdmin && TypeIcon ? <span className="type-indicator" aria-label={`Type : ${post.contentType}`}><TypeIcon aria-hidden="true" className="size-3.5" /></span> : null}
        </div>
        <div className="post-card-copy">
          <p className="truncate text-sm font-medium">@{post.authorUsername.replace(/^@/, "")}</p>
          {post.caption ? <p className="line-clamp-2 text-pretty text-xs text-muted">{post.captionTranslation?.text ?? post.caption}</p> : null}
          <div className="card-tags" aria-label="Tags">
            {visibleTags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}
          </div>
        </div>
      </button>
      {isAdmin && selection ? (
        <label className="post-selection-control">
          <input type="checkbox" checked={selection.checked} disabled={selection.disabled}
            onChange={selection.onToggle} aria-label={`Sélectionner la publication de ${post.authorUsername}`}
            data-selection-id={post.id} />
        </label>
      ) : isAdmin ? (
        <button
          className={cn("favorite-button", favorite && "is-favorite")}
          type="button"
          aria-label={favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
          aria-pressed={favorite}
          onClick={onToggleFavorite}
        >
          <Heart aria-hidden="true" className="size-4" fill={favorite ? "currentColor" : "none"} />
        </button>
      ) : null}
    </article>
  );
}

export function validMediaRatio(width: number, height: number): number | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return Math.min(2, Math.max(0.5, width / height));
}
