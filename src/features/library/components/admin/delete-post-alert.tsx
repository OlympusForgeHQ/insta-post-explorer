"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Trash2, X } from "lucide-react";
import { useRef, useState } from "react";

type DeletePostAlertProps = {
  postId: string;
  authorUsername: string;
  onDeleted: () => void;
};

export function DeletePostAlert({ postId, authorUsername, onDeleted }: DeletePostAlertProps) {
  const deletedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deletePost = async () => {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(postId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("POST_DELETE_FAILED");
      deletedRef.current = true;
      setOpen(false);
      onDeleted();
    } catch {
      setError("Impossible de supprimer cette publication.");
      setDeleting(false);
    }
  };

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (deleting && !nextOpen) return;
        setOpen(nextOpen);
        if (nextOpen) setError(null);
      }}
    >
      <AlertDialog.Trigger asChild>
        <button className="button w-full text-[var(--danger)]" type="button">
          <Trash2 aria-hidden="true" className="size-4" />
          Supprimer la publication
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content
          className="import-dialog"
          onCloseAutoFocus={(event) => {
            if (deletedRef.current) event.preventDefault();
          }}
        >
          <div className="modal-heading">
            <div>
              <AlertDialog.Title className="text-lg font-semibold">Supprimer cette publication ?</AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-sm text-muted">
                La publication de @{authorUsername.replace(/^@/, "")} et ses associations de tags seront supprimées définitivement.
                {" "}Elle ne sera plus réimportée lors des synchronisations.
              </AlertDialog.Description>
            </div>
            <AlertDialog.Cancel asChild>
              <button className="icon-button" type="button" aria-label="Annuler la suppression" disabled={deleting}>
                <X aria-hidden="true" className="size-5" />
              </button>
            </AlertDialog.Cancel>
          </div>

          {error ? <p className="request-error mt-4" role="alert">{error}</p> : null}

          <div className="modal-actions">
            <AlertDialog.Cancel asChild>
              <button className="button" type="button" disabled={deleting}>Annuler</button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                className="button button-primary"
                type="button"
                disabled={deleting}
                style={{ background: "var(--danger)", borderColor: "var(--danger)" }}
                onClick={(event) => {
                  event.preventDefault();
                  void deletePost();
                }}
              >
                <Trash2 aria-hidden="true" className="size-4" />
                {deleting ? "Suppression…" : "Supprimer définitivement"}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
