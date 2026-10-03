"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, FileWarning, MapPin, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { DeletePostAlert } from "@/features/library/components/admin/delete-post-alert";
import { PostTagEditor } from "@/features/library/components/admin/post-tag-editor";
import { BrokenImage } from "@/features/library/components/library-states";
import { parseCaptionMetrics } from "@/features/library/caption-metrics";
import type { LibraryPost, LibraryPostMedia } from "@/features/library/types";
import { PlaceAddressLink } from "@/features/places/components/place-address-link";

type PostDetailDialogProps = {
  post: LibraryPost | null;
  position: number;
  total: number;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  isAdmin: boolean;
};

export function PostDetailDialog({ post, position, total, onClose, onPrevious, onNext, isAdmin }: PostDetailDialogProps) {
  const [copied, setCopied] = useState(false);
  const [detailPost, setDetailPost] = useState<LibraryPost | null>(null);

  useEffect(() => {
    if (!post) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.defaultPrevented || target?.closest("input, textarea, select, a, video, [data-media-control], [contenteditable='true'], [role='alertdialog']")) return;
      if (event.key === "ArrowLeft") onPrevious();
      if (event.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNext, onPrevious, post]);

  useEffect(() => {
    if (!post) return;
    const controller = new AbortController();
    void fetch(`/api/posts/${encodeURIComponent(post.id)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (!controller.signal.aborted && value && typeof value === "object") setDetailPost(value as LibraryPost);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("Unable to load post detail");
        }
      });
    return () => controller.abort();
  }, [post]);

  if (!post) return null;
  const displayPost = detailPost?.id === post.id ? detailPost : post;
  const media = displayPost.media.length
    ? [...displayPost.media].sort((left, right) => left.position - right.position)
    : [{ id: `${displayPost.id}-legacy`, type: "image" as const, url: displayPost.mediaUrl, sourcePath: null, thumbnailUrl: displayPost.thumbnailUrl, position: 0 }];
  const caption = parseCaptionMetrics(displayPost.caption);

  const copyLink = async () => {
    await navigator.clipboard.writeText(displayPost.postUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="detail-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = document.querySelector<HTMLButtonElement>(`[data-post-id="${CSS.escape(post.id)}"]`);
            trigger?.focus();
          }}
        >
          <Dialog.Title className="sr-only">Publication de {displayPost.authorUsername}</Dialog.Title>
          <Dialog.Description className="sr-only">Détail de la publication, avec navigation précédente et suivante.</Dialog.Description>
          <header className="detail-header">
            <div className="detail-progress" aria-label={`Publication ${position + 1} sur ${total}`}>
              <span aria-hidden="true" />
              <span className="tabular-nums">{position + 1} / {total}</span>
            </div>
            <Dialog.Close asChild>
              <button className="icon-button" type="button" aria-label="Fermer le détail">
                <X aria-hidden="true" className="size-5" />
              </button>
            </Dialog.Close>
          </header>

          <div className="detail-scroll">
            <RichPostMedia key={displayPost.id} media={media} authorUsername={displayPost.authorUsername} />

            <div className="detail-author-row">
              <div className="avatar" aria-hidden="true">{displayPost.authorUsername.replace(/^@/, "").slice(0, 1).toUpperCase()}</div>
              <div className="min-w-0">
                <p className="truncate font-semibold">@{displayPost.authorUsername.replace(/^@/, "")}</p>
                {displayPost.savedAt ? <p className="text-xs text-muted">{formatSavedAt(displayPost.savedAt)}</p> : null}
              </div>
              <a className="button ml-auto" href={displayPost.postUrl} target="_blank" rel="noopener noreferrer">
                Ouvrir sur Instagram
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
            </div>

            <dl className="metadata-grid">
              <div><dt>Type</dt><dd>{formatMediaType(media, displayPost.contentType)}</dd></div>
              <div><dt>Thème</dt><dd>{displayPost.mainTheme || "Non défini"}</dd></div>
              <div><dt>Likes</dt><dd className="tabular-nums">{formatMetric(displayPost.likesCount ?? caption.likes)}</dd></div>
              <div><dt>Date</dt><dd>{formatPublishedAt(displayPost.publishedAt ?? caption.publishedAt?.toISOString() ?? null)}</dd></div>
            </dl>

            {displayPost.places?.length ? (
              <section className="detail-section" aria-labelledby="detail-places">
                <h2 id="detail-places" className="field-label">{displayPost.places.length === 1 ? "Lieu associé" : "Lieux associés"}</h2>
                <ul className="post-place-links">
                  {displayPost.places.map((place) => (
                    <li key={place.id}>
                      <div><strong>{place.displayName}</strong><PlaceAddressLink place={place} /></div>
                      <Link className="button" href={`/places?${new URLSearchParams({ placeId: place.id })}`}>
                        <MapPin className="size-4" aria-hidden="true" />Voir dans Places
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <p className="detail-caption text-pretty">{caption.text || "Aucune légende disponible."}</p>

            <section className="detail-section" aria-labelledby="detail-tags">
              <h2 id="detail-tags" className="field-label">Tags</h2>
              {isAdmin ? (
                <PostTagEditor
                  postId={displayPost.id}
                  tags={displayPost.tags}
                  onTagsChange={(tags) => setDetailPost({ ...displayPost, tags })}
                />
              ) : displayPost.tags.some((tag) => tag !== "Favoris") ? (
                <ul className="readonly-tags" aria-label="Tags associés à cette publication">
                  {displayPost.tags.filter((tag) => tag !== "Favoris").map((tag) => <li key={tag}>#{tag}</li>)}
                </ul>
              ) : <p className="text-sm text-muted">Aucun tag</p>}
            </section>

          </div>

          <footer className="detail-footer">
            <div className="detail-navigation">
              <button className="button" type="button" onClick={onPrevious}>
                <ArrowLeft aria-hidden="true" className="size-4" /> Précédent
              </button>
              <button className="button button-primary" type="button" onClick={onNext}>
                Suivant <ArrowRight aria-hidden="true" className="size-4" />
              </button>
            </div>
            <button className="button w-full" type="button" onClick={copyLink}>
              {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
              {copied ? "Lien copié" : "Copier le lien"}
            </button>
            {isAdmin ? (
              <DeletePostAlert
                postId={displayPost.id}
                authorUsername={displayPost.authorUsername}
                onDeleted={() => {
                  onClose();
                  window.location.reload();
                }}
              />
            ) : null}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RichPostMedia({ media, authorUsername }: { media: LibraryPostMedia[]; authorUsername: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeMedia = media[activeIndex];
  const hasMultipleMedia = media.length > 1;
  const selectPrevious = () => setActiveIndex((index) => (index - 1 + media.length) % media.length);
  const selectNext = () => setActiveIndex((index) => (index + 1) % media.length);

  return (
    <section className="detail-media-shell" aria-label={`Médias de la publication de ${authorUsername}`}>
      <div className="detail-media">
        <MediaItem
          key={activeMedia.id}
          media={activeMedia}
          alt={`Média ${activeIndex + 1} sur ${media.length} de la publication de ${authorUsername}`}
        />
        {hasMultipleMedia ? (
          <>
            <button className="media-nav media-nav-left" type="button" onClick={selectPrevious} aria-label="Média précédent" data-media-control>
              <ChevronLeft aria-hidden="true" className="size-5" />
            </button>
            <button className="media-nav media-nav-right" type="button" onClick={selectNext} aria-label="Média suivant" data-media-control>
              <ChevronRight aria-hidden="true" className="size-5" />
            </button>
            <span className="media-counter tabular-nums" aria-live="polite">{activeIndex + 1} / {media.length}</span>
          </>
        ) : null}
      </div>
      {hasMultipleMedia ? (
        <div className="media-pagination" aria-label="Choisir un média">
          {media.map((item, index) => (
            <button
              key={item.id}
              className="media-page"
              data-active={index === activeIndex}
              data-media-control
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={`Afficher le média ${index + 1} sur ${media.length}`}
              aria-current={index === activeIndex ? "true" : undefined}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MediaItem({ media, alt }: { media: LibraryPostMedia; alt: string }) {
  if (!media.url && media.type === "image" && media.thumbnailUrl) {
    return <DetailImage imageUrl={media.thumbnailUrl} alt={alt} />;
  }
  if (!media.url) return <UnavailableMedia sourcePath={media.sourcePath} />;
  if (media.type === "video") return <DetailVideo media={media} />;
  return <DetailImage imageUrl={media.url} alt={alt} />;
}

function DetailImage({ imageUrl, alt }: { imageUrl: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !imageUrl) return <BrokenImage />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt={alt}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function DetailVideo({ media }: { media: LibraryPostMedia }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  return (
    <video
      ref={videoRef}
      src={media.url ?? undefined}
      poster={media.thumbnailUrl ?? undefined}
      controls
      playsInline
      preload="metadata"
      onClick={togglePlayback}
      aria-label="Vidéo de la publication. Cliquer pour lire ou mettre en pause."
    />
  );
}

function UnavailableMedia({ sourcePath }: { sourcePath: string | null }) {
  return (
    <div className="unavailable-media" role="img" aria-label="Média indisponible en ligne">
      <FileWarning aria-hidden="true" className="size-7" />
      <strong>Média indisponible</strong>
      <span>{sourcePath ? "Le fichier existe dans la source locale, mais aucune URL lisible n’est disponible." : "Aucune URL n’est disponible pour ce média."}</span>
    </div>
  );
}

function formatMediaType(media: LibraryPostMedia[], legacyType: LibraryPost["contentType"]) {
  if (media.length > 1 || legacyType === "carousel") return "Carrousel";
  if (media[0]?.type === "video" || legacyType === "reel") return "Vidéo";
  return "Photo";
}

function formatSavedAt(value: string | null) {
  return value ? `Enregistré le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(value))}` : "";
}

function formatPublishedAt(value: string | null) {
  if (!value) return "Inconnue";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Inconnue"
    : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

function formatMetric(value: number | null) {
  return value === null ? "Non disponible" : new Intl.NumberFormat("fr-FR").format(value);
}
