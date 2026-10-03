"use client";

import { useEffect, useState, useTransition } from "react";
import { ExternalLink, Loader2, MapPin, X } from "lucide-react";

import type { PlacesMapItem } from "@/server/places/map-view";
import { cn } from "@/lib/utils";
import { confirmPlaceAction, loadPlacePostsAction, rejectPlaceAction, type PlacePostDetailDto } from "@/features/places/actions";
import { PlaceAddressLink } from "@/features/places/components/place-address-link";

// Detail sheet for the selected place. Review writes call the internal Server
// Actions (never the read-only external API); each action is guarded against
// double submission and reports a bounded error code.

const PRECISION_LABEL: Record<string, string> = {
  EXACT: "Exact",
  PROBABLE: "Probable",
  APPROXIMATE: "Approximatif",
};

const ERROR_LABEL: Record<string, string> = {
  FORBIDDEN: "Connectez-vous en administrateur pour modifier ce lieu.",
  PLACE_NOT_FOUND: "Ce lieu n’existe plus.",
  PLACE_REVIEW_AUDIT_CONTEXT_MISSING:
    "Impossible d’enregistrer une preuve de revue pour ce lieu : aucune analyse liée.",
};

type Pending = "confirm" | "reject" | null;

type SheetProps = { place: PlacesMapItem; isAdmin: boolean; onClose: () => void };

// Remount on selection change: loading, error and confirmation state reset by
// construction instead of being cleared in an effect.
export function PlaceDetailSheet(props: SheetProps) {
  return <PlaceDetailSheetContent key={props.place.id} {...props} />;
}

function PlaceDetailSheetContent({ place, isAdmin, onClose }: SheetProps) {
  const [posts, setPosts] = useState<PlacePostDetailDto[] | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [postsError, setPostsError] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Pending>(null);
  const [, startTransition] = useTransition();

  // Load the associated posts on demand, dropping a stale response when the
  // selection changes. State is reset by remounting on place.id (see the keyed
  // wrapper below), so this effect only fetches.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await loadPlacePostsAction(place.id);
      if (cancelled) return;
      if (result.ok) {
        setPosts(result.posts);
        setSelectedPostId(result.posts[0]?.postId ?? null);
      }
      else setPostsError(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [place.id]);

  const runAction = (kind: Exclude<Pending, null>) => {
    if (pending) return; // guard against double submission
    setPending(kind);
    setActionError(null);
    startTransition(async () => {
      const result = kind === "confirm" ? await confirmPlaceAction(place.id) : await rejectPlaceAction(place.id);
      setPending(null);
      setConfirming(null);
      if (!result.ok) setActionError(ERROR_LABEL[result.code] ?? "L’action a échoué. Réessayez.");
    });
  };

  const radiusKm =
    place.precision === "APPROXIMATE" && place.approximationRadiusMeters
      ? Math.round(place.approximationRadiusMeters / 1000)
      : null;
  const selectedPost = posts?.find((post) => post.postId === selectedPostId) ?? null;
  const showPostSelector = posts === null || postsError || posts.length !== 1;

  return (
    <aside className="places-sheet" role="dialog" aria-label={`Détail de ${place.displayName}`}>
      <div className="places-sheet-grab" aria-hidden="true" />
      <header className="places-sheet-header">
        <div>
          <h2>{place.displayName}</h2>
          <p className="places-sheet-loc">
            {[place.city, place.region, place.country].filter(Boolean).join(" · ") || "Localisation inconnue"}
          </p>
        </div>
        <button type="button" className="places-icon-button" aria-label="Fermer le détail" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      </header>

      <div className="places-sheet-address"><PlaceAddressLink place={place} /></div>

      <div className="places-sheet-badges">
        <span className={cn("places-badge", `is-${place.precision.toLowerCase()}`)}>
          {radiusKm ? `Zone ~${radiusKm} km` : PRECISION_LABEL[place.precision]}
        </span>
        {place.isUserConfirmed ? <span className="places-badge is-confirmed">Confirmé</span> : null}
        {place.sourceThemes.map((theme) => (
          <span className="places-chip" key={theme}>
            {theme}
          </span>
        ))}
      </div>

      <p className="places-sheet-meta">
        {place.postCount} post(s) associé(s)
        {place.confidence ? ` · confiance ${place.confidence.toFixed(2)}` : ""}
      </p>

      {showPostSelector ? (
        <div className="places-sheet-posts">
          {posts === null && !postsError ? (
            <span className="places-sheet-loading">
              <Loader2 className="places-spin" size={15} aria-hidden="true" /> Chargement des posts…
            </span>
          ) : null}
          {postsError ? <span className="places-sheet-error">Impossible de charger les posts.</span> : null}
          {posts && posts.length > 1
            ? posts.slice(0, 6).map((post) => (
                <button
                  type="button"
                  key={post.postId}
                  className={cn("places-post-thumb", post.postId === selectedPostId && "is-selected")}
                  aria-label={`Afficher le post de ${post.authorUsername}`}
                  onClick={() => setSelectedPostId(post.postId)}
                >
                  {post.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={post.thumbnailUrl} alt="" loading="lazy" />
                  ) : (
                    <MapPin size={16} aria-hidden="true" />
                  )}
                </button>
              ))
            : null}
          {posts?.length === 0 ? <span className="places-sheet-error">Aucun post lié.</span> : null}
        </div>
      ) : null}

      {selectedPost ? (
        <article className="places-post-card">
          {selectedPost.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selectedPost.thumbnailUrl} alt="" loading="lazy" />
          ) : null}
          <div className="places-post-card-copy">
            <strong>@{selectedPost.authorUsername}</strong>
            {selectedPost.mainTheme ? <span>{selectedPost.mainTheme}</span> : null}
            <p>{selectedPost.caption || "Aucune légende disponible."}</p>
          </div>
        </article>
      ) : null}

      {actionError ? (
        <p className="places-sheet-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <div className="places-sheet-actions">
        {selectedPost ? (
          <a className="places-primary" href={selectedPost.postUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden="true" /> Voir le post
          </a>
        ) : null}

        {isAdmin ? (
          confirming ? (
            <>
              <span className="places-confirm-question">
                {confirming === "confirm" ? "Confirmer ce lieu ?" : "Rejeter ce résultat ?"}
              </span>
              <button
                type="button"
                className="places-primary"
                disabled={pending !== null}
                onClick={() => runAction(confirming)}
              >
                {pending ? <Loader2 className="places-spin" size={14} aria-hidden="true" /> : null} Oui
              </button>
              <button type="button" className="places-ghost" disabled={pending !== null} onClick={() => setConfirming(null)}>
                Annuler
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="places-ghost"
                disabled={pending !== null}
                onClick={() => setConfirming("confirm")}
              >
                Confirmer
              </button>
              <button
                type="button"
                className="places-ghost"
                disabled={pending !== null}
                onClick={() => setConfirming("reject")}
              >
                Rejeter
              </button>
            </>
          )
        ) : null}
      </div>
    </aside>
  );
}
