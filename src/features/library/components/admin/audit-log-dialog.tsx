"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AUDIT_OPERATIONS, AUDIT_OPERATION_LABELS, AUDIT_TABLES, AUDIT_TABLE_LABELS,
  type AuditLogItem, type AuditLogPage,
} from "@/features/library/audit-types";

export function AuditLogDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [table, setTable] = useState("");
  const [operation, setOperation] = useState("");
  const [revision, setRevision] = useState(0);
  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="stats-dialog">
          <header className="stats-header">
            <div>
              <Dialog.Title className="stats-title">Journal des modifications</Dialog.Title>
              <Dialog.Description className="text-sm text-muted">Créations, modifications et suppressions enregistrées depuis l’activation du journal.</Dialog.Description>
            </div>
            <Dialog.Close asChild><button className="icon-button" type="button" aria-label="Fermer le journal"><X className="size-5" aria-hidden="true" /></button></Dialog.Close>
          </header>
          <div className="my-4 flex flex-wrap items-end gap-3">
            <div className="grid gap-1 text-sm"><label htmlFor="audit-table">Données</label>
              <select id="audit-table" className="button max-w-full" value={table} onChange={(event) => setTable(event.target.value)}>
                <option value="">Toutes les données</option>
                {AUDIT_TABLES.map((value) => <option key={value} value={value}>{AUDIT_TABLE_LABELS[value]}</option>)}
              </select>
            </div>
            <div className="grid gap-1 text-sm"><label htmlFor="audit-operation">Opération</label>
              <select id="audit-operation" className="button" value={operation} onChange={(event) => setOperation(event.target.value)}>
                <option value="">Toutes les opérations</option>
                {AUDIT_OPERATIONS.map((value) => <option key={value} value={value}>{AUDIT_OPERATION_LABELS[value]}</option>)}
              </select>
            </div>
            <button className="icon-button" type="button" aria-label="Actualiser le journal" onClick={() => setRevision((value) => value + 1)}><RefreshCw className="size-4" aria-hidden="true" /></button>
          </div>
          <AuditEntries key={`${table}:${operation}:${revision}`} table={table} operation={operation} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AuditEntries({ table, operation }: { table: string; operation: string }) {
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (table) params.set("table", table);
    if (operation) params.set("operation", operation);
    if (cursor) params.set("cursor", cursor);
    void fetch(`/api/admin/audit?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("AUDIT_UNAVAILABLE");
        return response.json() as Promise<AuditLogPage>;
      })
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems((previous) => cursor ? [...previous, ...page.items] : page.items);
        setNextCursor(page.nextCursor);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [table, operation, cursor, retry]);

  return <div className="grid gap-3">
    {items.map((event) => <details key={event.id} className="min-w-0 rounded-lg border border-current/15 p-3">
      <summary className="cursor-pointer text-sm">
        <strong>{AUDIT_OPERATION_LABELS[event.operation]} · {AUDIT_TABLE_LABELS[event.tableName]}</strong>
        <span className="mt-1 block text-xs text-muted"><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString("fr-FR")}</time> · {event.action === "admin.delete_post" ? "Suppression manuelle" : event.applicationName || event.databaseUser}</span>
      </summary>
      <dl className="my-3 grid gap-1 break-all text-xs text-muted">
        <div><dt className="inline font-semibold">Identifiant : </dt><dd className="inline">{JSON.stringify(event.recordKey)}</dd></div>
        <div><dt className="inline font-semibold">Origine : </dt><dd className="inline">{event.applicationName || "Connexion PostgreSQL"} ({event.databaseUser})</dd></div>
        <div><dt className="inline font-semibold">Transaction : </dt><dd className="inline">{event.transactionId}</dd></div>
      </dl>
      <div className="grid gap-3 sm:grid-cols-2">
        <Snapshot title="Avant" data={event.beforeData} />
        <Snapshot title="Après" data={event.afterData} />
      </div>
    </details>)}
    {!items.length && !loading && !error ? <p className="stats-status">Aucune modification enregistrée pour ces filtres.</p> : null}
    {loading ? <p role="status" className="stats-status">Chargement du journal…</p> : null}
    {error ? <div role="alert" className="stats-error">Le journal est momentanément indisponible. <button className="button" type="button" onClick={() => { setError(false); setLoading(true); setRetry((value) => value + 1); }}>Réessayer</button></div> : null}
    {nextCursor && !error ? <button className="button" type="button" disabled={loading} onClick={() => { setLoading(true); setCursor(nextCursor); }}>Charger les modifications précédentes</button> : null}
  </div>;
}

function Snapshot({ title, data }: { title: string; data: AuditLogItem["beforeData"] }) {
  return <section className="min-w-0"><h3 className="mb-1 text-sm font-semibold">{title}</h3><pre className="max-h-72 overflow-auto rounded bg-black/5 p-2 text-xs whitespace-pre-wrap break-all dark:bg-white/5">{data === null ? "—" : JSON.stringify(data, null, 2)}</pre></section>;
}
