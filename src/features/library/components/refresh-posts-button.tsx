"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const CHANNEL = "INSTA_POST_EXPLORER_SYNC_V2";
const JOB_POLL_INTERVAL_MS = 2_000;
const BRIDGE_STALE_AFTER_MS = 90_000;
const MANUAL_TOKEN_LIFETIME_MS = 86_400_000;

function startErrorMessage(error: unknown) {
  switch (error) {
    case "export_already_running":
      return "Une synchronisation est déjà en cours dans cette extension.";
    case "another_export_is_running":
      return "Un export local est en cours dans l’extension. Terminez-le ou mettez-le en pause.";
    case "invalid_sync_origin":
      return "Cette version de l’extension n’autorise pas l’adresse actuelle du site.";
    case "invalid_sync_session":
      return "La session de synchronisation est invalide. Reconnectez-vous en administrateur.";
    default:
      return `L’extension n’a pas pu démarrer la synchronisation${typeof error === "string" ? ` (${error})` : ""}.`;
  }
}

type SyncState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "running"; synced: number }
  | { status: "paused"; synced: number; message: string }
  | { status: "success"; synced: number }
  | { status: "error"; message: string };

type ExtensionCandidate = { extensionId: string; version: string };
type SyncJobSnapshot = {
  status?: string;
  collected?: number;
  errorCode?: string | null;
  heartbeatAt?: string;
};
type ExtensionSyncTask = {
  status?: string;
  progressVersion?: number;
  processedCount?: number;
  totalCount?: number | null;
  stats?: { synced?: number };
  error?: string;
  resumeAt?: string | null;
  pausedReason?: { note?: string } | null;
};

function extensionProgressKey(task: ExtensionSyncTask) {
  return JSON.stringify([
    task.status ?? null,
    task.progressVersion ?? null,
    task.processedCount ?? 0,
    task.totalCount ?? null,
    task.stats?.synced ?? 0,
    task.error ?? null,
    task.resumeAt ?? null,
  ]);
}

function nextCandidate(candidates: Map<string, string>, attempted: Set<string>) {
  return [...candidates.entries()]
    .map(([extensionId, version]) => ({ extensionId, version }))
    .filter((candidate) => !attempted.has(candidate.extensionId))
    .sort((left, right) => {
      const versionOrder = right.version.localeCompare(left.version, undefined, { numeric: true });
      return versionOrder || left.extensionId.localeCompare(right.extensionId);
    })[0] ?? null;
}

function sendStart(candidate: ExtensionCandidate, requestId: string, payload: Record<string, unknown>) {
  window.postMessage({
    channel: CHANNEL,
    type: "START",
    targetExtensionId: candidate.extensionId,
    requestId,
    payload,
  }, window.location.origin);
}

export function useRefreshPosts(onCompleted: () => void, enabled = true) {
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => { onCompletedRef.current = onCompleted; }, [onCompleted]);
  const [extensionReady, setExtensionReady] = useState(false);
  const [state, setState] = useState<SyncState>({ status: "idle" });
  const requestId = useRef<string | null>(null);
  const candidates = useRef(new Map<string, string>());
  const attempted = useRef(new Set<string>());
  const syncPayload = useRef<Record<string, unknown> | null>(null);
  const currentTarget = useRef<string | null>(null);
  const attemptTimer = useRef<number | null>(null);
  const attemptNext = useRef<() => boolean>(() => false);
  const jobPollTimer = useRef<number | null>(null);
  const activeJobId = useRef<string | null>(null);
  const lastProgressAt = useRef(0);
  const lastExtensionProgressKey = useRef<string | null>(null);
  const lastJobHeartbeat = useRef<string | null>(null);
  const lastLeaseRenewalAt = useRef(0);
  const settled = useRef(false);
  const plannedResumeAt = useRef(0);
  const tokenExpiresAt = useRef(0);
  const heartbeatRejectedAt = useRef<number | null>(null);

  const stopJobPolling = useCallback(() => {
    activeJobId.current = null;
    if (jobPollTimer.current) {
      window.clearTimeout(jobPollTimer.current);
      jobPollTimer.current = null;
    }
  }, []);

  const settleSuccess = useCallback((synced: number) => {
    if (settled.current) return;
    settled.current = true;
    stopJobPolling();
    setState({ status: "success", synced });
    onCompletedRef.current();
  }, [stopJobPolling]);

  const settleError = useCallback((message: string) => {
    if (settled.current) return;
    settled.current = true;
    const token = syncPayload.current?.token;
    if (typeof token === "string") {
      void fetch("/api/sync/complete", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: "failed", error: "MANUAL_SYNC_INTERRUPTED", mediaFailed: 0 }),
      }).catch(() => {});
    }
    stopJobPolling();
    setState({ status: "error", message });
  }, [stopJobPolling]);

  const startJobPolling = useCallback((jobId: string) => {
    stopJobPolling();
    activeJobId.current = jobId;

    const readJob = async () => {
      try {
        const response = await fetch(`/api/sync/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const job = await response.json() as SyncJobSnapshot;
        if (activeJobId.current !== jobId || settled.current) return;
        if (job.status === "COMPLETED") {
          settleSuccess(job.collected ?? 0);
          return;
        }
        if (job.status === "FAILED") {
          settleError(job.errorCode ?? "La synchronisation a échoué.");
          return;
        }
        if (job.status !== "PENDING" && job.status !== "RUNNING") return;
        if (heartbeatRejectedAt.current !== null) {
          settleError("La session de synchronisation a expiré. Relancez la synchronisation.");
          return;
        }
        if (typeof job.heartbeatAt === "string" && job.heartbeatAt !== lastJobHeartbeat.current) {
          lastJobHeartbeat.current = job.heartbeatAt;
          lastProgressAt.current = Date.now();
        }
      } catch {
        // Retry transient reads; a rejected heartbeat can race durable completion.
      }
    };

    const poll = async () => {
      if (activeJobId.current !== jobId || settled.current) return;
      await readJob();
      if (activeJobId.current !== jobId || settled.current) return;
      if (heartbeatRejectedAt.current !== null && Date.now() - heartbeatRejectedAt.current >= BRIDGE_STALE_AFTER_MS) {
        settleError("Impossible de confirmer la fin de la synchronisation. Rechargez la page pour vérifier son état.");
        return;
      }
      if (Date.now() >= tokenExpiresAt.current) {
        settleError("La session de synchronisation a expiré. Relancez la synchronisation.");
        return;
      }
      // A planned Instagram pause is not a stalled collector. Allow its advertised
      // resume time, then require actual progress within the normal watchdog window.
      if (Date.now() - Math.max(lastProgressAt.current, plannedResumeAt.current) >= BRIDGE_STALE_AFTER_MS) {
        settleError("La synchronisation ne répond plus. Rechargez la page puis réessayez.");
        return;
      }
      if (heartbeatRejectedAt.current === null && Date.now() - lastLeaseRenewalAt.current >= 30_000 && typeof syncPayload.current?.token === "string") {
        try {
          const renewal = await fetch("/api/sync/heartbeat", {
            method: "POST", headers: { Authorization: `Bearer ${syncPayload.current.token}` },
          });
          if (activeJobId.current !== jobId || settled.current) return;
          if (renewal.status === 401) {
            heartbeatRejectedAt.current = Date.now();
            await readJob();
          } else if (renewal.ok) lastLeaseRenewalAt.current = Date.now();
        } catch {
          // A transient heartbeat failure is retried before the lease expires.
        }
      }
      if (activeJobId.current !== jobId || settled.current) return;
      jobPollTimer.current = window.setTimeout(() => { void poll(); }, JOB_POLL_INTERVAL_MS);
    };

    void poll();
  }, [settleError, settleSuccess, stopJobPolling]);

  useEffect(() => {
    attemptNext.current = () => {
      if (!requestId.current || !syncPayload.current) return false;
      const candidate = nextCandidate(candidates.current, attempted.current);
      if (!candidate) return false;
      attempted.current.add(candidate.extensionId);
      currentTarget.current = candidate.extensionId;
      sendStart(candidate, requestId.current, syncPayload.current);
      if (attemptTimer.current) window.clearTimeout(attemptTimer.current);
      attemptTimer.current = window.setTimeout(() => {
        if (!attemptNext.current()) {
          settleError("Aucune installation de l’extension n’a répondu. Rechargez la dernière version d’Insta Saved Sync.");
        }
      }, 2_500);
      return true;
    };
    return () => {
      if (attemptTimer.current) window.clearTimeout(attemptTimer.current);
      stopJobPolling();
    };
  }, [settleError, stopJobPolling]);

  useEffect(() => {
    if (!enabled) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data as { channel?: string; type?: string; requestId?: string; payload?: Record<string, unknown> };
      if (message.channel !== CHANNEL) return;
      if (message.type === "EXTENSION_READY") {
        const id = typeof message.payload?.extensionId === "string" ? message.payload.extensionId : null;
        const version = typeof message.payload?.version === "string" ? message.payload.version : "0";
        if (id) {
          candidates.current.set(id, version);
          setExtensionReady(true);
        }
        return;
      }
      if (settled.current || !requestId.current || message.requestId !== requestId.current) return;
      if (message.payload?.extensionId !== currentTarget.current) return;
      if (message.type === "START_RESULT" && message.payload?.ok !== true) {
        if (attemptTimer.current) window.clearTimeout(attemptTimer.current);
        if (attemptNext.current()) return;
        settleError(startErrorMessage(message.payload?.error));
      }
      if (message.type === "START_RESULT" && message.payload?.ok === true && attemptTimer.current) {
        window.clearTimeout(attemptTimer.current);
        attemptTimer.current = null;
        lastProgressAt.current = Date.now();
      }
      if (message.type === "STATE" && message.payload?.ok !== true) {
        settleError("La communication avec l’extension a été interrompue. Rechargez l’extension puis réessayez.");
        return;
      }
      if (message.type !== "STATE" || message.payload?.ok !== true) return;
      const task = message.payload.task as ExtensionSyncTask | null;
      if (!task) return;
      const progressKey = extensionProgressKey(task);
      if (progressKey !== lastExtensionProgressKey.current) {
        lastExtensionProgressKey.current = progressKey;
        lastProgressAt.current = Date.now();
      }
      if (task.status !== "paused") plannedResumeAt.current = 0;
      const synced = task.stats?.synced ?? 0;
      if (task.status === "completed") {
        settleSuccess(synced);
      } else if (task.status === "failed") {
        settleError(task.error ?? "La synchronisation a échoué.");
      } else if (task.status === "paused" && !task.resumeAt) {
        settleError("Synchronisation en pause. Vérifiez votre session Instagram puis relancez.");
      } else if (task.status === "paused") {
        const resumeAt = Date.parse(task.resumeAt as string);
        if (!Number.isFinite(resumeAt) || resumeAt >= tokenExpiresAt.current) {
          settleError("La pause dépasse la durée de cette session. Vérifiez Instagram puis relancez la synchronisation.");
          return;
        }
        plannedResumeAt.current = resumeAt;
        const resumeTime = new Date(task.resumeAt as string).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit" });
        setState({
          status: "paused",
          synced,
          message: `${task.pausedReason?.note ?? "La synchronisation attend avant de réessayer."} Reprise automatique vers ${resumeTime}.`,
        });
      } else {
        setState({ status: "running", synced });
      }
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ channel: CHANNEL, type: "DISCOVER" }, window.location.origin);
    return () => {
      window.removeEventListener("message", onMessage);
      if (attemptTimer.current) window.clearTimeout(attemptTimer.current);
      stopJobPolling();
    };
  }, [enabled, settleError, settleSuccess, stopJobPolling]);

  const start = async () => {
    setState({ status: "starting" });
    try {
      settled.current = false;
      stopJobPolling();
      syncPayload.current = null;
      lastLeaseRenewalAt.current = Date.now();
      lastProgressAt.current = Date.now();
      lastExtensionProgressKey.current = null;
      lastJobHeartbeat.current = null;
      plannedResumeAt.current = 0;
      heartbeatRejectedAt.current = null;
      attempted.current.clear();
      const candidate = nextCandidate(candidates.current, attempted.current);
      if (!candidate) throw new Error("EXTENSION_NOT_FOUND");
      const response = await fetch("/api/sync/session", { method: "POST" });
      if (response.status === 409) throw new Error("SYNC_IN_PROGRESS");
      if (!response.ok) throw new Error("SESSION_FAILED");
      const payload = await response.json() as Record<string, unknown>;
      const jobId = typeof payload.jobId === "string" ? payload.jobId : null;
      if (!jobId) throw new Error("SESSION_FAILED");
      requestId.current = crypto.randomUUID();
      syncPayload.current = payload;
      const lifetime = typeof payload.expiresInSeconds === "number" && payload.expiresInSeconds > 0
        ? Math.min(payload.expiresInSeconds * 1000, MANUAL_TOKEN_LIFETIME_MS)
        : MANUAL_TOKEN_LIFETIME_MS;
      tokenExpiresAt.current = Date.now() + lifetime;
      currentTarget.current = null;
      startJobPolling(jobId);
      if (!attemptNext.current()) throw new Error("EXTENSION_NOT_FOUND");
      window.setTimeout(() => {
        setState((current) => current.status === "starting"
          ? { status: "error", message: "Extension introuvable. Installez ou rechargez Insta Saved Sync." }
          : current);
      }, 5_000);
    } catch (error) {
      settleError(error instanceof Error && error.message === "EXTENSION_NOT_FOUND"
        ? "Extension introuvable. Installez ou rechargez la dernière version d’Insta Saved Sync."
        : error instanceof Error && error.message === "SYNC_IN_PROGRESS"
          ? "Une synchronisation est déjà en cours sur le serveur ou sur un autre appareil. Réessayez après sa fin."
        : "Impossible de créer la session de synchronisation.");
    }
  };

  return { state, extensionReady, start };
}

export function RefreshPostsButton({ onCompleted, menuItem = false }: { onCompleted: () => void; menuItem?: boolean }) {
  const controller = useRefreshPosts(onCompleted);
  return <RefreshPostsControl controller={controller} menuItem={menuItem} />;
}

export function RefreshPostsControl({ controller, menuItem = false }: {
  controller: ReturnType<typeof useRefreshPosts>;
  menuItem?: boolean;
}) {
  const { state, extensionReady, start } = controller;
  const busy = state.status === "starting" || state.status === "running" || state.status === "paused";
  const label = state.status === "running"
    ? `${state.synced} nouveau${state.synced > 1 ? "x" : ""}`
    : state.status === "paused"
      ? `En pause (${state.synced})`
    : state.status === "success"
      ? `${state.synced} synchronisé${state.synced > 1 ? "s" : ""}`
      : "Actualiser les posts";

  const trigger = (
      <button className={menuItem ? "menu-item sync-button" : "button sync-button"} type="button" disabled={busy} onClick={() => void start()} title={extensionReady ? undefined : "Nécessite l’extension Insta Saved Sync"}>
        {state.status === "success"
          ? <CheckCircle2 aria-hidden="true" className="size-4" />
          : <RefreshCw aria-hidden="true" className={busy ? "size-4 sync-spin" : "size-4"} />}
        <span>{label}</span>
      </button>
  );

  return (
    <div className="sync-action" role={menuItem ? "none" : undefined}>
      {menuItem ? <DropdownMenu.Item asChild onSelect={(event) => event.preventDefault()}>{trigger}</DropdownMenu.Item> : trigger}
      {state.status === "paused" ? <span className="sync-status" role="status">{state.message}</span> : null}
      {state.status === "error" ? <span className="sync-error" role="alert">{state.message}</span> : null}
    </div>
  );
}
