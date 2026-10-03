"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function BulkDeletePostsAlert({ postIds, disabled, onDeleted }: {
  postIds: string[];
  disabled: boolean;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [batch, setBatch] = useState<string[]>([]);
  const [completed, setCompleted] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(false);
  const remaining = useRef<string[]>([]);
  const busy = useRef(false);
  const attempted = useRef(false);
  const lifetime = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  const deletePosts = async () => {
    const signal = lifetime.current?.signal;
    if (busy.current || !signal || signal.aborted) return;
    busy.current = true;
    setDeleting(true);
    setError(false);
    try {
      // Use the established owner-scoped, audited suppression transaction.
      while (remaining.current.length) {
        const id = remaining.current[0];
        attempted.current = true;
        const response = await fetch(`/api/posts/${encodeURIComponent(id)}`, {
          method: "DELETE", signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        });
        if (signal.aborted) return;
        // An alias or a request whose response was lost may already be deleted.
        if (!response.ok && response.status !== 404) throw new Error("POST_DELETE_FAILED");
        remaining.current.shift();
        setCompleted((value) => value + 1);
      }
      setOpen(false);
      onDeleted();
    } catch {
      if (!signal.aborted) setError(true);
    } finally {
      busy.current = false;
      if (!signal.aborted) setDeleting(false);
    }
  };

  return <AlertDialog.Root open={open} onOpenChange={(value) => {
    if (busy.current) return;
    if (value) {
      const ids = [...new Set(postIds)];
      setBatch(ids);
      remaining.current = ids.slice();
      attempted.current = false;
      setCompleted(0);
      setError(false);
    } else if (attempted.current) onDeleted();
    setOpen(value);
  }}>
    <AlertDialog.Trigger asChild>
      <button className="button selection-delete" type="button" aria-label="Supprimer la sélection" disabled={disabled || !postIds.length}>
        <Trash2 aria-hidden="true" className="size-4" />Supprimer ({postIds.length})
      </button>
    </AlertDialog.Trigger>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="dialog-overlay" />
      <AlertDialog.Content className="import-dialog" onCloseAutoFocus={(event) => { if (attempted.current) event.preventDefault(); }}>
        <AlertDialog.Title className="text-lg font-semibold">Supprimer {batch.length} publication{batch.length === 1 ? "" : "s"} ?</AlertDialog.Title>
        <AlertDialog.Description className="mt-2 text-sm text-muted">
          Ces publications et leurs associations seront supprimées définitivement. Elles ne seront plus réimportées lors des synchronisations.
        </AlertDialog.Description>
        {deleting ? <p className="mt-4 text-sm" role="status">Suppression : {completed} sur {batch.length} terminée{completed > 1 ? "s" : ""}…</p> : null}
        {error ? <p className="request-error mt-4" role="alert">{completed} sur {batch.length} suppressions confirmées. Impossible de terminer la suppression. Vous pouvez réessayer les publications restantes.</p> : null}
        <div className="modal-actions">
          <AlertDialog.Cancel asChild><button className="button" type="button" disabled={deleting}>{error ? "Fermer" : "Annuler"}</button></AlertDialog.Cancel>
          <button className="button button-primary selection-delete-confirm" type="button" disabled={deleting} onClick={() => void deletePosts()}>
            {deleting ? "Suppression…" : error ? `Réessayer les ${batch.length - completed} restantes` : "Supprimer définitivement"}
          </button>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
