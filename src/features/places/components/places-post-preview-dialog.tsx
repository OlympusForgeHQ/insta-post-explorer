"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { PostDetailDialog } from "@/features/library/components/post-detail-dialog";
import type { LibraryPost } from "@/features/library/types";

type Props = { postId: string; isAdmin: boolean; onClose: () => void; onSelectPlace?: (placeId: string) => void };
const noNavigation = () => undefined;

export function PlacesPostPreviewDialog(props: Props) {
  return <PreviewContent key={props.postId} {...props} />;
}

function PreviewContent({ postId, isAdmin, onClose, onSelectPlace }: Props) {
  const [post, setPost] = useState<LibraryPost | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
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

  if (post) return <PostDetailDialog post={post} position={0} total={1} onClose={onClose}
    onPrevious={noNavigation} onNext={noNavigation} isAdmin={isAdmin} loadDetail={false} onSelectPlace={onSelectPlace} />;

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="detail-dialog places-preview-loading" onCloseAutoFocus={event => event.preventDefault()}>
          <Dialog.Title>Publication</Dialog.Title>
          <Dialog.Description className="sr-only">Chargement de la publication associée au lieu.</Dialog.Description>
          <Dialog.Close asChild><button type="button" className="icon-button" aria-label="Fermer le détail"><X size={20} aria-hidden="true" /></button></Dialog.Close>
          {error ? (
            <div>
              <p role="alert">Impossible de charger cette publication. Elle a peut-être été supprimée.</p>
              <button type="button" className="button" onClick={() => { setError(false); setAttempt(value => value + 1); }}>Réessayer</button>
            </div>
          ) : <p role="status"><Loader2 size={20} className="animate-spin" aria-hidden="true" /> Chargement du post…</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
