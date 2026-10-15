"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowUpRight, ExternalLink, Loader2, MapPin, X } from "lucide-react";
import Link from "next/link";
import { RichPostMedia } from "@/features/library/components/post-detail-dialog";
import { PostCaption } from "@/features/library/components/post-caption";
import { PlaceAddressLink } from "@/features/places/components/place-address-link";
import type { LibraryPost, LibraryPostMedia } from "@/features/library/types";

type Props = {
  postId: string | null;
  placeId?: string;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onSelectPlace?: (placeId: string) => void;
};

export function PlacesPostPreviewDialog(props: Props) {
  const [retained, setRetained] = useState(props);
  if (props.postId && (props.postId !== retained.postId || props.placeId !== retained.placeId)) setRetained(props);
  const current = props.postId ? props : retained;
  if (!current.postId) return null;
  return <PreviewContent key={current.postId} {...current} postId={current.postId} open={Boolean(props.postId)} onExited={() => setRetained(props)} />;
}

function PreviewContent({ postId, placeId, onClose, onSelectPlace, returnFocusRef, open, onExited }: Omit<Props, "postId"> & { postId: string; open: boolean; onExited: () => void }) {
  const [post, setPost] = useState<LibraryPost | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/posts/${encodeURIComponent(postId)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("POST_UNAVAILABLE");
        const value = await response.json() as LibraryPost;
        if (value.id !== postId || !Array.isArray(value.media)) throw new Error("INVALID_POST_DETAIL");
        if (!controller.signal.aborted) setPost(value);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [postId, attempt]);

  const selectedPlace = post?.places?.find(place => place.id === placeId);
  const places = [...(post?.places ?? [])].sort((a, b) => Number(b.id === placeId) - Number(a.id === placeId));
  const media: LibraryPostMedia[] = !post ? [] : post.media.length
    ? [...post.media].sort((a, b) => a.position - b.position)
    : [{ id: `${post.id}-legacy`, type: "image", url: post.mediaUrl, sourcePath: null, thumbnailUrl: post.thumbnailUrl, position: 0 }];

  // Keep the same dialog mounted from loading through success, preserving focus
  // trapping and scroll locking while the content arrives.
  return (
    <Dialog.Root open={open} onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay map-post-overlay" />
        <Dialog.Content className="map-post-dialog" aria-labelledby={undefined} aria-label={post ? `Publication de ${post.authorUsername}` : "Publication"}
          onOpenAutoFocus={() => { opener.current = returnFocusRef ? returnFocusRef.current : document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (!open) {
              const target = opener.current?.isConnected && opener.current !== document.body
                ? opener.current : placeId ? document.querySelector<HTMLElement>(`[data-map-preview-id="${CSS.escape(placeId)}"]`) : null;
              (target ?? document.querySelector<HTMLElement>(".places-search input"))?.focus({ preventScroll: true });
              onExited();
            }
          }}>
          <header className="map-post-header">
            <div>
              <span className="map-post-eyebrow"><MapPin size={13} aria-hidden="true" /> Découvert sur la carte</span>
              <Dialog.Title>{selectedPlace?.displayName ?? "Le post et ses lieux"}</Dialog.Title>
              <Dialog.Description>{post ? `@${post.authorUsername}` : "Chargement de la publication…"}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="icon-button" aria-label="Fermer le détail"><X size={22} aria-hidden="true" /></button>
            </Dialog.Close>
          </header>
          {post ? (
            <div className="map-post-body motion-content">
              <div className="map-post-media"><RichPostMedia media={media} authorUsername={post.authorUsername} /></div>
              <div className="map-post-info">
                {post.mainTheme ? <span className="map-post-theme">{post.mainTheme}</span> : null}
                <PostCaption caption={post.caption} translation={post.captionTranslation?.text} />
                {places.length ? (
                  <section className="map-post-places" aria-label="Lieux associés">
                    <h3>{places.length === 1 ? "Le lieu du post" : `${places.length} lieux dans ce post`}</h3>
                    <ul>
                      {places.map(place => (
                        <li key={place.id} data-current={place.id === placeId || undefined}>
                          <strong>{place.displayName}</strong>
                          <PlaceAddressLink place={place} />
                          <Link className="map-post-place-action" href={`/places?${new URLSearchParams({ placeId: place.id })}`}
                            onNavigate={onSelectPlace ? event => { event.preventDefault(); onSelectPlace(place.id); } : undefined}>
                            <MapPin size={15} aria-hidden="true" /> Voir dans Places <ArrowUpRight size={15} aria-hidden="true" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {post.tags.length ? <ul className="readonly-tags" aria-label="Tags du post">{post.tags.map(tag => <li key={tag}>{tag}</li>)}</ul> : null}
                <footer className="map-post-actions">
                  <a className="button button-primary" href={post.postUrl} target="_blank" rel="noopener noreferrer">
                    Ouvrir sur Instagram <ExternalLink size={15} aria-hidden="true" />
                  </a>
                  <Link className="map-post-library-link" href={`/?${new URLSearchParams({ author: post.authorUsername })}`}>
                    Autres posts de cet auteur <ArrowUpRight size={15} aria-hidden="true" />
                  </Link>
                </footer>
              </div>
            </div>
          ) : (
            <div className="map-post-state">
              {error ? <><p role="alert">Impossible de charger cette publication. Elle a peut-être été supprimée.</p>
                <button type="button" className="button" onClick={() => { setError(false); setAttempt(value => value + 1); }}>Réessayer</button></>
                : <p role="status"><Loader2 size={24} className="animate-spin" aria-hidden="true" /> Chargement du post…</p>}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
